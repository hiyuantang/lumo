// SPDX-License-Identifier: AGPL-3.0-only
package notifications

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"lumo/server/internal/appplugins"
	"testing"
)

func TestNativeInstallationAndPermission(t *testing.T) {
	t.Setenv("LUMO_PLUGIN_DIR", t.TempDir())
	t.Setenv("LUMO_PLUGIN_BUNDLED_DIR", t.TempDir())
	home := t.TempDir()
	js := []byte("export default function App(){}")
	asset := fmt.Sprintf("%x.js", sha256.Sum256(js))
	message := Message{RequestID: "event-001", Title: "Ready"}
	for _, permission := range []bool{false, true} {
		m := appplugins.Manifest{SchemaVersion: 1, HostAPIVersion: 1, ID: "plugin:notice", Name: "Notice", Version: "1.0.0", License: "AGPL-3.0-only", Entry: asset, Icon: "IconBell", Window: appplugins.Window{Width: 640, Height: 480, MinWidth: 320, MinHeight: 240}, Permissions: []string{"account"}}
		if permission {
			m.Version = "1.1.0"
			m.Permissions = append(m.Permissions, "notifications.send")
		}
		raw, _ := json.Marshal(m)
		release, err := appplugins.Import(home, appplugins.Bundle{Name: "notice", Manifest: raw, Files: map[string][]byte{asset: js}})
		if err != nil {
			t.Fatal(err)
		}
		change := appplugins.Change{Name: "notice", Action: "install", Digest: release.Digest, Trust: true}
		for _, entry := range appplugins.Catalog(home) {
			if entry.Name == "notice" {
				change.Revision = entry.Revision
			}
		}
		if err = appplugins.Apply(home, change); err != nil {
			t.Fatal(err)
		}
		_, err = SendNative(home, "notice", message)
		if permission && err != nil || !permission && err == nil {
			t.Fatal("permission", permission, err)
		}
	}
	if _, err := SendNative(t.TempDir(), "notice", message); err == nil {
		t.Fatal("another account sent")
	}
	app := appplugins.Catalog(home)[0]
	if err := appplugins.Apply(home, appplugins.Change{Name: "notice", Action: "uninstall", Revision: app.Revision}); err != nil {
		t.Fatal(err)
	}
	if _, err := SendNative(home, "notice", message); err == nil {
		t.Fatal("uninstalled sender accepted")
	}
}
