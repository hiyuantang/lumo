// SPDX-License-Identifier: AGPL-3.0-only
package files

import (
	"bytes"
	"encoding/base64"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestReadImage(t *testing.T) {
	dir := t.TempDir()
	data := bytes.Repeat([]byte{0, 1, 2, 255}, MaxReadBytes/4+1)
	for _, ext := range []string{"PNG", "jpg", "jpeg", "webp", "avif", "gif", "bmp", "ico"} {
		path := filepath.Join(dir, "image."+ext)
		if err := os.WriteFile(path, data, 0600); err != nil {
			t.Fatal(err)
		}
		read, err := ReadImage(path)
		if err != nil {
			t.Fatal(err)
		}
		if read.Content == nil || read.Truncated || read.Revision != "" || read.Encoding != "binary" {
			t.Fatalf("invalid image response for %s", ext)
		}
		decoded, err := base64.StdEncoding.DecodeString(*read.Content)
		if err != nil || !bytes.Equal(decoded, data) {
			t.Fatalf("image bytes changed for %s", ext)
		}
		text, err := Read(path)
		if err != nil || text.Content != nil {
			t.Fatal("ordinary binary reads must retain their contract")
		}
	}
	if _, err := ReadImage(filepath.Join(dir, "image.html")); !errors.Is(err, ErrValidation) {
		t.Fatal("unsupported extension accepted")
	}
	if _, err := ReadImage(filepath.Join(dir, "missing.png")); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("missing file accepted")
	}
	folder := filepath.Join(dir, "folder.png")
	if err := os.Mkdir(folder, 0700); err != nil {
		t.Fatal(err)
	}
	if _, err := ReadImage(folder); !errors.Is(err, ErrValidation) {
		t.Fatal("directory accepted")
	}
}

func TestReadImageLimit(t *testing.T) {
	path := filepath.Join(t.TempDir(), "large.png")
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := f.Truncate(MaxImageBytes + 1); err != nil {
		t.Fatal(err)
	}
	f.Close()
	read, err := ReadImage(path)
	if err != nil {
		t.Fatal(err)
	}
	if !read.Truncated || read.Content != nil {
		t.Fatal("oversized image must not return partial bytes")
	}
}
