// SPDX-License-Identifier: AGPL-3.0-only
package httpapi

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPiModelDefaultsPreserveSettingsAndOtherModels(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "settings.json")
	os.WriteFile(path, []byte(`{"theme":"custom","compaction":{"enabled":false},"modelThinkingLevels":{"other/model":"low","fixture/balanced":"medium"}}`), 0600)
	if err := savePiModelDefaults(dir, "fixture", "balanced", "high"); err != nil {
		t.Fatal(err)
	}
	data, _ := os.ReadFile(path)
	var settings map[string]any
	if err := json.Unmarshal(data, &settings); err != nil {
		t.Fatal(err)
	}
	if settings["defaultModel"] != "balanced" || settings["defaultProvider"] != "fixture" || settings["defaultThinkingLevel"] != "high" || settings["theme"] != "custom" || settings["compaction"].(map[string]any)["enabled"] != false {
		t.Fatalf("settings: %s", data)
	}
	levels := settings["modelThinkingLevels"].(map[string]any)
	if levels["other/model"] != "low" || levels["fixture/balanced"] != "high" {
		t.Fatalf("levels: %v", levels)
	}
	info, _ := os.Stat(path)
	if info.Mode().Perm() != 0600 {
		t.Fatalf("permissions: %v", info.Mode())
	}
}

func TestPiModelDefaultsRejectInvalidAndLinkedSettings(t *testing.T) {
	for _, value := range []string{`invalid`, `null`, `[]`, `{"modelThinkingLevels":false}`, `{"modelThinkingLevels":null}`} {
		dir := t.TempDir()
		path := filepath.Join(dir, "settings.json")
		os.WriteFile(path, []byte(value), 0600)
		if err := savePiModelDefaults(dir, "fixture", "balanced", "high"); err == nil {
			t.Fatalf("accepted %s", value)
		}
		data, _ := os.ReadFile(path)
		if string(data) != value {
			t.Fatal("overwrote invalid settings")
		}
	}
	dir := t.TempDir()
	target := filepath.Join(dir, "original.json")
	os.WriteFile(target, []byte(`{}`), 0600)
	os.Symlink(target, filepath.Join(dir, "settings.json"))
	if err := savePiModelDefaults(dir, "fixture", "balanced", "high"); err == nil {
		t.Fatal("followed linked settings")
	}
	data, _ := os.ReadFile(target)
	if string(data) != `{}` {
		t.Fatal("changed linked settings")
	}
}

func TestPiSelectionsRememberConfirmedStateOnly(t *testing.T) {
	t.Setenv("LUMO_PI_RPC_FIXTURE", "1")
	t.Setenv("PI_CODING_AGENT_DIR", "")
	s := NewServer(Deps{})
	s.pi.home = t.TempDir()
	p, err := startPiProcess(os.Args[0], []string{"-test.run=^TestPiRPCFixtureProcess$"}, s.pi.home, s.pi.home)
	if err != nil {
		t.Fatal(err)
	}
	defer p.cancel()
	s.piRPC.processes["fixture"] = p
	path := filepath.Join(s.pi.home, ".pi", "agent", "settings.json")
	call := func(id, command string) {
		t.Helper()
		response := httptest.NewRecorder()
		s.Handler().ServeHTTP(response, httptest.NewRequest("POST", "/api/v1/pi/command", strings.NewReader(`{"id":"fixture","requestId":"`+id+`","command":`+command+`}`)))
		if response.Code != 200 {
			t.Fatalf("command: %d %s", response.Code, response.Body.String())
		}
	}
	call("read", `{"type":"get_state"}`)
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("opening a conversation saved defaults")
	}
	call("model", `{"type":"set_model","provider":"fixture","modelId":"fast"}`)
	call("effort", `{"type":"set_thinking_level","level":"max"}`)
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var settings map[string]any
	json.Unmarshal(before, &settings)
	if settings["defaultModel"] != "fast" || settings["defaultThinkingLevel"] != "high" {
		t.Fatalf("did not save confirmed values: %s", before)
	}
	call("failed", `{"type":"set_model","provider":"fixture","modelId":"missing"}`)
	call("reopen", `{"type":"get_state"}`)
	after, _ := os.ReadFile(path)
	if string(before) != string(after) {
		t.Fatal("failed selection or state read changed defaults")
	}
}
