// SPDX-License-Identifier: AGPL-3.0-only
package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"lumo/apps/git/backend/gitrepo"
)

func TestGitRoutesAndIdempotentCommit(t *testing.T) {
	path := t.TempDir()
	for _, args := range [][]string{{"init", "-b", "main"}, {"config", "user.name", "Local test"}, {"config", "user.email", "local@example.invalid"}, {"config", "commit.gpgsign", "false"}, {"config", "core.hooksPath", "/dev/null"}} {
		if out, err := exec.Command("git", append([]string{"-C", path}, args...)...).CombinedOutput(); err != nil {
			t.Fatalf("%v %s", err, out)
		}
	}
	if err := os.WriteFile(filepath.Join(path, "note.txt"), []byte("test\n"), 0600); err != nil {
		t.Fatal(err)
	}
	server := NewServer(Deps{})
	handler := server.Handler()
	get := func(endpoint string) *httptest.ResponseRecorder {
		r := httptest.NewRecorder()
		handler.ServeHTTP(r, httptest.NewRequest(http.MethodGet, endpoint, nil))
		return r
	}
	snapshot := func() gitrepo.Snapshot {
		t.Helper()
		s, err := gitrepo.Read(context.Background(), path)
		if err != nil {
			t.Fatal(err)
		}
		return s
	}
	request := func(body map[string]string) *httptest.ResponseRecorder {
		t.Helper()
		data, _ := json.Marshal(body)
		r := httptest.NewRecorder()
		handler.ServeHTTP(r, httptest.NewRequest(http.MethodPost, "/api/v1/git/action", strings.NewReader(string(data))))
		return r
	}
	if r := get("/api/v1/git/repository?path=" + url.QueryEscape(path)); r.Code != 200 || !strings.Contains(r.Body.String(), "note.txt") {
		t.Fatalf("snapshot: %d %s", r.Code, r.Body.String())
	}
	if r := get("/api/v1/git/diff?path=" + url.QueryEscape(path) + "&file=note.txt"); r.Code != 200 || !strings.Contains(r.Body.String(), "+test") {
		t.Fatalf("diff: %d %s", r.Code, r.Body.String())
	}
	r := request(map[string]string{"requestId": "stage-one", "path": path, "revision": snapshot().Revision, "action": "stage", "file": "note.txt"})
	if r.Code != 200 {
		t.Fatal(r.Body.String())
	}
	body := map[string]string{"requestId": "commit-once", "path": path, "revision": snapshot().Revision, "action": "commit", "message": "One commit"}
	for i := 0; i < 2; i++ {
		r = request(body)
		if r.Code != 200 {
			t.Fatal(r.Body.String())
		}
		if i == 1 && r.Header().Get("X-Lumo-Idempotent-Replay") != "true" {
			t.Fatal("missing replay marker")
		}
	}
	if len(snapshot().History) != 1 {
		t.Fatal("duplicate commit")
	}
	r = request(map[string]string{"requestId": "stale", "path": path, "revision": "stale", "action": "commit", "message": "Wrong"})
	if r.Code != 409 || !strings.Contains(r.Body.String(), "stale_revision") {
		t.Fatal(r.Body.String())
	}
	lock, _ := server.pluginLocks.LoadOrStore("git", make(chan struct{}, 1))
	lock.(chan struct{}) <- struct{}{}
	r = get("/api/v1/git/repository?path=" + url.QueryEscape(path))
	<-lock.(chan struct{})
	if r.Code != 409 || !strings.Contains(r.Body.String(), "busy") {
		t.Fatal("busy repository not rejected")
	}
}

func TestGitCreateRouteReplaysWithoutRecreating(t *testing.T) {
	handler := NewServer(Deps{}).Handler()
	path := filepath.Join(t.TempDir(), "created")
	body, _ := json.Marshal(map[string]string{"requestId": "create-repo", "action": "init", "path": path, "revision": ""})
	for i := 0; i < 2; i++ {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/v1/git/action", strings.NewReader(string(body))))
		if response.Code != 200 {
			t.Fatalf("create/replay: %d %s", response.Code, response.Body.String())
		}
	}
	if s, err := gitrepo.Read(context.Background(), path); err != nil || s.Branch != "main" {
		t.Fatalf("created repository: %+v %v", s, err)
	}
}
