// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"bytes"
	"encoding/json"
	"lumo/server/internal/appplugins"
	"net/http/httptest"
	"os"
	"testing"
)

func TestPiCalendarToggleAndPrivateExecutable(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("PI_CODING_AGENT_DIR", dir)
	before, err := readPiExtensionSettings(dir)
	if err != nil || !before.Calendar {
		t.Fatal("calendar should start enabled", err)
	}
	s := NewServer(Deps{})
	raw, _ := json.Marshal(map[string]any{"requestId": "calendar-off", "revision": before.Revision, "lumoUse": true, "calendar": false})
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, httptest.NewRequest("POST", "/api/v1/pi/extensions", bytes.NewReader(raw)))
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	after, err := readPiExtensionSettings(dir)
	if err != nil || after.Calendar || !after.LumoUse || !after.Questions {
		t.Fatal("toggle changed other extensions", err)
	}
	app, err := appplugins.Load("calendar")
	if err != nil {
		t.Fatal(err)
	}
	path, err := writePiPluginExtension(app, t.TempDir(), "read-only")
	if err != nil {
		t.Fatal(err)
	}
	info, _ := os.Stat(path)
	raw, err = os.ReadFile(path)
	if err != nil || info.Mode().Perm() != 0600 || !bytes.Contains(raw, []byte(`const permissionMode = "read-only";`)) || bytes.Contains(raw, []byte(`const executable = 'lumod';`)) {
		t.Fatal("unsafe calendar executable generation", err)
	}
}
