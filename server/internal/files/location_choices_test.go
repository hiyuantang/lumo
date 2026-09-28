// SPDX-License-Identifier: AGPL-3.0-only
package files

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestStorageMountPaths(t *testing.T) {
	content := `1 0 8:1 / / rw - ext4 /dev/sda1 rw
2 1 8:2 / /mnt/Archive\040Drive rw,relatime - ext4 /dev/sdb1 rw
3 1 8:2 / /mnt/Archive\040Drive rw - ext4 /dev/sdb1 rw
4 1 8:3 / /media/Backup ro - ext4 /dev/sdc1 ro
5 1 0:1 / /run rw - tmpfs tmpfs rw
6 1 8:4 / /var/lib/docker rw - ext4 /dev/sdd1 rw
7 1 0:2 / /srv/shared rw - nfs server:/share rw
8 1 8:5 / /run/media/user/USB rw - exfat /dev/sde1 rw
9 1 0:3 / /mnt/temporary rw - tmpfs tmpfs rw
malformed
`
	want := []string{"/mnt/Archive Drive", "/srv/shared", "/run/media/user/USB"}
	if got := storageMountPaths(content); !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestLocationChoicesIncludeExistingMountedStorageOnce(t *testing.T) {
	home, storage := t.TempDir(), t.TempDir()
	alias := filepath.Join(t.TempDir(), "alias")
	if err := os.Symlink(storage, alias); err != nil {
		t.Fatal(err)
	}
	got := existingLocationChoices(home, []string{storage, alias, home, filepath.Join(storage, "missing")})
	count := 0
	for _, item := range got {
		if item.Path == storage {
			count++
		}
		if item.Path == alias || strings.HasSuffix(item.Path, "/missing") {
			t.Fatalf("invalid choice: %+v", item)
		}
	}
	if got[0].Path != home || count != 1 {
		t.Fatalf("choices: %+v", got)
	}
}

func TestApplyingCurrentHomeCreatesMissingFoldersWithoutMovingFiles(t *testing.T) {
	home, _, settings := folderSettingsFixture(t)
	plan, err := PlanLocationMove(home, settings.Revision)
	if err != nil || plan.Create != 7 || plan.Files != 0 {
		t.Fatalf("plan=%+v, err=%v", plan, err)
	}
	saved, err := SetLocationBase(home, settings.Revision)
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range saved.Locations {
		if !item.Exists || !item.Enabled {
			t.Fatalf("not created: %+v", item)
		}
	}
	data, err := os.ReadFile(filepath.Join(home, "Documents", "notes.txt"))
	if err != nil || string(data) != "original" {
		t.Fatalf("existing file changed: %s %v", data, err)
	}
	plan, err = PlanLocationMove(home, saved.Revision)
	if err != nil || plan.Create != 0 || plan.Files != 0 {
		t.Fatalf("completed plan=%+v, err=%v", plan, err)
	}
}
