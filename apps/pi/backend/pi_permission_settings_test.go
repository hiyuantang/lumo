// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPiApprovalSettingsPreserveDefaultsAndSavedChats(t *testing.T) {
	dir := t.TempDir()
	first := filepath.Join(t.TempDir(), "first.jsonl")
	second := filepath.Join(t.TempDir(), "second.jsonl")
	os.WriteFile(first, []byte("chat"), 0600)
	os.WriteFile(second, []byte("chat"), 0600)
	os.WriteFile(filepath.Join(dir, "settings.json"), []byte(`{"defaultModel":"keep","defaultThinkingLevel":"high","lumoImageQuality":"quality90"}`), 0600)
	if err := savePiPermissionMode(dir, first, "auto", true); err != nil {
		t.Fatal(err)
	}
	if err := savePiPermissionMode(dir, second, "read-only", true); err != nil {
		t.Fatal(err)
	}
	if err := savePiPermissionMode(dir, first, "auto", false); err != nil {
		t.Fatal(err)
	}
	for path, want := range map[string]string{"": "read-only", first: "auto", second: "read-only"} {
		if mode, err := readPiPermissionMode(dir, path); err != nil || mode != want {
			t.Fatal(path, mode, err)
		}
	}
	settings, _, _ := readPiSettingsJSON(dir)
	if string(settings["defaultModel"]) != `"keep"` || string(settings["defaultThinkingLevel"]) != `"high"` || string(settings["lumoImageQuality"]) != `"quality90"` {
		t.Fatal("other settings changed")
	}
	missing := filepath.Join(dir, "unsent.jsonl")
	if err := savePiPermissionMode(dir, missing, "auto", false); err != nil {
		t.Fatal(err)
	}
	if mode, _ := readPiPermissionMode(dir, missing); mode != "read-only" {
		t.Fatal("saved a nonexistent chat")
	}
	info, _ := os.Stat(filepath.Join(dir, "settings.json"))
	if info.Mode().Perm() != 0600 {
		t.Fatal("permissions")
	}
	for _, value := range []string{`{"lumoPermissionMode":"bad"}`, `{"lumoPermissionMode":null}`, `{"lumoSessionPermissionModes":null}`, `{"lumoSessionPermissionModes":{"one":"bad"}}`} {
		os.WriteFile(filepath.Join(dir, "settings.json"), []byte(value), 0600)
		if err := savePiPermissionMode(dir, first, "ask", true); err == nil {
			t.Fatal("invalid settings overwritten")
		}
		raw, _ := os.ReadFile(filepath.Join(dir, "settings.json"))
		if string(raw) != value {
			t.Fatal("invalid settings modified")
		}
	}
}

func TestPiStartUsesRememberedApprovalModeAndPreservesLiveMode(t *testing.T) {
	t.Setenv("LUMO_PI_RPC_FIXTURE", "1")
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("PI_CODING_AGENT_DIR", filepath.Join(home, "agent"))
	binary := filepath.Join(home, "pi")
	script := "#!/bin/sh\nexec '" + strings.ReplaceAll(os.Args[0], "'", "'\\''") + "' -test.run=^TestPiRPCFixtureProcess$\n"
	os.WriteFile(binary, []byte(script), 0700)
	s := NewServer(Deps{})
	s.pi.home = home
	s.pi.path = func() string { return binary }
	project, dir, err := s.piFolder("~")
	if err != nil {
		t.Fatal(err)
	}
	os.MkdirAll(dir, 0700)
	for _, name := range []string{"first.jsonl", "second.jsonl"} {
		writePiChat(t, project, filepath.Join(dir, name))
	}
	defer func() {
		for _, p := range s.piRPC.processes {
			p.cancel()
		}
	}()
	start := func(key, session, resume, requested, ready string, remember bool, code int) string {
		t.Helper()
		t.Setenv("LUMO_PI_RPC_READY", ready)
		body, _ := json.Marshal(map[string]any{"requestId": key, "project": project, "session": session, "resume": resume, "permissionMode": requested, "rememberPermissionMode": remember})
		w := httptest.NewRecorder()
		s.Handler().ServeHTTP(w, httptest.NewRequest("POST", "/api/v1/pi/start", strings.NewReader(string(body))))
		if w.Code != code {
			t.Fatalf("%s: %d %s", key, w.Code, w.Body.String())
		}
		if code != 200 {
			return ""
		}
		var result struct {
			Data struct{ ID, PermissionMode string }
		}
		json.Unmarshal(w.Body.Bytes(), &result)
		if result.Data.PermissionMode != ready {
			t.Fatalf("%s: %s", key, w.Body.String())
		}
		return result.Data.ID
	}
	first := start("select-auto", "first.jsonl", "", "auto", "auto", true, 200)
	start("new-auto", "", "", "", "auto", false, 200)
	start("select-read", "second.jsonl", "", "read-only", "read-only", true, 200)
	start("resume-old", "first.jsonl", first, "", "auto", false, 200)
	start("mismatch", "first.jsonl", first, "ask", "ask", true, 409)
	start("new-read", "", "", "", "read-only", false, 200)
	start("failed-mode", "", "", "auto", "ask", true, 503)
	agentDir, _ := s.piAgentDir()
	if mode, err := readPiPermissionMode(agentDir, ""); err != nil || mode != "read-only" {
		t.Fatal("failed or resumed request changed default", mode, err)
	}
}
