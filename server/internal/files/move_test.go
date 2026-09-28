// SPDX-License-Identifier: AGPL-3.0-only
package files

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestMovePreservesFilesAndDirectories(t *testing.T) {
	dir := t.TempDir()
	from, to := filepath.Join(dir, "folder"), filepath.Join(dir, "moved")
	if err := os.Mkdir(from, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(from, "notes"), []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := Move(from, to); err != nil {
		t.Fatal(err)
	}
	if data, err := os.ReadFile(filepath.Join(to, "notes")); err != nil || string(data) != "keep" {
		t.Fatalf("content: %q %v", data, err)
	}
	if _, err := os.Stat(from); !os.IsNotExist(err) {
		t.Fatalf("source still exists: %v", err)
	}
	if _, err := Move(to, to); err != nil {
		t.Fatalf("same location: %v", err)
	}
	if _, err := Move(to, filepath.Join(to, "child")); !errors.Is(err, ErrValidation) {
		t.Fatalf("descendant: %v", err)
	}
}

func TestMoveRefusesCollisionsAndMovesLinkItself(t *testing.T) {
	dir := t.TempDir()
	from, to := filepath.Join(dir, "source"), filepath.Join(dir, "target")
	if err := os.WriteFile(from, []byte("source"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(to, []byte("target"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := Move(from, to); !os.IsExist(err) {
		t.Fatalf("collision: %v", err)
	}
	for path, want := range map[string]string{from: "source", to: "target"} {
		if got, err := os.ReadFile(path); err != nil || string(got) != want {
			t.Fatalf("changed %s: %q %v", path, got, err)
		}
	}
	link := filepath.Join(dir, "link")
	if err := os.Symlink(from, link); err != nil {
		t.Fatal(err)
	}
	moved := filepath.Join(dir, "moved-link")
	if _, err := Move(link, moved); err != nil {
		t.Fatal(err)
	}
	if target, err := os.Readlink(moved); err != nil || target != from {
		t.Fatalf("link: %q %v", target, err)
	}
	if _, err := os.Stat(from); err != nil {
		t.Fatal(err)
	}
}

func TestMoveRejectsInvalidPathsAndSymlinkDescendant(t *testing.T) {
	dir := t.TempDir()
	folder := filepath.Join(dir, "folder")
	if err := os.Mkdir(folder, 0755); err != nil {
		t.Fatal(err)
	}
	alias := filepath.Join(dir, "alias")
	if err := os.Symlink(folder, alias); err != nil {
		t.Fatal(err)
	}
	for _, pair := range [][2]string{{"/", folder}, {folder, "/"}, {"relative", folder}, {folder, dir + "/../bad"}, {folder, filepath.Join(alias, "nested")}} {
		if _, err := Move(pair[0], pair[1]); !errors.Is(err, ErrValidation) {
			t.Errorf("%v: %v", pair, err)
		}
	}
}
