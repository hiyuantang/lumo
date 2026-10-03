// SPDX-License-Identifier: AGPL-3.0-only
package httpapi

import (
	"bufio"
	"bytes"
	"context"
	_ "embed"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"lumo/server/internal/strictjson"
)

//go:embed pi_auth_bridge.mjs
var piAuthBridge string

type piAuthOutput struct{ bytes.Buffer }

func (b *piAuthOutput) Write(value []byte) (int, error) {
	if b.Len()+len(value) > 1<<20 {
		return 0, io.ErrShortBuffer
	}
	return b.Buffer.Write(value)
}

type piAuthMethod struct {
	Type  string `json:"type"`
	Label string `json:"label"`
}
type piProvider struct {
	ID         string         `json:"id"`
	Name       string         `json:"name"`
	Methods    []piAuthMethod `json:"methods"`
	Credential string         `json:"credential,omitempty"`
}
type piProviders struct {
	Providers []piProvider `json:"providers"`
}
type piAuthOption struct {
	ID    string `json:"id"`
	Label string `json:"label"`
}
type piAuthPrompt struct {
	ID          string         `json:"id"`
	Type        string         `json:"type"`
	Message     string         `json:"message"`
	Placeholder string         `json:"placeholder,omitempty"`
	Options     []piAuthOption `json:"options,omitempty"`
}
type piAuthLink struct {
	URL   string `json:"url"`
	Label string `json:"label,omitempty"`
}
type piAuthEvent struct {
	Type    string       `json:"type"`
	Message string       `json:"message,omitempty"`
	URL     string       `json:"url,omitempty"`
	Code    string       `json:"code,omitempty"`
	Links   []piAuthLink `json:"links,omitempty"`
}
type piAuthState struct {
	ID     string        `json:"id"`
	Status string        `json:"status"`
	Prompt *piAuthPrompt `json:"prompt,omitempty"`
	Events []piAuthEvent `json:"events"`
	Error  string        `json:"error,omitempty"`
}
type piAuthFlow struct {
	mu      sync.Mutex
	state   piAuthState
	input   io.WriteCloser
	cancel  context.CancelFunc
	touched time.Time
}
type piAuthRuntime struct {
	mu   sync.Mutex
	flow *piAuthFlow
}

func (s *Server) piAgentDir() (string, error) {
	dir := os.Getenv("PI_CODING_AGENT_DIR")
	if dir == "" {
		dir = filepath.Join(s.pi.home, ".pi", "agent")
	}
	if dir == "~" {
		dir = s.pi.home
	} else if strings.HasPrefix(dir, "~/") {
		dir = filepath.Join(s.pi.home, dir[2:])
	}
	if !filepath.IsAbs(dir) {
		return "", NewError(CodeValidationFailed, "Pi's agent directory must be an absolute path.")
	}
	return dir, nil
}

func (s *Server) piAuthCommand(ctx context.Context, operation, provider, method string) (*exec.Cmd, error) {
	binary, err := filepath.EvalSymlinks(s.pi.path())
	if err != nil {
		return nil, NewError(CodeUnavailable, "Set up the Pi engine in Pi first.")
	}
	root := filepath.Dir(binary)
	entry := ""
	for depth := 0; depth < 6; depth++ {
		data, _ := os.ReadFile(filepath.Join(root, "package.json"))
		var manifest struct {
			Name    string `json:"name"`
			Exports map[string]struct {
				Import string `json:"import"`
			} `json:"exports"`
		}
		if json.Unmarshal(data, &manifest) == nil && manifest.Name == "@earendil-works/pi-coding-agent" {
			entry = filepath.Join(root, manifest.Exports["."].Import)
			break
		}
		root = filepath.Dir(root)
	}
	if info, err := os.Stat(entry); err != nil || !info.Mode().IsRegular() {
		return nil, NewError(CodeUnavailable, "Update the engine in Pi settings to use provider settings.")
	}
	dir, err := s.piAgentDir()
	if err != nil {
		return nil, err
	}
	ctxCmd := exec.CommandContext(ctx, "node", "--input-type=module", "-e", piAuthBridge, entry, filepath.Join(dir, "auth.json"), operation, provider, method)
	ctxCmd.Dir = s.pi.home
	ctxCmd.Env = append(os.Environ(), "HOME="+s.pi.home, "PI_OFFLINE=1", "NO_COLOR=1")
	ctxCmd.Stderr = io.Discard
	ctxCmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	ctxCmd.Cancel = func() error { return syscall.Kill(-ctxCmd.Process.Pid, syscall.SIGKILL) }
	ctxCmd.WaitDelay = time.Second
	return ctxCmd, nil
}

func (s *Server) handlePiProviders(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	cmd, err := s.piAuthCommand(ctx, "list", "", "")
	if err != nil {
		WriteError(w, err)
		return
	}
	output := &piAuthOutput{}
	cmd.Stdout = output
	if err := cmd.Run(); err != nil {
		WriteError(w, NewError(CodeUnavailable, "Could not load Pi providers. Check that Pi is up to date."))
		return
	}
	var result piProviders
	if json.Unmarshal([]byte(output.String()), &result) != nil || result.Providers == nil {
		WriteError(w, NewError(CodeUnavailable, "Could not load Pi providers. Check that Pi is up to date."))
		return
	}
	WriteData(w, result)
}

func (s *Server) handlePiAuthStart(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RequestID string `json:"requestId"`
		Provider  string `json:"provider"`
		Method    string `json:"method"`
		Operation string `json:"operation"`
	}
	if strictjson.Decode(w, r, maxBodyBytes, &req) != nil || !validRequestID(req.RequestID) || len(req.Provider) > 160 || req.Provider == "" || (req.Operation != "login" && req.Operation != "logout") || (req.Operation == "login" && req.Method != "api_key" && req.Method != "oauth") {
		WriteError(w, NewError(CodeValidationFailed, "Choose a provider and sign-in method."))
		return
	}
	s.mutate(w, req.RequestID, func(w http.ResponseWriter) {
		s.pi.operation.Lock()
		defer s.pi.operation.Unlock()
		s.piAuth.mu.Lock()
		defer s.piAuth.mu.Unlock()
		if old := s.piAuth.flow; old != nil {
			old.mu.Lock()
			active := old.state.Status == "working"
			old.mu.Unlock()
			if active {
				WriteError(w, NewError(CodeConflict, "Finish or cancel the current provider setup first."))
				return
			}
		}
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
		cmd, err := s.piAuthCommand(ctx, req.Operation, req.Provider, req.Method)
		if err != nil {
			cancel()
			WriteError(w, err)
			return
		}
		flow, err := startPiAuth(cmd, cancel)
		if err != nil {
			cancel()
			WriteError(w, NewError(CodeUnavailable, "Could not start provider setup."))
			return
		}
		s.piAuth.flow = flow
		flow.mu.Lock()
		defer flow.mu.Unlock()
		WriteData(w, flow.state)
	})
}

func startPiAuth(cmd *exec.Cmd, cancel context.CancelFunc) (*piAuthFlow, error) {
	input, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	output, err := cmd.StdoutPipe()
	if err != nil {
		input.Close()
		return nil, err
	}
	flow := &piAuthFlow{state: piAuthState{ID: piID(), Status: "working", Events: []piAuthEvent{}}, input: input, cancel: cancel, touched: time.Now()}
	if err = cmd.Start(); err != nil {
		input.Close()
		return nil, err
	}
	done := make(chan struct{})
	go func() {
		defer close(done)
		defer cancel()
		defer input.Close()
		scanner := bufio.NewScanner(output)
		scanner.Buffer(make([]byte, 4096), 64<<10)
		for scanner.Scan() {
			flow.record(scanner.Bytes())
		}
		_ = cmd.Wait()
		flow.mu.Lock()
		defer flow.mu.Unlock()
		if flow.state.Status == "working" {
			flow.state.Status = "error"
			flow.state.Error = "Provider setup ended. Please try again."
			flow.state.Prompt = nil
		}
	}()
	go func() {
		timer := time.NewTicker(15 * time.Second)
		defer timer.Stop()
		for {
			select {
			case <-done:
				return
			case <-timer.C:
				flow.mu.Lock()
				expired := time.Since(flow.touched) > time.Minute
				flow.mu.Unlock()
				if expired {
					flow.stop()
					return
				}
			}
		}
	}()
	return flow, nil
}

func (f *piAuthFlow) record(raw []byte) {
	var record struct {
		Type   string        `json:"type"`
		ID     string        `json:"id"`
		Prompt *piAuthPrompt `json:"prompt"`
		Event  piAuthEvent   `json:"event"`
	}
	if json.Unmarshal(raw, &record) != nil {
		return
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.state.Status != "working" {
		return
	}
	switch record.Type {
	case "prompt":
		if record.Prompt != nil && (record.Prompt.Type == "text" || record.Prompt.Type == "secret" || record.Prompt.Type == "manual_code" || record.Prompt.Type == "select") {
			f.state.Prompt = record.Prompt
		}
	case "prompt_end":
		if f.state.Prompt != nil && f.state.Prompt.ID == record.ID {
			f.state.Prompt = nil
		}
	case "event":
		event := record.Event
		event.URL = piAuthURL(event.URL)
		for i := range event.Links {
			event.Links[i].URL = piAuthURL(event.Links[i].URL)
		}
		if event.Type == "progress" {
			for i := len(f.state.Events) - 1; i >= 0; i-- {
				if f.state.Events[i].Type == "progress" {
					f.state.Events[i] = event
					return
				}
			}
		}
		f.state.Events = append(f.state.Events, event)
		if len(f.state.Events) > 20 {
			f.state.Events = f.state.Events[1:]
		}
	case "done":
		f.state.Status = "done"
		f.state.Prompt = nil
	case "error":
		f.state.Status = "error"
		f.state.Prompt = nil
		f.state.Error = "Pi could not complete provider setup. Check your details and try again."
	}
}
func piAuthURL(value string) string {
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil {
		return ""
	}
	return value
}
func (f *piAuthFlow) stop() {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.state.Status == "working" {
		f.state.Status = "cancelled"
		f.state.Prompt = nil
		f.cancel()
	}
}
func (s *Server) findPiAuth(id string) *piAuthFlow {
	s.piAuth.mu.Lock()
	defer s.piAuth.mu.Unlock()
	f := s.piAuth.flow
	if f == nil || f.state.ID != id {
		return nil
	}
	return f
}
func (s *Server) handlePiAuthState(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	flow := s.findPiAuth(r.URL.Query().Get("id"))
	if flow == nil {
		WriteError(w, NewError(CodeNotFound, "Provider setup has ended."))
		return
	}
	flow.mu.Lock()
	defer flow.mu.Unlock()
	flow.touched = time.Now()
	WriteData(w, flow.state)
}
func (s *Server) handlePiAuthReply(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RequestID string `json:"requestId"`
		ID        string `json:"id"`
		PromptID  string `json:"promptId"`
		Value     string `json:"value"`
	}
	if strictjson.Decode(w, r, 32<<10, &req) != nil || !validRequestID(req.RequestID) || len(req.Value) > 16384 {
		WriteError(w, NewError(CodeValidationFailed, "Enter a valid sign-in response."))
		return
	}
	s.mutate(w, req.RequestID, func(w http.ResponseWriter) {
		f := s.findPiAuth(req.ID)
		if f == nil {
			WriteError(w, NewError(CodeNotFound, "Provider setup has ended."))
			return
		}
		f.mu.Lock()
		defer f.mu.Unlock()
		if err := f.reply(req.PromptID, req.Value); err != nil {
			WriteError(w, err)
			return
		}
		WriteData(w, struct{}{})
	})
}
func (f *piAuthFlow) reply(id, value string) error {
	prompt := f.state.Prompt
	if f.state.Status != "working" || prompt == nil || prompt.ID != id {
		return NewError(CodeConflict, "This sign-in step has changed. Use the current prompt.")
	}
	if prompt.Type == "select" {
		found := false
		for _, option := range prompt.Options {
			if option.ID == value {
				found = true
			}
		}
		if !found {
			return NewError(CodeValidationFailed, "Choose an available option.")
		}
	}
	if prompt.Type == "secret" {
		key := strings.TrimSpace(value)
		if key == "" || strings.HasPrefix(key, "!") || strings.HasPrefix(key, "$") || strings.ContainsAny(value, "\r\n\x00") {
			return NewError(CodeValidationFailed, "Enter the key itself, without a command or environment variable.")
		}
	}
	data, _ := json.Marshal(map[string]string{"id": id, "value": value})
	if _, err := f.input.Write(append(data, '\n')); err != nil {
		return NewError(CodeUnavailable, "Provider setup has ended. Try again.")
	}
	f.state.Prompt = nil
	f.touched = time.Now()
	return nil
}
func (s *Server) handlePiAuthCancel(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RequestID string `json:"requestId"`
		ID        string `json:"id"`
	}
	if strictjson.Decode(w, r, maxBodyBytes, &req) != nil || !validRequestID(req.RequestID) {
		WriteError(w, NewError(CodeValidationFailed, "Choose the provider setup to cancel."))
		return
	}
	s.mutate(w, req.RequestID, func(w http.ResponseWriter) {
		if flow := s.findPiAuth(req.ID); flow != nil {
			flow.stop()
		}
		WriteData(w, struct{}{})
	})
}
func (s *Server) piAuthRunning() bool {
	s.piAuth.mu.Lock()
	defer s.piAuth.mu.Unlock()
	if s.piAuth.flow == nil {
		return false
	}
	s.piAuth.flow.mu.Lock()
	defer s.piAuth.flow.mu.Unlock()
	return s.piAuth.flow.state.Status == "working"
}
