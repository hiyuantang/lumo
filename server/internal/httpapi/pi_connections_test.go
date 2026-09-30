// SPDX-License-Identifier: AGPL-3.0-only
package httpapi

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func TestPiConnectionsReadStorageWithoutRuntime(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("PI_CODING_AGENT_DIR", dir)
	t.Setenv("PATH", "")
	s := NewServer(Deps{})
	s.pi.path = func() string { t.Fatal("Provider overview must not launch Pi"); return "" }
	read := func() ([]piConnection, string) {
		t.Helper()
		res := httptest.NewRecorder()
		s.Handler().ServeHTTP(res, httptest.NewRequest("GET", "/api/v1/pi/connections", nil))
		if res.Code != 200 || res.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("Unexpected response: %d %s", res.Code, res.Body.String())
		}
		var result struct {
			Data struct {
				Providers []piConnection `json:"providers"`
			} `json:"data"`
		}
		if err := json.Unmarshal(res.Body.Bytes(), &result); err != nil || result.Data.Providers == nil {
			t.Fatal("Missing provider list")
		}
		return result.Data.Providers, res.Body.String()
	}
	if items, _ := read(); len(items) != 0 {
		t.Fatal("Missing credential file should return an empty list")
	}
	path := filepath.Join(dir, "auth.json")
	content := `{"openai":{"type":"oauth","access":"private-access-token","refresh":"private-refresh-token"},"deepseek":{"type":"api_key","key":"private-api-secret-1234"},"custom":{"type":"api_key","key":"tiny"},"dynamic":{"type":"api_key","key":{"env":"PRIVATE_KEY"}},"shell":{"type":"api_key","key":"!touch /tmp/never-run"},"empty":{"type":"api_key","key":""},"other":{"type":"unknown","key":"hidden"}}`
	if err := os.WriteFile(path, []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
	items, body := read()
	if len(items) != 5 || items[1].ID != "deepseek" || items[1].Name != "DeepSeek" || items[1].KeyPreview != "••••1234" || items[0].KeyPreview != "••••" || items[2].KeyPreview != "" || items[3].Credential != "oauth" || items[4].KeyPreview != "••••" {
		t.Fatalf("Incorrect provider metadata: %+v", items)
	}
	for _, secret := range []string{"private-api-secret", "private-access-token", "private-refresh-token", "tiny", "PRIVATE_KEY", "touch /tmp/never-run"} {
		if strings.Contains(body, secret) {
			t.Fatal("Credential response exposed a secret or configuration")
		}
	}
	if err := os.WriteFile(path+".next", []byte(`{"deepseek":{"type":"api_key","key":"changed-over-ssh-5678"}}`), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(path+".next", path); err != nil {
		t.Fatal(err)
	}
	if items, _ := read(); len(items) != 1 || items[0].KeyPreview != "••••5678" {
		t.Fatal("Provider overview did not reflect an external credential replacement")
	}
}

func TestPiConnectionsInvalidStorageDoesNotLeak(t *testing.T) {
	for _, content := range []string{`{"private-malformed-key":`, "null", strings.Repeat("x", (1<<20)+1)} {
		t.Run(strconv.Itoa(len(content)), func(t *testing.T) {
			dir := t.TempDir()
			t.Setenv("PI_CODING_AGENT_DIR", dir)
			if err := os.WriteFile(filepath.Join(dir, "auth.json"), []byte(content), 0600); err != nil {
				t.Fatal(err)
			}
			s := NewServer(Deps{})
			res := httptest.NewRecorder()
			s.Handler().ServeHTTP(res, httptest.NewRequest("GET", "/api/v1/pi/connections", nil))
			if res.Code == 200 || !strings.Contains(res.Body.String(), "Could not read saved providers.") || strings.Contains(res.Body.String(), "private-malformed-key") {
				t.Fatal("Invalid storage must return a safe error")
			}
		})
	}
}
