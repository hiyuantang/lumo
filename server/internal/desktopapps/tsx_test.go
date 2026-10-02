// SPDX-License-Identifier: AGPL-3.0-only
package desktopapps

import (
	"context"
	"lumo/server/internal/piruntime"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestReactBuildIsOfflineDeterministicAndDoesNotExecuteSource(t *testing.T) {
	home := t.TempDir()
	s := New(home)
	project := filepath.Join(home, "react")
	if _, e := Create(project, "local.react", "React Note", "react"); e != nil {
		t.Fatal(e)
	}
	if _, e := appToolchain.ReadFile("toolchain/compiler.cjs"); e != nil {
		t.Fatal("Run npm run build:app-sdk before React app tests.")
	}
	first, e := s.Build(context.Background(), project)
	if e != nil {
		t.Fatal(e)
	}
	second, e := s.Build(context.Background(), project)
	if e != nil || first.Digest != second.Digest {
		t.Fatal("non-deterministic build", e)
	}
	if first.Manifest.Entry != "src/main.tsx" || !strings.Contains(first.JS, "LumoReactV1") || !strings.Contains(first.JS, "Saved message") {
		t.Fatal("missing bundled runtime")
	}
	os.WriteFile(filepath.Join(project, "tsconfig.json"), []byte("broken config"), 0600)
	os.WriteFile(filepath.Join(project, "package.json"), []byte(`{"license":"AGPL-3.0-only","scripts":{"build":"exit 99"}}`), 0600)
	if _, e = s.Build(context.Background(), project); e != nil {
		t.Fatal("read project build configuration", e)
	}
	for _, source := range []string{`import fs from 'node:fs';`, `import './other.ts';`, `const x: = 1;`, `const x = import('react');`, `const x = require('react');`} {
		os.WriteFile(filepath.Join(project, "src/main.tsx"), []byte(source), 0600)
		if _, e = s.Build(context.Background(), project); e == nil {
			t.Fatal("accepted unsupported source", source)
		}
	}
	os.WriteFile(filepath.Join(project, "src/main.tsx"), []byte(`throw new Error('Must not execute during build');`), 0600)
	raw, _ := os.ReadFile(filepath.Join(project, "lumo.app.json"))
	os.WriteFile(filepath.Join(project, "lumo.app.json"), []byte(strings.Replace(string(raw), "0.1.0", "0.2.0", 1)), 0600)
	if _, e = s.Build(context.Background(), project); e != nil {
		t.Fatal("executed app source", e)
	}
	os.Remove(filepath.Join(project, "src/main.tsx"))
	os.Symlink("../../outside.tsx", filepath.Join(project, "src/main.tsx"))
	os.WriteFile(filepath.Join(home, "outside.tsx"), []byte("lumo.ready()"), 0600)
	if _, e = s.Build(context.Background(), project); e == nil {
		t.Fatal("followed linked entry")
	}
}

func TestBuildUsesPrivateNodeWithoutSystemNode(t *testing.T) {
	node, e := exec.LookPath("node")
	if e != nil {
		t.Fatal(e)
	}
	home := t.TempDir()
	private := piruntime.Bin(home)
	if e = os.MkdirAll(private, 0700); e != nil {
		t.Fatal(e)
	}
	if e = os.Symlink(node, filepath.Join(private, "node")); e != nil {
		t.Fatal(e)
	}
	t.Setenv("PATH", "/nonexistent")
	project := filepath.Join(home, "react")
	if _, e = Create(project, "local.private", "Private Runtime", "react"); e != nil {
		t.Fatal(e)
	}
	if _, e = New(home).Build(context.Background(), project); e != nil {
		t.Fatal(e)
	}
}
