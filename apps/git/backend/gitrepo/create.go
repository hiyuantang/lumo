// SPDX-License-Identifier: AGPL-3.0-only
package gitrepo

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

func createRepository(ctx context.Context, req Action) error {
	if !filepath.IsAbs(req.Path) || filepath.Clean(req.Path) != req.Path || req.Path == "/" || strings.ContainsAny(req.Path, "\x00\r\n") {
		return errors.New("Choose a new repository folder inside an existing parent folder.")
	}
	parent := filepath.Dir(req.Path)
	if info, err := os.Stat(parent); err != nil || !info.IsDir() {
		return errors.New("Choose an existing parent folder.")
	}
	var args []string
	if req.Action == "clone" {
		if strings.TrimSpace(req.URL) == "" || strings.HasPrefix(req.URL, "-") || strings.ContainsAny(req.URL, "\x00\r\n") {
			return errors.New("Enter a repository URL or absolute server path.")
		}
		args = []string{"-c", "protocol.allow=never", "-c", "protocol.https.allow=always", "-c", "protocol.ssh.allow=always", "-c", "protocol.file.allow=always", "clone", "--no-recurse-submodules", "--", req.URL, req.Path}
	} else {
		args = []string{"init", "--initial-branch=main", "--", req.Path}
	}
	if err := os.Mkdir(req.Path, 0700); err != nil {
		return errors.New("The destination already exists or cannot be created. Choose a new folder name.")
	}
	if _, _, err := command(ctx, parent, args...); err != nil {
		if removeErr := os.Remove(req.Path); removeErr != nil {
			return fmt.Errorf("%w. A partial repository may remain at %s; inspect it in Files before retrying", err, req.Path)
		}
		return err
	}
	return nil
}
