// SPDX-License-Identifier: AGPL-3.0-only
package httpapi

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"lumo/server/internal/strictjson"
)

const piRPCMessageLimit = 64 << 20

type piRuntime struct {
	mu        sync.Mutex
	processes map[string]*piProcess
}
type piProcess struct {
	compactionSettings map[string]json.RawMessage
	mu                 sync.Mutex
	write              sync.Mutex
	input              io.WriteCloser
	cancel             context.CancelFunc
	events             []json.RawMessage
	base               int
	eventBytes         int
	pending            map[string]chan json.RawMessage
	desktop            []piDesktopRequest
	desktopClient      string
	desktopEnabled     bool
	extensionsRevision string
	desktopLoaded      bool
	desktopReady       bool
	questions          []piQuestion
	permissionMode     string
	modelImagesReady   bool
	metrics            *piSessionMetrics
	retry              *piRetry
	done               chan struct{}
	wake               chan struct{}
	touched            time.Time
	closed             bool
	stopError          string
	project            string
	session            string
}
type piSession struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Modified string `json:"modified"`
	Project  string `json:"project,omitempty"`
}

func (s *Server) piFolder(project string) (string, string, error) {
	if project == "" || project == "~" {
		project = s.pi.home
	}
	if !filepath.IsAbs(project) {
		return "", "", errors.New("Choose an absolute project folder.")
	}
	project, err := filepath.EvalSymlinks(project)
	if err != nil {
		return "", "", errors.New("Project folder is unavailable.")
	}
	info, err := os.Stat(project)
	if err != nil || !info.IsDir() {
		return "", "", errors.New("Choose a project folder.")
	}
	hash := sha256.Sum256([]byte(project))
	return project, filepath.Join(s.pi.home, ".local/state/lumo/pi-sessions", hex.EncodeToString(hash[:16])), nil
}
func (s *Server) handlePiSessions(w http.ResponseWriter, r *http.Request) {
	_, dir, err := s.piFolder(r.URL.Query().Get("project"))
	if err != nil {
		WriteError(w, NewError(CodeValidationFailed, err.Error()))
		return
	}
	result, err := readPiSessions(dir)
	if err != nil {
		WriteError(w, err)
		return
	}
	WriteData(w, map[string]any{"sessions": result})
}
func readPiSessions(dir string) ([]piSession, error) {
	entries, err := os.ReadDir(dir)
	if err != nil && !os.IsNotExist(err) {
		return nil, err
	}
	result := []piSession{}
	for _, entry := range entries {
		if entry.IsDir() || entry.Type()&os.ModeSymlink != 0 || !strings.HasSuffix(entry.Name(), ".jsonl") {
			continue
		}
		info, err := entry.Info()
		if err != nil || !info.Mode().IsRegular() {
			continue
		}
		name := "Untitled session"
		project := ""
		file, err := os.Open(filepath.Join(dir, entry.Name()))
		if err != nil {
			continue
		}
		scanner := bufio.NewScanner(io.LimitReader(file, 8<<20))
		scanner.Buffer(make([]byte, 4096), 2<<20)
		for scanner.Scan() {
			var record struct {
				Type    string `json:"type"`
				Cwd     string `json:"cwd"`
				Name    string `json:"name"`
				Message struct {
					Role    string          `json:"role"`
					Content json.RawMessage `json:"content"`
				} `json:"message"`
			}
			if json.Unmarshal(scanner.Bytes(), &record) != nil {
				continue
			}
			if record.Type == "session" {
				project = record.Cwd
			}
			if record.Type == "session_info" && record.Name != "" {
				name = record.Name
			}
			if name == "Untitled session" && record.Message.Role == "user" {
				var content []struct {
					Text string `json:"text"`
				}
				_ = json.Unmarshal(record.Message.Content, &content)
				if len(content) > 0 && content[0].Text != "" {
					name = content[0].Text
				}
			}
		}
		file.Close()
		if len([]rune(name)) > 100 {
			name = string([]rune(name)[:100])
		}
		result = append(result, piSession{entry.Name(), name, info.ModTime().UTC().Format(time.RFC3339Nano), project})
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Modified > result[j].Modified })
	return result, nil
}
func (s *Server) handlePiStart(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RequestID              string `json:"requestId"`
		Project                string `json:"project"`
		Session                string `json:"session"`
		Resume                 string `json:"resume"`
		PermissionMode         string `json:"permissionMode"`
		RememberPermissionMode bool   `json:"rememberPermissionMode"`
		ClientID               string `json:"clientId"`
	}
	if err := strictjson.Decode(w, r, maxBodyBytes, &req); err != nil || !validRequestID(req.RequestID) || (req.ClientID != "" && !validRequestID(req.ClientID)) {
		WriteError(w, NewError(CodeValidationFailed, "Choose a project folder."))
		return
	}
	if req.RememberPermissionMode && req.PermissionMode == "" || req.PermissionMode != "" && !validPiPermissionMode(req.PermissionMode) {
		WriteError(w, NewError(CodeValidationFailed, "Choose a valid Pi permission mode."))
		return
	}
	s.mutate(w, req.RequestID, func(w http.ResponseWriter) {
		if !s.pi.operation.TryLock() {
			WriteError(w, NewError(CodeConflict, "Wait for Pi installation or removal to finish."))
			return
		}
		defer s.pi.operation.Unlock()
		project, dir, err := s.piFolder(req.Project)
		if err != nil {
			WriteError(w, NewError(CodeValidationFailed, err.Error()))
			return
		}
		agentDir, err := s.piAgentDir()
		if err != nil {
			WriteError(w, err)
			return
		}
		settings, err := readPiExtensionSettings(agentDir)
		if err != nil {
			WriteError(w, err)
			return
		}
		desktopEnabled := settings.LumoUse && req.ClientID != ""
		if req.PermissionMode == "" {
			if existing := s.piProcess(req.Resume); existing != nil {
				existing.mu.Lock()
				if !existing.closed && existing.project == project && (req.Session == "" || existing.session == req.Session) {
					req.PermissionMode = existing.permissionMode
				}
				existing.mu.Unlock()
			}
			if req.PermissionMode == "" {
				sessionPath := ""
				if req.Session != "" {
					sessionPath = filepath.Join(dir, req.Session)
				}
				req.PermissionMode, err = readPiPermissionMode(agentDir, sessionPath)
				if err != nil {
					WriteError(w, err)
					return
				}
			}
		}
		if existing := s.piProcess(req.Resume); existing != nil {
			existing.mu.Lock()
			canResume := !existing.closed && existing.project == project && (req.Session == "" || existing.session == req.Session)
			if canResume && existing.permissionMode != req.PermissionMode {
				existing.mu.Unlock()
				WriteError(w, NewError(CodeConflict, "This chat is running with a different permission mode. Stop it before changing modes."))
				return
			}
			if canResume {
				existing.touched = time.Now()
			}
			extensionsChanged := existing.extensionsRevision != settings.Revision || existing.desktopClient == req.ClientID && (existing.desktopLoaded != desktopEnabled || desktopEnabled && !existing.desktopEnabled)
			desktopEnabled := existing.desktopEnabled && existing.desktopClient == req.ClientID
			existingSession := existing.session
			existing.mu.Unlock()
			if canResume {
				if err := savePiPermissionMode(agentDir, filepath.Join(dir, existingSession), req.PermissionMode, req.RememberPermissionMode); err != nil {
					WriteError(w, err)
					return
				}
				WriteData(w, map[string]any{"id": req.Resume, "project": project, "permissionMode": req.PermissionMode, "lumoUse": desktopEnabled, "extensionsChanged": extensionsChanged})
				return
			}
		}
		args := []string{"--mode", "rpc", "--no-extensions", "--no-prompt-templates", "--no-approve", "--session-dir", dir}
		if req.Session != "" {
			if filepath.Base(req.Session) != req.Session || !strings.HasSuffix(req.Session, ".jsonl") {
				WriteError(w, NewError(CodeValidationFailed, "Choose a saved session."))
				return
			}
			path := filepath.Join(dir, req.Session)
			info, err := os.Lstat(path)
			if err != nil || !info.Mode().IsRegular() {
				WriteError(w, NewError(CodeNotFound, "Saved session is unavailable."))
				return
			}
			args = append(args, "--session", path)
		}
		binary := s.pi.path()
		if binary == "" {
			WriteError(w, NewError(CodeUnavailable, "Install Pi from App Library first."))
			return
		}
		s.piRPC.mu.Lock()
		defer s.piRPC.mu.Unlock()
		for _, existing := range s.piRPC.processes {
			existing.mu.Lock()
			same := !existing.closed && req.Session != "" && existing.project == project && existing.session == req.Session
			existing.mu.Unlock()
			if same {
				WriteError(w, NewError(CodeConflict, "This conversation is already open in another Pi window."))
				return
			}
		}
		if len(s.piRPC.processes) >= 8 {
			WriteError(w, NewError(CodeConflict, "Up to eight Pi chats can run at once. Wait for a chat to finish before starting another."))
			return
		}
		if err := os.MkdirAll(dir, 0700); err != nil {
			WriteError(w, err)
			return
		}
		extension, err := writePiQuestionsExtension(dir, req.PermissionMode, settings.Questions)
		if err != nil {
			WriteError(w, err)
			return
		}
		imagesExtension, err := writePiModelImagesExtension(dir, agentDir, s.pi.home)
		if err != nil {
			WriteError(w, err)
			return
		}
		if desktopEnabled {
			desktopExtension, err := writeLumoUseExtension(dir)
			if err != nil {
				WriteError(w, err)
				return
			}
			args = append(args, "--extension", desktopExtension)
		}
		appsExtension, err := writePiAppsExtension(dir, req.PermissionMode, desktopEnabled)
		if err != nil {
			WriteError(w, err)
			return
		}
		args = append(args, "--extension", appsExtension)
		optionalArgs := piExtensionArgs(settings)
		if settings.Calendar {
			calendarExtension, err := writePiCalendarExtension(dir, req.PermissionMode)
			if err != nil {
				WriteError(w, err)
				return
			}
			args = append(args, "--extension", calendarExtension)
		}
		args = append(args, optionalArgs...)
		args = append(args, "--extension", extension, "--extension", imagesExtension)
		if len(optionalArgs) == 0 {
			tools := piToolsForMode(req.PermissionMode, desktopEnabled)
			if settings.Calendar {
				tools += ",lumo_calendar_list"
				if req.PermissionMode != "read-only" {
					tools += ",lumo_calendar_change"
				}
			}
			if !settings.Questions {
				tools = strings.Replace(tools, ",ask_user", "", 1)
			}
			args = append(args, "--tools", tools)
		} else if req.PermissionMode == "read-only" {
			args = append(args, "--exclude-tools", "bash,powershell,edit,write,lumo_act")
		} else {
			args = append(args, "--exclude-tools", "powershell")
		}
		p, err := startManagedPiProcess(r.Context(), binary, args, project, s.pi.home, req.PermissionMode, desktopEnabled)
		if err != nil {
			WriteError(w, NewError(CodeUnavailable, "Could not start Pi: "+err.Error()))
			return
		}
		changed, err := preparePiContextBudget(r.Context(), p, agentDir)
		if err != nil {
			p.cancel()
			WriteError(w, NewError(CodeUnavailable, "Could not apply context budget: "+err.Error()))
			return
		}
		if changed {
			p.cancel()
			select {
			case <-p.done:
			case <-time.After(5 * time.Second):
				WriteError(w, NewError(CodeUnavailable, "Pi is still restarting to apply its context budget."))
				return
			}
			p, err = startManagedPiProcess(r.Context(), binary, args, project, s.pi.home, req.PermissionMode, desktopEnabled)
			if err != nil {
				WriteError(w, NewError(CodeUnavailable, "Could not reopen Pi: "+err.Error()))
				return
			}
		}
		p.compactionSettings, err = piCompactionSnapshot(agentDir, project)
		if err != nil {
			p.cancel()
			WriteError(w, err)
			return
		}
		p.mu.Lock()
		p.desktopClient = req.ClientID
		p.desktopEnabled = desktopEnabled
		p.desktopLoaded = desktopEnabled
		p.extensionsRevision = settings.Revision
		if p.session == "" {
			p.session = req.Session
		}
		sessionPath := ""
		if p.session != "" {
			sessionPath = filepath.Join(dir, p.session)
		}
		p.mu.Unlock()
		if err := savePiPermissionMode(agentDir, sessionPath, req.PermissionMode, req.RememberPermissionMode); err != nil {
			p.cancel()
			WriteError(w, err)
			return
		}
		id := piID()
		s.piRPC.processes[id] = p
		go func() {
			<-p.done
			time.Sleep(30 * time.Second)
			s.piRPC.mu.Lock()
			delete(s.piRPC.processes, id)
			s.piRPC.mu.Unlock()
		}()
		WriteData(w, map[string]any{"id": id, "project": project, "permissionMode": req.PermissionMode, "lumoUse": desktopEnabled})
	})
}
func startPiProcess(binary string, args []string, project, home string) (*piProcess, error) {
	ctx, cancel := context.WithCancel(context.Background())
	cmd := exec.CommandContext(ctx, binary, args...)
	cmd.Dir = project
	cmd.Env = append(os.Environ(), "HOME="+home, "PATH="+filepath.Join(home, ".local/share/lumo/pi/bin")+":"+filepath.Join(home, ".local/bin")+":"+os.Getenv("PATH"), "NO_COLOR=1")
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error { return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL) }
	cmd.WaitDelay = 2 * time.Second
	input, err := cmd.StdinPipe()
	if err != nil {
		cancel()
		return nil, err
	}
	output, err := cmd.StdoutPipe()
	if err != nil {
		cancel()
		input.Close()
		return nil, err
	}
	stderr := &limitedCommandOutput{}
	cmd.Stderr = stderr
	p := &piProcess{project: project, input: input, cancel: cancel, pending: map[string]chan json.RawMessage{}, done: make(chan struct{}), wake: make(chan struct{}, 1), touched: time.Now(), events: []json.RawMessage{}}
	if err = cmd.Start(); err != nil {
		cancel()
		input.Close()
		return nil, err
	}
	go func() {
		scanner := bufio.NewScanner(output)
		scanner.Buffer(make([]byte, 4096), piRPCMessageLimit+1)
		for scanner.Scan() {
			raw := append(json.RawMessage(nil), scanner.Bytes()...)
			var record struct {
				Type    string `json:"type"`
				ID      string `json:"id"`
				Command string `json:"command"`
			}
			if json.Unmarshal(raw, &record) != nil {
				continue
			}
			p.mu.Lock()
			if record.Type == "response" {
				if record.Command == "get_state" {
					var state struct {
						Data struct {
							SessionFile string `json:"sessionFile"`
						} `json:"data"`
					}
					if json.Unmarshal(raw, &state) == nil && state.Data.SessionFile != "" {
						p.session = filepath.Base(state.Data.SessionFile)
					}
				}
				if ch := p.pending[record.ID]; ch != nil {
					if record.Command == "get_messages" {
						var reply map[string]any
						if json.Unmarshal(raw, &reply) == nil {
							reply["eventCursor"] = p.base + len(p.events)
							reply["questions"] = p.activeQuestions()
							reply["retry"] = p.retry
							raw, _ = json.Marshal(reply)
						}
					}
					ch <- raw
					delete(p.pending, record.ID)
				}
			} else {
				p.trackDesktop(record.Type, raw)
				p.trackQuestion(record.Type, raw)
				p.trackRetry(record.Type, raw)
				if record.Type == "extension_ui_request" {
					var status struct {
						Method string `json:"method"`
						Key    string `json:"statusKey"`
						Text   string `json:"statusText"`
					}
					if json.Unmarshal(raw, &status) == nil && status.Method == "setStatus" && status.Key == "lumo-permissions" && validPiPermissionMode(status.Text) {
						p.permissionMode = status.Text
					}
					if status.Method == "setStatus" && status.Key == "lumo-metrics" {
						p.trackMetrics(status.Text)
					}
					if status.Method == "setStatus" && status.Key == "lumo-use" && status.Text == "ready" {
						p.desktopReady = true
					}
					if status.Method == "setStatus" && status.Key == "lumo-model-images" && status.Text == "ready" {
						p.modelImagesReady = true
					}
				}
				p.events = append(p.events, raw)
				p.eventBytes += len(raw)
				for len(p.events) > 1 && (len(p.events) > 512 || p.eventBytes > 8<<20) {
					p.eventBytes -= len(p.events[0])
					p.events[0] = nil
					p.events = p.events[1:]
					p.base++
				}
				select {
				case p.wake <- struct{}{}:
				default:
				}
			}
			p.mu.Unlock()
		}
		scanErr := scanner.Err()
		if scanErr != nil {
			cancel()
		}
		err := cmd.Wait()
		cancelled := ctx.Err() != nil
		input.Close()
		cancel()
		p.mu.Lock()
		p.closed = true
		p.desktop = nil
		p.retry = nil
		if errors.Is(scanErr, bufio.ErrTooLong) {
			p.stopError = "This conversation exceeds Lumo's 64 MiB response limit. Your saved chat is intact."
		} else if scanErr != nil {
			p.stopError = "Lumo could not read Pi's response. Reconnect to reopen your saved chat."
		} else if err != nil && !cancelled {
			p.stopError = "Pi exited unexpectedly. Reconnect to reopen your saved chat."
		}
		if p.stopError != "" {
			raw, _ := json.Marshal(map[string]any{"type": "error", "error": p.stopError})
			p.events = append(p.events, raw)
		}
		p.mu.Unlock()
		close(p.done)
	}()
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-p.done:
				return
			case <-ticker.C:
				p.mu.Lock()
				expired := time.Since(p.touched) > 2*time.Minute
				p.mu.Unlock()
				if expired {
					cancel()
					return
				}
			}
		}
	}()
	return p, nil
}
func (s *Server) piProcess(id string) *piProcess {
	s.piRPC.mu.Lock()
	defer s.piRPC.mu.Unlock()
	return s.piRPC.processes[id]
}
func (s *Server) handlePiEvents(w http.ResponseWriter, r *http.Request) {
	p := s.piProcess(r.URL.Query().Get("id"))
	if p == nil {
		WriteError(w, NewError(CodeNotFound, "Pi has stopped. Reopen the project to continue."))
		return
	}
	after, err := strconv.Atoi(r.URL.Query().Get("after"))
	if err != nil || after < 0 {
		WriteError(w, NewError(CodeValidationFailed, "Invalid event cursor."))
		return
	}
	p.mu.Lock()
	p.touched = time.Now()
	empty := after >= p.base+len(p.events)
	p.mu.Unlock()
	if empty {
		select {
		case <-p.wake:
		case <-p.done:
		case <-r.Context().Done():
			return
		case <-time.After(15 * time.Second):
		}
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if after < p.base {
		WriteError(w, NewError(CodeConflict, "Pi output changed while disconnected. Reopen the saved session."))
		return
	}
	index := after - p.base
	if index > len(p.events) {
		index = len(p.events)
	}
	WriteData(w, map[string]any{"events": p.events[index:], "cursor": p.base + len(p.events), "closed": p.closed, "questions": p.activeQuestions(), "retry": p.retry, "desktop": p.activeDesktop(r.URL.Query().Get("clientId"))})
}
func (p *piProcess) command(ctx context.Context, command map[string]any) (json.RawMessage, error) {
	id := piID()
	command["id"] = id
	data, err := json.Marshal(command)
	if err != nil {
		return nil, err
	}
	ch := make(chan json.RawMessage, 1)
	p.mu.Lock()
	if len(p.pending) >= 16 {
		p.mu.Unlock()
		return nil, errors.New("Pi is busy. Try again shortly.")
	}
	p.pending[id] = ch
	p.touched = time.Now()
	p.mu.Unlock()
	defer func() { p.mu.Lock(); delete(p.pending, id); p.mu.Unlock() }()
	p.write.Lock()
	data = append(data, '\n')
	if command["type"] == "abort" {
		p.mu.Lock()
		for _, req := range p.desktop {
			cancel, _ := json.Marshal(map[string]any{"type": "extension_ui_response", "id": req.ID, "cancelled": true})
			data = append(data, append(cancel, '\n')...)
		}
		for _, question := range p.activeQuestions() {
			cancel, _ := json.Marshal(map[string]any{"type": "extension_ui_response", "id": question.ID, "cancelled": true})
			data = append(data, append(cancel, '\n')...)
		}
		p.mu.Unlock()
	}
	_, err = p.input.Write(data)
	if err == nil && command["type"] == "abort" {
		p.mu.Lock()
		p.questions = nil
		p.desktop = nil
		select {
		case p.wake <- struct{}{}:
		default:
		}
		p.mu.Unlock()
	}
	p.write.Unlock()
	if err != nil {
		return nil, err
	}
	select {
	case response := <-ch:
		return response, nil
	case <-p.done:
		p.mu.Lock()
		message := p.stopError
		p.mu.Unlock()
		if message == "" {
			message = "Pi stopped. Reconnect to reopen your saved chat."
		}
		return nil, errors.New(message)
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}
func (s *Server) handlePiCommand(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RequestID string                     `json:"requestId"`
		ID        string                     `json:"id"`
		Command   map[string]json.RawMessage `json:"command"`
	}
	if err := strictjson.Decode(w, r, maxBodyBytes, &req); err != nil || !validRequestID(req.RequestID) {
		WriteError(w, NewError(CodeValidationFailed, "Invalid Pi command."))
		return
	}
	command, err := validatePiCommand(req.Command)
	if err != nil {
		WriteError(w, NewError(CodeValidationFailed, err.Error()))
		return
	}
	p := s.piProcess(req.ID)
	if p == nil {
		WriteError(w, NewError(CodeNotFound, "Reopen the Pi project to continue."))
		return
	}
	s.mutate(w, req.RequestID, func(w http.ResponseWriter) {
		ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
		defer cancel()
		selection := command["type"] == "set_model" || command["type"] == "set_thinking_level"
		if selection {
			s.pi.operation.Lock()
			defer s.pi.operation.Unlock()
		}
		result, err := p.command(ctx, command)
		if err != nil {
			WriteError(w, NewError(CodeUnavailable, err.Error()))
			return
		}
		if command["type"] == "get_state" {
			s.pi.operation.Lock()
			err := s.rememberPiChatPermission(p)
			s.pi.operation.Unlock()
			if err != nil {
				WriteError(w, NewError(CodeUnavailable, "Could not save this chat's approval mode: "+err.Error()))
				return
			}
			result = piSavedState(result)
		}
		if command["type"] == "get_session_stats" {
			result = p.metricsStats(p.contextBudgetStats(ctx, result))
		}
		if selection {
			var reply struct {
				Success bool `json:"success"`
			}
			if json.Unmarshal(result, &reply) == nil && reply.Success {
				if err := s.rememberPiSelection(ctx, p); err != nil {
					WriteError(w, NewError(CodeUnavailable, "The choice changed in this conversation, but could not be saved for new conversations: "+err.Error()))
					return
				}
			}
		}
		if command["type"] == "fork" || command["type"] == "clone" {
			var reply map[string]any
			if err := json.Unmarshal(result, &reply); err != nil {
				WriteError(w, err)
				return
			}
			p.mu.Lock()
			reply["eventCursor"] = p.base + len(p.events)
			p.mu.Unlock()
			WriteData(w, reply)
		} else {
			WriteData(w, json.RawMessage(result))
		}
	})
}
func validatePiCommand(raw map[string]json.RawMessage) (map[string]any, error) {
	var kind string
	_ = json.Unmarshal(raw["type"], &kind)
	allowed := map[string][]string{"prompt": {"message", "streamingBehavior"}, "steer": {"message"}, "follow_up": {"message"}, "abort": {}, "clear_queue": {}, "abort_retry": {}, "set_auto_retry": {"enabled"}, "get_state": {}, "get_messages": {}, "get_fork_messages": {}, "fork": {"entryId"}, "clone": {}, "get_available_models": {}, "get_available_thinking_levels": {}, "get_session_stats": {}, "set_model": {"provider", "modelId"}, "set_thinking_level": {"level"}, "set_session_name": {"name"}, "compact": {"customInstructions"}}
	fields, ok := allowed[kind]
	if !ok {
		return nil, errors.New("Unsupported Pi command.")
	}
	result := map[string]any{"type": kind}
	for key, value := range raw {
		if key == "type" {
			continue
		}
		found := false
		for _, f := range fields {
			if key == f {
				found = true
			}
		}
		if !found {
			return nil, fmt.Errorf("Unsupported Pi field: %s", key)
		}
		if kind == "set_auto_retry" && key == "enabled" {
			var enabled bool
			if string(value) == "null" || json.Unmarshal(value, &enabled) != nil {
				return nil, errors.New("Choose whether to retry automatically.")
			}
			result[key] = enabled
			continue
		}
		var text string
		if json.Unmarshal(value, &text) != nil || len(text) > 100000 {
			return nil, errors.New("Invalid Pi field.")
		}
		result[key] = text
	}
	if kind == "prompt" || kind == "steer" || kind == "follow_up" {
		message, _ := result["message"].(string)
		if strings.TrimSpace(message) == "" {
			return nil, errors.New("Write a message first.")
		}
		if strings.HasPrefix(strings.TrimSpace(message), "/") {
			return nil, errors.New("Slash commands are not enabled in this interface yet.")
		}
	}
	if kind == "set_auto_retry" {
		if _, ok := result["enabled"]; !ok {
			return nil, errors.New("Choose whether to retry automatically.")
		}
	}
	if kind == "fork" {
		entry, _ := result["entryId"].(string)
		if len(entry) == 0 || len(entry) > 128 || strings.ContainsAny(entry, "/\\ \t\r\n") {
			return nil, errors.New("Choose an earlier message.")
		}
	}
	return result, nil
}
func (s *Server) handlePiStop(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ID string `json:"id"`
	}
	if err := strictjson.Decode(w, r, maxBodyBytes, &req); err != nil {
		WriteError(w, NewError(CodeValidationFailed, "Invalid Pi session."))
		return
	}
	if p := s.piProcess(req.ID); p != nil {
		p.cancel()
		select {
		case <-p.done:
		case <-r.Context().Done():
			return
		case <-time.After(5 * time.Second):
			WriteError(w, NewError(CodeUnavailable, "Pi is still stopping. Try again."))
			return
		}
		s.piRPC.mu.Lock()
		delete(s.piRPC.processes, req.ID)
		s.piRPC.mu.Unlock()
	}
	WriteData(w, map[string]any{"closed": true})
}

func (s *Server) piRunning() bool {
	if s.piAuthRunning() {
		return true
	}
	s.piRPC.mu.Lock()
	defer s.piRPC.mu.Unlock()
	for _, p := range s.piRPC.processes {
		p.mu.Lock()
		closed := p.closed
		p.mu.Unlock()
		if !closed {
			return true
		}
	}
	return false
}

func piSavedState(raw json.RawMessage) json.RawMessage {
	var reply map[string]json.RawMessage
	if json.Unmarshal(raw, &reply) != nil {
		return raw
	}
	var data map[string]json.RawMessage
	if json.Unmarshal(reply["data"], &data) != nil || data == nil {
		return raw
	}
	var path string
	if json.Unmarshal(data["sessionFile"], &path) != nil || path == "" {
		return raw
	}
	info, err := os.Lstat(path)
	if err == nil && info.Mode().IsRegular() {
		return raw
	}
	delete(data, "sessionFile")
	reply["data"], _ = json.Marshal(data)
	result, _ := json.Marshal(reply)
	return result
}
