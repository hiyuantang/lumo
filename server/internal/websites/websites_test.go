// SPDX-License-Identifier: AGPL-3.0-only
package websites

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func testStore(t *testing.T) *Store {
	t.Helper()
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	_ = os.MkdirAll(filepath.Join(root, "conf.d"), 0o755)
	_ = os.MkdirAll(filepath.Join(root, "sites-enabled"), 0o755)
	_ = os.WriteFile(filepath.Join(root, "nginx.conf"), []byte("events {}\nhttp { include "+root+"/conf.d/*.conf; }\n"), 0o644)
	s := &Store{Root: root, LogRoot: root, RollbackDir: filepath.Join(root, "backups"), Binary: filepath.Join(root, "nginx.conf")}
	s.Run = func(_ context.Context, args ...string) ([]byte, error) {
		if args[0] == "-T" {
			return []byte("# configuration file " + filepath.Join(root, "conf.d", "lumo-notes.conf") + ":\n"), nil
		}
		return nil, nil
	}
	return s
}

func TestWebsiteRoundTripAndExternalEdits(t *testing.T) {
	s := testStore(t)
	d := Definition{Domain: "notes.example.com", Kind: "proxy", Port: 3000, Enabled: true}
	result, err := s.Apply(context.Background(), "notes", d, "absent", "create")
	if err != nil || !result.Reloaded || !result.Site.Managed {
		t.Fatalf("%+v %v", result, err)
	}
	if _, err = os.Stat(filepath.Join(s.RollbackDir, result.RollbackRef+".json")); err != nil {
		t.Fatal("missing backup")
	}
	d.Enabled = false
	disabled, err := s.Apply(context.Background(), "notes", d, result.Site.Revision, "disable")
	if err != nil || disabled.Site.Definition == nil || disabled.Site.Definition.Enabled {
		t.Fatalf("disabled: %+v %v", disabled, err)
	}
	if _, err = s.Apply(context.Background(), "notes", d, result.Site.Revision, "stale"); !errors.Is(err, ErrStale) {
		t.Fatal("stale revision accepted")
	}
	path := filepath.Join(s.Root, "conf.d", "lumo-notes.conf")
	custom := Render(d) + "# edited via SSH\n"
	_ = os.WriteFile(path, []byte(custom), 0o644)
	snapshot, err := s.Snapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	for _, site := range snapshot.Sites {
		if site.Path == path && site.Managed {
			t.Fatal("custom file exposed as editable")
		}
	}
	if _, err = s.Apply(context.Background(), "notes", d, Revision([]byte(custom)), "custom"); !errors.Is(err, ErrValidation) {
		t.Fatal("custom file overwritten")
	}
}

func TestWebsiteRestoresOnValidationAndReloadFailure(t *testing.T) {
	for _, phase := range []string{"-T", "-s", "not-included"} {
		t.Run(phase, func(t *testing.T) {
			s := testStore(t)
			d := Definition{Domain: "notes.example.com", Kind: "proxy", Port: 3000, Enabled: true}
			first, err := s.Apply(context.Background(), "notes", d, "absent", "first")
			if err != nil {
				t.Fatal(err)
			}
			before, _ := os.ReadFile(first.Site.Path)
			s.Run = func(_ context.Context, args ...string) ([]byte, error) {
				if args[0] == phase {
					return []byte("test failure"), errors.New("failed")
				}
				if phase == "not-included" {
					return []byte("valid but not included"), nil
				}
				return []byte("# configuration file " + first.Site.Path + ":\n"), nil
			}
			d.Port = 4000
			if _, err = s.Apply(context.Background(), "notes", d, first.Site.Revision, "second"); err == nil {
				t.Fatal("failure reported success")
			}
			after, _ := os.ReadFile(first.Site.Path)
			if string(before) != string(after) {
				t.Fatal("previous config not restored")
			}
		})
	}
}

func TestWebsiteValidationAndSymlinks(t *testing.T) {
	d := Definition{Domain: "notes.example.com", Kind: "proxy", Port: 3000, Enabled: true}
	for _, domain := range []string{"example.com; include /etc/passwd;", "bad\n.example.com", "-bad.example.com", "foo..com", strings.Repeat("x", 64) + ".com"} {
		bad := d
		bad.Domain = domain
		if Validate("site", bad, "absent") == nil {
			t.Fatalf("accepted %q", domain)
		}
	}
	for _, root := range []string{"/etc", "/var/www/../secret", "/srv/$host", "/srv/a\";"} {
		bad := Definition{Domain: d.Domain, Kind: "static", Root: root}
		if Validate("site", bad, "absent") == nil {
			t.Fatalf("accepted %q", root)
		}
	}
	s := testStore(t)
	outside := filepath.Join(s.Root, "outside")
	_ = os.WriteFile(outside, []byte("unchanged"), 0o644)
	_ = os.Symlink(outside, filepath.Join(s.Root, "conf.d", "lumo-notes.conf"))
	if _, err := s.Apply(context.Background(), "notes", d, "absent", "symlink"); err == nil {
		t.Fatal("symlink overwritten")
	}
	body, _ := os.ReadFile(outside)
	if string(body) != "unchanged" {
		t.Fatal("symlink target modified")
	}
}
