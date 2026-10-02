// SPDX-License-Identifier: AGPL-3.0-only
package httpapi

import (
	"bytes"
	"encoding/json"
	"lumo/server/internal/calendar"
	"net/http/httptest"
	"os"
	"testing"
)

func TestCalendarAPIIdempotenceConflictAndStrictInput(t *testing.T) {
	s := NewServer(Deps{})
	s.pi.home = t.TempDir()
	send := func(path, body string, code int) testEnvelope {
		t.Helper()
		w := httptest.NewRecorder()
		s.Handler().ServeHTTP(w, httptest.NewRequest("POST", path, bytes.NewBufferString(body)))
		if w.Code != code {
			t.Fatalf("%s: %d %s", path, w.Code, w.Body.String())
		}
		var env testEnvelope
		if err := json.Unmarshal(w.Body.Bytes(), &env); err != nil {
			t.Fatal(err)
		}
		return env
	}
	body := `{"requestId":"create-event","action":"save","item":{"collectionId":"personal","kind":"event","title":"Review","start":"2026-10-01T09:00:00Z","end":"2026-10-01T10:00:00Z","timeZone":"UTC"}}`
	first := send("/api/v1/calendar", body, 200)
	again := send("/api/v1/calendar", body, 200)
	if !bytes.Equal(first.Data, again.Data) {
		t.Fatal("mutation replay created another event")
	}
	var item calendar.Item
	json.Unmarshal(first.Data, &item)
	item.Title = "Changed"
	raw, _ := json.Marshal(map[string]any{"requestId": "edit", "action": "save", "item": item})
	send("/api/v1/calendar", string(raw), 200)
	raw, _ = json.Marshal(map[string]any{"requestId": "stale", "action": "delete", "id": item.ID, "revision": item.Revision})
	send("/api/v1/calendar", string(raw), 409)
	send("/api/v1/calendar", `{"requestId":"bad","action":"save","unknown":true}`, 400)
	send("/api/v1/calendar", `{"requestId":"trailing","action":"collection"} {}`, 400)
	send("/api/v1/calendar/google", `{"requestId":"tasks","action":"tasks"}`, 400)
	send("/api/v1/calendar/notices", `{"requestId":"poll"}`, 200)
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/calendar?from=2026-10-01T00:00:00Z&to=2026-10-02T00:00:00Z", nil))
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	var env testEnvelope
	json.Unmarshal(w.Body.Bytes(), &env)
	var snapshot calendar.Snapshot
	json.Unmarshal(env.Data, &snapshot)
	if len(snapshot.Items) != 1 || snapshot.Items[0].Title != "Changed" {
		t.Fatal("CRUD did not share persisted state")
	}
}
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
	path, err := writePiCalendarExtension(t.TempDir(), "read-only")
	if err != nil {
		t.Fatal(err)
	}
	info, _ := os.Stat(path)
	raw, err = os.ReadFile(path)
	if err != nil || info.Mode().Perm() != 0600 || !bytes.Contains(raw, []byte(`const permissionMode = "read-only";`)) || bytes.Contains(raw, []byte(`const executable = 'lumod';`)) {
		t.Fatal("unsafe calendar executable generation", err)
	}
}
