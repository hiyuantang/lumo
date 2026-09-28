// SPDX-License-Identifier: AGPL-3.0-only
package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPiSettingsPersistUserInstructionsAndRejectConflicts(t *testing.T) {
	t.Setenv("PI_CODING_AGENT_DIR", "")
	s := NewServer(Deps{})
	s.pi.home = t.TempDir()
	first, err := s.readPiInstruction("instructions")
	if err != nil || first.Exists || first.Content != "" || first.Path != filepath.Join(s.pi.home, ".pi/agent/AGENTS.md") {
		t.Fatalf("missing instructions: %+v %v", first, err)
	}
	save := func(id, content, revision string) *httptest.ResponseRecorder {
		body, _ := json.Marshal(map[string]string{"requestId": id, "kind": "instructions", "content": content, "revision": revision})
		response := httptest.NewRecorder()
		s.Handler().ServeHTTP(response, httptest.NewRequest("POST", "/api/v1/pi/settings", bytes.NewReader(body)))
		return response
	}
	if res := save("first", "# Preferences\nUse 日本語.\n", ""); res.Code != 200 {
		t.Fatal(res.Body.String())
	}
	saved, err := s.readPiInstruction("instructions")
	if err != nil || !saved.Exists || !strings.Contains(saved.Content, "日本語") || saved.Revision == "" {
		t.Fatalf("saved: %+v %v", saved, err)
	}
	info, _ := os.Stat(saved.Path)
	if info.Mode().Perm() != 0600 {
		t.Fatalf("permissions: %v", info.Mode())
	}
	if res := save("stale-create", "overwrite", ""); res.Code != 409 {
		t.Fatalf("missing revision overwrote existing: %s", res.Body.String())
	}
	if err := os.WriteFile(saved.Path, []byte("External edit"), 0600); err != nil {
		t.Fatal(err)
	}
	if res := save("stale", "overwrite", saved.Revision); res.Code != 409 {
		t.Fatalf("stale save: %s", res.Body.String())
	}
	external, _ := s.readPiInstruction("instructions")
	if external.Content != "External edit" {
		t.Fatal("external edit lost")
	}
	if res := save("clear", "", external.Revision); res.Code != 200 {
		t.Fatal(res.Body.String())
	}
	cleared, _ := s.readPiInstruction("instructions")
	if !cleared.Exists || cleared.Content != "" {
		t.Fatalf("clear: %+v", cleared)
	}
	if res := save("clear", "", external.Revision); res.Code != 200 {
		t.Fatal("idempotent retry failed")
	}
}

func TestPiSettingsHonorsAgentDirectoryAndInstructionOverride(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("PI_CODING_AGENT_DIR", dir)
	s := NewServer(Deps{})
	for name, text := range map[string]string{"AGENTS.md": "normal", "AGENTS.override.md": "override", "APPEND_SYSTEM.md": "extra"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(text), 0600); err != nil {
			t.Fatal(err)
		}
	}
	for kind, want := range map[string]string{"instructions": "override", "append": "extra"} {
		result, err := s.readPiInstruction(kind)
		if err != nil || result.Content != want {
			t.Fatalf("%s: %+v %v", kind, result, err)
		}
	}
	for _, kind := range []string{"auth.json", "../AGENTS.md", "settings", ""} {
		if _, err := s.readPiInstruction(kind); err == nil {
			t.Fatalf("accepted %q", kind)
		}
	}
	if err := os.Remove(filepath.Join(dir, "AGENTS.override.md")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(dir, "AGENTS.md"), filepath.Join(dir, "AGENTS.override.md")); err != nil {
		t.Fatal(err)
	}
	if _, err := s.readPiInstruction("instructions"); err == nil {
		t.Fatal("accepted linked instruction file")
	}
	if err := os.WriteFile(filepath.Join(dir, "APPEND_SYSTEM.md"), []byte(strings.Repeat("x", piInstructionLimit+1)), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := s.readPiInstruction("append"); err == nil {
		t.Fatal("read oversized instructions")
	}
	t.Setenv("PI_CODING_AGENT_DIR", "relative")
	if _, err := s.readPiInstruction("instructions"); err == nil {
		t.Fatal("accepted ambiguous relative directory")
	}
}
