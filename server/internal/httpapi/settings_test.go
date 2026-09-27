// SPDX-License-Identifier: AGPL-3.0-only
package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"lumo/server/internal/hostsettings"
)

type fakeSettingsReader struct{ unavailable bool }

func (f fakeSettingsReader) Snapshot(context.Context) (hostsettings.Snapshot, error) {
	if f.unavailable {
		return hostsettings.Snapshot{}, errors.New("no bus")
	}
	values := hostsettings.Values{Hostname: "atlas", Timezone: "Etc/UTC", NTP: true}
	return hostsettings.Snapshot{Values: values, CanNTP: true, Revision: hostsettings.Revision(values)}, nil
}

func TestSettingsForwardTypedChangeAndSession(t *testing.T) {
	dir, err := os.MkdirTemp("/tmp", "lumo-settings")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(dir)
	socket := filepath.Join(dir, "broker.sock")
	listener, err := net.Listen("unix", socket)
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	broker := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Error(err)
		}
		if payload["action"] != "system.settings" || payload["sessionToken"] != "session-token" {
			t.Errorf("payload=%v", payload)
		}
		change := payload["arguments"].(map[string]any)["change"].(map[string]any)
		if change["timezone"] != "America/New_York" || len(change) != 1 {
			t.Errorf("change=%v", change)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "data": map[string]any{"timezone": "America/New_York"}})
	})}
	go broker.Serve(listener)
	defer broker.Close()
	server := NewServer(Deps{BrokerSocket: socket})
	payload := `{"requestId":"settings-1","expectedRevision":"sha256:` + strings.Repeat("a", 64) + `","change":{"timezone":"America/New_York"}}`
	request := httptest.NewRequest("POST", "/api/v1/system/settings", strings.NewReader(payload))
	request.Header.Set("X-Lumo-Session", "session-token")
	w := httptest.NewRecorder()
	server.Handler().ServeHTTP(w, request)
	if w.Code != 200 || !strings.Contains(w.Body.String(), "America/New_York") {
		t.Fatalf("response=%s", w.Body.String())
	}
}

func (f fakeSettingsReader) Timezones(context.Context) ([]string, error) {
	return []string{"Etc/UTC", "America/New_York"}, nil
}

func TestSettingsReadAndUnavailable(t *testing.T) {
	for _, unavailable := range []bool{false, true} {
		server := NewServer(Deps{Settings: fakeSettingsReader{unavailable: unavailable}})
		w := httptest.NewRecorder()
		server.Handler().ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/system/settings", nil))
		if unavailable && w.Code != 503 {
			t.Fatalf("unavailable: %d", w.Code)
		}
		if !unavailable {
			var response struct {
				Data hostsettings.Snapshot `json:"data"`
			}
			_ = json.Unmarshal(w.Body.Bytes(), &response)
			if w.Code != 200 || response.Data.Hostname != "atlas" || !hostsettings.ValidRevision(response.Data.Revision) {
				t.Fatalf("response: %s", w.Body.String())
			}
		}
	}
	server := NewServer(Deps{Settings: fakeSettingsReader{}})
	w := httptest.NewRecorder()
	server.Handler().ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/system/timezones", nil))
	if w.Code != 200 || !strings.Contains(w.Body.String(), "America/New_York") {
		t.Fatalf("zones: %s", w.Body.String())
	}
	w = httptest.NewRecorder()
	NewServer(Deps{}).Handler().ServeHTTP(w, httptest.NewRequest("POST", "/api/v1/system/settings", strings.NewReader(`{}`)))
	if w.Code != http.StatusServiceUnavailable {
		t.Fatal("missing broker did not fail closed")
	}
}

func TestSettingsRequestValidation(t *testing.T) {
	server := NewServer(Deps{BrokerSocket: "/no-broker"})
	prefix := `{"requestId":"req","expectedRevision":"sha256:` + strings.Repeat("a", 64) + `","change":`
	for _, payload := range []string{
		`{}`, prefix + `{}}`, prefix + `{"hostname":"new-host"}}`, prefix + `{"runtimeHostname":"new-host"}}`, prefix + `{"ntp":"false"}}`, prefix + `{"ntp":true,"timezone":"Etc/UTC"}}`, prefix + `{"command":"id"}}`, prefix + `{"timezone":"../../etc"}}`, prefix + `{"timezone":"Etc/UTC"}} {}`,
	} {
		w := httptest.NewRecorder()
		server.Handler().ServeHTTP(w, httptest.NewRequest("POST", "/api/v1/system/settings", strings.NewReader(payload)))
		if w.Code != http.StatusBadRequest {
			t.Fatalf("payload=%s status=%d response=%s", payload, w.Code, w.Body.String())
		}
	}
}
