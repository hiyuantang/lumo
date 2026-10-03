// SPDX-License-Identifier: AGPL-3.0-only
package skills

import (
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
)

func fixture(t *testing.T, home, name, content string) string {
	t.Helper()
	path := filepath.Join(home, ".agents", "skills", name, "SKILL.md")
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestAccountDiscovery(t *testing.T) {
	home := t.TempDir()
	empty, err := List(home)
	if err != nil || len(empty.Skills) != 0 {
		t.Fatalf("missing folder: %#v %v", empty, err)
	}
	fixture(t, home, "daily", "---\r\nname: daily\r\ndescription: >-\r\n  Review resources\r\n  and recent events.\r\n---\r\n# Daily check\r\n")
	fixture(t, home, "broken", "---\nname: [broken\n---\n# Still readable")
	fixture(t, home, "bundle/nested", "---\nname: nested\ndescription: Not an immediate skill\n---")
	fixture(t, filepath.Join(home, "project"), "project-only", "---\nname: project-only\ndescription: Excluded\n---")
	catalog, err := List(home)
	if err != nil || len(catalog.Skills) != 2 {
		t.Fatalf("catalog: %#v %v", catalog, err)
	}
	if catalog.Skills[0].ID != "broken" || catalog.Skills[0].Issue == "" || catalog.Skills[1].Description != "Review resources and recent events." {
		t.Fatalf("metadata: %#v", catalog)
	}
	detail, err := Read(home, "daily")
	if err != nil || detail.Body != "# Daily check\n" || !strings.Contains(detail.Raw, "description:") {
		t.Fatalf("detail: %#v %v", detail, err)
	}
	fixture(t, home, "daily", "---\nname: daily\ndescription: Updated externally\n---\nNew instructions")
	detail, err = Read(home, "daily")
	if err != nil || detail.Description != "Updated externally" {
		t.Fatal("external edits not reflected", detail, err)
	}
}

func TestBoundedAccountReads(t *testing.T) {
	home := t.TempDir()
	fixture(t, home, "large", strings.Repeat("x", MaxBytes+1))
	fixture(t, home, "binary", "\x00\xff")
	root := filepath.Join(home, ".agents", "skills")
	outside := t.TempDir()
	os.WriteFile(filepath.Join(outside, "SKILL.md"), []byte("private"), 0600)
	if err := os.Symlink(outside, filepath.Join(root, "outside")); err != nil {
		t.Fatal(err)
	}
	os.Mkdir(filepath.Join(root, "pipe"), 0700)
	if err := syscall.Mkfifo(filepath.Join(root, "pipe", "SKILL.md"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"../outside", "/etc", "a/b", "..", "a\\b", ""} {
		if _, err := Read(home, id); err == nil {
			t.Fatalf("accepted invalid id %q", id)
		}
	}
	if _, err := Read(home, "outside"); err == nil {
		t.Fatal("followed a link outside the skills folder")
	}
	for _, id := range []string{"large", "binary", "pipe"} {
		detail, err := Read(home, id)
		if err != nil || detail.Issue == "" || detail.Raw != "" {
			t.Fatalf("unbounded read %s: %#v %v", id, detail, err)
		}
	}
	catalog, err := List(home)
	if err != nil || len(catalog.Skills) != 4 {
		t.Fatalf("unreadable entries lost: %#v %v", catalog, err)
	}
}
