// SPDX-License-Identifier: AGPL-3.0-only
package desktopapps

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func fixture(version string) Bundle {
	return Bundle{Manifest: Manifest{SchemaVersion: 1, ID: "local.pulse", Name: "Pulse", Version: version, Description: "Test metrics", License: "AGPL-3.0-only", APIVersion: 1, Entry: "src/main.js", Styles: "src/style.css", Window: Window{720, 480, 390, 320}, Capabilities: []Capability{{"system.metrics.read"}}}, JS: "lumo.ready();", CSS: "body{color:black}"}
}
func TestLifecyclePersistsAndRejectsStaleChanges(t *testing.T) {
	s := New(t.TempDir())
	a, e := s.Stage(fixture("0.1.0"))
	if e != nil {
		t.Fatal(e)
	}
	b, e := s.Stage(fixture("0.2.0"))
	if e != nil {
		t.Fatal(e)
	}
	req := Change{RequestID: Token(), Action: "install", ID: a.Manifest.ID, Digest: a.Digest}
	installed, e := s.Change(req)
	if e != nil {
		t.Fatal(e)
	}
	replay, e := New(s.Home).Change(req)
	if e != nil || replay.Revision != installed.Revision {
		t.Fatal("replay", e)
	}
	bad := req
	bad.Digest = b.Digest
	if _, e = s.Change(bad); !errors.Is(e, ErrConflict) {
		t.Fatal("conflicting replay", e)
	}
	bad.RequestID = Token()
	if _, e = s.Change(bad); !errors.Is(e, ErrConflict) {
		t.Fatal("stale update", e)
	}
	bad.Revision = installed.Revision
	updated, e := s.Change(bad)
	if e != nil || updated.Previous != a.Digest {
		t.Fatal("update", e)
	}
	if _, e = s.Check(a.Digest, false); !errors.Is(e, ErrMissing) {
		t.Fatal("old version launch", e)
	}
	restored, e := s.Change(Change{RequestID: Token(), ID: a.Manifest.ID, Action: "restore", Revision: updated.Revision})
	if e != nil || restored.Digest != a.Digest {
		t.Fatal("restore", e)
	}
	disabled, e := s.Change(Change{RequestID: Token(), ID: a.Manifest.ID, Action: "disable", Revision: restored.Revision})
	if e != nil || disabled.Enabled {
		t.Fatal("disable", e)
	}
	if _, e = s.Check(a.Digest, false); !errors.Is(e, ErrMissing) {
		t.Fatal("disabled launch", e)
	}
	c, e := New(s.Home).Catalog()
	if e != nil || len(c.Apps) != 1 || len(c.Builds) != 2 {
		t.Fatal(c, e)
	}
}
func TestConcurrentUpdatesHaveOneWinner(t *testing.T) {
	s := New(t.TempDir())
	a, _ := s.Stage(fixture("0.1.0"))
	installed, e := s.Change(Change{RequestID: Token(), Action: "install", ID: a.Manifest.ID, Digest: a.Digest})
	if e != nil {
		t.Fatal(e)
	}
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, e := New(s.Home).Change(Change{RequestID: Token(), Action: "disable", ID: a.Manifest.ID, Revision: installed.Revision})
			results <- e
		}()
	}
	wg.Wait()
	close(results)
	success := 0
	for e := range results {
		if e == nil {
			success++
		} else if !errors.Is(e, ErrConflict) {
			t.Fatal(e)
		}
	}
	if success != 1 {
		t.Fatalf("winners: %d", success)
	}
}
func TestBuildChecksAndPathBoundaries(t *testing.T) {
	home := t.TempDir()
	s := New(home)
	project := filepath.Join(home, "project")
	if _, e := Create(project, "local.pulse", "Pulse"); e != nil {
		t.Fatal(e)
	}
	if _, e := Create(project, "local.pulse", "Pulse"); e == nil {
		t.Fatal("overwrote existing project")
	}
	b, e := s.Build(context.Background(), project)
	if e != nil {
		t.Fatal(e)
	}
	if !ValidDigest(b.Digest) || !strings.Contains(b.JS, `textContent = "Pulse"`) {
		t.Fatal(b)
	}
	os.WriteFile(filepath.Join(project, "src/main.js"), []byte("const = broken"), 0600)
	if _, e := s.Build(context.Background(), project); e == nil {
		t.Fatal("accepted invalid JavaScript")
	}
	os.Remove(filepath.Join(project, "src/main.js"))
	os.Symlink("../../outside.js", filepath.Join(project, "src/main.js"))
	os.WriteFile(filepath.Join(home, "outside.js"), []byte("lumo.ready()"), 0600)
	if _, e := s.Build(context.Background(), project); !errors.Is(e, ErrInvalid) {
		t.Fatal("followed symlink", e)
	}
}
func TestValidationAndArtifactIntegrity(t *testing.T) {
	s := New(t.TempDir())
	for _, mutate := range []func(*Bundle){func(b *Bundle) { b.Manifest.ID = "builtin.files" }, func(b *Bundle) { b.Manifest.Entry = "../main.js" }, func(b *Bundle) { b.Manifest.Capabilities = []Capability{{"shell"}} }, func(b *Bundle) { b.Manifest.APIVersion = 2 }} {
		b := fixture("0.1.0")
		mutate(&b)
		if _, e := s.Stage(b); !errors.Is(e, ErrInvalid) {
			t.Fatal("accepted invalid manifest", e)
		}
	}
	b, e := s.Stage(fixture("0.1.0"))
	if e != nil {
		t.Fatal(e)
	}
	different := fixture("0.1.0")
	different.JS = "throw Error('changed')"
	if _, e = s.Stage(different); e == nil {
		t.Fatal("version collision accepted")
	}
	b.JS = "modified"
	data, _ := json.Marshal(b)
	os.WriteFile(filepath.Join(s.Dir, "builds", b.Digest+".json"), data, 0600)
	if _, e = s.Bundle(b.Digest); !errors.Is(e, ErrInvalid) {
		t.Fatal("tampering accepted", e)
	}
}
func TestFramePolicyAndSourceEncoding(t *testing.T) {
	b := fixture("0.1.0")
	b.JS = "const marker = '</script><script>bad()</script>';"
	b.Manifest.Name = "<script>bad()</script>"
	doc, policy := Document(b)
	if strings.Contains(doc, b.JS) || strings.Contains(doc, "<title><script>") || !strings.Contains(policy, "sandbox allow-scripts") || strings.Contains(policy, "allow-same-origin") || !strings.Contains(policy, "connect-src 'none'") {
		t.Fatal("unsafe document", policy)
	}
}

func TestUninstallPreservesProjectAndTrashesArtifacts(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	s := New(home)
	project := filepath.Join(home, "project")
	if _, e := Create(project, "local.pulse", "Pulse"); e != nil {
		t.Fatal(e)
	}
	b, e := s.Build(context.Background(), project)
	if e != nil {
		t.Fatal(e)
	}
	app, e := s.Change(Change{RequestID: Token(), Action: "install", ID: b.Manifest.ID, Digest: b.Digest})
	if e != nil {
		t.Fatal(e)
	}
	dataDir := filepath.Join(s.Dir, "data", b.Manifest.ID)
	os.MkdirAll(dataDir, 0700)
	os.WriteFile(filepath.Join(dataDir, "prefs.json"), []byte(`{}`), 0600)
	req := Change{RequestID: Token(), Action: "uninstall", ID: b.Manifest.ID, Revision: app.Revision}
	if _, e = s.Change(req); e != nil {
		t.Fatal(e)
	}
	c, e := s.Catalog()
	if e != nil || len(c.Apps) != 0 || len(c.Builds) != 0 {
		t.Fatal(c, e)
	}
	if _, e = os.Stat(filepath.Join(project, "src/main.js")); e != nil {
		t.Fatal("project removed", e)
	}
	if _, e = os.Stat(filepath.Join(dataDir, "prefs.json")); e != nil {
		t.Fatal("data removed", e)
	}
	if _, e = s.Change(req); e != nil {
		t.Fatal("uninstall replay", e)
	}
	b, e = s.Build(context.Background(), project)
	if e != nil {
		t.Fatal(e)
	}
	app, e = s.Change(Change{RequestID: Token(), Action: "install", ID: b.Manifest.ID, Digest: b.Digest})
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.Change(Change{RequestID: Token(), Action: "uninstall", ID: b.Manifest.ID, Revision: app.Revision, Clean: true}); e != nil {
		t.Fatal(e)
	}
	if _, e = os.Stat(dataDir); !os.IsNotExist(e) {
		t.Fatal("clean uninstall retained data", e)
	}
	entries, e := os.ReadDir(filepath.Join(home, ".local/share/Trash/files"))
	if e != nil || len(entries) < 3 {
		t.Fatal("missing recoverable artifacts", e)
	}
}

func TestUninstallCanRecoverDamagedAppWithoutReadingOtherApps(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("XDG_DATA_HOME", filepath.Join(home, ".local/share"))
	s := New(home)
	b, err := s.Stage(fixture("0.1.0"))
	if err != nil {
		t.Fatal(err)
	}
	app, err := s.Change(Change{RequestID: Token(), Action: "install", ID: b.Manifest.ID, Digest: b.Digest})
	if err != nil {
		t.Fatal(err)
	}
	other := fixture("0.1.0")
	other.Manifest.ID = "local.other"
	other, err = s.Stage(other)
	if err != nil {
		t.Fatal(err)
	}
	for _, digest := range []string{b.Digest, other.Digest} {
		if err = os.WriteFile(filepath.Join(s.Dir, "builds", digest+".json"), []byte("damaged"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if _, err = s.Change(Change{RequestID: Token(), Action: "uninstall", ID: b.Manifest.ID, Revision: app.Revision}); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(filepath.Join(s.Dir, "builds", other.Digest+".json")); err != nil {
		t.Fatal("unrelated artifact removed", err)
	}
	entries, err := os.ReadDir(filepath.Join(home, ".local/share/Trash/files"))
	if err != nil || len(entries) != 1 {
		t.Fatal(entries, err)
	}
	raw, err := os.ReadFile(filepath.Join(home, ".local/share/Trash/files", entries[0].Name(), b.Digest+".json"))
	if err != nil || string(raw) != "damaged" {
		t.Fatal("damaged artifact not recoverable", err)
	}
}

func TestIconBuildEmbedsAndImportValidates(t *testing.T) {
	home := t.TempDir()
	project := filepath.Join(t.TempDir(), "icons")
	Create(project, "local.icons", "Icons")
	raw, _ := os.ReadFile(filepath.Join(project, "lumo.app.json"))
	var m Manifest
	json.Unmarshal(raw, &m)
	m.IconImage = "assets/icon.png"
	m.Capabilities = append(m.Capabilities, Capability{Name: "notifications.send"})
	raw, _ = json.Marshal(m)
	os.WriteFile(filepath.Join(project, "lumo.app.json"), raw, 0600)
	os.MkdirAll(filepath.Join(project, "assets"), 0700)
	data, _ := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAL0lEQVR4nO3OIQEAAAgDMKIRjWg0gxg3E/Ornr2kEhAQEBAQEBAQEBAQEBAQSAcejZH8iJt+oVIAAAAASUVORK5CYII=")
	os.WriteFile(filepath.Join(project, "assets/icon.png"), data, 0600)
	store := New(home)
	built, err := store.Build(context.Background(), project)
	if err != nil {
		t.Fatal(err)
	}
	if built.Manifest.IconImage != "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAL0lEQVR4nO3OIQEAAAgDMKIRjWg0gxg3E/Ornr2kEhAQEBAQEBAQEBAQEBAQSAcejZH8iJt+oVIAAAAASUVORK5CYII=" {
		t.Fatal("icon missing")
	}
	built.Manifest.IconImage = "https://example.test/icon.png"
	built.Manifest.Version = "1.0.1"
	built.Digest = ""
	if _, err = store.Stage(built); err == nil {
		t.Fatal("external icon accepted")
	}
}
