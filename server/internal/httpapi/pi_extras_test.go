// SPDX-License-Identifier: AGPL-3.0-only
package httpapi

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func piExtrasRequest(s *Server, method, path string, body any) *httptest.ResponseRecorder {
	data, _ := json.Marshal(body)
	res := httptest.NewRecorder()
	s.Handler().ServeHTTP(res, httptest.NewRequest(method, "/api/v1/pi/"+path, bytes.NewReader(data)))
	return res
}

func TestPiTemplatesConflictsAndBoundaries(t *testing.T) {
	t.Setenv("PI_CODING_AGENT_DIR", t.TempDir())
	s := NewServer(Deps{})
	save := func(id, name, content, revision string) *httptest.ResponseRecorder {
		return piExtrasRequest(s, "POST", "templates", map[string]any{"requestId": id, "name": name, "content": content, "revision": revision})
	}
	if r := save("create", "review", "Review $ARGUMENTS", ""); r.Code != 200 {
		t.Fatal(r.Body.String())
	}
	dir, _ := s.piTemplateDir()
	value, err := readPiTemplate(dir, "review")
	if err != nil || value.Revision == "" {
		t.Fatalf("%+v %v", value, err)
	}
	info, _ := os.Stat(value.Path)
	if info.Mode().Perm() != 0600 {
		t.Fatal("template must be private")
	}
	if r := save("conflict", "review", "Lost update", ""); r.Code != 409 {
		t.Fatal(r.Body.String())
	}
	if r := save("update", "review", "Updated", value.Revision); r.Code != 200 {
		t.Fatal(r.Body.String())
	}
	for _, name := range []string{"../escape", "nested/review", "undo", "rename", "compact"} {
		if r := save("bad-"+strings.ReplaceAll(name, "/", "-"), name, "text", ""); r.Code == 200 {
			t.Fatalf("accepted %s", name)
		}
	}
	if r := save("oversize", "large", strings.Repeat("a", piInstructionLimit+1), ""); r.Code == 200 {
		t.Fatal("accepted oversized template")
	}
	if err := os.Symlink(value.Path, filepath.Join(dir, "linked.md")); err != nil {
		t.Fatal(err)
	}
	if r := save("linked", "linked", "overwrite", ""); r.Code == 200 {
		t.Fatal("accepted linked template")
	}
	r := piExtrasRequest(s, "GET", "templates", nil)
	if r.Code != 200 || !strings.Contains(r.Body.String(), "Updated") || strings.Contains(r.Body.String(), "linked") {
		t.Fatal(r.Body.String())
	}
}

func TestPiImageUploadPrivateIdempotentAndValidated(t *testing.T) {
	s := NewServer(Deps{})
	s.pi.home = t.TempDir()
	png := "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII="
	body := map[string]string{"requestId": "image-once", "content": png}
	first := piExtrasRequest(s, "POST", "images", body)
	second := piExtrasRequest(s, "POST", "images", body)
	if first.Code != 200 || first.Body.String() != second.Body.String() {
		t.Fatal(first.Body.String(), second.Body.String())
	}
	var reply struct {
		Data struct {
			Path string `json:"path"`
		} `json:"data"`
	}
	json.Unmarshal(first.Body.Bytes(), &reply)
	info, err := os.Stat(reply.Data.Path)
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatalf("private file: %v", err)
	}
	raw, _ := os.ReadFile(reply.Data.Path)
	decoded, _ := base64.StdEncoding.DecodeString(png)
	if !bytes.Equal(raw, decoded) {
		t.Fatal("image bytes changed")
	}
	for i, data := range []string{"broken", base64.StdEncoding.EncodeToString([]byte("<svg onload='bad'/ >")), base64.StdEncoding.EncodeToString(make([]byte, (8<<20)+1))} {
		if r := piExtrasRequest(s, "POST", "images", map[string]any{"requestId": strings.Repeat("x", i+1), "content": data}); r.Code == 200 {
			t.Fatal("accepted invalid image")
		}
	}
}

func TestPiRetryValidationAndSnapshotLifecycle(t *testing.T) {
	for _, text := range []string{`{"type":"set_auto_retry","enabled":true}`, `{"type":"set_auto_retry","enabled":false}`, `{"type":"abort_retry"}`} {
		var command map[string]json.RawMessage
		json.Unmarshal([]byte(text), &command)
		if _, err := validatePiCommand(command); err != nil {
			t.Fatal(err)
		}
	}
	for _, text := range []string{`{"type":"set_auto_retry"}`, `{"type":"set_auto_retry","enabled":null}`, `{"type":"set_auto_retry","enabled":"true"}`, `{"type":"abort_retry","enabled":true}`} {
		var command map[string]json.RawMessage
		json.Unmarshal([]byte(text), &command)
		if _, err := validatePiCommand(command); err == nil {
			t.Fatal("accepted invalid retry command", text)
		}
	}
	p := &piProcess{}
	for _, source := range []string{"auto_retry_start", "summarization_retry_scheduled"} {
		before := time.Now().UnixMilli()
		p.trackRetry(source, json.RawMessage(`{"attempt":2,"maxAttempts":3,"delayMs":2000,"errorMessage":"rate limited"}`))
		if p.retry == nil || p.retry.Attempt != 2 || p.retry.RetryAt < before+2000 || p.retry.ErrorMessage != "rate limited" {
			t.Fatalf("%+v", p.retry)
		}
		p.trackRetry("agent_settled", nil)
		if p.retry != nil {
			t.Fatal("stale retry after completion")
		}
	}
}
