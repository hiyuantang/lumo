// SPDX-License-Identifier: AGPL-3.0-only
package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestPiCompactionDefaultsOverridesAndPreservation(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("PI_CODING_AGENT_DIR", dir)
	s := NewServer(Deps{})
	initial, err := readPiCompaction(dir, "fixture/model")
	if err != nil || !initial.Enabled || initial.ReserveTokens != 16384 || initial.KeepRecentTokens != 20000 || initial.Customized {
		t.Fatalf("defaults: %+v %v", initial, err)
	}
	path := filepath.Join(dir, "settings.json")
	os.WriteFile(path, []byte(`{"defaultModel":"existing","modelThinkingLevels":{"fixture/model":"high"},"theme":"custom","compaction":{"enabled":true,"reserveTokens":10000,"extra":"keep","modelOverrides":{"fixture/model":{"keepRecentTokens":8000,"extra":7},"other/model":{"reserveTokens":555}}}}`), 0600)
	before, err := readPiCompaction(dir, "fixture/model")
	if err != nil || before.ReserveTokens != 10000 || before.KeepRecentTokens != 8000 || !before.Customized {
		t.Fatalf("inheritance: %+v %v", before, err)
	}
	call := func(id string, value piCompaction) *httptest.ResponseRecorder {
		t.Helper()
		body, _ := json.Marshal(map[string]any{"requestId": id, "model": value.Model, "enabled": value.Enabled, "reserveTokens": value.ReserveTokens, "keepRecentTokens": value.KeepRecentTokens, "customized": value.Customized, "revision": value.Revision})
		response := httptest.NewRecorder()
		s.Handler().ServeHTTP(response, httptest.NewRequest("POST", "/api/v1/pi/compaction", bytes.NewReader(body)))
		return response
	}
	changed := before
	changed.Enabled = false
	changed.ReserveTokens = 40000
	changed.KeepRecentTokens = 12000
	if res := call("save", changed); res.Code != 200 {
		t.Fatal(res.Body.String())
	}
	if res := call("save", changed); res.Code != 200 {
		t.Fatal("idempotent retry failed")
	}
	if res := call("stale", before); res.Code != 409 {
		t.Fatalf("stale: %d", res.Code)
	}
	settings, _, _ := readPiSettingsJSON(dir)
	compaction, _ := piSettingsObject(settings, "compaction")
	overrides, _ := piSettingsObject(compaction, "modelOverrides")
	matching, _ := piSettingsObject(overrides, "fixture/model")
	if string(settings["defaultModel"]) != `"existing"` || string(settings["theme"]) != `"custom"` || string(settings["modelThinkingLevels"]) == "" || string(compaction["extra"]) != `"keep"` || string(matching["extra"]) != "7" || string(overrides["other/model"]) == "" {
		t.Fatal("lost unrelated settings")
	}
	updated, _ := readPiCompaction(dir, "fixture/model")
	if updated.Enabled || updated.ReserveTokens != 40000 || updated.KeepRecentTokens != 12000 {
		t.Fatalf("saved: %+v", updated)
	}
	updated.Customized = false
	if res := call("inherit", updated); res.Code != 200 {
		t.Fatal(res.Body.String())
	}
	inherited, _ := readPiCompaction(dir, "fixture/model")
	if inherited.Customized || inherited.ReserveTokens != 10000 || inherited.KeepRecentTokens != 20000 {
		t.Fatalf("reset: %+v", inherited)
	}
	info, _ := os.Stat(path)
	if info.Mode().Perm() != 0600 {
		t.Fatal("settings permissions")
	}
	global, _ := readPiCompaction(dir, "")
	global.ReserveTokens = 0
	global.KeepRecentTokens = 0
	if res := call("zero", global); res.Code != 200 {
		t.Fatal(res.Body.String())
	}
	if err := savePiModelDefaults(dir, "fixture", "new", "medium"); err != nil {
		t.Fatal(err)
	}
	zero, _ := readPiCompaction(dir, "")
	if zero.ReserveTokens != 0 || zero.KeepRecentTokens != 0 || zero.Enabled {
		t.Fatal("model choice overwrote compaction")
	}
}

func TestPiCompactionRejectsInvalidAndLinkedSettings(t *testing.T) {
	for _, content := range []string{`{`, `null`, `{"compaction":null}`, `{"compaction":{"enabled":null}}`, `{"compaction":{"reserveTokens":-1}}`, `{"compaction":{"keepRecentTokens":1.5}}`, `{"compaction":{"reserveTokens":9007199254740992}}`, `{"compaction":{"modelOverrides":{"fixture/model":null}}}`} {
		dir := t.TempDir()
		path := filepath.Join(dir, "settings.json")
		os.WriteFile(path, []byte(content), 0600)
		if _, err := readPiCompaction(dir, "fixture/model"); err == nil {
			t.Fatalf("accepted %s", content)
		}
		data, _ := os.ReadFile(path)
		if string(data) != content {
			t.Fatal("invalid settings modified")
		}
	}
	dir := t.TempDir()
	target := filepath.Join(t.TempDir(), "target")
	os.WriteFile(target, []byte(`{"secret":"unchanged"}`), 0600)
	os.Symlink(target, filepath.Join(dir, "settings.json"))
	if _, err := readPiCompaction(dir, ""); err == nil {
		t.Fatal("followed symlink")
	}
	t.Setenv("PI_CODING_AGENT_DIR", t.TempDir())
	s := NewServer(Deps{})
	for _, body := range []string{`{"requestId":"missing"}`, `{"requestId":"invalid","model":"bad","enabled":true,"customized":false,"reserveTokens":1,"keepRecentTokens":2}`, `{"requestId":"negative","enabled":true,"customized":false,"reserveTokens":-1,"keepRecentTokens":2}`} {
		response := httptest.NewRecorder()
		s.Handler().ServeHTTP(response, httptest.NewRequest("POST", "/api/v1/pi/compaction", bytes.NewBufferString(body)))
		if response.Code != 400 {
			t.Fatalf("accepted invalid request: %d %s", response.Code, response.Body.String())
		}
	}
}
