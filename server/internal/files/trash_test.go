// SPDX-License-Identifier: AGPL-3.0-only
package files

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func setupTrashHome(t *testing.T) string {
	t.Helper()
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("XDG_DATA_HOME", "")
	return home
}

func TestTrashFile(t *testing.T) {
	home := setupTrashHome(t)
	path := filepath.Join(home, "doomed.txt")
	if err := os.WriteFile(path, []byte("bye"), 0o644); err != nil {
		t.Fatal(err)
	}
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil {
		t.Fatal(err)
	}
	res, err := Trash(path)
	if err != nil {
		t.Fatalf("Trash: %v", err)
	}
	if !res.Trashed {
		t.Error("trashed should be true")
	}
	if _, err := os.Lstat(path); !errors.Is(err, fs.ErrNotExist) {
		t.Error("original should be gone")
	}
	trashed := filepath.Join(home, ".local", "share", "Trash", "files", "doomed.txt")
	data, err := os.ReadFile(trashed)
	if err != nil || string(data) != "bye" {
		t.Errorf("trash copy: %v %q", err, data)
	}
	info, err := os.ReadFile(filepath.Join(home, ".local", "share", "Trash", "info", "doomed.txt.trashinfo"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(info), "Path="+resolved) || !strings.Contains(string(info), "DeletionDate=") {
		t.Errorf("trashinfo = %q", info)
	}
}

func TestTrashNameCollision(t *testing.T) {
	home := setupTrashHome(t)
	for _, content := range []string{"one", "two"} {
		path := filepath.Join(home, "same.txt")
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
		if _, err := Trash(path); err != nil {
			t.Fatalf("Trash %q: %v", content, err)
		}
	}
	filesDir := filepath.Join(home, ".local", "share", "Trash", "files")
	for _, want := range []string{"same.txt", "same.txt.1"} {
		if _, err := os.Lstat(filepath.Join(filesDir, want)); err != nil {
			t.Errorf("missing %s: %v", want, err)
		}
	}
}

func TestTrashValidation(t *testing.T) {
	home := setupTrashHome(t)
	if _, err := Trash("relative.txt"); !errors.Is(err, ErrValidation) {
		t.Errorf("relative: %v", err)
	}
	if _, err := Trash("/"); !errors.Is(err, ErrValidation) {
		t.Errorf("root: %v", err)
	}
	if _, err := Trash(filepath.Join(home, "missing.txt")); !errors.Is(err, fs.ErrNotExist) {
		t.Errorf("missing: %v", err)
	}
	inside := filepath.Join(home, ".local", "share", "Trash", "files")
	if err := os.MkdirAll(inside, 0o700); err != nil {
		t.Fatal(err)
	}
	f := filepath.Join(inside, "already.txt")
	if err := os.WriteFile(f, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := Trash(f); !errors.Is(err, ErrValidation) {
		t.Errorf("inside trash: %v", err)
	}
}

func TestTrashUnreadableTarget(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("running as root")
	}
	setupTrashHome(t)
	if _, err := Trash("/etc/sudoers"); err == nil {
		t.Skip("host allows renaming /etc/sudoers")
	} else if !errors.Is(err, fs.ErrPermission) {
		t.Errorf("expected permission error, got %v", err)
	}
}

func selection(item TrashItem) TrashSelection {
	return TrashSelection{ID: item.ID, Revision: item.Revision}
}

func TestTrashRestoreConflictAndMetadata(t *testing.T) {
	home := setupTrashHome(t)
	path := filepath.Join(home, "notes % and spaces\n.md")
	if err := os.WriteFile(path, []byte("original"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := Trash(path); err != nil {
		t.Fatal(err)
	}
	items, err := ListTrash()
	if err != nil || len(items) != 1 || !items[0].CanRestore || items[0].Name != filepath.Base(path) || items[0].DeletedAt == "" {
		t.Fatalf("items=%+v err=%v", items, err)
	}
	if err := os.WriteFile(path, []byte("new file"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := RestoreTrash(selection(items[0])); !errors.Is(err, fs.ErrExist) {
		t.Fatalf("expected conflict: %v", err)
	}
	data, _ := os.ReadFile(path)
	if string(data) != "new file" {
		t.Fatal("restore overwrote existing file")
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if _, err := RestoreTrash(selection(items[0])); err != nil {
		t.Fatal(err)
	}
	data, _ = os.ReadFile(path)
	if string(data) != "original" {
		t.Fatal("content was not restored")
	}
	items, err = ListTrash()
	if err != nil || len(items) != 0 {
		t.Fatalf("items=%v err=%v", items, err)
	}
}

func TestTrashSymlinkAndDirectory(t *testing.T) {
	home := setupTrashHome(t)
	target := filepath.Join(home, "target")
	os.WriteFile(target, []byte("keep"), 0o644)
	link := filepath.Join(home, "shortcut")
	if err := os.Symlink(target, link); err != nil {
		t.Fatal(err)
	}
	if _, err := Trash(link); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(target); err != nil {
		t.Fatal("shortcut target moved", err)
	}
	items, _ := ListTrash()
	if _, err := RestoreTrash(selection(items[0])); err != nil {
		t.Fatal(err)
	}
	if got, err := os.Readlink(link); err != nil || got != target {
		t.Fatal("shortcut not preserved", got, err)
	}
	folder := filepath.Join(home, "folder")
	os.Mkdir(folder, 0o755)
	os.WriteFile(filepath.Join(folder, "child"), []byte("nested"), 0o600)
	os.Symlink(target, filepath.Join(folder, "link"))
	if _, err := Trash(folder); err != nil {
		t.Fatal(err)
	}
	items, _ = ListTrash()
	if _, err := RestoreTrash(selection(items[0])); err != nil {
		t.Fatal(err)
	}
	if data, err := os.ReadFile(filepath.Join(folder, "child")); err != nil || string(data) != "nested" {
		t.Fatal("nested file not restored")
	}
	Trash(folder)
	items, _ = ListTrash()
	if err := DeleteTrash([]TrashSelection{selection(items[0])}); err != nil {
		t.Fatal(err)
	}
	if data, err := os.ReadFile(target); err != nil || string(data) != "keep" {
		t.Fatal("deletion followed a symlink")
	}
}

func TestTrashDeletionSnapshotAndStaleRevision(t *testing.T) {
	home := setupTrashHome(t)
	first := filepath.Join(home, "first")
	os.WriteFile(first, []byte("one"), 0o600)
	Trash(first)
	items, _ := ListTrash()
	later := filepath.Join(home, "later")
	os.WriteFile(later, []byte("two"), 0o600)
	Trash(later)
	if err := DeleteTrash([]TrashSelection{{ID: items[0].ID, Revision: "old"}}); !errors.Is(err, ErrStaleRevision) {
		t.Fatalf("stale revision accepted: %v", err)
	}
	if err := DeleteTrash([]TrashSelection{selection(items[0])}); err != nil {
		t.Fatal(err)
	}
	remaining, _ := ListTrash()
	if len(remaining) != 1 || remaining[0].Name != "later" {
		t.Fatalf("new arrivals removed: %+v", remaining)
	}
	for _, id := range []string{"../later", "/etc/passwd", ".", "..", ""} {
		if err := DeleteTrash([]TrashSelection{{ID: id, Revision: "x"}}); !errors.Is(err, ErrValidation) {
			t.Fatalf("invalid id %q accepted: %v", id, err)
		}
	}
}

func TestTrashMissingMetadataAndStorageFailure(t *testing.T) {
	home := setupTrashHome(t)
	path := filepath.Join(home, "orphan")
	os.WriteFile(path, []byte("keep"), 0o600)
	Trash(path)
	dir, _ := trashDir()
	os.Remove(filepath.Join(dir, "info", "orphan.trashinfo"))
	items, err := ListTrash()
	if err != nil || len(items) != 1 || items[0].CanRestore {
		t.Fatalf("missing metadata not exposed: %+v %v", items, err)
	}
	if _, err := RestoreTrash(selection(items[0])); !errors.Is(err, ErrValidation) {
		t.Fatal(err)
	}
	if err := DeleteTrash([]TrashSelection{selection(items[0])}); err != nil {
		t.Fatal(err)
	}
	os.Remove(filepath.Join(dir, "info"))
	os.WriteFile(filepath.Join(dir, "info"), []byte("blocked"), 0o600)
	os.WriteFile(path, []byte("still here"), 0o600)
	if _, err := Trash(path); err == nil {
		t.Fatal("invalid metadata storage accepted")
	}
	if data, _ := os.ReadFile(path); string(data) != "still here" {
		t.Fatal("file lost on metadata failure")
	}
}
