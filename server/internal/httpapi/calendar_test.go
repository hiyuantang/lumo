// SPDX-License-Identifier: AGPL-3.0-only
package httpapi

import (
	"bytes"
	"encoding/json"
	"lumo/apps/calendar/backend/calendar"
	"net/http/httptest"
	"testing"
)

func TestCalendarAPIIdempotenceConflictAndStrictInput(t *testing.T) {
	s := NewServer(Deps{})
	s.home = t.TempDir()
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
