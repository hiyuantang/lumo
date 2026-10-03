// SPDX-License-Identifier: AGPL-3.0-only
package httpapi

import (
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSkillsAccountRoutes(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	path := filepath.Join(home, ".agents", "skills", "daily")
	if err := os.MkdirAll(path, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(path, "SKILL.md"), []byte("---\nname: daily\ndescription: Review daily health\n---\n# Health"), 0600); err != nil {
		t.Fatal(err)
	}
	server := NewServer(Deps{})
	server.home = home
	handler := server.Handler()
	for _, test := range []struct {
		path     string
		status   int
		contains string
	}{
		{"/api/v1/skills", 200, "Review daily health"},
		{"/api/v1/skills/detail?id=daily", 200, "# Health"},
		{"/api/v1/skills/detail?id=..", 400, "validation_failed"},
		{"/api/v1/skills/detail?id=missing", 404, "not_found"},
	} {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest("GET", test.path, nil))
		if response.Code != test.status || !strings.Contains(response.Body.String(), test.contains) {
			t.Fatalf("%s: %d %s", test.path, response.Code, response.Body.String())
		}
	}
}
