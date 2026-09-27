// SPDX-License-Identifier: AGPL-3.0-only
package httpapi

import (
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAppUpdateHistoryForwardsReadOnlyBrokerView(t *testing.T) {
	dir, err := os.MkdirTemp("/tmp", "lumo-history")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(dir)
	socket := filepath.Join(dir, "broker.sock")
	listener, err := net.Listen("unix", socket)
	if err != nil {
		t.Fatal(err)
	}
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" || r.URL.Path != "/apps/update-history" {
			t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"data":{"entries":[{"requestId":"update-one","appId":"docker","completedAt":"2026-09-27T21:00:00Z","success":true,"packages":[{"name":"docker.io","fromVersion":"27.5.1","toVersion":"27.5.2"}]}]}}`))
	})}
	go server.Serve(listener)
	defer server.Close()
	api := NewServer(Deps{BrokerSocket: socket})
	response := httptest.NewRecorder()
	api.Handler().ServeHTTP(response, httptest.NewRequest("GET", "/api/v1/apps/update-history", nil))
	if response.Code != 200 || !strings.Contains(response.Body.String(), `"fromVersion":"27.5.1"`) {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	server.Close()
	response = httptest.NewRecorder()
	api.Handler().ServeHTTP(response, httptest.NewRequest("GET", "/api/v1/apps/update-history", nil))
	if response.Code != 503 {
		t.Fatalf("unavailable status=%d", response.Code)
	}
}
