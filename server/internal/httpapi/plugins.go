// SPDX-License-Identifier: AGPL-3.0-only
package httpapi

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"syscall"
	"time"

	"lumo/plugin"
	"lumo/server/internal/appplugins"
)

type pluginOutput struct {
	bytes.Buffer
	limit int
}

func (b *pluginOutput) Write(data []byte) (int, error) {
	if b.Len()+len(data) > b.limit {
		return 0, fmt.Errorf("app response limit exceeded")
	}
	return b.Buffer.Write(data)
}
func (s *Server) handlePlugin(w http.ResponseWriter, r *http.Request, name string) {
	loaded, err := appplugins.LoadFor(s.home, name)
	if err != nil {
		WriteError(w, NewError(CodeUnavailable, "The app package is unavailable. Reinstall its complete package."))
		return
	}
	if loaded.Manifest.Auth != nil && r.URL.Path == loaded.Manifest.Auth.Start {
		w.Header().Set("X-Lumo-Plugin-OAuth", loaded.Manifest.Auth.Callback)
	}
	if !loaded.HasRoute(r.Method, r.URL.Path) {
		s.handleNotFound(w, r)
		return
	}
	limit := int64(maxBodyBytes)
	if loaded.Manifest.Backend.MaxBodyBytes > 0 {
		limit = loaded.Manifest.Backend.MaxBodyBytes
	}
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	if loaded.Manifest.Backend.Resident {
		s.serveResident(w, r, loaded)
		return
	}
	if loaded.Manifest.Backend.Privileged && r.Method == http.MethodPost && s.deps.BrokerSocket == "" {
		WriteError(w, NewError(CodeUnavailable, "The privileged broker is unavailable."))
		return
	}
	if loaded.Manifest.Backend.Serial || r.Method == http.MethodPost {
		value, _ := s.pluginLocks.LoadOrStore(name, make(chan struct{}, 1))
		gate := value.(chan struct{})
		if loaded.Manifest.Backend.Serial {
			select {
			case gate <- struct{}{}:
			default:
				WriteError(w, NewError(CodeBusy, "The app is busy. Wait for the current operation to finish."))
				return
			}
		} else {
			select {
			case gate <- struct{}{}:
			case <-r.Context().Done():
				WriteError(w, NewError(CodeUnavailable, "The app request was cancelled."))
				return
			}
		}
		defer func() { <-gate }()
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		WriteError(w, NewError(CodeValidationFailed, "Invalid app request."))
		return
	}
	key := ""
	digest := fmt.Sprintf("%x", sha256.Sum256(body))
	if r.Method == http.MethodPost {
		var request struct {
			RequestID string `json:"requestId"`
		}
		if json.Unmarshal(body, &request) != nil || !validRequestID(request.RequestID) {
			WriteError(w, NewError(CodeValidationFailed, "A request ID is required."))
			return
		}
		key = "plugin:" + name + ":" + r.URL.Path + ":" + request.RequestID
		if entry, ok := s.idem.get(key); ok {
			if entry.digest != digest {
				WriteError(w, NewError(CodeConflict, "This request ID was used with different content."))
				return
			}
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.Header().Set("X-Lumo-Idempotent-Replay", "true")
			w.WriteHeader(entry.status)
			w.Write(entry.body)
			return
		}
	}
	execute := func(target http.ResponseWriter) {
		ctx, cancel := context.WithTimeout(r.Context(), 75*time.Second)
		defer cancel()
		cmd, err := loaded.Command(ctx, s.home, "serve")
		if err != nil {
			WriteError(target, NewError(CodeUnavailable, "The app backend is missing or damaged."))
			return
		}
		request := r.Clone(ctx)
		request.Body = io.NopCloser(bytes.NewReader(body))
		request.ContentLength = int64(len(body))
		request.Header = http.Header{"Content-Type": []string{"application/json"}}
		request.Host = "lumo-plugin"
		request.RequestURI = ""
		var input bytes.Buffer
		if err = request.Write(&input); err != nil {
			WriteError(target, err)
			return
		}
		cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
		cmd.Cancel = func() error { return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL) }
		cmd.WaitDelay = time.Second
		cmd.Stdin = &input
		executable, _ := os.Executable()
		cmd.Env = append(os.Environ(), "HOME="+s.home, "LUMO_APP_DATA="+appplugins.DataDirectory(s.home, name), "LUMO_APP_NAME="+name, "LUMO_HOST_EXECUTABLE="+executable)
		output := &pluginOutput{limit: 32 << 20}
		diagnostic := &pluginOutput{limit: 64 << 10}
		cmd.Stdout = output
		cmd.Stderr = diagnostic
		if err = cmd.Run(); err != nil {
			WriteError(target, NewError(CodeUnavailable, "The app backend stopped or did not answer in time."))
			return
		}
		var reply plugin.Reply
		if json.Unmarshal(output.Bytes(), &reply) != nil || reply.Status < 200 || reply.Status > 599 {
			WriteError(target, NewError(CodeUnavailable, "The app backend returned an invalid response."))
			return
		}
		if reply.Broker != nil {
			if !loaded.AllowsBroker(reply.Broker.Action) {
				WriteError(target, NewError(CodeForbidden, "The app cannot use this system operation."))
				return
			}
			var request struct {
				RequestID string `json:"requestId"`
			}
			json.Unmarshal(body, &request)
			if reply.Broker.RequestID != request.RequestID {
				WriteError(target, NewError(CodeForbidden, "The app returned a mismatched system operation."))
				return
			}
			s.forwardBrokerAction(target, r, brokerAction{RequestID: reply.Broker.RequestID, Action: reply.Broker.Action, Arguments: reply.Broker.Arguments, Expected: reply.Broker.Expected}, 50*time.Second)
			return
		}
		for _, header := range []string{"Content-Type", "Location", "Retry-After"} {
			if value := reply.Headers.Get(header); value != "" {
				target.Header().Set(header, value)
			}
		}
		target.WriteHeader(reply.Status)
		target.Write(reply.Body)
	}
	if key == "" {
		execute(w)
		return
	}
	recorder := newResponseRecorder()
	execute(recorder)
	if recorder.status >= 200 && recorder.status < 300 || recorder.status >= 500 {
		s.idem.put(key, idemEntry{status: recorder.status, body: recorder.body.Bytes(), at: time.Now(), digest: digest})
	}
	for k, values := range recorder.header {
		w.Header()[k] = values
	}
	w.WriteHeader(recorder.status)
	w.Write(recorder.body.Bytes())
}
