// SPDX-License-Identifier: AGPL-3.0-only
package files

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
)

func folderSettingsFixture(t *testing.T) (string, string, LocationSettings) {
	t.Helper()
	home, target := t.TempDir(), t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(home, ".config"))
	if err := os.Mkdir(filepath.Join(home, "Documents"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(home, "Documents", "notes.txt"), []byte("original"), 0640); err != nil {
		t.Fatal(err)
	}
	settings, err := GetLocationSettings()
	if err != nil {
		t.Fatal(err)
	}
	return home, target, settings
}

func TestLocationBaseMovesExistingContents(t *testing.T) {
	home, target, settings := folderSettingsFixture(t)
	if err := os.Mkdir(filepath.Join(target, "Documents"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(target, "Documents", "keep.txt"), []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	plan, err := PlanLocationMove(target, settings.Revision)
	if err != nil || plan.Files != 1 || plan.Bytes != 8 {
		t.Fatalf("plan=%+v, err=%v", plan, err)
	}
	saved, err := SetLocationBase(target, settings.Revision)
	if err != nil {
		t.Fatal(err)
	}
	if saved.Revision == settings.Revision {
		t.Fatal("configuration revision unchanged")
	}
	for _, item := range saved.Locations {
		if !item.Exists || !strings.HasPrefix(item.Path, target+"/") {
			t.Fatalf("location=%+v", item)
		}
	}
	if data, err := os.ReadFile(filepath.Join(target, "Documents", "notes.txt")); err != nil || string(data) != "original" {
		t.Fatalf("moved data=%s, err=%v", data, err)
	}
	if _, err := os.Stat(filepath.Join(home, "Documents", "notes.txt")); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("source remains")
	}
	if data, _ := os.ReadFile(filepath.Join(target, "Documents", "keep.txt")); string(data) != "keep" {
		t.Fatal("existing destination changed")
	}
	if len(UserLocations()) != 8 {
		t.Fatal("sidebar locations did not update")
	}
}

func TestLocationMoveConflictChangesNothing(t *testing.T) {
	home, target, settings := folderSettingsFixture(t)
	os.Mkdir(filepath.Join(target, "Documents"), 0755)
	os.WriteFile(filepath.Join(target, "Documents", "notes.txt"), []byte("destination"), 0600)
	if _, err := SetLocationBase(target, settings.Revision); err == nil {
		t.Fatal("conflict accepted")
	}
	if data, _ := os.ReadFile(filepath.Join(home, "Documents", "notes.txt")); string(data) != "original" {
		t.Fatal("source changed")
	}
	if data, _ := os.ReadFile(filepath.Join(target, "Documents", "notes.txt")); string(data) != "destination" {
		t.Fatal("destination changed")
	}
	if _, err := os.Stat(filepath.Join(target, "Desktop")); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("preflight created directories")
	}
	current, _ := GetLocationSettings()
	if current.Revision != settings.Revision {
		t.Fatal("configuration changed")
	}
}

func TestLocationMoveStaleAndNestedTargets(t *testing.T) {
	home, target, settings := folderSettingsFixture(t)
	if _, err := SetLocationBase(filepath.Join(home, "Documents"), settings.Revision); err == nil {
		t.Fatal("nested target accepted")
	}
	os.Mkdir(filepath.Join(home, ".config"), 0700)
	os.WriteFile(filepath.Join(home, ".config", "user-dirs.dirs"), []byte("# external edit\n"), 0600)
	if _, err := SetLocationBase(target, settings.Revision); !errors.Is(err, ErrStaleRevision) {
		t.Fatalf("expected stale revision, got %v", err)
	}
	if _, err := os.Stat(filepath.Join(home, "Documents", "notes.txt")); err != nil {
		t.Fatal(err)
	}
}

func TestLocationMoveRollsBackPartialFailure(t *testing.T) {
	home, target, _ := folderSettingsFixture(t)
	first := locationMoveEntry{from: filepath.Join(home, "Documents", "notes.txt"), to: filepath.Join(target, "notes.txt")}
	plan := LocationMovePlan{entries: []locationMoveEntry{first, {from: filepath.Join(home, "missing"), to: filepath.Join(target, "missing")}}}
	moved, err := stageLocationMoves(plan)
	if err == nil {
		t.Fatal("expected failure")
	}
	if err := rollbackLocationMoves(moved); err != nil {
		t.Fatal(err)
	}
	if data, _ := os.ReadFile(first.from); string(data) != "original" {
		t.Fatal("source not restored")
	}
	if _, err := os.Stat(first.to); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("destination remains")
	}
}

func TestLocationMoveLateConflictPreservesIdenticalDestination(t *testing.T) {
	home, target, _ := folderSettingsFixture(t)
	from, to := filepath.Join(home, "Documents", "notes.txt"), filepath.Join(target, "notes.txt")
	os.WriteFile(to, []byte("original"), 0640)
	moved, err := stageLocationMoves(LocationMovePlan{entries: []locationMoveEntry{{from: from, to: to}}})
	if err == nil {
		t.Fatal("late conflict accepted")
	}
	if err := rollbackLocationMoves(moved); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{from, to} {
		if data, _ := os.ReadFile(path); string(data) != "original" {
			t.Fatalf("file removed: %s", path)
		}
	}
}

func TestLocationTreeCopyPreservesContentsAndLinks(t *testing.T) {
	home, target, _ := folderSettingsFixture(t)
	from, to := filepath.Join(home, "Documents"), filepath.Join(target, "copied")
	os.Symlink("notes.txt", filepath.Join(from, "link"))
	if err := copyLocationTree(from, to); err != nil {
		t.Fatal(err)
	}
	a, err := locationFingerprint(from)
	if err != nil {
		t.Fatal(err)
	}
	b, err := locationFingerprint(to)
	if err != nil || a != b {
		t.Fatalf("copy differs: %v", err)
	}
	if link, _ := os.Readlink(filepath.Join(to, "link")); link != "notes.txt" {
		t.Fatal("symlink was followed")
	}
}

func TestLocationSettingsPreserveOtherConfigurationAndEscapes(t *testing.T) {
	home, parent, _ := folderSettingsFixture(t)
	target := filepath.Join(parent, "data $cash `literal` \\")
	os.Mkdir(target, 0755)
	config := filepath.Join(home, ".config", "user-dirs.dirs")
	os.Mkdir(filepath.Dir(config), 0700)
	os.WriteFile(config, []byte("# keep this\nOTHER_SETTING=preserve\nXDG_DOCUMENTS_DIR=\"$HOME/Documents\"\n"), 0600)
	settings, _ := GetLocationSettings()
	if _, err := SetLocationBase(target, settings.Revision); err != nil {
		t.Fatal(err)
	}
	data, _ := os.ReadFile(config)
	if !strings.Contains(string(data), "# keep this\nOTHER_SETTING=preserve\n") {
		t.Fatal("unrelated configuration lost")
	}
	for _, item := range UserLocations() {
		if !strings.HasPrefix(item.Path, target+"/") {
			t.Fatalf("path did not round trip: %s", item.Path)
		}
	}
}

func TestLocationCrossDeviceCopyAndRollback(t *testing.T) {
	home, target, _ := folderSettingsFixture(t)
	from, to := filepath.Join(home, "Documents", "notes.txt"), filepath.Join(target, "notes.txt")
	moved, err := stageLocationMovesWith(LocationMovePlan{entries: []locationMoveEntry{{from: from, to: to}}}, func(string, string) error { return syscall.EXDEV }, nil)
	if err != nil {
		t.Fatal(err)
	}
	if data, _ := os.ReadFile(to); string(data) != "original" {
		t.Fatal("copy missing")
	}
	if _, err := os.Stat(moved[0].backup); err != nil {
		t.Fatal("source backup missing")
	}
	if err := rollbackLocationMoves(moved); err != nil {
		t.Fatal(err)
	}
	if data, _ := os.ReadFile(from); string(data) != "original" {
		t.Fatal("source not restored")
	}
	if _, err := os.Stat(to); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("copy remains")
	}
}

func TestLocationMoveRecoveryAfterInterruption(t *testing.T) {
	home, target, _ := folderSettingsFixture(t)
	_, config, _ := locationConfigPath()
	os.MkdirAll(filepath.Dir(config), 0700)
	from, to := filepath.Join(home, "Documents", "notes.txt"), filepath.Join(target, "notes.txt")
	_, err := stageLocationMovesWith(LocationMovePlan{entries: []locationMoveEntry{{from: from, to: to}}}, renameExclusive, func(moved []movedLocationEntry) error {
		return saveLocationMove(config, "missing", "not-committed", moved)
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := GetLocationSettings(); err != nil {
		t.Fatal(err)
	}
	if data, _ := os.ReadFile(from); string(data) != "original" {
		t.Fatal("interrupted move not restored")
	}
	if _, err := os.Stat(to); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("destination remains")
	}
	if _, err := os.Stat(config + ".lumo-move.json"); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("recovery record remains")
	}
}
