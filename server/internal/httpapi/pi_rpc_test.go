// SPDX-License-Identifier: AGPL-3.0-only
package httpapi

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"lumo/server/internal/piruntime"
)

func TestPiRPCFixtureProcess(t *testing.T) {
	if os.Getenv("LUMO_PI_RPC_FIXTURE") != "1" {
		return
	}
	if mode := os.Getenv("LUMO_PI_RPC_READY"); mode != "" {
		event, _ := json.Marshal(map[string]string{"type": "extension_ui_request", "method": "setStatus", "statusKey": "lumo-permissions", "statusText": mode})
		fmt.Println(string(event))
		if os.Getenv("LUMO_PI_RPC_IMAGES_MISSING") != "1" {
			fmt.Println(`{"type":"extension_ui_request","method":"setStatus","statusKey":"lumo-model-images","statusText":"ready"}`)
		}
	}
	if os.Getenv("LUMO_PI_USE_READY") == "1" {
		fmt.Println(`{"type":"extension_ui_request","method":"setStatus","statusKey":"lumo-use","statusText":"ready"}`)
	}
	scanner := bufio.NewScanner(os.Stdin)
	model, level := "balanced", "medium"
	for scanner.Scan() {
		var command map[string]any
		if json.Unmarshal(scanner.Bytes(), &command) != nil {
			os.Exit(2)
		}
		kind, _ := command["type"].(string)
		if kind == "extension_ui_response" {
			event, _ := json.Marshal(map[string]any{"type": "fixture_answer", "answer": command})
			fmt.Println(string(event))
			continue
		}
		if kind == "prompt" && command["message"] == "desktop" {
			fmt.Println(`{"type":"extension_ui_request","id":"desktop-1","method":"input","title":"Lumo Use: {\"action\":\"observe\"}"}`)
		}
		if kind == "prompt" && command["message"] == "ask" {
			fmt.Println(`{"type":"extension_ui_request","id":"question-1","method":"select","title":"Which environment?","options":["Development","Production"]}`)
		}
		if kind == "abort" {
			fmt.Println(`{"type":"agent_settled"}`)
		}
		if kind == "prompt" {
			event, _ := json.Marshal(map[string]any{"type": "message_update", "assistantMessageEvent": map[string]any{"type": "text_delta", "contentIndex": 0, "delta": command["message"]}})
			fmt.Println(string(event))
		}
		success := true
		if kind == "set_model" {
			if command["modelId"] == "missing" {
				success = false
			} else {
				model = command["modelId"].(string)
			}
		}
		if kind == "set_thinking_level" {
			level = "high"
		}
		data := map[string]any{"cwd": mustWorkingDirectory(), "home": os.Getenv("HOME")}
		if kind == "get_messages" && command["fixtureBytes"] != nil {
			data = map[string]any{"messages": []any{map[string]any{"role": "toolResult", "content": []any{map[string]any{"type": "image", "mimeType": "image/png", "data": strings.Repeat("A", int(command["fixtureBytes"].(float64)))}}}}}
		}
		if kind == "get_state" {
			data = map[string]any{"model": map[string]any{"provider": "fixture", "id": model, "contextWindow": 200000}, "thinkingLevel": level}
		}
		if kind == "get_available_models" {
			data = map[string]any{"models": []piContextModel{{"fixture", "balanced", 200000}, {"fixture", "fast", 128000}}}
		}
		response, _ := json.Marshal(map[string]any{"type": "response", "id": command["id"], "command": kind, "success": success, "data": data})
		fmt.Println(string(response))
	}
	os.Exit(0)
}
func mustWorkingDirectory() string { value, _ := os.Getwd(); return value }
func TestPiRPCLargeImageHistory(t *testing.T) {
	t.Setenv("LUMO_PI_RPC_FIXTURE", "1")
	for _, size := range []int{12 << 20, piRPCMessageLimit + 1024} {
		t.Run(fmt.Sprint(size), func(t *testing.T) {
			home := t.TempDir()
			process, err := startPiProcess(os.Args[0], []string{"-test.run=^TestPiRPCFixtureProcess$"}, home, home)
			if err != nil {
				t.Fatal(err)
			}
			defer process.cancel()
			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			defer cancel()
			raw, err := process.command(ctx, map[string]any{"type": "get_messages", "fixtureBytes": size})
			if size > piRPCMessageLimit {
				if err == nil || !strings.Contains(err.Error(), "64 MiB response limit") {
					t.Fatalf("expected a clear response limit error, got %v", err)
				}
				process.mu.Lock()
				defer process.mu.Unlock()
				if !process.closed || len(process.events) != 1 || !strings.Contains(string(process.events[0]), "saved chat is intact") {
					t.Fatal("missing transport failure event")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			var reply struct {
				Data struct {
					Messages []struct {
						Content []struct{ Data string }
					}
				}
			}
			if json.Unmarshal(raw, &reply) != nil || len(reply.Data.Messages) != 1 || len(reply.Data.Messages[0].Content) != 1 || len(reply.Data.Messages[0].Content[0].Data) != size {
				t.Fatal("image history was truncated")
			}
			if _, err = process.command(ctx, map[string]any{"type": "get_state"}); err != nil {
				t.Fatalf("process did not survive large history: %v", err)
			}
		})
	}
}

func TestPiRPCTransportStreamsUnicodeAndCleansUp(t *testing.T) {
	t.Setenv("LUMO_PI_RPC_FIXTURE", "1")
	home := t.TempDir()
	project := filepath.Join(home, "project with spaces")
	if err := os.Mkdir(project, 0700); err != nil {
		t.Fatal(err)
	}
	process, err := startPiProcess(os.Args[0], []string{"-test.run=^TestPiRPCFixtureProcess$"}, project, home)
	if err != nil {
		t.Fatal(err)
	}
	defer process.cancel()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	text := "first\nsecond\u2028third\u2029end"
	raw, err := process.command(ctx, map[string]any{"type": "prompt", "message": text})
	if err != nil {
		t.Fatal(err)
	}
	var reply struct {
		Command string `json:"command"`
		Data    struct {
			Cwd  string `json:"cwd"`
			Home string `json:"home"`
		} `json:"data"`
	}
	if json.Unmarshal(raw, &reply) != nil || reply.Command != "prompt" || reply.Data.Home != home {
		t.Fatalf("response: %s", raw)
	}
	resolved, _ := filepath.EvalSymlinks(project)
	if reply.Data.Cwd != resolved {
		t.Fatalf("wrong project: %s", raw)
	}
	process.mu.Lock()
	events := append([]json.RawMessage{}, process.events...)
	process.mu.Unlock()
	if len(events) != 1 {
		t.Fatalf("events: %s", events)
	}
	var event struct {
		Delta struct {
			Text string `json:"delta"`
		} `json:"assistantMessageEvent"`
	}
	_ = json.Unmarshal(events[0], &event)
	if event.Delta.Text != text {
		t.Fatalf("JSONL framing split content: %q", event.Delta.Text)
	}
	process.cancel()
	select {
	case <-process.done:
	case <-time.After(3 * time.Second):
		t.Fatal("process did not stop")
	}
}
func TestPiCommandsRejectExtraExecutionAndMalformedFields(t *testing.T) {
	for _, body := range []string{`{"type":"bash","command":"id"}`, `{"type":"prompt","message":"hello","shell":"sh"}`, `{"type":"prompt","message":"/login"}`, `{"type":"prompt","message":false}`, `{"type":"prompt","message":" "}`, `{"type":"switch_session","sessionPath":"/etc/shadow"}`, `{"type":"clone","sessionPath":"/tmp/other"}`, `{"type":"clone","entryId":"abc"}`} {
		var raw map[string]json.RawMessage
		_ = json.Unmarshal([]byte(body), &raw)
		if _, err := validatePiCommand(raw); err == nil {
			t.Fatalf("accepted %s", body)
		}
	}
}
func TestPiSessionsUseProjectScopeAndIgnoreSymlinks(t *testing.T) {
	server := NewServer(Deps{})
	server.pi.home = t.TempDir()
	project := filepath.Join(server.pi.home, "project")
	os.Mkdir(project, 0700)
	_, dir, err := server.piFolder(project)
	if err != nil {
		t.Fatal(err)
	}
	os.MkdirAll(dir, 0700)
	body := `{"type":"session","cwd":"` + project + `"}` + "\n" + `{"type":"message","message":{"role":"user","content":[{"type":"text","text":"First task"}]}}` + "\n" + `{"type":"session_info","name":"Renamed task"}` + "\n"
	if err := os.WriteFile(filepath.Join(dir, "one.jsonl"), []byte(body), 0600); err != nil {
		t.Fatal(err)
	}
	os.Symlink(filepath.Join(dir, "one.jsonl"), filepath.Join(dir, "linked.jsonl"))
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, httptest.NewRequest("GET", "/api/v1/pi/sessions?project="+project, nil))
	if response.Code != 200 || !strings.Contains(response.Body.String(), "Renamed task") || strings.Contains(response.Body.String(), "linked.jsonl") {
		t.Fatalf("sessions: %d %s", response.Code, response.Body.String())
	}
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, httptest.NewRequest("POST", "/api/v1/pi/start", strings.NewReader(`{"requestId":"traversal","project":"`+project+`","session":"../secret.jsonl"}`)))
	if response.Code != 400 {
		t.Fatalf("traversal accepted: %d", response.Code)
	}
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, httptest.NewRequest("POST", "/api/v1/pi/start", strings.NewReader(`{"requestId":"symlink","project":"`+project+`","session":"linked.jsonl"}`)))
	if response.Code != 404 {
		t.Fatalf("symlink accepted: %d", response.Code)
	}
}
func TestPiEventsDetectGapAndIsolateProcessIDs(t *testing.T) {
	server := NewServer(Deps{})
	p := &piProcess{base: 10, events: []json.RawMessage{json.RawMessage(`{"type":"agent_start"}`)}, wake: make(chan struct{}, 1), done: make(chan struct{})}
	server.piRPC.processes["known"] = p
	for _, item := range []struct {
		query  string
		status int
	}{{"id=known&after=0", 409}, {"id=unknown&after=0", 404}, {"id=known&after=-1", 400}, {"id=known&after=10", 200}} {
		response := httptest.NewRecorder()
		server.Handler().ServeHTTP(response, httptest.NewRequest("GET", "/api/v1/pi/events?"+item.query, nil))
		if response.Code != item.status {
			t.Fatalf("%s: %d", item.query, response.Code)
		}
	}
}

func TestPiForkValidationAndEventBoundary(t *testing.T) {
	for _, body := range []string{`{"type":"fork"}`, `{"type":"fork","entryId":""}`, `{"type":"fork","entryId":"../session"}`, `{"type":"fork","entryId":false}`, `{"type":"fork","entryId":"abc","sessionPath":"/tmp/other"}`, `{"type":"get_fork_messages","path":"/tmp/other"}`} {
		var raw map[string]json.RawMessage
		_ = json.Unmarshal([]byte(body), &raw)
		if _, err := validatePiCommand(raw); err == nil {
			t.Fatalf("accepted %s", body)
		}
	}
	for _, body := range []string{`{"type":"fork","entryId":"abc-123"}`, `{"type":"get_fork_messages"}`, `{"type":"clone"}`} {
		var raw map[string]json.RawMessage
		_ = json.Unmarshal([]byte(body), &raw)
		if _, err := validatePiCommand(raw); err != nil {
			t.Fatalf("rejected %s: %v", body, err)
		}
	}
	t.Setenv("LUMO_PI_RPC_FIXTURE", "1")
	home := t.TempDir()
	process, err := startPiProcess(os.Args[0], []string{"-test.run=^TestPiRPCFixtureProcess$"}, home, home)
	if err != nil {
		t.Fatal(err)
	}
	defer process.cancel()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err := process.command(ctx, map[string]any{"type": "prompt", "message": "old output"}); err != nil {
		t.Fatal(err)
	}
	s := NewServer(Deps{})
	s.piRPC.processes["fixture"] = process
	body := `{"requestId":"fork-boundary","id":"fixture","command":{"type":"fork","entryId":"abc-123"}}`
	response := httptest.NewRecorder()
	s.Handler().ServeHTTP(response, httptest.NewRequest("POST", "/api/v1/pi/command", strings.NewReader(body)))
	var result struct {
		Data struct {
			Success bool `json:"success"`
			Cursor  int  `json:"eventCursor"`
		} `json:"data"`
	}
	if json.Unmarshal(response.Body.Bytes(), &result) != nil || !result.Data.Success || result.Data.Cursor != 1 {
		t.Fatalf("fork boundary: %s", response.Body.String())
	}
	if _, err := process.command(ctx, map[string]any{"type": "prompt", "message": "new output"}); err != nil {
		t.Fatal(err)
	}
	cloned := httptest.NewRecorder()
	s.Handler().ServeHTTP(cloned, httptest.NewRequest("POST", "/api/v1/pi/command", strings.NewReader(`{"requestId":"clone-boundary","id":"fixture","command":{"type":"clone"}}`)))
	if cloned.Code != 200 || !strings.Contains(cloned.Body.String(), `"eventCursor":2`) {
		t.Fatalf("clone boundary: %s", cloned.Body.String())
	}
	history, err := process.command(ctx, map[string]any{"type": "get_messages"})
	if err != nil || !strings.Contains(string(history), `"eventCursor":2`) {
		t.Fatalf("missing history boundary: %s %v", history, err)
	}
	repeated := httptest.NewRecorder()
	s.Handler().ServeHTTP(repeated, httptest.NewRequest("POST", "/api/v1/pi/command", strings.NewReader(body)))
	if repeated.Body.String() != response.Body.String() {
		t.Fatal("fork retry was not idempotent")
	}
}

func TestPiReconnectResumesOnlyMatchingLiveProcess(t *testing.T) {
	s := NewServer(Deps{})
	s.pi.home = t.TempDir()
	project, _, err := s.piFolder("~")
	if err != nil {
		t.Fatal(err)
	}
	p := &piProcess{project: project, permissionMode: "ask", touched: time.Now().Add(-time.Minute)}
	s.piRPC.processes["existing"] = p
	response := httptest.NewRecorder()
	s.Handler().ServeHTTP(response, httptest.NewRequest("POST", "/api/v1/pi/start", strings.NewReader(`{"requestId":"resume-existing","project":"~","resume":"existing"}`)))
	if response.Code != 200 || !strings.Contains(response.Body.String(), `"id":"existing"`) || time.Since(p.touched) > time.Second {
		t.Fatalf("did not resume existing process: %d %s", response.Code, response.Body.String())
	}
	if len(s.piRPC.processes) != 1 {
		t.Fatal("created an extra process")
	}
	p.closed = true
	response = httptest.NewRecorder()
	s.Handler().ServeHTTP(response, httptest.NewRequest("POST", "/api/v1/pi/start", strings.NewReader(`{"requestId":"resume-closed","project":"~","resume":"existing","session":"missing.jsonl"}`)))
	if strings.Contains(response.Body.String(), `"id":"existing"`) {
		t.Fatal("resumed a closed process")
	}
	p.closed = false
	p.project = project + "/other"
	response = httptest.NewRecorder()
	s.Handler().ServeHTTP(response, httptest.NewRequest("POST", "/api/v1/pi/start", strings.NewReader(`{"requestId":"resume-wrong-project","project":"~","resume":"existing","session":"missing.jsonl"}`)))
	if strings.Contains(response.Body.String(), `"id":"existing"`) {
		t.Fatal("resumed another project")
	}
}

func TestPiConcurrentSessionsInOneProject(t *testing.T) {
	t.Setenv("LUMO_PI_RPC_READY", "ask")
	t.Setenv("LUMO_PI_RPC_FIXTURE", "1")
	home := t.TempDir()
	t.Setenv("HOME", home)
	binary := filepath.Join(home, ".local/share/lumo/pi/bin/pi")
	if err := os.MkdirAll(filepath.Dir(binary), 0700); err != nil {
		t.Fatal(err)
	}
	script := "#!/bin/sh\nexec '" + strings.ReplaceAll(os.Args[0], "'", "'\\''") + "' -test.run=^TestPiRPCFixtureProcess$\n"
	if err := os.WriteFile(binary, []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	s := NewServer(Deps{})
	s.pi.home = home
	s.pi.path = func() string { return binary }
	project, dir, err := s.piFolder("~")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"first.jsonl", "second.jsonl"} {
		writePiChat(t, project, filepath.Join(dir, name))
	}
	start := func(session, resume, request string) *httptest.ResponseRecorder {
		response := httptest.NewRecorder()
		body, _ := json.Marshal(map[string]string{"requestId": request, "project": project, "session": session, "resume": resume})
		s.Handler().ServeHTTP(response, httptest.NewRequest("POST", "/api/v1/pi/start", strings.NewReader(string(body))))
		return response
	}
	defer func() {
		for _, p := range s.piRPC.processes {
			p.cancel()
		}
	}()
	for index, session := range []string{"first.jsonl", "second.jsonl"} {
		if response := start(session, "", fmt.Sprintf("open-%d", index)); response.Code != 200 {
			t.Fatalf("start %s: %d %s", session, response.Code, response.Body.String())
		}
	}
	if len(s.piRPC.processes) != 2 {
		t.Fatal("expected independent processes")
	}
	if response := start("first.jsonl", "", "duplicate"); response.Code != 409 {
		t.Fatalf("duplicate: %d %s", response.Code, response.Body.String())
	}
	for id, p := range s.piRPC.processes {
		p.mu.Lock()
		session := p.session
		p.mu.Unlock()
		if session == "first.jsonl" {
			if response := start("second.jsonl", id, "wrong-resume"); response.Code != 409 {
				t.Fatalf("resumed wrong conversation: %d %s", response.Code, response.Body.String())
			}
			if response := start(session, id, "right-resume"); response.Code != 200 {
				t.Fatal(response.Body.String())
			}
		}
	}
	if response := archivePiRequest(s, project, "first.jsonl", "archive-running", "archive"); response.Code != 409 {
		t.Fatal(response.Body.String())
	}
	writePiChat(t, project, filepath.Join(dir, "idle.jsonl"))
	if response := archivePiRequest(s, project, "idle.jsonl", "archive-idle", "archive"); response.Code != 200 {
		t.Fatal(response.Body.String())
	}
}

func TestPiSavedStateOmitsUnwrittenSessionPaths(t *testing.T) {
	path := filepath.Join(t.TempDir(), "new.jsonl")
	raw, _ := json.Marshal(map[string]any{"success": true, "data": map[string]any{"sessionFile": path, "thinkingLevel": "high"}})
	result := piSavedState(raw)
	if strings.Contains(string(result), "sessionFile") || !strings.Contains(string(result), "high") {
		t.Fatalf("provisional state: %s", result)
	}
	if err := os.WriteFile(path, []byte(`{"type":"session"}`), 0600); err != nil {
		t.Fatal(err)
	}
	if string(piSavedState(raw)) != string(raw) {
		t.Fatal("saved conversation path was lost")
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(path, 0700); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(piSavedState(raw)), "sessionFile") {
		t.Fatal("directory accepted as saved session")
	}
}

func TestPiRPCUsesPrivateRuntimeWithoutSystemNode(t *testing.T) {
	home := t.TempDir()
	bin := piruntime.Bin(home)
	if err := os.MkdirAll(bin, 0700); err != nil {
		t.Fatal(err)
	}
	node := "#!/bin/sh\nprintf '%s\\n' '{\"type\":\"runtime_ready\"}'\n"
	if err := os.WriteFile(filepath.Join(bin, "node"), []byte(node), 0700); err != nil {
		t.Fatal(err)
	}
	pi := filepath.Join(home, "pi")
	if err := os.WriteFile(pi, []byte("#!/usr/bin/env node\n"), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", t.TempDir())
	process, err := startPiProcess(pi, nil, home, home)
	if err != nil {
		t.Fatal(err)
	}
	defer process.cancel()
	select {
	case <-process.done:
	case <-time.After(3 * time.Second):
		t.Fatal("Pi failed to exit")
	}
	process.mu.Lock()
	defer process.mu.Unlock()
	for _, event := range process.events {
		if strings.Contains(string(event), "runtime_ready") {
			return
		}
	}
	t.Fatalf("private runtime did not run: %s", process.events)
}
