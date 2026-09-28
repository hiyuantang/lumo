// SPDX-License-Identifier: AGPL-3.0-only
package files

import (
	"os"
	"path/filepath"
	"testing"
)

func TestUserDirectoryPath(t *testing.T) {
	for _, tc := range []struct{ value, want string }{
		{`"$HOME/Documents"`, "/home/test/Documents"},
		{`"${HOME}/My Documents"`, "/home/test/My Documents"},
		{`"/srv/shared/docs"`, "/srv/shared/docs"},
		{`"$HOME/Price\$5"`, "/home/test/Price$5"},
		{`"$(touch /tmp/sentinel)"`, ""},
		{"\"`touch /tmp/sentinel`\"", ""},
		{`"$OTHER/Documents"`, ""},
		{`"relative/path"`, ""},
		{`"$HOME/Documents"; touch /tmp/sentinel`, ""},
	} {
		if got := userDirectoryPath(tc.value, "/home/test"); got != tc.want {
			t.Errorf("userDirectoryPath(%q) = %q, want %q", tc.value, got, tc.want)
		}
	}
}

func TestUserLocations(t *testing.T) {
	home := t.TempDir()
	config := filepath.Join(t.TempDir(), "user-dirs.dirs")
	if got := userLocations(home, config); len(got) != 0 {
		t.Fatalf("empty home: %v", got)
	}
	for _, name := range []string{"Documents", "Pictures", "Desktop", "文档"} {
		if err := os.Mkdir(filepath.Join(home, name), 0700); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(home, "Music"), []byte("not a directory"), 0600); err != nil {
		t.Fatal(err)
	}
	if got := userLocations(home, config); len(got) != 3 {
		t.Fatalf("existing defaults: %v", got)
	}
	external := t.TempDir()
	if err := os.Symlink(filepath.Join(home, "Pictures"), filepath.Join(home, "Videos")); err != nil {
		t.Fatal(err)
	}
	content := "XDG_DESKTOP_DIR=\"$HOME\"\nXDG_DOCUMENTS_DIR=\"$HOME/文档\"\nXDG_DOWNLOAD_DIR=\"" + external + "\"\nXDG_TEMPLATES_DIR=\"$(touch /tmp/sentinel)\"\n"
	if err := os.WriteFile(config, []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
	got := userLocations(home, config)
	if len(got) != 3 {
		t.Fatalf("configured locations: %v", got)
	}
	if got[0].ID != "documents" || got[0].Path != filepath.Join(home, "文档") || got[1].Path != external || got[2].ID != "pictures" {
		t.Fatalf("unexpected locations: %v", got)
	}
	if err := os.Remove(filepath.Join(home, "文档")); err != nil {
		t.Fatal(err)
	}
	if got := userLocations(home, config); len(got) != 2 || got[0].ID != "download" {
		t.Fatalf("deleted configured folder should not fall back: %v", got)
	}
}

func TestUserLocationsConfigHome(t *testing.T) {
	home, config := t.TempDir(), t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("XDG_CONFIG_HOME", config)
	if err := os.Mkdir(filepath.Join(home, "Docs"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(config, "user-dirs.dirs"), []byte("XDG_DOCUMENTS_DIR=\"$HOME/Docs\"\n"), 0600); err != nil {
		t.Fatal(err)
	}
	got := UserLocations()
	if len(got) != 1 || got[0].Path != filepath.Join(home, "Docs") {
		t.Fatalf("configured home: %v", got)
	}
}
