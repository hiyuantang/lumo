// SPDX-License-Identifier: AGPL-3.0-only
package piruntime

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const Version = "24.21.0"

type Runner func(context.Context, string, ...string) (string, error)

func Bin(home string) string {
	return filepath.Join(home, ".local/share/lumo/pi/runtime-v"+Version, "bin")
}

func Lookup(home, name string) (string, error) {
	path := filepath.Join(Bin(home), name)
	if info, err := os.Stat(path); err == nil && info.Mode().IsRegular() && info.Mode().Perm()&0111 != 0 {
		return path, nil
	}
	return exec.LookPath(name)
}

func release(goos, arch string) (string, string, error) {
	if goos == "linux" {
		switch arch {
		case "amd64":
			return "node-v" + Version + "-linux-x64", "6e1db87ef58b8819e5d5402eff1536491b18edd8eb7bee5ef7897876e88dc5ff", nil
		case "arm64":
			return "node-v" + Version + "-linux-arm64", "724282c3b43aec998aa9527380465b45d229e021b58035f5f4f63095eabfe5d5", nil
		}
	}
	return "", "", errors.New("Automatic Pi installation requires Ubuntu on amd64 or arm64.")
}

func Supported() bool {
	_, _, err := release(runtime.GOOS, runtime.GOARCH)
	return err == nil
}

func Ensure(ctx context.Context, home string, run Runner) (string, error) {
	if ready(ctx, filepath.Dir(Bin(home)), run) {
		return filepath.Join(Bin(home), "npm"), nil
	}
	name, checksum, err := release(runtime.GOOS, runtime.GOARCH)
	if err != nil {
		return "", err
	}
	client := &http.Client{Timeout: 5 * time.Minute, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if req.URL.Scheme != "https" || req.URL.Host != "nodejs.org" || len(via) >= 5 {
			return errors.New("Unexpected runtime download redirect")
		}
		return nil
	}}
	return install(ctx, home, name, checksum, "https://nodejs.org/dist/v"+Version+"/"+name+".tar.gz", client, run)
}

func ready(ctx context.Context, root string, run Runner) bool {
	for _, name := range []string{"node", "npm"} {
		info, err := os.Stat(filepath.Join(root, "bin", name))
		if err != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0111 == 0 {
			return false
		}
	}
	version, err := run(ctx, filepath.Join(root, "bin/node"), "--version")
	return err == nil && strings.TrimSpace(version) == "v"+Version
}

func install(ctx context.Context, home, name, checksum, url string, client *http.Client, run Runner) (string, error) {
	if home == "" || !filepath.IsAbs(home) {
		return "", errors.New("Linux account home is unavailable")
	}
	parent := filepath.Dir(filepath.Dir(Bin(home)))
	if err := os.MkdirAll(parent, 0700); err != nil {
		return "", err
	}
	stage, err := os.MkdirTemp(parent, ".runtime-")
	if err != nil {
		return "", err
	}
	cleanup := true
	defer func() {
		if cleanup {
			_ = os.RemoveAll(stage)
		}
	}()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	response, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("Could not download Pi's runtime. Check the server's internet connection: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return "", fmt.Errorf("Pi runtime download failed (HTTP %d). Try installing again.", response.StatusCode)
	}
	archive, err := os.CreateTemp(stage, "archive-")
	if err != nil {
		return "", err
	}
	defer archive.Close()
	hash := sha256.New()
	n, err := io.Copy(io.MultiWriter(archive, hash), io.LimitReader(response.Body, (128<<20)+1))
	if err != nil {
		return "", err
	}
	if n > 128<<20 || hex.EncodeToString(hash.Sum(nil)) != checksum {
		return "", errors.New("Pi runtime download failed verification. Try installing again.")
	}
	if _, err := archive.Seek(0, io.SeekStart); err != nil {
		return "", err
	}
	root := filepath.Join(stage, "runtime")
	if err := extract(archive, root, name); err != nil {
		return "", err
	}
	if !ready(ctx, root, run) {
		return "", errors.New("Pi's runtime could not start. The existing installation was kept.")
	}
	destination := filepath.Dir(Bin(home))
	backup := filepath.Join(stage, "previous")
	if err := os.Rename(destination, backup); err != nil && !os.IsNotExist(err) {
		return "", err
	}
	if err := os.Rename(root, destination); err != nil {
		if restoreErr := os.Rename(backup, destination); restoreErr != nil && !os.IsNotExist(restoreErr) {
			cleanup = false
			return "", fmt.Errorf("%w; previous runtime retained at %s: %v", err, backup, restoreErr)
		}
		return "", err
	}
	return filepath.Join(Bin(home), "npm"), nil
}

func extract(reader io.Reader, root, name string) error {
	gz, err := gzip.NewReader(reader)
	if err != nil {
		return err
	}
	defer gz.Close()
	archive := tar.NewReader(gz)
	links := map[string]string{}
	var size int64
	for count := 0; ; count++ {
		header, err := archive.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
		if count >= 30000 {
			return errors.New("Pi runtime archive has too many entries")
		}
		path := strings.TrimPrefix(header.Name, name+"/")
		if path == header.Name || (path != "" && !filepath.IsLocal(path)) {
			return errors.New("Invalid Pi runtime archive path")
		}
		out := filepath.Join(root, path)
		switch header.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(out, 0755); err != nil {
				return err
			}
		case tar.TypeReg, tar.TypeRegA:
			size += header.Size
			if header.Size < 0 || size > 512<<20 {
				return errors.New("Pi runtime archive is too large")
			}
			if err := os.MkdirAll(filepath.Dir(out), 0755); err != nil {
				return err
			}
			mode := os.FileMode(0644)
			if header.Mode&0111 != 0 {
				mode = 0755
			}
			file, err := os.OpenFile(out, os.O_CREATE|os.O_EXCL|os.O_WRONLY, mode)
			if err != nil {
				return err
			}
			_, copyErr := io.CopyN(file, archive, header.Size)
			closeErr := file.Close()
			if copyErr != nil {
				return copyErr
			}
			if closeErr != nil {
				return closeErr
			}
		case tar.TypeSymlink:
			if filepath.IsAbs(header.Linkname) || !filepath.IsLocal(filepath.Join(filepath.Dir(path), header.Linkname)) {
				return errors.New("Invalid Pi runtime archive link")
			}
			links[out] = header.Linkname
		default:
			return errors.New("Unsupported Pi runtime archive entry")
		}
	}
	for path, target := range links {
		if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
			return err
		}
		if err := os.Symlink(target, path); err != nil {
			return err
		}
	}
	return nil
}
