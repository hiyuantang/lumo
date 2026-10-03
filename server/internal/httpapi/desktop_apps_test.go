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
	}{{"two", "system.metrics.read", 404}, {"one", "files.read", 403}, {"one", "notifications.send", 403}, {"one", "system.metrics.read", 200}} {
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

}

func TestDesktopAppStoragePermissionsPreviewAndErrors(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	store := desktopapps.New(home)
	project := filepath.Join(home, "counter")
	if _, e := desktopapps.Create(project, "local.counter", "Counter", "counter"); e != nil {
		t.Fatal(e)
	}
	b, e := store.Build(context.Background(), project)
	if e != nil {
		t.Fatal(e)
	}
	s := NewServer(Deps{Sampler: system.NewSampler()})
	call := func(path, session string, body any) *httptest.ResponseRecorder {
		t.Helper()
		raw, _ := json.Marshal(body)
		r := httptest.NewRequest("POST", "/api/v1/desktop-apps/"+path, bytes.NewReader(raw))
		r.Header.Set("X-Lumo-Session", session)
		w := httptest.NewRecorder()
		s.Handler().ServeHTTP(w, r)
		return w
	}
	launch := func(preview bool) string {
		t.Helper()
		w := call("launch", "one", map[string]any{"digest": b.Digest, "preview": preview})
		if w.Code != 200 {
			t.Fatal(w.Body.String())
		}
		var result struct {
			Data struct {
				Token string `json:"token"`
			} `json:"data"`
		}
		json.Unmarshal(w.Body.Bytes(), &result)
		return result.Data.Token
	}
	request := func(token, method string, params any, code int) string {
		t.Helper()
		body := map[string]any{"token": token, "method": method}
		if params != nil {
			body["params"] = params
		}
		w := call("call", "one", body)
		if w.Code != code {
			t.Fatal(method, w.Code, w.Body.String())
		}
		return w.Body.String()
	}
	first := launch(true)
	request(first, "system.metrics.read", nil, 403)
	request(first, "app.storage.set", map[string]any{"revision": "", "value": map[string]int{"count": 9}}, 200)
	if got := request(first, "app.storage.set", map[string]any{"revision": "", "value": 1}, 409); !strings.Contains(got, "conflict") {
		t.Fatal(got)
	}
	if got := request(launch(true), "app.storage.get", nil, 200); !strings.Contains(got, `"value":null`) {
		t.Fatal("preview shared data", got)
	}
	if _, e = store.Change(desktopapps.Change{RequestID: desktopapps.Token(), Action: "install", ID: b.Manifest.ID, Digest: b.Digest}); e != nil {
		t.Fatal(e)
	}
	installed := launch(false)
	if got := request(installed, "app.storage.get", nil, 200); !strings.Contains(got, `"value":null`) {
		t.Fatal("preview wrote installed data", got)
	}
	request(installed, "app.storage.set", map[string]any{"revision": "", "value": 2, "id": "local.other"}, 400)
	request(installed, "app.storage.set", map[string]any{"revision": "", "value": 2}, 200)
	if got := request(first, "app.storage.get", nil, 200); !strings.Contains(got, `"count":9`) {
		t.Fatal("preview changed", got)
	}
	w := call("call", "two", map[string]string{"token": installed, "method": "app.storage.get"})
	if w.Code != 404 {
		t.Fatal("cross-session access", w.Code)
	}
	w = call("close", "one", map[string]string{"token": first})
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	request(first, "app.storage.get", nil, 404)
}
