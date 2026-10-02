// SPDX-License-Identifier: AGPL-3.0-only
package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"lumo/server/internal/desktopapps"
	"lumo/server/internal/system"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

func TestDesktopAppLaunchCapabilityAndRevocation(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	s := NewServer(Deps{Sampler: system.NewSampler()})
	store := desktopapps.New(home)
	project := filepath.Join(home, "pulse")
	if _, e := desktopapps.Create(project, "local.pulse", "Pulse"); e != nil {
		t.Fatal(e)
	}
	b, e := store.Build(context.Background(), project)
	if e != nil {
		t.Fatal(e)
	}
	call := func(method, path, session string, body any) *httptest.ResponseRecorder {
		t.Helper()
		data, _ := json.Marshal(body)
		req := httptest.NewRequest(method, path, bytes.NewReader(data))
		req.Header.Set("X-Lumo-Session", session)
		w := httptest.NewRecorder()
		s.Handler().ServeHTTP(w, req)
		return w
	}
	req := desktopapps.Change{RequestID: desktopapps.Token(), Action: "install", ID: b.Manifest.ID, Digest: b.Digest}
	w := call("POST", "/api/v1/desktop-apps/action", "one", req)
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	var installed struct {
		Data desktopapps.App `json:"data"`
	}
	json.Unmarshal(w.Body.Bytes(), &installed)
	w = call("POST", "/api/v1/desktop-apps/launch", "one", map[string]any{"digest": b.Digest, "preview": false})
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	var launch struct {
		Data struct {
			Token string `json:"token"`
			URL   string `json:"url"`
		} `json:"data"`
	}
	json.Unmarshal(w.Body.Bytes(), &launch)
	if strings.Contains(launch.Data.URL, launch.Data.Token) {
		t.Fatal("capability token exposed in app URL")
	}
	w = call("GET", launch.Data.URL, "one", nil)
	if w.Code != 200 || !strings.Contains(w.Header().Get("Content-Security-Policy"), "sandbox allow-scripts") {
		t.Fatal(w.Code, w.Body.String())
	}
	for _, tc := range []struct {
		session, method string
		code            int
	}{{"two", "system.metrics.read", 404}, {"one", "files.read", 403}, {"one", "system.metrics.read", 200}} {
		w = call("POST", "/api/v1/desktop-apps/call", tc.session, map[string]string{"token": launch.Data.Token, "method": tc.method})
		if w.Code != tc.code {
			t.Fatal(tc, w.Code, w.Body.String())
		}
	}
	w = call("POST", "/api/v1/desktop-apps/action", "one", desktopapps.Change{RequestID: desktopapps.Token(), Action: "disable", ID: b.Manifest.ID, Revision: installed.Data.Revision})
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	if w = call("POST", "/api/v1/desktop-apps/call", "one", map[string]string{"token": launch.Data.Token, "method": "system.metrics.read"}); w.Code != http.StatusNotFound {
		t.Fatal("revoked launch accepted", w.Body.String())
	}
	if validDesktopRequest(piDesktopRequest{Action: "app_preview", Target: "../../etc/passwd", Label: "App"}) || !validDesktopRequest(piDesktopRequest{Action: "app_preview", Target: b.Digest, Label: "App"}) {
		t.Fatal("preview request validation")
	}
}
