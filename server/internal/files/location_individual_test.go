// SPDX-License-Identifier: AGPL-3.0-only
package files

import (
	"errors"
	"os"
	"path/filepath"
	"syscall"
	"testing"
)

func TestIndividualLocationMovesOnlyChosenFolder(t *testing.T) {
	home, target, settings := folderSettingsFixture(t)
	os.Mkdir(filepath.Join(home, "Pictures"), 0755)
	os.WriteFile(filepath.Join(home, "Pictures", "photo"), []byte("picture"), 0600)
	destination := filepath.Join(target, "Work papers")
	plan, err := PlanIndividualLocation("documents", destination, settings.Revision)
	if err != nil || plan.Create != 1 || plan.Files != 1 {
		t.Fatalf("plan=%+v err=%v", plan, err)
	}
	saved, err := SetIndividualLocation("documents", destination, false, settings.Revision)
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range saved.Locations {
		if item.ID == "documents" {
			if item.Path != destination || !item.Exists {
				t.Fatalf("documents=%+v", item)
			}
		} else if item.Path != item.DefaultPath {
			t.Fatalf("other folder changed: %+v", item)
		}
	}
	if data, _ := os.ReadFile(filepath.Join(destination, "notes.txt")); string(data) != "original" {
		t.Fatal("document missing")
	}
	if data, _ := os.ReadFile(filepath.Join(home, "Pictures", "photo")); string(data) != "picture" {
		t.Fatal("picture changed")
	}
	if _, err := os.Stat(filepath.Join(home, "Videos")); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("unrequested folder created")
	}
}

func TestIndividualLocationCollisionLeavesEverythingUnchanged(t *testing.T) {
	home, target, settings := folderSettingsFixture(t)
	os.WriteFile(filepath.Join(target, "notes.txt"), []byte("existing"), 0600)
	if _, err := SetIndividualLocation("documents", target, false, settings.Revision); err == nil {
		t.Fatal("collision accepted")
	}
	current, _ := GetLocationSettings()
	if current.Revision != settings.Revision {
		t.Fatal("settings changed")
	}
	if data, _ := os.ReadFile(filepath.Join(home, "Documents", "notes.txt")); string(data) != "original" {
		t.Fatal("source changed")
	}
	if data, _ := os.ReadFile(filepath.Join(target, "notes.txt")); string(data) != "existing" {
		t.Fatal("target changed")
	}
	for _, path := range []string{home, filepath.Join(home, "Documents"), filepath.Join(home, "Documents", "Nested")} {
		if _, err := PlanIndividualLocation("videos", path, settings.Revision); err == nil {
			t.Fatalf("overlapping new folder accepted: %s", path)
		}
	}
}

func TestRemoveIndividualLocationTrashesAndDisablesUntilAdded(t *testing.T) {
	home, _, settings := folderSettingsFixture(t)
	t.Setenv("XDG_DATA_HOME", filepath.Join(home, ".local", "share"))
	saved, err := SetIndividualLocation("documents", "", true, settings.Revision)
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range saved.Locations {
		if item.ID == "documents" && item.Enabled {
			t.Fatal("removed folder enabled")
		}
	}
	if _, err := os.Stat(filepath.Join(home, "Documents")); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("source remains")
	}
	items, err := ListTrash()
	if err != nil || len(items) != 1 {
		t.Fatalf("trash=%+v err=%v", items, err)
	}
	realHome, _ := filepath.EvalSymlinks(home)
	if items[0].OriginalPath != filepath.Join(realHome, "Documents") {
		t.Fatal("wrong restore path")
	}
	if _, err := RestoreTrash(TrashSelection{ID: items[0].ID, Revision: items[0].Revision}); err != nil {
		t.Fatal(err)
	}
	if data, _ := os.ReadFile(filepath.Join(home, "Documents", "notes.txt")); string(data) != "original" {
		t.Fatal("restored content differs")
	}
	for _, item := range UserLocations() {
		if item.ID == "documents" {
			t.Fatal("restoring unexpectedly enabled shortcut")
		}
	}
	if _, err := SetIndividualLocation("documents", filepath.Join(home, "Documents"), false, saved.Revision); err != nil {
		t.Fatal(err)
	}
	found := false
	for _, item := range UserLocations() {
		if item.ID == "documents" {
			found = true
		}
	}
	if !found {
		t.Fatal("add did not enable shortcut")
	}
}

func TestRemoveMissingLocationDoesNotTrashHome(t *testing.T) {
	home, _, settings := folderSettingsFixture(t)
	t.Setenv("XDG_DATA_HOME", filepath.Join(home, ".local", "share"))
	saved, err := SetIndividualLocation("videos", "", true, settings.Revision)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := SetIndividualLocation("videos", "", true, saved.Revision); err != nil {
		t.Fatal(err)
	}
	if data, _ := os.ReadFile(filepath.Join(home, "Documents", "notes.txt")); string(data) != "original" {
		t.Fatal("Home contents changed")
	}
	items, err := ListTrash()
	if err != nil || len(items) != 0 {
		t.Fatalf("unexpected trash: %+v %v", items, err)
	}
}

func TestRemovalRecoveryRestoresFolderAndCleansTrashMetadata(t *testing.T) {
	home, _, settings := folderSettingsFixture(t)
	t.Setenv("XDG_DATA_HOME", filepath.Join(home, ".local", "share"))
	os.MkdirAll(filepath.Join(home, ".config"), 0700)
	plan, info, err := planLocationRemoval(settings, "documents")
	if err != nil {
		t.Fatal(err)
	}
	config := filepath.Join(home, ".config", "user-dirs.dirs")
	_, err = stageLocationMovesWith(plan, renameExclusive, func(entries []movedLocationEntry) error {
		return saveLocationMoveWithTrash(config, settings.Revision, "never-committed", entries, info)
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := GetLocationSettings(); err != nil {
		t.Fatal(err)
	}
	if data, _ := os.ReadFile(filepath.Join(home, "Documents", "notes.txt")); string(data) != "original" {
		t.Fatal("interrupted removal lost data")
	}
	if _, err := os.Stat(info); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("orphan Trash metadata")
	}
	items, err := ListTrash()
	if err != nil || len(items) != 0 {
		t.Fatalf("unexpected trash: %+v %v", items, err)
	}
}

func TestRemovedFolderRestoresAcrossFilesystemsWithoutOverwriting(t *testing.T) {
	source, parent := t.TempDir(), t.TempDir()
	from, to := filepath.Join(source, "Documents"), filepath.Join(parent, "Documents")
	os.Mkdir(from, 0750)
	os.WriteFile(filepath.Join(from, "notes.txt"), []byte("keep"), 0640)
	os.Symlink("notes.txt", filepath.Join(from, "link"))
	crossDevice := func(string, string) error { return syscall.EXDEV }
	os.Mkdir(to, 0755)
	os.WriteFile(filepath.Join(to, "existing"), []byte("untouched"), 0600)
	if err := restoreTrashPath(from, to, crossDevice); err == nil {
		t.Fatal("overwrote restore destination")
	}
	if data, _ := os.ReadFile(filepath.Join(from, "notes.txt")); string(data) != "keep" {
		t.Fatal("failed restore lost Trash content")
	}
	os.RemoveAll(to)
	if err := restoreTrashPath(from, to, crossDevice); err != nil {
		t.Fatal(err)
	}
	if data, _ := os.ReadFile(filepath.Join(to, "notes.txt")); string(data) != "keep" {
		t.Fatal("restored content differs")
	}
	if link, _ := os.Readlink(filepath.Join(to, "link")); link != "notes.txt" {
		t.Fatal("symlink not preserved")
	}
	if _, err := os.Stat(from); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("restored item remains in Trash")
	}
}
