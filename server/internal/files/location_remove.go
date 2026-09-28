// SPDX-License-Identifier: AGPL-3.0-only
package files

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"syscall"
	"time"
)

func planLocationRemoval(settings LocationSettings, id string) (LocationMovePlan, string, error) {
	var item *LocationSetting
	for i := range settings.Locations {
		if settings.Locations[i].ID == id {
			item = &settings.Locations[i]
		}
	}
	if item == nil {
		return LocationMovePlan{}, "", fmt.Errorf("%w: unknown standard folder", ErrValidation)
	}
	if !item.Enabled || !item.Exists {
		return LocationMovePlan{}, "", nil
	}
	home, config, err := locationConfigPath()
	if err != nil {
		return LocationMovePlan{}, "", err
	}
	path, err := filepath.EvalSymlinks(item.Path)
	if err != nil {
		return LocationMovePlan{}, "", err
	}
	home, err = filepath.EvalSymlinks(home)
	if err != nil {
		return LocationMovePlan{}, "", err
	}
	if info, err := os.Lstat(item.Path); err != nil || info.Mode()&os.ModeSymlink != 0 {
		return LocationMovePlan{}, "", fmt.Errorf("%w: cannot remove a symbolic link as a standard folder", ErrValidation)
	}
	if containsLocation(path, home) || containsLocation(path, config) {
		return LocationMovePlan{}, "", fmt.Errorf("%w: this folder contains Home or folder settings", ErrValidation)
	}
	for _, other := range settings.Locations {
		if other.ID == id || !other.Enabled || !other.Exists {
			continue
		}
		otherPath, err := filepath.EvalSymlinks(other.Path)
		if err != nil {
			return LocationMovePlan{}, "", err
		}
		if containsLocation(path, otherPath) || containsLocation(otherPath, path) {
			return LocationMovePlan{}, "", fmt.Errorf("%w: this folder overlaps another standard folder", ErrValidation)
		}
	}
	root, dir, err := openTrash(true)
	if err != nil {
		return LocationMovePlan{}, "", err
	}
	defer root.Close()
	if containsLocation(path, dir) || containsLocation(dir, path) {
		return LocationMovePlan{}, "", fmt.Errorf("%w: cannot remove the Trash folder", ErrValidation)
	}
	if _, err := locationFingerprint(path); err != nil {
		return LocationMovePlan{}, "", err
	}
	for i := 0; ; i++ {
		name := filepath.Base(path)
		if i > 0 {
			name = fmt.Sprintf("%s.%d", name, i)
		}
		if _, err := root.Lstat("files/" + name); err == nil {
			continue
		} else if !errors.Is(err, os.ErrNotExist) {
			return LocationMovePlan{}, "", err
		}
		infoPath := "info/" + name + ".trashinfo"
		file, err := root.OpenFile(infoPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if errors.Is(err, os.ErrExist) {
			continue
		}
		if err != nil {
			return LocationMovePlan{}, "", err
		}
		_, err = fmt.Fprintf(file, "[Trash Info]\nPath=%s\nDeletionDate=%s\n", trashEscape(path), time.Now().Format("2006-01-02T15:04:05"))
		if err == nil {
			err = file.Sync()
		}
		closeErr := file.Close()
		if err == nil {
			err = closeErr
		}
		if err != nil {
			_ = root.Remove(infoPath)
			return LocationMovePlan{}, "", err
		}
		return LocationMovePlan{entries: []locationMoveEntry{{from: path, to: filepath.Join(dir, "files", name)}}}, filepath.Join(dir, infoPath), nil
	}
}

func restoreTrashPath(from, to string, rename func(string, string) error) error {
	if err := rename(from, to); err == nil {
		return nil
	} else if !errors.Is(err, syscall.EXDEV) {
		return err
	}
	signature, err := locationFingerprint(from)
	if err != nil {
		return err
	}
	stage, err := os.MkdirTemp(filepath.Dir(to), ".lumo-trash-restore-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(stage)
	copy := filepath.Join(stage, "contents")
	if err := copyLocationTree(from, copy); err != nil {
		return err
	}
	copied, err := locationFingerprint(copy)
	if err != nil {
		return err
	}
	current, err := locationFingerprint(from)
	if err != nil {
		return err
	}
	if signature != copied || signature != current {
		return fmt.Errorf("%w: Trash contents changed during restore", ErrValidation)
	}
	if err := renameExclusive(copy, to); err != nil {
		return err
	}
	return os.RemoveAll(from)
}
