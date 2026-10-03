// SPDX-License-Identifier: AGPL-3.0-only
package httpapi

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"lumo/plugin"
	"lumo/server/internal/appplugins"
)

func pluginFixture(t *testing.T, root, script string) {
	t.Helper()
	directory := filepath.Join(root, "skills")
	if err := os.MkdirAll(directory, 0755); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256([]byte(script))
	name := fmt.Sprintf("%x.bin", sum)
	if err := os.WriteFile(filepath.Join(directory, name), []byte(script), 0755); err != nil {
		t.Fatal(err)
	}
	app, err := appplugins.Load("skills")
	if err != nil {
		t.Fatal(err)
	}
	manifest := app.Manifest
	manifest.Backend.Entry = name
	raw, _ := json.Marshal(manifest)
	if err = os.WriteFile(filepath.Join(directory, "manifest.json"), raw, 0644); err != nil {
		t.Fatal(err)
	}
}
func TestPluginReplacementFailureContainmentAndHostBoundary(t *testing.T) {
	root := t.TempDir()
	reply := func(text string) string {
		raw, _ := json.Marshal(plugin.Reply{Status: 200, Body: []byte(text)})
		return "#!/bin/sh\ncat >/dev/null\nprintf '%s' '" + string(raw) + "'\n"
	}
	pluginFixture(t, root, reply("first"))
	t.Setenv("LUMO_PLUGIN_DIR", root)
	server := NewServer(Deps{})
	handler := server.Handler()
	get := func(path string) (int, string) {
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		return w.Code, w.Body.String()
	}
	if code, body := get("/api/v1/skills"); code != 200 || body != "first" {
		t.Fatalf("first %d %s", code, body)
	}
	pluginFixture(t, root, reply("second"))
	if code, body := get("/api/v1/skills"); code != 200 || body != "second" {
		t.Fatalf("new version %d %s", code, body)
	}
	pluginFixture(t, root, "#!/bin/sh\nexit 7\n")
	if code, _ := get("/api/v1/skills"); code != 503 {
		t.Fatal("crash not contained", code)
	}
	if code, _ := get("/api/v1/meta/version"); code != 200 {
		t.Fatal("core stopped with plugin", code)
	}
	raw, _ := json.Marshal(plugin.Reply{Status: 200, Broker: &plugin.BrokerAction{Action: "system.power", RequestID: "test"}})
	pluginFixture(t, root, "#!/bin/sh\ncat >/dev/null\nprintf '%s' '"+string(raw)+"'\n")
	if code, _ := get("/api/v1/skills"); code != 403 {
		t.Fatal("plugin escaped broker allowlist", code)
	}
}
func TestPluginRequestIDCannotReplayDifferentMutation(t *testing.T) {
	server := NewServer(Deps{})
	server.pi.home = t.TempDir()
	for index, body := range []string{`{"requestId":"same","action":"collection","collection":{"name":"One","color":"#336699","kind":"event"}}`, `{"requestId":"same","action":"collection","collection":{"name":"Two","color":"#336699","kind":"event"}}`} {
		response := httptest.NewRecorder()
		server.Handler().ServeHTTP(response, httptest.NewRequest("POST", "/api/v1/calendar", strings.NewReader(body)))
		expected := 200
		if index == 1 {
			expected = 409
		}
		if response.Code != expected {
			t.Fatalf("%d %s", response.Code, response.Body.String())
		}
	}
}

func TestPluginCalendarMutationsQueueWithReminderPolling(t *testing.T) {
	server := NewServer(Deps{})
	server.pi.home = t.TempDir()
	handler := server.Handler()
	start := make(chan struct{})
	results := make(chan int, 2)
	for _, request := range []struct{ path, body string }{
		{"/api/v1/calendar/notices", `{"requestId":"poll"}`},
		{"/api/v1/calendar", `{"requestId":"create","action":"collection","collection":{"name":"Concurrent","color":"#336699","kind":"event"}}`},
	} {
		go func(path, body string) {
			<-start
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, httptest.NewRequest("POST", path, strings.NewReader(body)))
			results <- response.Code
		}(request.path, request.body)
	}
	close(start)
	for i := 0; i < 2; i++ {
		if code := <-results; code != 200 {
			t.Fatalf("concurrent request returned %d", code)
		}
	}
}
