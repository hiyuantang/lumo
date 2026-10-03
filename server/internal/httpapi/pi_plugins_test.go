// SPDX-License-Identifier: AGPL-3.0-only
package httpapi

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"lumo/server/internal/appplugins"
	"testing"
)

func TestInstalledPluginPiToolsDiscoveredPerAccount(t *testing.T) {
	t.Setenv("LUMO_PLUGIN_DIR", t.TempDir())
	t.Setenv("LUMO_PLUGIN_BUNDLED_DIR", t.TempDir())
	home := t.TempDir()
	files := map[string][]byte{}
	asset := func(code, suffix string) string {
		key := fmt.Sprintf("%x%s", sha256.Sum256([]byte(code)), suffix)
		files[key] = []byte(code)
		return key
	}
	m := appplugins.Manifest{SchemaVersion: 1, HostAPIVersion: 1, ID: "plugin:notes", Name: "Notes", Version: "1.0.0", License: "AGPL-3.0-only", Entry: asset("export default function(){}", ".js"), Window: appplugins.Window{Width: 600, Height: 400, MinWidth: 300, MinHeight: 240}, Pi: &appplugins.Extension{Entry: asset("export default function(pi){}", ".mjs"), Setting: "notes", ReadTools: []string{"lumo_notes_read"}, WriteTools: []string{"lumo_notes_write"}}}
	raw, _ := json.Marshal(m)
	release, err := appplugins.Import(home, appplugins.Bundle{Name: "notes", Manifest: raw, Files: files})
	if err != nil {
		t.Fatal(err)
	}
	if len(piPluginExtensions(home, piExtensionSettings{})) != 0 {
		t.Fatal("import executed before installation")
	}
	if err = appplugins.Apply(home, appplugins.Change{Name: "notes", Action: "install", Digest: release.Digest, Trust: true}); err != nil {
		t.Fatal(err)
	}
	plugins := piPluginExtensions(home, piExtensionSettings{})
	if len(plugins) != 1 || plugins[0].Manifest.Pi.ReadTools[0] != "lumo_notes_read" {
		t.Fatal("new plugin tools not discovered")
	}
	if len(piPluginExtensions(t.TempDir(), piExtensionSettings{})) != 0 {
		t.Fatal("tools leaked to another account")
	}
	if err = appplugins.Apply(home, appplugins.Change{Name: "notes", Action: "uninstall", Revision: appplugins.Catalog(home)[0].Revision}); err != nil {
		t.Fatal(err)
	}
	if len(piPluginExtensions(home, piExtensionSettings{})) != 0 {
		t.Fatal("uninstalled tools retained")
	}
}
