// SPDX-License-Identifier: AGPL-3.0-only
package strictjson

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestUnmarshalRejectsUnknownAndTrailingValues(t *testing.T) {
	var dst struct {
		Name string `json:"name"`
	}
	if err := Unmarshal([]byte(`{"name":"lumo"}`), &dst); err != nil || dst.Name != "lumo" {
		t.Fatalf("valid JSON: name=%q err=%v", dst.Name, err)
	}
	for _, body := range []string{
		`{"name":"lumo","unknown":true}`,
		`{"name":"lumo"} {}`,
	} {
		if err := Unmarshal([]byte(body), &dst); err == nil {
			t.Fatalf("accepted %s", body)
		}
	}
}

func TestDecodeRejectsOversizedBody(t *testing.T) {
	req := httptest.NewRequest("POST", "/", strings.NewReader(`{"name":"lumo"}`))
	w := httptest.NewRecorder()
	var dst struct {
		Name string `json:"name"`
	}
	if err := Decode(w, req, 8, &dst); err == nil {
		t.Fatal("accepted oversized body")
	}
}
