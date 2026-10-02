// SPDX-License-Identifier: AGPL-3.0-only
package desktopapps

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func installDataApp(t *testing.T, s *Store, id string) App {
	t.Helper()
	b := fixture("0.1.0")
	b.Manifest.ID = id
	b.Manifest.Capabilities = []Capability{{"app.storage"}}
	b, e := s.Stage(b)
	if e != nil {
		t.Fatal(e)
	}
	a, e := s.Change(Change{RequestID: Token(), Action: "install", ID: id, Digest: b.Digest})
	if e != nil {
		t.Fatal(e)
	}
	return a
}
func TestDataPersistenceIsolationAndConcurrency(t *testing.T) {
	s := New(t.TempDir())
	a := installDataApp(t, s, "local.counter")
	other := installDataApp(t, s, "local.other")
	read := func(s *Store, a App) DataSnapshot {
		t.Helper()
		v, e := s.Data(a.Digest, a.Revision, "app.storage.get", nil)
		if e != nil {
			t.Fatal(e)
		}
		return v
	}
	if v := read(s, a); v.Revision != "" || string(v.Value) != "null" {
		t.Fatal(v)
	}
	var wg sync.WaitGroup
	results := make(chan error, 8)
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, e := New(s.Home).Data(a.Digest, a.Revision, "app.storage.set", json.RawMessage(`{"revision":"","value":{"count":1}}`))
			results <- e
		}()
	}
	wg.Wait()
	close(results)
	wins := 0
	for e := range results {
		if e == nil {
			wins++
		} else if !errors.Is(e, ErrDataConflict) {
			t.Fatal(e)
		}
	}
	if wins != 1 {
		t.Fatal("concurrent saves", wins)
	}
	saved := read(New(s.Home), a)
	if string(saved.Value) != `{"count":1}` || saved.Revision == "" {
		t.Fatal(saved)
	}
	if v := read(s, other); string(v.Value) != "null" {
		t.Fatal("cross-app leak", v)
	}
	newer := fixture("0.2.0")
	newer.Manifest.ID = a.Manifest.ID
	newer.Manifest.Capabilities = []Capability{{"app.storage"}}
	b, e := s.Stage(newer)
	if e != nil {
		t.Fatal(e)
	}
	updated, e := s.Change(Change{RequestID: Token(), Action: "install", ID: a.Manifest.ID, Digest: b.Digest, Revision: a.Revision})
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.Data(a.Digest, a.Revision, "app.storage.set", json.RawMessage(`{"revision":"","value":2}`)); !errors.Is(e, ErrMissing) {
		t.Fatal("stale launch", e)
	}
	if got := read(s, updated); got.Revision != saved.Revision {
		t.Fatal("update reset storage")
	}
	restored, e := s.Change(Change{RequestID: Token(), Action: "restore", ID: a.Manifest.ID, Revision: updated.Revision})
	if e != nil {
		t.Fatal(e)
	}
	if got := read(s, restored); got.Revision != saved.Revision {
		t.Fatal("rollback reset storage")
	}
	disabled, e := s.Change(Change{RequestID: Token(), Action: "disable", ID: a.Manifest.ID, Revision: restored.Revision})
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.Data(a.Digest, disabled.Revision, "app.storage.get", nil); !errors.Is(e, ErrMissing) {
		t.Fatal("disabled access", e)
	}
}
func TestDataValidationAndRetention(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("XDG_DATA_HOME", filepath.Join(home, ".local/share"))
	s := New(home)
	a := installDataApp(t, s, "local.counter")
	for _, params := range []string{`{}`, `{"revision":"","value":1,"id":"local.other"}`, `{"revision":"bad","value":1}`, `{"revision":"","value":"` + strings.Repeat("x", MaxDataBytes) + `"}`} {
		if _, e := s.Data(a.Digest, a.Revision, "app.storage.set", json.RawMessage(params)); !errors.Is(e, ErrInvalid) {
			t.Fatal("invalid data accepted", e)
		}
	}
	boundary := `{"revision":"","value":"` + strings.Repeat("<", MaxDataBytes-2) + `"}`
	saved, e := s.Data(a.Digest, a.Revision, "app.storage.set", json.RawMessage(boundary))
	if e != nil {
		t.Fatal(e)
	}
	if got, e := s.Data(a.Digest, a.Revision, "app.storage.get", nil); e != nil || string(got.Value) != string(saved.Value) {
		t.Fatal("boundary roundtrip", e)
	}
	b, e := s.Bundle(a.Digest)
	if e != nil {
		t.Fatal(e)
	}
	for _, clean := range []bool{false, true} {
		if _, e = s.Change(Change{RequestID: Token(), Action: "uninstall", ID: a.Manifest.ID, Revision: a.Revision, Clean: clean}); e != nil {
			t.Fatal(e)
		}
		if _, e = s.Stage(b); e != nil {
			t.Fatal(e)
		}
		a, e = s.Change(Change{RequestID: Token(), Action: "install", ID: b.Manifest.ID, Digest: b.Digest})
		if e != nil {
			t.Fatal(e)
		}
		got, e := s.Data(a.Digest, a.Revision, "app.storage.get", nil)
		if e != nil {
			t.Fatal(e)
		}
		if clean && string(got.Value) != "null" || !clean && got.Revision != saved.Revision {
			t.Fatal("retention", clean, got.Revision)
		}
	}
	entries, e := os.ReadDir(filepath.Join(home, ".local/share/Trash/files"))
	if e != nil {
		t.Fatal(e)
	}
	found := false
	for _, entry := range entries {
		if raw, e := os.ReadFile(filepath.Join(home, ".local/share/Trash/files", entry.Name(), "storage.json")); e == nil && strings.Contains(string(raw), saved.Revision) {
			found = true
		}
	}
	if !found {
		t.Fatal("clean uninstall did not preserve recoverable data")
	}
	dataFile := filepath.Join(s.Dir, "data", a.Manifest.ID, "storage.json")
	outside := filepath.Join(home, "outside")
	os.WriteFile(outside, []byte("preserve"), 0600)
	os.Symlink(outside, dataFile)
	if _, e = s.Data(a.Digest, a.Revision, "app.storage.set", json.RawMessage(`{"revision":"","value":1}`)); !errors.Is(e, ErrInvalid) {
		t.Fatal("followed symlink", e)
	}
	if got, _ := os.ReadFile(outside); string(got) != "preserve" {
		t.Fatal("overwrote target")
	}
}
