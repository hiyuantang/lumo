// SPDX-License-Identifier: AGPL-3.0-only
package appplugins

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestPackageValidationFailsClosed(t *testing.T) {
	root := t.TempDir()
	t.Setenv("LUMO_PLUGIN_DIR", root)
	t.Setenv("LUMO_PLUGIN_BUNDLED_DIR", t.TempDir())
	directory := filepath.Join(root, "calendar")
	os.Mkdir(directory, 0755)
	bytes := []byte("backend")
	sum := sha256.Sum256(bytes)
	entry := fmt.Sprintf("%x.bin", sum)
	os.WriteFile(filepath.Join(directory, entry), bytes, 0755)
	valid := Manifest{SchemaVersion: 1, HostAPIVersion: 1, ID: "calendar", Version: "1.0.0", License: "AGPL-3.0-only", Backend: &Backend{ProtocolVersion: 1, Entry: entry, Platform: runtime.GOOS + "/" + runtime.GOARCH, Routes: []string{"GET /api/v1/calendar"}}}
	publish := func(m Manifest) {
		raw, _ := json.Marshal(m)
		os.WriteFile(filepath.Join(directory, "manifest.json"), raw, 0644)
	}
	publish(valid)
	app, err := Load("calendar")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = app.Executable(); err != nil {
		t.Fatal(err)
	}
	os.WriteFile(filepath.Join(directory, entry), []byte("changed"), 0755)
	if _, err = app.Executable(); err == nil {
		t.Fatal("corrupt executable accepted")
	}
	valid.Backend.Routes = []string{"POST /api/v1/pi/command"}
	publish(valid)
	if _, err = Load("calendar"); err == nil {
		t.Fatal("core route override accepted")
	}
	valid.Backend.Routes = []string{"GET /api/v1/calendar"}
	valid.Backend.Entry = "../../escape.bin"
	publish(valid)
	if _, err = Load("calendar"); err == nil {
		t.Fatal("path escape accepted")
	}
	valid.Backend.Entry = entry
	valid.Backend.Platform = "other/arch"
	publish(valid)
	if _, err = Load("calendar"); err == nil {
		t.Fatal("wrong platform accepted")
	}
}
