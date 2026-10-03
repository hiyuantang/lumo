// SPDX-License-Identifier: AGPL-3.0-only
package httpapi

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestResidentAppReusesProcessAndStopsWithHost(t *testing.T) {
	t.Setenv("PI_CODING_AGENT_DIR", t.TempDir())
	s := NewServer(Deps{})
	t.Cleanup(s.Close)
	request := func(path string) *httptest.ResponseRecorder {
		t.Helper()
		w := httptest.NewRecorder()
		s.Handler().ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		return w
	}
	first := request("/api/v1/pi/extensions")
	if first.Code != 200 {
		t.Fatal(first.Code, first.Body.String())
	}
	process := s.residents.processes["pi"]
	if process == nil {
		t.Fatal("Pi did not run as an app process")
	}
	if next := request("/api/v1/pi/extensions"); next.Code != 200 || next.Body.String() != first.Body.String() {
		t.Fatal("separate requests did not share Pi state")
	}
	if s.residents.processes["pi"] != process {
		t.Fatal("app process restarted for another request")
	}
	apps := request("/api/v1/apps")
	if apps.Code != 200 || !strings.Contains(apps.Body.String(), `"id":"pi"`) {
		t.Fatal("missing software contribution", apps.Body.String())
	}
	if history := request("/api/v1/apps/update-history"); history.Code != 200 {
		t.Fatal(history.Body.String())
	}
	if private := request("/_lumo/status"); private.Code == 200 {
		t.Fatal("private lifecycle route exposed")
	}
	if private := request("/api/v1/pi/_lumo/status"); private.Code == 200 {
		t.Fatal("undeclared app route exposed")
	}
	if s.ActiveOperations() != 0 {
		t.Fatal("idle app prevents agent cleanup")
	}
	var before testEnvelope
	if err := json.Unmarshal(first.Body.Bytes(), &before); err != nil {
		t.Fatal(err)
	}
	process.command.Process.Kill()
	select {
	case <-process.done:
	case <-time.After(5 * time.Second):
		t.Fatal("app did not exit")
	}
	if recovered := request("/api/v1/pi/extensions"); recovered.Code != 200 {
		t.Fatal("failed to recover crashed app", recovered.Body.String())
	}
	replacement := s.residents.processes["pi"]
	if replacement == process {
		t.Fatal("dead process reused")
	}
	s.Close()
	select {
	case <-replacement.done:
	case <-time.After(5 * time.Second):
		t.Fatal("orphaned app after host closed")
	}
}
