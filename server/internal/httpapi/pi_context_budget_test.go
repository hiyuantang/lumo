// SPDX-License-Identifier: AGPL-3.0-only
package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestPiContextBudgetModesAndNativeOverrides(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "settings.json")
	os.WriteFile(path, []byte(`{"theme":"keep","lumoContextBudget":{"mode":"percent","value":80},"compaction":{"keepRecentTokens":20000,"modelOverrides":{"p/a":{"extra":7}}}}`), 0600)
	models := []piContextModel{{"p", "a", 200000}, {"p", "b", 1000000}, {"p", "tiny", 1000}, {"p", "unknown", 0}}
	changed, err := applyPiContextBudget(dir, models)
	if err != nil || !changed {
		t.Fatalf("apply: %v %v", changed, err)
	}
	for key, want := range map[string]int64{"p/a": 40000, "p/b": 200000, "p/tiny": 200} {
		value, err := readPiCompaction(dir, key)
		if err != nil || value.ReserveTokens != want {
			t.Fatalf("%s: %+v %v", key, value, err)
		}
	}
	tiny, _ := readPiCompaction(dir, "p/tiny")
	if tiny.KeepRecentTokens != 800 {
		t.Fatal("recent budget was not capped")
	}
	if changed, err = applyPiContextBudget(dir, models); err != nil || changed {
		t.Fatalf("not idempotent: %v %v", changed, err)
	}
	models = append(models, piContextModel{"new", "model", 128000})
	if changed, err = applyPiContextBudget(dir, models); err != nil || !changed {
		t.Fatalf("new model: %v %v", changed, err)
	}
	settings, _, _ := readPiSettingsJSON(dir)
	settings["lumoContextBudget"] = json.RawMessage(`{"mode":"tokens","value":150000}`)
	writePiSettingsJSON(dir, settings)
	if _, err := applyPiContextBudget(dir, models); err != nil {
		t.Fatal(err)
	}
	for key, want := range map[string]int64{"p/a": 50000, "p/b": 850000, "new/model": 16384} {
		value, _ := readPiCompaction(dir, key)
		if value.ReserveTokens != want {
			t.Fatalf("fixed %s: %+v", key, value)
		}
	}
	settings, _, _ = readPiSettingsJSON(dir)
	compaction, _ := piSettingsObject(settings, "compaction")
	overrides, _ := piSettingsObject(compaction, "modelOverrides")
	a, _ := piSettingsObject(overrides, "p/a")
	if string(settings["theme"]) != `"keep"` || string(a["extra"]) != "7" {
		t.Fatal("unrelated data lost")
	}
	for _, budget := range []piContextBudget{{"percent", 0}, {"percent", 100}, {"tokens", 0}, {"tokens", 9007199254740992}, {"bad", 80}} {
		if budget.valid() {
			t.Fatalf("invalid budget accepted: %+v", budget)
		}
	}
}

func TestPiContextBudgetSaveAndProjectSnapshot(t *testing.T) {
	dir, project := t.TempDir(), t.TempDir()
	t.Setenv("PI_CODING_AGENT_DIR", dir)
	os.WriteFile(filepath.Join(dir, "settings.json"), []byte(`{"compaction":{"modelOverrides":{"p/a":{"reserveTokens":123,"keepRecentTokens":345,"extra":7}}}}`), 0600)
	before, _ := readPiCompaction(dir, "")
	body, _ := json.Marshal(map[string]any{"requestId": "shared", "model": "", "enabled": true, "customized": false, "reserveTokens": 16384, "keepRecentTokens": 20000, "revision": before.Revision, "usageBudget": piContextBudget{"percent", 80}})
	s := NewServer(Deps{})
	response := httptest.NewRecorder()
	s.Handler().ServeHTTP(response, httptest.NewRequest("POST", "/api/v1/pi/compaction", bytes.NewReader(body)))
	if response.Code != 200 {
		t.Fatal(response.Body.String())
	}
	after, err := readPiCompaction(dir, "p/a")
	if err != nil || after.UsageBudget == nil || after.UsageBudget.Value != 80 || after.Customized {
		t.Fatalf("shared save: %+v %v", after, err)
	}
	applyPiContextBudget(dir, []piContextModel{{"p", "a", 200000}})
	os.MkdirAll(filepath.Join(project, ".pi"), 0700)
	os.WriteFile(filepath.Join(project, ".pi", "settings.json"), []byte(`{"compaction":{"modelOverrides":{"p/a":{"reserveTokens":60000}}}}`), 0600)
	snapshot, err := piCompactionSnapshot(dir, project)
	if err != nil {
		t.Fatal(err)
	}
	point, err := piCompactionPoint(snapshot, "p/a", 200000)
	if err != nil || !point.Enabled || point.Threshold != 140000 {
		t.Fatalf("project: %+v %v", point, err)
	}
	os.WriteFile(filepath.Join(project, ".pi", "settings.json"), []byte(`{"compaction":{"enabled":false}}`), 0600)
	point, _ = piCompactionPoint(snapshot, "p/a", 200000)
	if !point.Enabled || point.Threshold != 140000 {
		t.Fatal("running snapshot changed")
	}
	snapshot, _ = piCompactionSnapshot(dir, project)
	point, _ = piCompactionPoint(snapshot, "p/a", 200000)
	if point.Enabled {
		t.Fatal("disabled not reflected")
	}
}

func TestPiContextBudgetRPCPreparationAndStats(t *testing.T) {
	t.Setenv("LUMO_PI_RPC_FIXTURE", "1")
	dir, project := t.TempDir(), t.TempDir()
	os.WriteFile(filepath.Join(dir, "settings.json"), []byte(`{"lumoContextBudget":{"mode":"percent","value":75}}`), 0600)
	p, err := startPiProcess(os.Args[0], []string{"-test.run=^TestPiRPCFixtureProcess$"}, project, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer p.cancel()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	changed, err := preparePiContextBudget(ctx, p, dir)
	if err != nil || !changed {
		t.Fatalf("prepare: %v %v", changed, err)
	}
	p.compactionSettings, err = piCompactionSnapshot(dir, project)
	if err != nil {
		t.Fatal(err)
	}
	raw := p.contextBudgetStats(ctx, json.RawMessage(`{"success":true,"data":{"contextUsage":{"contextWindow":200000,"tokens":30000,"percent":15}}}`))
	var result struct {
		Data struct {
			Compaction piCompactionStatus `json:"compaction"`
		} `json:"data"`
	}
	if json.Unmarshal(raw, &result) != nil || result.Data.Compaction.Threshold != 150000 || !result.Data.Compaction.Enabled {
		t.Fatalf("stats: %s", raw)
	}
}
