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

func testBundle(t *testing.T, name, version string) Bundle {
	t.Helper()
	b := Bundle{Name: name, Files: map[string][]byte{}}
	asset := func(content, suffix string) string {
		file := fmt.Sprintf("%x%s", sha256.Sum256([]byte(content)), suffix)
		b.Files[file] = []byte(content)
		return file
	}
	m := Manifest{SchemaVersion: 1, HostAPIVersion: 1, ID: AppID(name), Name: "Notes", Version: version, License: "AGPL-3.0-only", Icon: "IconGrid", Window: Window{Width: 600, Height: 400, MinWidth: 300, MinHeight: 240}, Entry: asset("export default function Notes(){}", ".js"), Permissions: []string{"account"}, Backend: &Backend{ProtocolVersion: 1, Platform: runtime.GOOS + "/" + runtime.GOARCH, Entry: asset("#!/bin/sh\nexit 0\n", ".bin"), Routes: []string{"GET /api/v1/plugins/" + name}}, Pi: &Extension{Setting: name, Entry: asset("export default function(){}", ".mjs"), ReadTools: []string{"lumo_" + name + "_read"}}}
	b.Manifest, _ = json.Marshal(m)
	return b
}
func TestAccountPackageLifecycleAndIsolation(t *testing.T) {
	t.Setenv("LUMO_PLUGIN_DIR", t.TempDir())
	t.Setenv("LUMO_PLUGIN_BUNDLED_DIR", t.TempDir())
	alice, bob := t.TempDir(), t.TempDir()
	v1, err := Import(alice, testBundle(t, "notes", "1.0.0"))
	if err != nil {
		t.Fatal(err)
	}
	if len(NamesFor(alice)) != 0 || len(Catalog(bob)) != 0 {
		t.Fatal("import activated code or leaked another account")
	}
	change := Change{Name: "notes", Action: "install", Digest: v1.Digest}
	if Apply(alice, change) == nil {
		t.Fatal("untrusted install accepted")
	}
	change.Trust = true
	if err = Apply(alice, change); err != nil {
		t.Fatal(err)
	}
	if _, err = LoadFor(bob, "notes"); !os.IsNotExist(err) {
		t.Fatal("account isolation failed", err)
	}
	app, err := LoadFor(alice, "notes")
	if err != nil || !app.HasRoute("GET", "/api/v1/plugins/notes") {
		t.Fatal(err)
	}
	os.MkdirAll(DataDirectory(alice, "notes"), 0700)
	os.WriteFile(filepath.Join(DataDirectory(alice, "notes"), "draft"), []byte("keep"), 0600)
	v2, err := Import(alice, testBundle(t, "notes", "1.1.0"))
	if err != nil {
		t.Fatal(err)
	}
	change.Action = "update"
	change.Digest = v2.Digest
	if Apply(alice, change) != ErrConflict {
		t.Fatal("stale update accepted")
	}
	change.Revision = Catalog(alice)[0].Revision
	if err = Apply(alice, change); err != nil {
		t.Fatal(err)
	}
	change.Action = "rollback"
	change.Revision = Catalog(alice)[0].Revision
	if err = Apply(alice, change); err != nil {
		t.Fatal(err)
	}
	app, _ = LoadFor(alice, "notes")
	if app.Manifest.Version != "1.0.0" {
		t.Fatal("rollback failed")
	}
	change.Action = "uninstall"
	change.Revision = Catalog(alice)[0].Revision
	if err = Apply(alice, change); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(filepath.Join(DataDirectory(alice, "notes"), "draft")); err != nil {
		t.Fatal("normal uninstall lost data")
	}
	if len(NamesFor(alice)) != 0 {
		t.Fatal("uninstalled app active")
	}
	change.Clean = true
	change.Revision = Catalog(alice)[0].Revision
	if err = Apply(alice, change); err != nil {
		t.Fatal(err)
	}
	entries, _ := os.ReadDir(filepath.Join(alice, ".local/share/Trash/files"))
	if len(entries) != 1 {
		t.Fatal("clean uninstall not recoverable")
	}
}
func TestPackageImportRejectsCoreCollisionCorruptionAndPermissions(t *testing.T) {
	home := t.TempDir()
	for _, name := range []string{"pi", "app", "plugin", "../notes", "files"} {
		if _, err := Import(home, testBundle(t, name, "1.0.0")); err == nil {
			t.Fatal("core name accepted", name)
		}
	}
	b := testBundle(t, "notes", "1.0.0")
	var m Manifest
	json.Unmarshal(b.Manifest, &m)
	b.Files[m.Entry] = []byte("corrupt")
	if _, err := Import(home, b); err == nil {
		t.Fatal("corrupt asset accepted")
	}
	b = testBundle(t, "notes", "1.0.0")
	json.Unmarshal(b.Manifest, &m)
	m.Backend.Routes = []string{"POST /api/v1/pi/command"}
	b.Manifest, _ = json.Marshal(m)
	if _, err := Import(home, b); err == nil {
		t.Fatal("core route accepted")
	}
	m.Backend.Routes = []string{"GET /api/v1/plugins/notes"}
	m.Permissions = []string{"broker.root.shell"}
	b.Manifest, _ = json.Marshal(m)
	if _, err := Import(home, b); err == nil {
		t.Fatal("unknown permission accepted")
	}
	m.Permissions = []string{"account", "broker.containers.start"}
	b.Manifest, _ = json.Marshal(m)
	release, err := Import(home, b)
	if err != nil {
		t.Fatal(err)
	}
	app, err := capture(home, "notes", release.Digest)
	if err != nil || !app.AllowsBroker("containers.start") || app.AllowsBroker("websites.save") {
		t.Fatal("broker capability declaration failed", err)
	}
}
func TestSharedDiscoveryAndPerAccountRemoval(t *testing.T) {
	shared := t.TempDir()
	t.Setenv("LUMO_PLUGIN_DIR", shared)
	t.Setenv("LUMO_PLUGIN_BUNDLED_DIR", t.TempDir())
	b := testBundle(t, "notes", "1.0.0")
	directory := filepath.Join(shared, "notes")
	os.MkdirAll(directory, 0755)
	os.WriteFile(filepath.Join(directory, "manifest.json"), b.Manifest, 0644)
	for name, bytes := range b.Files {
		os.WriteFile(filepath.Join(directory, name), bytes, 0755)
	}
	alice, bob := t.TempDir(), t.TempDir()
	if len(NamesFor(alice)) != 1 || Owner("/api/v1/plugins/notes") != "notes" {
		t.Fatal("dynamic discovery failed")
	}
	if err := Apply(alice, Change{Name: "notes", Action: "uninstall"}); err != nil {
		t.Fatal(err)
	}
	if len(NamesFor(alice)) != 0 || len(NamesFor(bob)) != 1 {
		t.Fatal("shared package was removed for another account")
	}
}

func TestConcurrentNativeChangesAndDurableReplay(t *testing.T) {
	t.Setenv("LUMO_PLUGIN_DIR", t.TempDir())
	t.Setenv("LUMO_PLUGIN_BUNDLED_DIR", t.TempDir())
	home := t.TempDir()
	release, err := Import(home, testBundle(t, "notes", "1.0.0"))
	if err != nil {
		t.Fatal(err)
	}
	install := Change{Name: "notes", Action: "install", Digest: release.Digest, Trust: true, RequestID: "install"}
	if err = Apply(home, install); err != nil {
		t.Fatal(err)
	}
	before := Catalog(home)[0]
	if err = Apply(home, install); err != nil || Catalog(home)[0].Revision != before.Revision {
		t.Fatal("replay changed selection", err)
	}
	altered := install
	altered.Clean = true
	if err = Apply(home, altered); err == nil {
		t.Fatal("request ID reused for different content")
	}
	results := make(chan error, 2)
	for _, id := range []string{"first", "second"} {
		go func(id string) {
			results <- Apply(home, Change{Name: "notes", Action: "uninstall", Revision: before.Revision, RequestID: id})
		}(id)
	}
	successes, conflicts := 0, 0
	for range 2 {
		err := <-results
		if err == nil {
			successes++
		} else if err == ErrConflict {
			conflicts++
		} else {
			t.Fatal(err)
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatal("concurrent changes lost revision check", successes, conflicts)
	}
}
