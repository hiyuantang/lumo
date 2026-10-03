// SPDX-License-Identifier: AGPL-3.0-only
package httpapi

import (
	"bytes"
	"encoding/json"
	"lumo/server/internal/desktopapps"
	"lumo/server/internal/notifications"
	"net/http/httptest"
	"testing"
)

func TestSandboxNotificationsAuthorityPreviewAndRevocation(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	server := NewServer(Deps{})
	server.home = home
	store := desktopapps.New(home)
	bundle := desktopapps.Bundle{Manifest: desktopapps.Manifest{SchemaVersion: 1, ID: "local.notice", Name: "Notice", Version: "1.0.0", License: "AGPL-3.0-only", APIVersion: 1, Entry: "src/main.js", Styles: "src/style.css", Window: desktopapps.Window{Width: 640, Height: 480, MinWidth: 320, MinHeight: 240}, Capabilities: []desktopapps.Capability{{Name: "notifications.send"}}}, JS: "lumo.ready();", CSS: "body{}"}
	build, err := store.Stage(bundle)
	if err != nil {
		t.Fatal(err)
	}
	installed, err := store.Change(desktopapps.Change{Action: "install", RequestID: desktopapps.Token(), ID: build.Manifest.ID, Digest: build.Digest})
	if err != nil {
		t.Fatal(err)
	}
	call := func(path, session string, body any) (int, map[string]any) {
		raw, _ := json.Marshal(body)
		r := httptest.NewRequest("POST", "/api/v1/"+path, bytes.NewReader(raw))
		r.Header.Set("X-Lumo-Session", session)
		w := httptest.NewRecorder()
		server.Handler().ServeHTTP(w, r)
		var result map[string]any
		json.Unmarshal(w.Body.Bytes(), &result)
		return w.Code, result
	}
	launch := func(preview bool) string {
		status, result := call("desktop-apps/launch", "one", map[string]any{"digest": build.Digest, "preview": preview})
		if status != 200 {
			t.Fatal(result)
		}
		return result["data"].(map[string]any)["token"].(string)
	}
	message := notifications.Message{RequestID: "notice-001", Title: "Ready", Body: "Saved"}
	preview := launch(true)
	if code, result := call("desktop-apps/call", "one", map[string]any{"token": preview, "method": "notifications.send", "params": message}); code != 200 || result["data"].(map[string]any)["preview"] != true {
		t.Fatal(code, result)
	}
	items, _ := (notifications.Store{Home: home}).List()
	if len(items) != 0 {
		t.Fatal("preview delivered")
	}
	token := launch(false)
	request := map[string]any{"token": token, "method": "notifications.send", "params": message}
	if code, _ := call("desktop-apps/call", "two", request); code != 404 {
		t.Fatal("cross-session", code)
	}
	if code, result := call("desktop-apps/call", "one", request); code != 200 {
		t.Fatal(code, result)
	}
	if code, result := call("desktop-apps/call", "one", request); code != 200 {
		t.Fatal(code, result)
	}
	items, _ = (notifications.Store{Home: home}).List()
	if len(items) != 1 || items[0].AppID != "app:local.notice" || items[0].AppName != "Notice" {
		t.Fatal(items)
	}
	call("desktop-apps/close", "one", map[string]any{"token": token})
	if code, _ := call("desktop-apps/call", "one", request); code != 404 {
		t.Fatal("closed launch", code)
	}
	items, _ = (notifications.Store{Home: home}).List()
	if len(items) != 1 {
		t.Fatal("window close lost notification")
	}
	token = launch(false)
	request["token"] = token
	_, err = store.Change(desktopapps.Change{Action: "disable", RequestID: desktopapps.Token(), ID: build.Manifest.ID, Revision: installed.Revision})
	if err != nil {
		t.Fatal(err)
	}
	if code, _ := call("desktop-apps/call", "one", request); code != 404 {
		t.Fatal("disabled app", code)
	}
	if code, _ := call("notifications/send", "one", map[string]any{"app": "missing", "requestId": "request-1", "title": "Forged", "body": ""}); code == 200 {
		t.Fatal("missing native app accepted")
	}
}
