// SPDX-License-Identifier: AGPL-3.0-only
package appplugins

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestRequiredAppsCannotBeReplacedOrRemovedPerAccount(t *testing.T) {
	bundled := t.TempDir()
	home := t.TempDir()
	t.Setenv("LUMO_PLUGIN_BUNDLED_DIR", bundled)
	t.Setenv("LUMO_PLUGIN_DIR", t.TempDir())
	for name := range requiredNames {
		bundle := testBundle(t, name, "1.0.0")
		var m Manifest
		json.Unmarshal(bundle.Manifest, &m)
		m.Required = true
		bundle.Manifest, _ = json.Marshal(m)
		if _, err := Import(home, bundle); err == nil {
			t.Fatalf("imported required app %s", name)
		}
		for _, action := range []string{"install", "update", "rollback", "uninstall"} {
			if err := Apply(home, Change{Name: name, Action: action, Trust: true}); err == nil {
				t.Fatalf("allowed %s for %s", action, name)
			}
		}
		directory := filepath.Join(bundled, name)
		os.MkdirAll(directory, 0755)
		os.WriteFile(filepath.Join(directory, "manifest.json"), bundle.Manifest, 0644)
		for file, data := range bundle.Files {
			os.WriteFile(filepath.Join(directory, file), data, 0755)
		}
		selections := filepath.Join(StoreRoot(home), "selections")
		os.MkdirAll(selections, 0700)
		os.WriteFile(filepath.Join(selections, name+".json"), []byte(`{"installed":false}`), 0600)
		loaded, err := LoadFor(home, name)
		if err != nil || loaded.Directory != directory {
			t.Fatalf("account selection disabled required app %s: %v", name, err)
		}
	}
	bundle := testBundle(t, "notes", "1.0.0")
	var m Manifest
	json.Unmarshal(bundle.Manifest, &m)
	m.Required = true
	bundle.Manifest, _ = json.Marshal(m)
	if _, err := Import(home, bundle); err == nil {
		t.Fatal("custom app claimed required status")
	}
}
