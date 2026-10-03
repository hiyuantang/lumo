// SPDX-License-Identifier: AGPL-3.0-only
package static

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPluginOverlay(t *testing.T) {
	dir := t.TempDir()
	if err := os.Mkdir(filepath.Join(dir, "skills"), 0755); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "skills", "manifest.json")
	if err := os.WriteFile(path, []byte(`{"version":"1.0.1"}`), 0644); err != nil {
		t.Fatal(err)
	}
	fallback := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(418); _, _ = w.Write([]byte(r.URL.Path)) })
	handler := WithPlugins(fallback, dir)
	for _, tc := range []struct {
		path   string
		status int
		body   string
	}{
		{"/plugins/skills/manifest.json", 200, `{"version":"1.0.1"}`},
		{"/plugins/calendar/manifest.json", 418, "/plugins/calendar/manifest.json"},
		{"/plugins/skills/" + strings.Repeat("a", 64) + ".js", 418, "/plugins/skills/"},
		{"/plugins/unknown/manifest.json", 418, "/plugins/unknown/manifest.json"},
		{"/plugins/skills/../../secret", 404, "404"},
		{"/plugins/skills/source.ts", 404, "404"},
		{"/plugins/skills/" + strings.Repeat("a", 64) + ".bin", 404, "404"},
		{"/plugins/calendar/" + strings.Repeat("a", 64) + ".mjs", 404, "404"},
		{"/", 418, "/"},
	} {
		t.Run(tc.path, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			handler.ServeHTTP(recorder, httptest.NewRequest("GET", tc.path, nil))
			if recorder.Code != tc.status || !strings.Contains(recorder.Body.String(), tc.body) {
				t.Fatalf("got %d %s", recorder.Code, recorder.Body.String())
			}
		})
	}
	next := path + ".next"
	if err := os.WriteFile(next, []byte(`{"version":"1.0.2"}`), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(next, path); err != nil {
		t.Fatal(err)
	}
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest("GET", "/plugins/skills/manifest.json", nil))
	if !strings.Contains(recorder.Body.String(), "1.0.2") || recorder.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("did not pick up atomic plugin update")
	}
	outside := filepath.Join(t.TempDir(), "secret.js")
	if err := os.WriteFile(outside, []byte("secret"), 0600); err != nil {
		t.Fatal(err)
	}
	asset := strings.Repeat("b", 64) + ".js"
	if err := os.Symlink(outside, filepath.Join(dir, "skills", asset)); err != nil {
		t.Fatal(err)
	}
	recorder = httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest("GET", "/plugins/skills/"+asset, nil))
	if recorder.Code != 418 || strings.Contains(recorder.Body.String(), "secret") {
		t.Fatal("followed escaping symlink")
	}
}
