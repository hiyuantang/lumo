// SPDX-License-Identifier: AGPL-3.0-only
package gateway

import (
	"context"
	"encoding/json"
	"fmt"
	"lumo/server/internal/desktopapps"
	"lumo/server/internal/httpapi"
	"lumo/server/internal/system"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestDesktopAppBrowserFixture(t *testing.T) {
	if os.Getenv("LUMO_DESKTOP_BROWSER_FIXTURE") != "1" {
		t.Skip("Started explicitly by the offline browser workflow")
	}
	home := t.TempDir()
	t.Setenv("HOME", home)
	store := desktopapps.New(home)
	project := filepath.Join(home, "pulse")
	if _, e := desktopapps.Create(project, "local.server-pulse", "Server Pulse"); e != nil {
		t.Fatal(e)
	}
	if _, e := store.Build(context.Background(), project); e != nil {
		t.Fatal(e)
	}
	counter := filepath.Join(home, "counter")
	if _, e := desktopapps.Create(counter, "local.counter", "Counter", "counter"); e != nil {
		t.Fatal(e)
	}
	if _, e := store.Build(context.Background(), counter); e != nil {
		t.Fatal(e)
	}
	notes := filepath.Join(home, "notes")
	if _, e := desktopapps.Create(notes, "local.notes", "Notes", "notes"); e != nil {
		t.Fatal(e)
	}
	if _, e := store.Build(context.Background(), notes); e != nil {
		t.Fatal(e)
	}
	react := filepath.Join(home, "react")
	if _, e := desktopapps.Create(react, "local.react", "React Note", "react"); e != nil {
		t.Fatal(e)
	}
	if _, e := store.Build(context.Background(), react); e != nil {
		t.Fatal(e)
	}
	agent := startStub(t, "apps-agent.sock", httpapi.NewServer(httpapi.Deps{Sampler: system.NewSampler()}).Handler())
	session := startStub(t, "apps-session.sock", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req map[string]string
		json.NewDecoder(r.Body).Decode(&req)
		if r.URL.Path == "/login" {
			if req["username"] != "demo" || req["password"] != "demo" {
				w.WriteHeader(401)
				return
			}
		} else if req["token"] != testToken {
			w.WriteHeader(404)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"token": testToken, "csrf": testCSRF, "user": map[string]any{"name": "demo", "uid": 1000, "gid": 1000, "home": home}, "agentSocket": agent})
	}))
	dist, e := filepath.Abs("../../../dist")
	if e != nil {
		t.Fatal(e)
	}
	if _, e = os.Stat(filepath.Join(dist, "index.html")); e != nil {
		t.Fatal("Build the production frontend before this test", e)
	}
	gateway := New(Config{SessiondSocket: session, Static: http.FileServer(http.Dir(dist))})
	server := httptest.NewServer(gateway.Handler())
	defer server.Close()
	fmt.Println("LUMO_DESKTOP_FIXTURE_HOME=" + home)
	fmt.Println("LUMO_DESKTOP_FIXTURE_URL=" + server.URL)
	for range 180 {
		if _, e := os.Stat(filepath.Join(home, "finish")); e == nil {
			return
		}
		time.Sleep(time.Second)
	}
	t.Fatal("Browser fixture timed out")
}
func TestDesktopAppFrameHeadersDoNotRelaxShell(t *testing.T) {
	handler := securityHeaders(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.Write([]byte("ok")) }))
	for _, path := range []string{"/", "/api/v1/desktop-apps/frame", "/api/v1/desktop-apps/frame/extra"} {
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		policy := w.Header().Get("Content-Security-Policy")
		if path == "/api/v1/desktop-apps/frame" {
			if !strings.Contains(policy, "sandbox allow-scripts") || w.Header().Get("X-Frame-Options") != "SAMEORIGIN" {
				t.Fatal(policy)
			}
		} else if policy != contentSecurityPolicy || w.Header().Get("X-Frame-Options") != "DENY" {
			t.Fatal("shell policy changed", path, policy)
		}
	}
}
