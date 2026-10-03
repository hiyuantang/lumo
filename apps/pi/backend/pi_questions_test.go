// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

func TestPiQuestionRoundTripAndReplay(t *testing.T) {
	t.Setenv("LUMO_PI_RPC_FIXTURE", "1")
	home := t.TempDir()
	p, err := startPiProcess(os.Args[0], []string{"-test.run=^TestPiRPCFixtureProcess$"}, home, home)
	if err != nil {
		t.Fatal(err)
	}
	defer p.cancel()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err := p.command(ctx, map[string]any{"type": "prompt", "message": "ask"}); err != nil {
		t.Fatal(err)
	}
	snapshot, err := p.command(ctx, map[string]any{"type": "get_messages"})
	if err != nil || !strings.Contains(string(snapshot), `"questions":[{"id":"question-1"`) {
		t.Fatalf("missing reconnect question: %s %v", snapshot, err)
	}
	s := NewServer(Deps{})
	s.piRPC.processes["chat"] = p
	post := func(body string, code int) {
		t.Helper()
		w := httptest.NewRecorder()
		s.Handler().ServeHTTP(w, httptest.NewRequest("POST", "/api/v1/pi/answer", strings.NewReader(body)))
		if w.Code != code {
			t.Fatalf("status %d: %s", w.Code, w.Body.String())
		}
	}
	post(`{"requestId":"unknown","id":"chat","questionId":"other","value":"Development"}`, 409)
	post(`{"requestId":"empty","id":"chat","questionId":"question-1","value":"  "}`, 400)
	post(`{"requestId":"mixed","id":"chat","questionId":"question-1","value":"Development","cancelled":true}`, 400)
	body := `{"requestId":"answer-once","id":"chat","questionId":"question-1","value":"Custom café"}`
	post(body, 200)
	post(body, 200)
	post(`{"requestId":"late","id":"chat","questionId":"question-1","value":"Production"}`, 409)
	if _, err := p.command(ctx, map[string]any{"type": "get_state"}); err != nil {
		t.Fatal(err)
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	count := 0
	for _, event := range p.events {
		var record struct {
			Type   string         `json:"type"`
			Answer map[string]any `json:"answer"`
		}
		json.Unmarshal(event, &record)
		if record.Type != "fixture_answer" {
			continue
		}
		count++
		if record.Answer["id"] != "question-1" || record.Answer["value"] != "Custom café" {
			t.Fatalf("mismatched response: %s", event)
		}
	}
	if count != 1 || len(p.activeQuestions()) != 0 {
		t.Fatalf("answers=%d questions=%v", count, p.questions)
	}
}

func TestPiQuestionCancellationExpiryAndStop(t *testing.T) {
	t.Setenv("LUMO_PI_RPC_FIXTURE", "1")
	home := t.TempDir()
	p, err := startPiProcess(os.Args[0], []string{"-test.run=^TestPiRPCFixtureProcess$"}, home, home)
	if err != nil {
		t.Fatal(err)
	}
	defer p.cancel()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	s := NewServer(Deps{})
	s.piRPC.processes["chat"] = p
	if _, err := p.command(ctx, map[string]any{"type": "prompt", "message": "ask"}); err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, httptest.NewRequest("POST", "/api/v1/pi/answer", strings.NewReader(`{"requestId":"cancel","id":"chat","questionId":"question-1","cancelled":true}`)))
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	if _, err := p.command(ctx, map[string]any{"type": "prompt", "message": "ask"}); err != nil {
		t.Fatal(err)
	}
	if _, err := p.command(ctx, map[string]any{"type": "abort"}); err != nil {
		t.Fatal(err)
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if len(p.activeQuestions()) != 0 {
		t.Fatal("aborted question retained")
	}
	p.trackQuestion("extension_ui_request", json.RawMessage(`{"id":"timed","method":"input","timeout":1}`))
	p.questions[0].ExpiresAt = time.Now().Add(-time.Second).UnixMilli()
	if len(p.activeQuestions()) != 0 {
		t.Fatal("expired question retained")
	}
	p.trackQuestion("extension_ui_request", json.RawMessage(`{"id":"notice","method":"notify"}`))
	if len(p.activeQuestions()) != 0 {
		t.Fatal("notification treated as question")
	}
}

func TestPiQuestionsExtensionWrittenPrivately(t *testing.T) {
	path, err := writePiQuestionsExtension(t.TempDir(), "ask")
	if err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatalf("permissions: %v %v", info, err)
	}
	content, err := os.ReadFile(path)
	if err != nil || string(content) != strings.Replace(piQuestionsExtension, "const permissionMode = 'ask';", `const permissionMode = "ask";`, 1) {
		t.Fatal("extension content mismatch")
	}
}

func TestPiModesRejectInvalidAndMismatchedResume(t *testing.T) {
	s := NewServer(Deps{})
	s.pi.home = t.TempDir()
	project, _, err := s.piFolder("~")
	if err != nil {
		t.Fatal(err)
	}
	s.piRPC.processes["running"] = &piProcess{project: project, permissionMode: "auto"}
	for _, tc := range []struct {
		mode, resume string
		status       int
	}{{"invalid", "", 400}, {"read-only", "running", 409}, {"auto", "running", 200}} {
		body, _ := json.Marshal(map[string]string{"requestId": "mode-" + tc.mode, "project": s.pi.home, "resume": tc.resume, "permissionMode": tc.mode})
		response := httptest.NewRecorder()
		s.Handler().ServeHTTP(response, httptest.NewRequest("POST", "/api/v1/pi/start", strings.NewReader(string(body))))
		if response.Code != tc.status {
			t.Fatalf("mode=%s status=%d %s", tc.mode, response.Code, response.Body.String())
		}
	}
	if strings.Contains(piToolsForMode("read-only", false, true), "bash") || strings.Contains(piToolsForMode("read-only", false, true), "write") || strings.Contains(piToolsForMode("read-only", false, true), "edit") {
		t.Fatal("read only exposes mutating tools")
	}
}

func TestPiManagedStartRequiresPermissionHandshake(t *testing.T) {
	t.Setenv("LUMO_PI_RPC_FIXTURE", "1")
	home := t.TempDir()
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	if process, err := startManagedPiProcess(ctx, os.Args[0], []string{"-test.run=^TestPiRPCFixtureProcess$"}, home, home, "ask"); err == nil || process != nil {
		t.Fatal("accepted a process without permission controls")
	}
}
