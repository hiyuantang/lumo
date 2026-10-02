// SPDX-License-Identifier: AGPL-3.0-only
package piruntime

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func fixtureArchive(t *testing.T, headers []*tar.Header, bodies []string) []byte {
	t.Helper()
	var buffer bytes.Buffer
	gz := gzip.NewWriter(&buffer)
	archive := tar.NewWriter(gz)
	for i, header := range headers {
		if err := archive.WriteHeader(header); err != nil {
			t.Fatal(err)
		}
		if _, err := io.WriteString(archive, bodies[i]); err != nil {
			t.Fatal(err)
		}
	}
	if err := archive.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func runtimeFixture(t *testing.T) []byte {
	node := "#!/bin/sh\nprintf 'v" + Version + "\\n'\n"
	npm := "#!/usr/bin/env node\n"
	return fixtureArchive(t, []*tar.Header{
		{Name: "node-fixture/bin/node", Mode: 0755, Size: int64(len(node)), Typeflag: tar.TypeReg},
		{Name: "node-fixture/lib/npm.js", Mode: 0755, Size: int64(len(npm)), Typeflag: tar.TypeReg},
		{Name: "node-fixture/bin/npm", Typeflag: tar.TypeSymlink, Linkname: "../lib/npm.js"},
	}, []string{node, npm, ""})
}

func fixtureRun(ctx context.Context, name string, args ...string) (string, error) {
	out, err := exec.CommandContext(ctx, name, args...).CombinedOutput()
	return strings.TrimSpace(string(out)), err
}

func TestInstallWithoutSystemNodeAndReuse(t *testing.T) {
	t.Setenv("PATH", t.TempDir())
	home := t.TempDir()
	payload := runtimeFixture(t)
	hash := sha256.Sum256(payload)
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls++; w.Write(payload) }))
	defer server.Close()
	npm, err := install(context.Background(), home, "node-fixture", hex.EncodeToString(hash[:]), server.URL, server.Client(), fixtureRun)
	if err != nil {
		t.Fatal(err)
	}
	if npm != filepath.Join(Bin(home), "npm") {
		t.Fatal(npm)
	}
	if _, err := Lookup(home, "node"); err != nil {
		t.Fatal(err)
	}
	if got, err := Ensure(context.Background(), home, fixtureRun); err != nil || got != npm {
		t.Fatalf("reuse: %s %v", got, err)
	}
	if calls != 1 {
		t.Fatal("runtime downloaded again")
	}
	entries, err := os.ReadDir(filepath.Dir(filepath.Dir(Bin(home))))
	if err != nil || len(entries) != 1 {
		t.Fatalf("staging files left behind: %v %v", entries, err)
	}
}

func TestDownloadFailuresPreserveRuntimeAndAllowRetry(t *testing.T) {
	for _, problem := range []string{"checksum", "http", "truncated", "startup"} {
		t.Run(problem, func(t *testing.T) {
			home := t.TempDir()
			root := filepath.Dir(Bin(home))
			if err := os.MkdirAll(root, 0700); err != nil {
				t.Fatal(err)
			}
			marker := filepath.Join(root, "keep")
			if err := os.WriteFile(marker, []byte("previous"), 0600); err != nil {
				t.Fatal(err)
			}
			payload := runtimeFixture(t)
			hash := sha256.Sum256(payload)
			checksum := hex.EncodeToString(hash[:])
			fail := true
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if fail && problem == "http" {
					w.WriteHeader(503)
					return
				}
				if fail && problem == "truncated" {
					w.Write(payload[:len(payload)/2])
					return
				}
				w.Write(payload)
			}))
			defer server.Close()
			run := func(ctx context.Context, name string, args ...string) (string, error) {
				if fail && problem == "startup" {
					return "v20.0.0", nil
				}
				return fixtureRun(ctx, name, args...)
			}
			badChecksum := checksum
			if problem == "checksum" {
				badChecksum = strings.Repeat("0", 64)
			}
			if _, err := install(context.Background(), home, "node-fixture", badChecksum, server.URL, server.Client(), run); err == nil {
				t.Fatal("accepted failure")
			}
			if data, err := os.ReadFile(marker); err != nil || string(data) != "previous" {
				t.Fatal("previous runtime lost")
			}
			fail = false
			if _, err := install(context.Background(), home, "node-fixture", checksum, server.URL, server.Client(), run); err != nil {
				t.Fatal(err)
			}
			if !ready(context.Background(), root, run) {
				t.Fatal("retry failed")
			}
		})
	}
}

func TestArchiveRejectsEscapesAndSpecialFiles(t *testing.T) {
	for _, header := range []*tar.Header{
		{Name: "node-fixture/../../escape", Typeflag: tar.TypeReg},
		{Name: "/escape", Typeflag: tar.TypeReg},
		{Name: "node-fixture/bin/npm", Typeflag: tar.TypeSymlink, Linkname: "../../../escape"},
		{Name: "node-fixture/bin/npm", Typeflag: tar.TypeSymlink, Linkname: "/tmp/escape"},
		{Name: "node-fixture/device", Typeflag: tar.TypeChar},
	} {
		t.Run(header.Name+header.Linkname, func(t *testing.T) {
			payload := fixtureArchive(t, []*tar.Header{header}, []string{""})
			if err := extract(bytes.NewReader(payload), filepath.Join(t.TempDir(), "out"), "node-fixture"); err == nil {
				t.Fatal("unsafe archive accepted")
			}
		})
	}
}

func TestSupportedReleases(t *testing.T) {
	for _, arch := range []string{"amd64", "arm64"} {
		name, checksum, err := release("linux", arch)
		if err != nil || !strings.Contains(name, Version) || len(checksum) != 64 {
			t.Fatalf("release: %s %s %v", name, checksum, err)
		}
	}
	if _, _, err := release("linux", "386"); err == nil {
		t.Fatal("unsupported architecture accepted")
	}
	if _, _, err := release("darwin", "arm64"); err == nil {
		t.Fatal("unsupported platform accepted")
	}
}
