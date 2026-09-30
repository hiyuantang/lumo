// SPDX-License-Identifier: AGPL-3.0-only
package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestPiOptionalExtensionsDiscoverSaveAndLoad(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("PI_CODING_AGENT_DIR", dir)
	root := filepath.Join(dir, "extensions")
	paths := []string{filepath.Join(root, "notes.ts"), filepath.Join(root, "review", "index.js"), filepath.Join(dir, "extra.mjs"), filepath.Join(root, "excluded.js")}
	for _, path := range paths {
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("original fixture"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	configured, _ := json.Marshal([]string{"extra.mjs", "!extensions/excluded.js"})
	if err := writePiSettingsJSON(dir, map[string]json.RawMessage{"extensions": configured, "theme": json.RawMessage(`"keep"`)}); err != nil {
		t.Fatal(err)
	}
	before, err := readPiExtensionSettings(dir)
	if err != nil || len(before.Extensions) != 3 {
		t.Fatalf("%+v %v", before, err)
	}
	choices := []map[string]any{}
	disabled := ""
	for _, item := range before.Extensions {
		enabled := item.Name != "review"
		choices = append(choices, map[string]any{"id": item.ID, "enabled": enabled})
		if !enabled {
			disabled = item.ID
		}
	}
	s := NewServer(Deps{})
	post := func(id, revision string, choices any, code int) {
		t.Helper()
		body, _ := json.Marshal(map[string]any{"requestId": id, "revision": revision, "lumoUse": true, "extensions": choices})
		w := httptest.NewRecorder()
		s.Handler().ServeHTTP(w, httptest.NewRequest("POST", "/api/v1/pi/extensions", bytes.NewReader(body)))
		if w.Code != code {
			t.Fatalf("status %d: %s", w.Code, w.Body.String())
		}
	}
	post("save", before.Revision, choices, 200)
	after, err := readPiExtensionSettings(dir)
	if err != nil || before.Revision == after.Revision {
		t.Fatal(after, err)
	}
	expected := []string{}
	for _, item := range after.Extensions {
		if item.ID == disabled && item.Enabled {
			t.Fatal("preference lost")
		}
		if item.Enabled {
			expected = append(expected, "--extension", item.Path)
		}
	}
	if !reflect.DeepEqual(piExtensionArgs(after), expected) || len(expected) != 4 {
		t.Fatal("disabled code loaded", piExtensionArgs(after))
	}
	settings, _, _ := readPiSettingsJSON(dir)
	var retained []string
	json.Unmarshal(settings["extensions"], &retained)
	if string(settings["theme"]) != `"keep"` || !reflect.DeepEqual(retained, []string{"extra.mjs", "!extensions/excluded.js"}) {
		t.Fatal("unrelated preferences changed")
	}
	post("stale", before.Revision, choices, 409)
	post("unknown", after.Revision, []map[string]any{{"id": "unknown", "enabled": true}}, 400)
	duplicate := append([]map[string]any{}, choices...)
	duplicate[1] = duplicate[0]
	post("duplicate", after.Revision, duplicate, 400)
	for _, path := range paths {
		data, _ := os.ReadFile(path)
		if string(data) != "original fixture" {
			t.Fatal("installed code changed")
		}
	}
	os.Remove(paths[0])
	changed, _ := readPiExtensionSettings(dir)
	post("removed", after.Revision, choices, 409)
	if changed.Revision == after.Revision {
		t.Fatal("inventory change missed")
	}
}

func TestPiQuestionsTogglePersistsWithoutChangingApprovalsOrImageQuality(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("PI_CODING_AGENT_DIR", dir)
	writePiSettingsJSON(dir, map[string]json.RawMessage{"lumoPermissionMode": json.RawMessage(`"ask"`), "lumoImageQuality": json.RawMessage(`"quality90"`)})
	before, err := readPiExtensionSettings(dir)
	if err != nil || !before.Questions {
		t.Fatal(before, err)
	}
	s := NewServer(Deps{})
	body, _ := json.Marshal(map[string]any{"requestId": "questions-off", "revision": before.Revision, "lumoUse": true, "questions": false})
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, httptest.NewRequest("POST", "/api/v1/pi/extensions", bytes.NewReader(body)))
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	after, err := readPiExtensionSettings(dir)
	if err != nil || after.Questions || !after.LumoUse {
		t.Fatal(after, err)
	}
	settings, _, _ := readPiSettingsJSON(dir)
	if string(settings["lumoPermissionMode"]) != `"ask"` || string(settings["lumoImageQuality"]) != `"quality90"` {
		t.Fatal("other features changed")
	}
	file, err := writePiQuestionsExtension(t.TempDir(), "ask", false)
	code, _ := os.ReadFile(file)
	if err != nil || !bytes.Contains(code, []byte("const questionsEnabled = false;")) || !bytes.Contains(code, []byte(`const permissionMode = "ask";`)) {
		t.Fatal("Questions did not switch off independently", err)
	}
}
