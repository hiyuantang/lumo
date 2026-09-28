// SPDX-License-Identifier: AGPL-3.0-only
package files

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"syscall"
)

type MoveResult struct {
	Path string `json:"path"`
}

func Move(from, to string) (MoveResult, error) {
	for _, path := range []string{from, to} {
		clean, err := cleanPath(path)
		if err != nil {
			return MoveResult{}, err
		}
		if clean != path || clean == "/" {
			return MoveResult{}, fmt.Errorf("%w: choose canonical absolute paths below the root", ErrValidation)
		}
	}
	sourceParent, err := filepath.EvalSymlinks(filepath.Dir(from))
	if err != nil {
		return MoveResult{}, err
	}
	targetParent, err := filepath.EvalSymlinks(filepath.Dir(to))
	if err != nil {
		return MoveResult{}, err
	}
	source := filepath.Join(sourceParent, filepath.Base(from))
	target := filepath.Join(targetParent, filepath.Base(to))
	info, err := os.Lstat(source)
	if err != nil {
		return MoveResult{}, err
	}
	if source == target {
		return MoveResult{Path: to}, nil
	}
	if info.IsDir() && within(target, source) {
		return MoveResult{}, fmt.Errorf("%w: a folder cannot be moved inside itself", ErrValidation)
	}
	if dir, err := trashDir(); err == nil {
		if within(source, dir) || within(dir, source) || within(target, dir) || within(dir, target) {
			return MoveResult{}, fmt.Errorf("%w: use the Trash actions for Trash storage", ErrValidation)
		}
	}
	if err := renameExclusive(source, target); err != nil {
		if errors.Is(err, syscall.EXDEV) {
			return MoveResult{}, fmt.Errorf("%w: moving between different filesystems is not supported", ErrValidation)
		}
		return MoveResult{}, &os.LinkError{Op: "move", Old: from, New: to, Err: err}
	}
	syncDir(sourceParent)
	if sourceParent != targetParent {
		syncDir(targetParent)
	}
	return MoveResult{Path: to}, nil
}
