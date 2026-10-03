// SPDX-License-Identifier: AGPL-3.0-only
package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"lumo/server/internal/appplugins"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"
)

type residentProcess struct {
	entry     string
	command   *exec.Cmd
	input     io.WriteCloser
	directory string
	transport *http.Transport
	done      chan struct{}
}
type residentRuntime struct {
	mu        sync.Mutex
	processes map[string]*residentProcess
}

func (s *Server) resident(ctx context.Context, pkg *appplugins.Package) (*residentProcess, error) {
	s.residents.mu.Lock()
	defer s.residents.mu.Unlock()
	if s.residents.processes == nil {
		s.residents.processes = map[string]*residentProcess{}
	}
	if running := s.residents.processes[pkg.Name]; running != nil {
		select {
		case <-running.done:
			delete(s.residents.processes, pkg.Name)
		default:
			if running.entry != pkg.Manifest.Backend.Entry {
				return nil, errors.New("restart Lumo to load the updated system app")
			}
			return running, nil
		}
	}
	directory, err := os.MkdirTemp("", "lumo-app-")
	if err != nil {
		return nil, err
	}
	success := false
	defer func() {
		if !success {
			os.RemoveAll(directory)
		}
	}()
	socket := filepath.Join(directory, "http.sock")
	listener, err := net.ListenUnix("unix", &net.UnixAddr{Name: socket, Net: "unix"})
	if err != nil {
		return nil, err
	}
	listener.SetUnlinkOnClose(false)
	defer listener.Close()
	descriptor, err := listener.File()
	if err != nil {
		return nil, err
	}
	defer descriptor.Close()
	command, err := pkg.Command(context.Background(), s.home, "serve-resident")
	if err != nil {
		return nil, err
	}
	executable, err := os.Executable()
	if err != nil {
		return nil, err
	}
	roots := appplugins.Roots()
	command.Env = append(os.Environ(), "LUMO_PLUGIN_DIR="+roots[0], "LUMO_PLUGIN_BUNDLED_DIR="+roots[1], "HOME="+s.home, "LUMO_APP_NAME="+pkg.Name, "LUMO_HOST_EXECUTABLE="+executable, "LUMO_APP_DATA="+appplugins.DataDirectory(s.home, pkg.Name))
	command.ExtraFiles = []*os.File{descriptor}
	command.Stderr = os.Stderr
	input, err := command.StdinPipe()
	if err != nil {
		return nil, err
	}
	if err = command.Start(); err != nil {
		input.Close()
		return nil, err
	}
	transport := &http.Transport{Proxy: nil, DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "unix", socket)
	}, MaxIdleConns: 8, IdleConnTimeout: time.Minute}
	process := &residentProcess{entry: pkg.Manifest.Backend.Entry, command: command, input: input, directory: directory, transport: transport, done: make(chan struct{})}
	go func() {
		command.Wait()
		close(process.done)
		input.Close()
		transport.CloseIdleConnections()
		os.RemoveAll(directory)
	}()
	readyCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	var status struct {
		ActiveOperations int `json:"activeOperations"`
	}
	if err = process.read(readyCtx, "status", &status); err != nil {
		input.Close()
		return nil, err
	}
	s.residents.processes[pkg.Name] = process
	success = true
	return process, nil
}
func (p *residentProcess) read(ctx context.Context, kind string, target any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://lumo-app/_lumo/"+kind, nil)
	if err != nil {
		return err
	}
	response, err := (&http.Client{Transport: p.transport}).Do(req)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	var envelope struct {
		OK   bool            `json:"ok"`
		Data json.RawMessage `json:"data"`
	}
	if response.StatusCode != 200 {
		return errors.New("app contribution unavailable")
	}
	if err = json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&envelope); err != nil {
		return err
	}
	if !envelope.OK {
		return errors.New("invalid app contribution")
	}
	return json.Unmarshal(envelope.Data, target)
}
func (s *Server) serveResident(w http.ResponseWriter, r *http.Request, pkg *appplugins.Package) {
	process, err := s.resident(r.Context(), pkg)
	if err != nil {
		WriteError(w, NewError(CodeUnavailable, "The system app could not start. Restart Lumo and try again."))
		return
	}
	proxy := &httputil.ReverseProxy{Transport: process.transport, FlushInterval: -1,
		Rewrite: func(request *httputil.ProxyRequest) {
			request.SetURL(&url.URL{Scheme: "http", Host: "lumo-app"})
			request.Out.Header = http.Header{"Content-Type": []string{"application/json"}}
		},
		ModifyResponse: func(response *http.Response) error {
			for name := range response.Header {
				if name != "Content-Type" && name != "Cache-Control" && name != "X-Lumo-Idempotent-Replay" && name != "Retry-After" {
					response.Header.Del(name)
				}
			}
			return nil
		},
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			WriteError(w, NewError(CodeUnavailable, "The system app connection ended."))
		},
	}
	proxy.ServeHTTP(w, r)
}
func (s *Server) pluginContributions(ctx context.Context, kind string) ([]any, error) {
	result := []any{}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	for _, name := range appplugins.NamesFor(s.home) {
		pkg, err := appplugins.LoadFor(s.home, name)
		if err != nil {
			return nil, err
		}
		if pkg.Manifest.Backend == nil {
			continue
		}
		for _, contribution := range pkg.Manifest.Backend.Contributions {
			if contribution != kind {
				continue
			}
			process, err := s.resident(ctx, pkg)
			if err != nil {
				return nil, err
			}
			var values []any
			if err = process.read(ctx, kind, &values); err != nil {
				return nil, err
			}
			result = append(result, values...)
		}
	}
	return result, nil
}
func (s *Server) ActiveOperations() int {
	s.residents.mu.Lock()
	processes := make([]*residentProcess, 0, len(s.residents.processes))
	for _, p := range s.residents.processes {
		processes = append(processes, p)
	}
	s.residents.mu.Unlock()
	count := int(s.folderMoves.Load())
	for _, p := range processes {
		select {
		case <-p.done:
			continue
		default:
		}
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		var status struct {
			ActiveOperations int `json:"activeOperations"`
		}
		err := p.read(ctx, "status", &status)
		cancel()
		if err != nil {
			count++
		} else {
			count += status.ActiveOperations
		}
	}
	return count
}
func (s *Server) Close() {
	s.residents.mu.Lock()
	defer s.residents.mu.Unlock()
	for _, p := range s.residents.processes {
		p.input.Close()
	}
}
