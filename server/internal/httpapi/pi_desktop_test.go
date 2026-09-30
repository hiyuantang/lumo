// SPDX-License-Identifier: AGPL-3.0-only
package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestPiDesktopRoundTripOwnershipAndClaims(t *testing.T) {
	t.Setenv("LUMO_PI_RPC_FIXTURE", "1")
	home := t.TempDir()
	p, err := startPiProcess(os.Args[0], []string{"-test.run=^TestPiRPCFixtureProcess$"}, home, home)
	if err != nil {
		t.Fatal(err)
	}
	defer p.cancel()
	p.mu.Lock()
	p.desktopEnabled = true
	p.desktopClient = "tab-a"
	p.permissionMode = "auto"
	p.mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	s := NewServer(Deps{})
	s.piRPC.processes["chat"] = p
	if _, err := p.command(ctx, map[string]any{"type": "prompt", "message": "desktop"}); err != nil {
		t.Fatal(err)
	}
	p.mu.Lock()
	if len(p.activeDesktop("tab-b")) != 0 || len(p.activeDesktop("tab-a")) != 1 || len(p.activeQuestions()) != 0 {
		t.Fatal("desktop ownership or question projection failed")
	}
	pending := p.activeDesktop("tab-a")[0]
	p.mu.Unlock()
	post := func(path, key, client string, result bool) *httptest.ResponseRecorder {
		t.Helper()
		body := map[string]any{"requestId": key, "id": "chat", "clientId": client, "desktopId": pending.ID}
		if result {
			body["text"] = "[1] button: Files"
			body["error"] = false
		}
		raw, _ := json.Marshal(body)
		w := httptest.NewRecorder()
		s.Handler().ServeHTTP(w, httptest.NewRequest("POST", "/api/v1/pi/desktop/"+path, bytes.NewReader(raw)))
		return w
	}
	if w := post("claim", "wrong-tab", "tab-b", false); w.Code != 409 {
		t.Fatal(w.Body.String())
	}
	if w := post("result", "unclaimed", "tab-a", true); w.Code != 409 {
		t.Fatal(w.Body.String())
	}
	for range 2 {
		if w := post("claim", "claim-once", "tab-a", false); w.Code != 200 {
			t.Fatal(w.Body.String())
		}
	}
	if w := post("claim", "duplicate-claim", "tab-a", false); w.Code != 409 {
		t.Fatal(w.Body.String())
	}
	for range 2 {
		if w := post("result", "result-once", "tab-a", true); w.Code != 200 {
			t.Fatal(w.Body.String())
		}
	}
	if w := post("result", "late", "tab-a", true); w.Code != 409 {
		t.Fatal(w.Body.String())
	}
	if _, err := p.command(ctx, map[string]any{"type": "get_state"}); err != nil {
		t.Fatal(err)
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	answers := 0
	for _, raw := range p.events {
		var event struct {
			Type   string
			Answer struct{ ID, Value string }
		}
		_ = json.Unmarshal(raw, &event)
		if event.Type == "fixture_answer" {
			answers++
			if event.Answer.ID != pending.ID || !strings.Contains(event.Answer.Value, "button: Files") {
				t.Fatalf("wrong native response: %s", raw)
			}
		}
	}
	if answers != 1 || len(p.desktop) != 0 {
		t.Fatalf("answers=%d requests=%v", answers, p.desktop)
	}
}

func TestPiDesktopValidationExpiryAbortAndMode(t *testing.T) {
	p := &piProcess{desktopEnabled: true, desktopClient: "tab-a", permissionMode: "read-only"}
	request := func(action string) json.RawMessage {
		raw, _ := json.Marshal(map[string]any{"id": "one", "method": "input", "title": desktopPrefix + `{"action":"` + action + `","target":"one","label":"Files"}`})
		return raw
	}
	p.trackDesktop("extension_ui_request", request("click"))
	if len(p.desktop) != 0 {
		t.Fatal("read-only action accepted")
	}
	p.trackDesktop("extension_ui_request", json.RawMessage(`{"id":"one","method":"input","title":"Lumo Use: {\"action\":\"observe\"}"}`))
	if len(p.desktop) != 1 {
		t.Fatal("observation missing")
	}
	p.desktop[0].ExpiresAt = time.Now().Add(-time.Second).UnixMilli()
	if len(p.activeDesktop("tab-a")) != 0 {
		t.Fatal("expired request retained")
	}
	p.trackDesktop("agent_settled", nil)
	if len(p.desktop) != 0 {
		t.Fatal("settled request retained")
	}
	for _, action := range []string{"eval", "navigate", "javascript"} {
		if validDesktopRequest(piDesktopRequest{Action: action, Target: "one", Label: "Files"}) {
			t.Fatal("unbounded action accepted")
		}
	}
	p.desktop = []piDesktopRequest{{ID: "one", Action: "observe", ExpiresAt: time.Now().Add(time.Minute).UnixMilli()}}
	p.closed = true
	if len(p.activeDesktop("tab-a")) != 0 {
		t.Fatal("closed process exposes requests")
	}
}

func TestPiExtensionSettingsAndBundledCodeSurviveReplacement(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("PI_CODING_AGENT_DIR", dir)
	s := NewServer(Deps{})
	before, err := readPiExtensionSettings(dir)
	if err != nil || !before.LumoUse {
		t.Fatal(before, err)
	}
	if err := writePiSettingsJSON(dir, map[string]json.RawMessage{"theme": json.RawMessage(`"keep"`), "lumoImageQuality": json.RawMessage(`"quality90"`)}); err != nil {
		t.Fatal(err)
	}
	before, _ = readPiExtensionSettings(dir)
	raw, _ := json.Marshal(map[string]any{"requestId": "disable", "lumoUse": false, "revision": before.Revision})
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, httptest.NewRequest("POST", "/api/v1/pi/extensions", bytes.NewReader(raw)))
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	path, err := writeLumoUseExtension(dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("old extension"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := writeLumoUseExtension(dir); err != nil {
		t.Fatal(err)
	}
	code, _ := os.ReadFile(path)
	if string(code) != lumoUseExtension {
		t.Fatal("bundled code was not restored")
	}
	after, err := readPiExtensionSettings(dir)
	if err != nil || after.LumoUse {
		t.Fatal("extension replacement changed preferences")
	}
	settings, _, _ := readPiSettingsJSON(dir)
	if string(settings["theme"]) != `"keep"` || string(settings["lumoImageQuality"]) != `"quality90"` {
		t.Fatal("other settings changed")
	}
	info, _ := os.Stat(path)
	if info.Mode().Perm() != 0600 {
		t.Fatal("extension permissions")
	}
	w = httptest.NewRecorder()
	s.Handler().ServeHTTP(w, httptest.NewRequest("POST", "/api/v1/pi/extensions", bytes.NewReader(raw)))
	if w.Code != 200 {
		t.Fatal("idempotent save failed")
	}
	raw, _ = json.Marshal(map[string]any{"requestId": "stale", "lumoUse": true, "revision": before.Revision})
	w = httptest.NewRecorder()
	s.Handler().ServeHTTP(w, httptest.NewRequest("POST", "/api/v1/pi/extensions", bytes.NewReader(raw)))
	if w.Code != 409 {
		t.Fatal("stale save accepted")
	}
	if err := os.WriteFile(filepath.Join(dir, "settings.json"), []byte(`{"lumoUse":"yes"}`), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := readPiExtensionSettings(dir); err == nil {
		t.Fatal("invalid setting accepted")
	}
}

func TestPiDesktopStopAndDisableCancelNativeDialogs(t *testing.T) {
	t.Setenv("LUMO_PI_RPC_FIXTURE", "1")
	for _, disable := range []bool{false, true} {
		t.Run(map[bool]string{false: "Stop", true: "Disable"}[disable], func(t *testing.T) {
			home := t.TempDir()
			p, err := startPiProcess(os.Args[0], []string{"-test.run=^TestPiRPCFixtureProcess$"}, home, home)
			if err != nil {
				t.Fatal(err)
			}
			defer p.cancel()
			p.mu.Lock()
			p.desktopEnabled = true
			p.desktopClient = "tab-a"
			p.permissionMode = "auto"
			p.mu.Unlock()
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			if _, err := p.command(ctx, map[string]any{"type": "prompt", "message": "desktop"}); err != nil {
				t.Fatal(err)
			}
			if disable {
				p.disableDesktop()
			} else if _, err := p.command(ctx, map[string]any{"type": "abort"}); err != nil {
				t.Fatal(err)
			}
			if _, err := p.command(ctx, map[string]any{"type": "get_state"}); err != nil {
				t.Fatal(err)
			}
			p.mu.Lock()
			defer p.mu.Unlock()
			answers := 0
			for _, raw := range p.events {
				var event struct {
					Type   string
					Answer struct {
						ID        string
						Cancelled bool
					}
				}
				_ = json.Unmarshal(raw, &event)
				if event.Type == "fixture_answer" {
					answers++
					if event.Answer.ID != "desktop-1" || !event.Answer.Cancelled {
						t.Fatalf("wrong cancellation: %s", raw)
					}
				}
			}
			if answers != 1 || len(p.desktop) != 0 || disable && p.desktopEnabled {
				t.Fatalf("cancellation failed: %d %v", answers, p.desktop)
			}
		})
	}
}

func TestPiDesktopManagedStartRequiresExtensionHandshake(t *testing.T) {
	t.Setenv("LUMO_PI_RPC_FIXTURE", "1")
	t.Setenv("LUMO_PI_RPC_READY", "ask")
	home := t.TempDir()
	ctx, cancel := context.WithTimeout(context.Background(), 150*time.Millisecond)
	defer cancel()
	if p, err := startManagedPiProcess(ctx, os.Args[0], []string{"-test.run=^TestPiRPCFixtureProcess$"}, home, home, "ask", true); err == nil || p != nil {
		t.Fatal("accepted missing Lumo Use extension")
	}
	t.Setenv("LUMO_PI_USE_READY", "1")
	ctxReady, stop := context.WithTimeout(context.Background(), 5*time.Second)
	defer stop()
	p, err := startManagedPiProcess(ctxReady, os.Args[0], []string{"-test.run=^TestPiRPCFixtureProcess$"}, home, home, "ask", true)
	if err != nil {
		t.Fatal(err)
	}
	defer p.cancel()
	p.mu.Lock()
	defer p.mu.Unlock()
	if !p.desktopReady {
		t.Fatal("missing ready status")
	}
}

func TestPiSettingsRevisionsIgnoreOtherPreferences(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("PI_CODING_AGENT_DIR", dir)
	if err := writePiSettingsJSON(dir, map[string]json.RawMessage{"lumoImageQuality": json.RawMessage(`"quality90"`)}); err != nil {
		t.Fatal(err)
	}
	extension, _ := readPiExtensionSettings(dir)
	image, _ := readPiImageSettings(dir)
	compaction, _ := readPiCompaction(dir, "")
	if err := savePiModelDefaults(dir, "fixture", "fast", "high"); err != nil {
		t.Fatal(err)
	}
	if err := savePiPermissionMode(dir, "", "auto", true); err != nil {
		t.Fatal(err)
	}
	currentExtension, _ := readPiExtensionSettings(dir)
	currentImage, _ := readPiImageSettings(dir)
	currentCompaction, _ := readPiCompaction(dir, "")
	if currentExtension.Revision != extension.Revision || currentImage.Revision != image.Revision || currentCompaction.Revision != compaction.Revision {
		t.Fatal("model, effort or approval invalidated unrelated controls")
	}
	s := NewServer(Deps{})
	post := func(path string, body map[string]any) {
		t.Helper()
		raw, _ := json.Marshal(body)
		w := httptest.NewRecorder()
		s.Handler().ServeHTTP(w, httptest.NewRequest("POST", "/api/v1/pi/"+path, bytes.NewReader(raw)))
		if w.Code != 200 {
			t.Fatalf("%s: %d %s", path, w.Code, w.Body.String())
		}
	}
	post("extensions", map[string]any{"requestId": "extension-after-model", "revision": extension.Revision, "lumoUse": false})
	post("image-settings", map[string]any{"requestId": "image-after-extension", "revision": image.Revision, "mode": "original"})
	post("compaction", map[string]any{"requestId": "compaction-after-image", "revision": compaction.Revision, "model": "", "enabled": false, "customized": false, "reserveTokens": compaction.ReserveTokens, "keepRecentTokens": compaction.KeepRecentTokens})
	settings, _, _ := readPiSettingsJSON(dir)
	if string(settings["defaultModel"]) != `"fast"` || string(settings["defaultThinkingLevel"]) != `"high"` || string(settings["lumoPermissionMode"]) != `"auto"` || string(settings["lumoUse"]) != "false" || string(settings["lumoImageQuality"]) != `"original"` {
		t.Fatal("saving independent panels lost settings")
	}
}
