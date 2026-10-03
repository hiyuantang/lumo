// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"encoding/json"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func deletePiFixture(t *testing.T) (*Server, string, string) {
	t.Helper()
	s := NewServer(Deps{})
	s.pi.home = t.TempDir()
	project := filepath.Join(s.pi.home, "project")
	if err := os.Mkdir(project, 0700); err != nil {
		t.Fatal(err)
	}
	project, dir, err := s.piFolder(project)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	return s, project, dir
}
func deletePiRequest(s *Server, project, session, id string) *httptest.ResponseRecorder {
	body, _ := json.Marshal(map[string]string{"requestId": id, "project": project, "session": session})
	response := httptest.NewRecorder()
	s.Handler().ServeHTTP(response, httptest.NewRequest("POST", "/api/v1/pi/sessions/delete", strings.NewReader(string(body))))
	return response
}

func archivePiRequest(s *Server, project, session, id, action string) *httptest.ResponseRecorder {
	body, _ := json.Marshal(map[string]string{"requestId": id, "project": project, "session": session})
	response := httptest.NewRecorder()
	s.Handler().ServeHTTP(response, httptest.NewRequest("POST", "/api/v1/pi/sessions/"+action, strings.NewReader(string(body))))
	return response
}
func writePiChat(t *testing.T, project, path string) []byte {
	t.Helper()
	header, _ := json.Marshal(map[string]string{"type": "session", "cwd": project})
	content := append(header, []byte("\n"+`{"type":"session_info","name":"Chat to archive"}`+"\n")...)
	if err := os.WriteFile(path, content, 0600); err != nil {
		t.Fatal(err)
	}
	return content
}
func TestPiArchiveRestoreAndDeletePreserveOtherFiles(t *testing.T) {
	s, project, dir := deletePiFixture(t)
	original := filepath.Join(dir, "one.jsonl")
	content := writePiChat(t, project, original)
	keep := filepath.Join(dir, "fork.jsonl")
	writePiChat(t, project, keep)
	for index, action := range []string{"archive", "restore", "archive"} {
		response := archivePiRequest(s, project, "one.jsonl", action+fmtID(index), action)
		if response.Code != 200 {
			t.Fatalf("%s: %d %s", action, response.Code, response.Body.String())
		}
		if action == "archive" {
			if _, err := os.Stat(original); !os.IsNotExist(err) {
				t.Fatalf("active file remains: %v", err)
			}
			got, err := os.ReadFile(filepath.Join(dir, ".archive", "one.jsonl"))
			if err != nil || string(got) != string(content) {
				t.Fatalf("changed file %v", err)
			}
		} else {
			got, err := os.ReadFile(original)
			if err != nil || string(got) != string(content) {
				t.Fatalf("bad restore: %v", err)
			}
		}
	}
	response := httptest.NewRecorder()
	s.Handler().ServeHTTP(response, httptest.NewRequest("GET", "/api/v1/pi/sessions/archived", nil))
	if response.Code != 200 || !strings.Contains(response.Body.String(), project) || !strings.Contains(response.Body.String(), "one.jsonl") {
		t.Fatal(response.Body.String())
	}
	active := httptest.NewRecorder()
	s.Handler().ServeHTTP(active, httptest.NewRequest("GET", "/api/v1/pi/sessions?project="+url.QueryEscape(project), nil))
	if strings.Contains(active.Body.String(), "one.jsonl") || !strings.Contains(active.Body.String(), "fork.jsonl") {
		t.Fatal(active.Body.String())
	}
	if err := os.Remove(project); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"delete-once", "delete-twice"} {
		if reply := deletePiRequest(s, project, "one.jsonl", id); reply.Code != 200 {
			t.Fatal(reply.Body.String())
		}
	}
	if _, err := os.Stat(filepath.Join(dir, ".archive", "one.jsonl")); !os.IsNotExist(err) {
		t.Fatalf("archive remains: %v", err)
	}
	if _, err := os.Stat(keep); err != nil {
		t.Fatal("fork removed")
	}
	if reply := deletePiRequest(s, project, "fork.jsonl", "active-protected"); reply.Code != 200 {
		t.Fatal(reply.Body.String())
	}
	if _, err := os.Stat(keep); err != nil {
		t.Fatal("active chat was deleted")
	}
}
func fmtID(i int) string { return "-" + string(rune('a'+i)) }
func TestPiArchiveRejectsUnsafeTargetsAndOverwrite(t *testing.T) {
	s, project, dir := deletePiFixture(t)
	victim := filepath.Join(s.pi.home, "victim.jsonl")
	writePiChat(t, project, victim)
	if err := os.Symlink(victim, filepath.Join(dir, "linked.jsonl")); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(dir, "directory.jsonl"), 0700); err != nil {
		t.Fatal(err)
	}
	for i, target := range []string{"../victim.jsonl", victim, "linked.jsonl", "directory.jsonl", "plain.txt", "", "sub\\file.jsonl"} {
		response := archivePiRequest(s, project, target, "invalid"+fmtID(i), "archive")
		if response.Code != 400 {
			t.Fatalf("accepted %q: %d %s", target, response.Code, response.Body.String())
		}
	}
	writePiChat(t, project, filepath.Join(dir, "one.jsonl"))
	writePiChat(t, project, filepath.Join(dir, ".archive", "one.jsonl"))
	if response := archivePiRequest(s, project, "one.jsonl", "collision", "archive"); response.Code != 409 {
		t.Fatal(response.Body.String())
	}
	if response := archivePiRequest(s, project, "one.jsonl", "restore-collision", "restore"); response.Code != 409 {
		t.Fatal(response.Body.String())
	}
	if err := os.Symlink(victim, filepath.Join(dir, ".archive", "linked.jsonl")); err != nil {
		t.Fatal(err)
	}
	if response := deletePiRequest(s, project, "linked.jsonl", "linked-delete"); response.Code != 400 {
		t.Fatal(response.Body.String())
	}
	if _, err := os.Stat(victim); err != nil {
		t.Fatal(err)
	}
	if err := os.RemoveAll(filepath.Join(dir, ".archive")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(s.pi.home, filepath.Join(dir, ".archive")); err != nil {
		t.Fatal(err)
	}
	if response := archivePiRequest(s, project, "one.jsonl", "linked-folder", "archive"); response.Code != 400 {
		t.Fatal(response.Body.String())
	}
}
func TestPiArchiveWaitsForExitAndOperationLock(t *testing.T) {
	s, project, dir := deletePiFixture(t)
	writePiChat(t, project, filepath.Join(dir, "one.jsonl"))
	done := make(chan struct{})
	s.piRPC.processes["open"] = &piProcess{project: project, done: done, closed: true}
	if response := archivePiRequest(s, project, "one.jsonl", "still-running", "archive"); response.Code != 409 {
		t.Fatal(response.Body.String())
	}
	if _, err := os.Stat(filepath.Join(dir, "one.jsonl")); err != nil {
		t.Fatal(err)
	}
	close(done)
	s.pi.operation.Lock()
	response := archivePiRequest(s, project, "one.jsonl", "operation-locked", "archive")
	s.pi.operation.Unlock()
	if response.Code != 409 {
		t.Fatal(response.Body.String())
	}
	if response := archivePiRequest(s, project, "one.jsonl", "exited", "archive"); response.Code != 200 {
		t.Fatal(response.Body.String())
	}
}

func TestPiArchiveListsAcrossProjectsAndRejectsMismatchedHeaders(t *testing.T) {
	s, project, dir := deletePiFixture(t)
	other := filepath.Join(s.pi.home, "other")
	if err := os.Mkdir(other, 0700); err != nil {
		t.Fatal(err)
	}
	other, otherDir, err := s.piFolder(other)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(otherDir, 0700); err != nil {
		t.Fatal(err)
	}
	writePiChat(t, project, filepath.Join(dir, "first.jsonl"))
	writePiChat(t, other, filepath.Join(otherDir, "second.jsonl"))
	for i, target := range []struct{ project, session string }{{project, "first.jsonl"}, {other, "second.jsonl"}} {
		if response := archivePiRequest(s, target.project, target.session, "cross-project"+fmtID(i), "archive"); response.Code != 200 {
			t.Fatal(response.Body.String())
		}
	}
	if err := os.Remove(other); err != nil {
		t.Fatal(err)
	}
	response := httptest.NewRecorder()
	s.Handler().ServeHTTP(response, httptest.NewRequest("GET", "/api/v1/pi/sessions/archived", nil))
	if response.Code != 200 || !strings.Contains(response.Body.String(), "first.jsonl") || !strings.Contains(response.Body.String(), "second.jsonl") {
		t.Fatal(response.Body.String())
	}
	writePiChat(t, other, filepath.Join(dir, "mismatch.jsonl"))
	if response := archivePiRequest(s, project, "mismatch.jsonl", "mismatch", "archive"); response.Code != 400 {
		t.Fatal(response.Body.String())
	}
	if _, err := os.Stat(filepath.Join(dir, "mismatch.jsonl")); err != nil {
		t.Fatal(err)
	}
}
