// SPDX-License-Identifier: AGPL-3.0-only
package apptrash

import (
	"lumo/server/internal/files"
	"os"
	"path/filepath"
	"testing"
)

func fixture(t *testing.T) *Store {
	t.Helper()
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	s := New(filepath.Join(root, "var/lib/lumo/app-trash"))
	s.FSRoot = root
	s.Mounts = ""
	for _, path := range []string{"/etc/nginx", "/var/cache/nginx", "/var/lib/nginx", "/var/log/nginx", "/var/www/site", "/etc/docker", "/var/lib/docker"} {
		if err := os.MkdirAll(s.host(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(s.host(path), "keep"), []byte(path), 0o640); err != nil {
			t.Fatal(err)
		}
	}
	return s
}

func TestCleanUninstallRestoresPermissionsAndPreservesWebsites(t *testing.T) {
	s := fixture(t)
	if err := s.Move("nginx", 1000); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(s.host("/etc/nginx")); !os.IsNotExist(err) {
		t.Fatal(err)
	}
	if _, err := os.Stat(s.host("/var/www/site/keep")); err != nil {
		t.Fatal(err)
	}
	items, err := s.List(1000)
	if err != nil || len(items) != 1 {
		t.Fatalf("%v %v", items, err)
	}
	other, err := s.List(1001)
	if err != nil || len(other) != 0 {
		t.Fatalf("other account: %v %v", other, err)
	}
	selection := files.TrashSelection{ID: items[0].ID, Revision: items[0].Revision}
	if _, err := s.Restore(1001, selection); err == nil {
		t.Fatal("cross-user restore allowed")
	}
	if err := os.Mkdir(s.host("/etc/nginx"), 0755); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Restore(1000, selection); err == nil {
		t.Fatal("overwrote current configuration")
	}
	_ = os.Remove(s.host("/etc/nginx"))
	if _, err := s.Restore(1000, selection); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(s.host("/etc/nginx/keep"))
	if err != nil || info.Mode().Perm() != 0640 {
		t.Fatalf("permissions: %v %v", info, err)
	}
	items, err = s.List(1000)
	if err != nil || len(items) != 0 {
		t.Fatalf("after restore: %v %v", items, err)
	}
}

func TestCleanupRejectsRedirectedOrMountedDataAndCustomDockerStorage(t *testing.T) {
	s := fixture(t)
	_ = os.RemoveAll(s.host("/etc/nginx"))
	if err := os.Symlink(s.host("/var/www/site"), s.host("/etc/nginx")); err != nil {
		t.Fatal(err)
	}
	if err := s.Move("nginx", 1000); err == nil {
		t.Fatal("followed configuration symlink")
	}
	s.Mounts = filepath.Join(s.FSRoot, "mountinfo")
	_ = os.WriteFile(s.Mounts, []byte("1 2 0:1 / "+s.host("/var/lib/docker/overlay2/mount")+" rw - overlay overlay rw\n"), 0600)
	if err := s.Move("docker", 1000); err == nil {
		t.Fatal("moved mounted storage")
	}
	s.Mounts = ""
	_ = os.WriteFile(s.host("/etc/docker/daemon.json"), []byte(`{"data-root":"/srv/docker"}`), 0600)
	if err := s.Check("docker"); err == nil {
		t.Fatal("ignored custom data root")
	}
	_ = os.WriteFile(s.host("/etc/docker/daemon.json"), []byte(`{"features":{"containerd-snapshotter":true}}`), 0600)
	if err := s.Check("docker"); err == nil {
		t.Fatal("ignored shared storage")
	}
	if _, err := os.Stat(s.host("/var/lib/docker/keep")); err != nil {
		t.Fatal(err)
	}
}

func TestAppTrashDeleteChecksRevisionAndDoesNotFollowNestedSymlinks(t *testing.T) {
	s := fixture(t)
	if err := os.Symlink(s.host("/var/www/site"), s.host("/etc/nginx/site-link")); err != nil {
		t.Fatal(err)
	}
	if err := s.Move("nginx", 1000); err != nil {
		t.Fatal(err)
	}
	items, _ := s.List(1000)
	if err := s.Delete(1000, []files.TrashSelection{{ID: items[0].ID, Revision: "stale"}}); err == nil {
		t.Fatal("stale deletion allowed")
	}
	if err := s.Delete(1000, []files.TrashSelection{{ID: items[0].ID, Revision: items[0].Revision}}); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(s.host("/var/www/site/keep")); err != nil {
		t.Fatal(err)
	}
	items, _ = s.List(1000)
	if len(items) != 0 {
		t.Fatal(items)
	}
}

func TestGitCleanupPreservesRepositoriesAndAccountSettings(t *testing.T) {
	s := fixture(t)
	for _, path := range []string{"/etc/gitconfig", "/home/alice/.gitconfig", "/home/alice/project/.git/config", "/home/alice/.ssh/id_test"} {
		if err := os.MkdirAll(filepath.Dir(s.host(path)), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(s.host(path), []byte(path), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.Move("git", 1000); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(s.host("/etc/gitconfig")); !os.IsNotExist(err) {
		t.Fatal("system config not moved")
	}
	for _, path := range []string{"/home/alice/.gitconfig", "/home/alice/project/.git/config", "/home/alice/.ssh/id_test"} {
		if _, err := os.Stat(s.host(path)); err != nil {
			t.Fatal(err)
		}
	}
	items, err := s.List(1000)
	if err != nil || len(items) != 1 {
		t.Fatalf("%v %v", items, err)
	}
	if _, err := s.Restore(1000, files.TrashSelection{ID: items[0].ID, Revision: items[0].Revision}); err != nil {
		t.Fatal(err)
	}
	if data, err := os.ReadFile(s.host("/etc/gitconfig")); err != nil || string(data) != "/etc/gitconfig" {
		t.Fatal("system config not restored")
	}
}
