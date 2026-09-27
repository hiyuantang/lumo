// SPDX-License-Identifier: AGPL-3.0-only
package httpapi

import (
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestActionsForwardTypedRequestsAndSession(t *testing.T) {
	dir, err := os.MkdirTemp("/tmp", "lumo-actions")
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
	received := make(chan map[string]any, 1)
	broker := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Error(err)
		}
		received <- payload
		w.Header().Set("X-Lumo-Idempotent-Replay", "true")
		_, _ = w.Write([]byte(`{"ok":true,"data":{}}`))
	})}
	go broker.Serve(listener)
	defer broker.Close()
	server := NewServer(Deps{BrokerSocket: socket})
	revision := "sha256:" + strings.Repeat("b", 64)
	planID := "pln_" + strings.Repeat("a", 24)
	for _, tc := range []struct{ path, action, body, key, value, expected string }{
		{"/apps/plan", "apps.plan", `{"requestId":"plan","appId":"nginx"}`, "appId", "nginx", ""},
		{"/apps/plan", "apps.plan", `{"requestId":"update","appId":"docker","operation":"update"}`, "operation", "update", ""},
		{"/docker/resource", "docker.resource", `{"requestId":"volume-create","kind":"volume","action":"create","id":"test-data","revision":"absent"}`, "", "", ""},
		{"/apps/plan", "apps.plan", `{"requestId":"remove","appId":"nginx","operation":"uninstall"}`, "operation", "uninstall", ""},
		{"/containers/action", "containers.restart", `{"requestId":"restart","id":"` + strings.Repeat("a", 64) + `","action":"restart","expectedRevision":"` + revision + `"}`, "containerId", strings.Repeat("a", 64), `{"revision":"` + revision + `"}`},
		{"/websites/save", "websites.save", `{"requestId":"save","id":"notes","definition":{"domain":"notes.example.com","kind":"proxy","port":3000,"root":"","enabled":true},"expectedRevision":"absent"}`, "siteId", "notes", `{"revision":"absent"}`},
		{"/system/settings", "system.settings", `{"requestId":"settings","change":{"ntp":false},"expectedRevision":"` + revision + `"}`, "", "", `{"revision":"` + revision + `"}`},
		{"/system/power", "system.reboot", `{"requestId":"power","action":"reboot"}`, "", "", `{}`},
		{"/network/apply", "network.applyWithRollback", `{"requestId":"network","expectedRevision":"` + revision + `","config":{"version":2,"ethernets":{"eth0":{"dhcp4":true}}}}`, "", "", `{"revision":"` + revision + `"}`},
		{"/network/confirm", "network.confirm", `{"requestId":"confirm","token":"` + strings.Repeat("a", 64) + `"}`, "token", strings.Repeat("a", 64), `{}`},
		{"/files/write-privileged", "files.writePrivileged", `{"requestId":"file","path":"/etc/lumo.conf","content":"dGVzdA==","expectedRevision":"` + revision + `"}`, "contentBase64", "dGVzdA==", `{"revision":"` + revision + `"}`},
		{"/services/action", "services.restart", `{"requestId":"service","action":"restart","unit":"nginx.service"}`, "unit", "nginx.service", ""},
		{"/services/action", "services.stop", `{"requestId":"service-expected","action":"stop","unit":"nginx.service","expected":{"activeState":"active"}}`, "unit", "nginx.service", `{"activeState":"active"}`},
		{"/updates/refresh", "updates.refresh", `{"requestId":"refresh"}`, "", "", ""},
		{"/updates/plan", "updates.plan", `{"requestId":"plan"}`, "", "", ""},
		{"/updates/apply", "packages.applyPlan", `{"requestId":"apply","planId":"` + planID + `"}`, "planId", planID, `{"planId":"` + planID + `"}`},
	} {
		r := httptest.NewRequest("POST", "/api/v1"+tc.path, strings.NewReader(tc.body))
		r.Header.Set("X-Lumo-Session", "session-token")
		w := httptest.NewRecorder()
		server.Handler().ServeHTTP(w, r)
		if w.Code != 200 {
			t.Fatalf("%s status=%d body=%s", tc.path, w.Code, w.Body.String())
		}
		payload := <-received
		if payload["action"] != tc.action || payload["sessionToken"] != "session-token" || payload["requestId"] == "" {
			t.Fatalf("%s payload=%v", tc.path, payload)
		}
		args, ok := payload["arguments"].(map[string]any)
		if !ok || (tc.key != "" && args[tc.key] != tc.value) {
			t.Fatalf("%s arguments=%v", tc.path, payload["arguments"])
		}
		var expected any
		if tc.expected != "" {
			if err := json.Unmarshal([]byte(tc.expected), &expected); err != nil {
				t.Fatal(err)
			}
		}
		actual, hasExpected := payload["expected"]
		if hasExpected != (tc.expected != "") || !reflect.DeepEqual(actual, expected) {
			t.Fatalf("%s expected=%v, want %s", tc.path, actual, tc.expected)
		}
		if w.Header().Get("X-Lumo-Idempotent-Replay") != "true" || w.Body.String() != `{"ok":true,"data":{}}` {
			t.Fatalf("%s response was not forwarded: %v %s", tc.path, w.Header(), w.Body.String())
		}
	}
}

func TestServerAppsRejectUnsupportedRequestsBeforeBroker(t *testing.T) {
	server := NewServer(Deps{BrokerSocket: "/not-running"})
	for path, payloads := range map[string][]string{
		"/apps/plan":         {`{"requestId":"r","appId":"nginx","operation":"purge"}`, `{}`, `{"requestId":"r","appId":"nginx;id"}`, `{"requestId":"r","appId":"docker","command":"id"}`, `{"requestId":"r","appId":"docker"} {}`},
		"/containers/action": {`{}`, `{"requestId":"r","id":"../exec","action":"start","expectedRevision":"absent"}`, `{"requestId":"r","id":"` + strings.Repeat("a", 64) + `","action":"exec","expectedRevision":"sha256:` + strings.Repeat("b", 64) + `"}`},
		"/websites/save":     {`{}`, `{"requestId":"r","id":"notes","expectedRevision":"absent","definition":{"domain":"example.com","kind":"static","root":"/etc","port":0,"enabled":true}}`, `{"requestId":"r","id":"notes","expectedRevision":"absent","definition":{"domain":"example.com","kind":"proxy","port":3000,"command":"id"}}`},
	} {
		for _, payload := range payloads {
			w := httptest.NewRecorder()
			server.Handler().ServeHTTP(w, httptest.NewRequest("POST", "/api/v1"+path, strings.NewReader(payload)))
			if w.Code != 400 {
				t.Fatalf("%s input=%s status=%d response=%s", path, payload, w.Code, w.Body.String())
			}
		}
		w := httptest.NewRecorder()
		NewServer(Deps{}).Handler().ServeHTTP(w, httptest.NewRequest("POST", "/api/v1"+path, strings.NewReader(`{}`)))
		if w.Code != 503 {
			t.Fatalf("missing broker status=%d", w.Code)
		}
	}
}
