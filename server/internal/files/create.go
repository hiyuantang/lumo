// SPDX-License-Identifier: AGPL-3.0-only
package files

import (
	"fmt"
	"os"
	"path/filepath"
)

type CreateResult struct {
	Path string `json:"path"`
	Kind string `json:"kind"`
}

func Create(p, kind string) (CreateResult, error) {
	clean, err := cleanPath(p)
	if err != nil {
		return CreateResult{}, err
	}
	if clean != p || clean == "/" || (kind != "file" && kind != "directory") {
		return CreateResult{}, fmt.Errorf("%w: choose an absolute path and a file or directory", ErrValidation)
	}
	parent, err := os.OpenRoot(filepath.Dir(clean))
	if err != nil {
		return CreateResult{}, err
	}
	defer parent.Close()
	name := filepath.Base(clean)
	if kind == "directory" {
		err = parent.Mkdir(name, 0o755)
	} else {
		var file *os.File
		file, err = parent.OpenFile(name, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
		if err == nil {
			err = file.Close()
		}
	}
	if err != nil {
		return CreateResult{}, err
	}
	syncDir(filepath.Dir(clean))
	return CreateResult{Path: clean, Kind: kind}, nil
}
