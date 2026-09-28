// SPDX-License-Identifier: AGPL-3.0-only
package files

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"syscall"
)

type LocationMovePlan struct {
	Create  int   `json:"create"`
	Files   int   `json:"files"`
	Bytes   int64 `json:"bytes"`
	entries []locationMoveEntry
}

type locationMoveEntry struct{ from, to string }

func PlanLocationMove(base, revision string) (LocationMovePlan, error) {
	settings, err := GetLocationSettings()
	if err != nil {
		return LocationMovePlan{}, err
	}
	if revision != settings.Revision {
		return LocationMovePlan{}, &StaleError{Expected: revision, Actual: settings.Revision}
	}
	if !filepath.IsAbs(base) || strings.ContainsAny(base, "\x00\r\n") {
		return LocationMovePlan{}, fmt.Errorf("%w: choose an absolute parent folder", ErrValidation)
	}
	base, err = filepath.EvalSymlinks(base)
	if err != nil {
		return LocationMovePlan{}, err
	}
	info, err := os.Stat(base)
	if err != nil {
		return LocationMovePlan{}, err
	}
	if !info.IsDir() {
		return LocationMovePlan{}, fmt.Errorf("%w: choose an existing parent folder", ErrValidation)
	}
	targets := map[string]string{}
	for _, item := range settings.Locations {
		targets[item.ID] = filepath.Join(base, item.Name)
	}
	return planLocationTargets(settings, targets)
}

func PlanIndividualLocation(id, path, revision string) (LocationMovePlan, error) {
	settings, err := GetLocationSettings()
	if err != nil {
		return LocationMovePlan{}, err
	}
	if revision != settings.Revision {
		return LocationMovePlan{}, &StaleError{Expected: revision, Actual: settings.Revision}
	}
	known := false
	for _, item := range settings.Locations {
		if item.ID == id {
			known = true
		}
	}
	if !known {
		return LocationMovePlan{}, fmt.Errorf("%w: unknown standard folder", ErrValidation)
	}
	if !filepath.IsAbs(path) || strings.ContainsAny(path, "\x00\r\n") {
		return LocationMovePlan{}, fmt.Errorf("%w: choose an absolute folder path", ErrValidation)
	}
	parent, err := filepath.EvalSymlinks(filepath.Dir(filepath.Clean(path)))
	if err != nil {
		return LocationMovePlan{}, err
	}
	path = filepath.Join(parent, filepath.Base(filepath.Clean(path)))
	home, _, err := locationConfigPath()
	if err != nil {
		return LocationMovePlan{}, err
	}
	home, err = filepath.EvalSymlinks(home)
	if err != nil {
		return LocationMovePlan{}, err
	}
	if containsLocation(path, home) {
		return LocationMovePlan{}, fmt.Errorf("%w: choose a folder separate from Home", ErrValidation)
	}
	return planLocationTargets(settings, map[string]string{id: path})
}

func planLocationTargets(settings LocationSettings, targets map[string]string) (LocationMovePlan, error) {
	_, config, err := locationConfigPath()
	if err != nil {
		return LocationMovePlan{}, err
	}
	out := LocationMovePlan{}
	sources := []string{}
	for _, item := range settings.Locations {
		if !item.Exists || !item.Enabled {
			continue
		}
		from, err := filepath.EvalSymlinks(item.Path)
		if err != nil {
			return out, err
		}
		to, changing := targets[item.ID]
		if changing && from == to {
			continue
		}
		if changing && (containsLocation(from, to) || containsLocation(from, config)) {
			return out, fmt.Errorf("%w: choose a parent outside the folders being moved", ErrValidation)
		}
		for _, other := range sources {
			if containsLocation(from, other) || containsLocation(other, from) {
				return out, fmt.Errorf("%w: current folder locations overlap; separate them before moving", ErrValidation)
			}
		}
		sources = append(sources, from)
	}
	for _, item := range settings.Locations {
		to, changing := targets[item.ID]
		if !changing {
			continue
		}
		if containsLocation(to, config) {
			return out, fmt.Errorf("%w: choose a folder separate from folder settings", ErrValidation)
		}
		if info, err := os.Lstat(to); err == nil {
			if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
				return out, fmt.Errorf("%w: %s already exists and is not a regular folder", ErrValidation, to)
			}
		} else if !errors.Is(err, os.ErrNotExist) {
			return out, err
		} else {
			out.Create++
		}
		from := ""
		if item.Exists && item.Enabled {
			from, err = filepath.EvalSymlinks(item.Path)
			if err != nil {
				return out, err
			}
		}
		for _, other := range sources {
			if from == to && other == from {
				continue
			}
			if containsLocation(other, to) || containsLocation(to, other) {
				return out, fmt.Errorf("%w: source and destination folders overlap", ErrValidation)
			}
		}
		if from == "" || from == to {
			continue
		}
		children, err := os.ReadDir(from)
		if err != nil {
			return out, err
		}
		for _, child := range children {
			destination := filepath.Join(to, child.Name())
			if _, err := os.Lstat(destination); err == nil {
				return out, fmt.Errorf("%w: %s already exists. Nothing was moved", ErrValidation, destination)
			} else if !errors.Is(err, os.ErrNotExist) {
				return out, err
			}
			entry := locationMoveEntry{from: filepath.Join(from, child.Name()), to: destination}
			err := filepath.WalkDir(entry.from, func(path string, d fs.DirEntry, walkErr error) error {
				if walkErr != nil {
					return walkErr
				}
				info, err := d.Info()
				if err != nil {
					return err
				}
				if info.Mode().IsRegular() {
					out.Files++
					out.Bytes += info.Size()
				} else if info.Mode()&os.ModeSymlink != 0 {
					out.Files++
				} else if !info.IsDir() {
					return fmt.Errorf("%w: %s is not a regular file, folder or symbolic link", ErrValidation, path)
				}
				return nil
			})
			if err != nil {
				return out, err
			}
			out.entries = append(out.entries, entry)
		}
	}
	return out, nil
}

func containsLocation(parent, child string) bool {
	return child == parent || strings.HasPrefix(child, strings.TrimRight(parent, string(filepath.Separator))+string(filepath.Separator))
}

type movedLocationEntry struct {
	from, to, backup, signature string
	published                   bool
}

func stageLocationMoves(plan LocationMovePlan) ([]movedLocationEntry, error) {
	return stageLocationMovesWith(plan, renameExclusive, nil)
}

func stageLocationMovesWith(plan LocationMovePlan, publish func(string, string) error, save func([]movedLocationEntry) error) ([]movedLocationEntry, error) {
	moved := []movedLocationEntry{}
	for _, entry := range plan.entries {
		signature, err := locationFingerprint(entry.from)
		if err != nil {
			return moved, err
		}
		backupDir, err := os.MkdirTemp(filepath.Dir(entry.from), ".lumo-folder-move-*")
		if err != nil {
			return moved, err
		}
		backup := filepath.Join(backupDir, filepath.Base(entry.from))
		item := movedLocationEntry{from: entry.from, to: entry.to, backup: backup, signature: signature}
		moved = append(moved, item)
		if save != nil {
			if err := save(moved); err != nil {
				return moved, err
			}
		}
		if err := renameExclusive(entry.from, backup); err != nil {
			return moved, err
		}
		if err := publish(backup, entry.to); err != nil {
			if !errors.Is(err, syscall.EXDEV) {
				return moved, err
			}
			stage, err := os.MkdirTemp(filepath.Dir(entry.to), ".lumo-folder-copy-*")
			if err != nil {
				return moved, err
			}
			target := filepath.Join(stage, "contents")
			err = copyLocationTree(backup, target)
			if err == nil {
				var current string
				current, err = locationFingerprint(backup)
				if err == nil && current != signature {
					err = fmt.Errorf("%w: files changed during the move", ErrValidation)
				}
			}
			if err == nil {
				var copied string
				copied, err = locationFingerprint(target)
				if err == nil && copied != signature {
					err = fmt.Errorf("%w: copied files could not be verified", ErrValidation)
				}
			}
			if err == nil {
				err = renameExclusive(target, entry.to)
			}
			_ = os.RemoveAll(stage)
			if err != nil {
				return moved, err
			}
		}
		moved[len(moved)-1].published = true
		if save != nil {
			if err := save(moved); err != nil {
				return moved, err
			}
		}
	}
	return moved, nil
}

func rollbackLocationMoves(moved []movedLocationEntry) error {
	var failures []error
	for i := len(moved) - 1; i >= 0; i-- {
		item := moved[i]
		if _, err := os.Lstat(item.backup); err == nil {
			if err := renameExclusive(item.backup, item.from); err != nil {
				failures = append(failures, fmt.Errorf("restore %s from %s: %w", item.from, item.backup, err))
				continue
			}
			if signature, err := locationFingerprint(item.to); item.published && err == nil && signature == item.signature {
				_ = os.RemoveAll(item.to)
			}
		} else if _, err := os.Lstat(item.from); err == nil && !item.published {
			_ = os.Remove(filepath.Dir(item.backup))
			continue
		} else if err := renameExclusive(item.to, item.from); err != nil {
			failures = append(failures, fmt.Errorf("restore %s from %s: %w", item.from, item.to, err))
			continue
		}
		_ = os.Remove(filepath.Dir(item.backup))
	}
	return errors.Join(failures...)
}

func finishLocationMoves(moved []movedLocationEntry) {
	for _, item := range moved {
		if signature, err := locationFingerprint(item.backup); err == nil && signature == item.signature {
			_ = os.RemoveAll(item.backup)
		}
		_ = os.Remove(filepath.Dir(item.backup))
	}
}

func locationFingerprint(root string) (string, error) {
	hash := sha256.New()
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(root, path)
		fmt.Fprintf(hash, "%s\x00%d\x00", rel, info.Mode())
		if info.Mode()&os.ModeSymlink != 0 {
			target, err := os.Readlink(path)
			if err != nil {
				return err
			}
			fmt.Fprint(hash, target)
		} else if info.Mode().IsRegular() {
			file, err := os.Open(path)
			if err != nil {
				return err
			}
			_, err = io.Copy(hash, file)
			file.Close()
			if err != nil {
				return err
			}
		} else if !info.IsDir() {
			return fmt.Errorf("%w: unsupported file type", ErrValidation)
		}
		return nil
	})
	return hex.EncodeToString(hash.Sum(nil)), err
}

func copyLocationTree(from, to string) error {
	info, err := os.Lstat(from)
	if err != nil {
		return err
	}
	switch {
	case info.Mode()&os.ModeSymlink != 0:
		target, err := os.Readlink(from)
		if err != nil {
			return err
		}
		return os.Symlink(target, to)
	case info.IsDir():
		if err := os.Mkdir(to, 0700); err != nil {
			return err
		}
		entries, err := os.ReadDir(from)
		if err != nil {
			return err
		}
		for _, entry := range entries {
			if err := copyLocationTree(filepath.Join(from, entry.Name()), filepath.Join(to, entry.Name())); err != nil {
				return err
			}
		}
	case info.Mode().IsRegular():
		input, err := os.Open(from)
		if err != nil {
			return err
		}
		defer input.Close()
		output, err := os.OpenFile(to, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if err != nil {
			return err
		}
		_, err = io.Copy(output, input)
		if err == nil {
			err = output.Sync()
		}
		closeErr := output.Close()
		if err != nil {
			return err
		}
		if closeErr != nil {
			return closeErr
		}
	default:
		return fmt.Errorf("%w: unsupported file type", ErrValidation)
	}
	if err := os.Chmod(to, info.Mode()); err != nil {
		return err
	}
	return os.Chtimes(to, info.ModTime(), info.ModTime())
}
