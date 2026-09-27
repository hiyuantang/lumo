// SPDX-License-Identifier: AGPL-3.0-only
package files

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"testing"
)

func TestCreatePreservesExistingEntries(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "notes.md")
	if _, err := Create(target, "file"); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(target, []byte("keep this"), 0o644); err != nil {
		t.Fatal(err)
	}
	for _, kind := range []string{"file", "directory"} {
		if _, err := Create(target, kind); !errors.Is(err, fs.ErrExist) {
			t.Fatalf("duplicate %s: %v", kind, err)
		}
	}
	data, _ := os.ReadFile(target)
	if string(data) != "keep this" {
		t.Fatal("existing file changed")
	}
	link := filepath.Join(dir, "link")
	if err := os.Symlink(target, link); err != nil {
		t.Fatal(err)
	}
	if _, err := Create(link, "file"); !errors.Is(err, fs.ErrExist) {
		t.Fatalf("symlink: %v", err)
	}
}

func TestCreateDirectoryAndValidatePaths(t *testing.T) {
	dir := t.TempDir()
	folder := filepath.Join(dir, "new folder")
	if _, err := Create(folder, "directory"); err != nil {
		t.Fatal(err)
	}
	if _, err := Create(filepath.Join(folder, "empty.txt"), "file"); err != nil {
		t.Fatal(err)
	}
	for _, pair := range [][2]string{{"relative", "file"}, {dir + "/../escaped", "file"}, {dir + "/x", "device"}, {"/", "directory"}} {
		if _, err := Create(pair[0], pair[1]); !errors.Is(err, ErrValidation) {
			t.Errorf("accepted invalid request: %v (%v)", pair, err)
		}
	}
}
