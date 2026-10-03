// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPiReferenceResolvesOnlySavedProjectSession(t *testing.T) {
	s := NewServer(Deps{})
	s.pi.home = t.TempDir()
	project, dir, err := s.piFolder("~")
	if err != nil {
		t.Fatal(err)
	}
	os.MkdirAll(dir, 0700)
	os.WriteFile(filepath.Join(dir, "saved.jsonl"), []byte("{\"type\":\"session\"}\n{\"type\":\"message\",\"id\":\"a\",\"message\":{\"role\":\"user\",\"content\":\"PRIVATE HISTORY\"}}\n"), 0600)
	for _, tc := range []struct {
		session string
		status  int
	}{{"saved.jsonl", 200}, {"../saved.jsonl", 400}, {"missing.jsonl", 404}, {"", 400}} {
		res := httptest.NewRecorder()
		s.Handler().ServeHTTP(res, httptest.NewRequest("GET", "/api/v1/pi/reference?project="+url.QueryEscape(project)+"&session="+url.QueryEscape(tc.session), nil))
		if res.Code != tc.status {
			t.Fatalf("%s: %d %s", tc.session, res.Code, res.Body.String())
		}
		if strings.Contains(res.Body.String(), "PRIVATE HISTORY") {
			t.Fatal("returned transcript")
		}
		if tc.status == 200 && (!strings.Contains(res.Body.String(), "saved.jsonl") || !strings.Contains(res.Body.String(), "reader")) {
			t.Fatal(res.Body.String())
		}
	}
}
