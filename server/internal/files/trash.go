// SPDX-License-Identifier: AGPL-3.0-only
package files

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"
)

var trashMu sync.Mutex

type TrashResult struct {
	Trashed bool `json:"trashed"`
}
type TrashItem struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	OriginalPath string `json:"originalPath"`
	DeletedAt    string `json:"deletedAt"`
	Type         string `json:"type"`
	SizeBytes    int64  `json:"sizeBytes"`
	Revision     string `json:"revision"`
	CanRestore   bool   `json:"canRestore"`
}
type TrashSelection struct {
	ID       string `json:"id"`
	Revision string `json:"revision"`
}

func Trash(p string) (TrashResult, error) {
	trashMu.Lock()
	defer trashMu.Unlock()
	clean, err := cleanPath(p)
	if err != nil {
		return TrashResult{}, err
	}
	parent, err := filepath.EvalSymlinks(filepath.Dir(clean))
	if err != nil {
		return TrashResult{}, err
	}
	real := filepath.Join(parent, filepath.Base(clean))
	if real == "/" {
		return TrashResult{}, fmt.Errorf("%w: cannot trash the root directory", ErrValidation)
	}
	if _, err := os.Lstat(real); err != nil {
		return TrashResult{}, err
	}
	root, dir, err := openTrash(true)
	if err != nil {
		return TrashResult{}, err
	}
	defer root.Close()
	if within(real, dir) || within(dir, real) {
		return TrashResult{}, fmt.Errorf("%w: cannot trash the Trash folder or its contents", ErrValidation)
	}
	unlock := writeLocks.lock(real)
	defer unlock()
	name := filepath.Base(real)
	for i := 0; ; i++ {
		id := name
		if i > 0 {
			id = fmt.Sprintf("%s.%d", name, i)
		}
		if _, err := root.Lstat("files/" + id); err == nil {
			continue
		} else if !os.IsNotExist(err) {
			return TrashResult{}, err
		}
		infoPath := "info/" + id + ".trashinfo"
		file, err := root.OpenFile(infoPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
		if os.IsExist(err) {
			continue
		}
		if err != nil {
			return TrashResult{}, err
		}
		_, err = fmt.Fprintf(file, "[Trash Info]\nPath=%s\nDeletionDate=%s\n", trashEscape(real), time.Now().Format("2006-01-02T15:04:05"))
		if err == nil {
			err = file.Sync()
		}
		closeErr := file.Close()
		if err == nil {
			err = closeErr
		}
		if err == nil {
			err = renameExclusive(real, filepath.Join(dir, "files", id))
		}
		if err != nil {
			_ = root.Remove(infoPath)
			if errors.Is(err, syscall.EXDEV) {
				return TrashResult{}, fmt.Errorf("%w: cannot trash across filesystems", ErrValidation)
			}
			if os.IsExist(err) {
				continue
			}
			return TrashResult{}, &os.LinkError{Op: "trash", Old: real, New: dir, Err: err}
		}
		return TrashResult{Trashed: true}, nil
	}
}

func within(path, parent string) bool {
	return path == parent || strings.HasPrefix(path, parent+string(filepath.Separator))
}

func trashDir() (string, error) {
	if xdg := os.Getenv("XDG_DATA_HOME"); xdg != "" && filepath.IsAbs(xdg) {
		return filepath.Join(xdg, "Trash"), nil
	}
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return "", fmt.Errorf("%w: no home directory available for trash", ErrValidation)
	}
	return filepath.Join(home, ".local", "share", "Trash"), nil
}

func openTrash(create bool) (*os.Root, string, error) {
	dir, err := trashDir()
	if err != nil {
		return nil, "", err
	}
	if create {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return nil, "", err
		}
	}
	dir, err = filepath.EvalSymlinks(dir)
	if err != nil {
		return nil, "", err
	}
	root, err := os.OpenRoot(dir)
	if err != nil {
		return nil, "", err
	}
	for _, sub := range []string{"files", "info"} {
		if create {
			if err := root.Mkdir(sub, 0o700); err != nil && !os.IsExist(err) {
				root.Close()
				return nil, "", err
			}
		}
		info, err := root.Lstat(sub)
		if os.IsNotExist(err) {
			if sub == "info" && !create {
				continue
			}
			root.Close()
			return nil, "", err
		}
		if err != nil || !info.IsDir() {
			root.Close()
			return nil, "", fmt.Errorf("%w: Trash storage is unavailable", ErrValidation)
		}
	}
	return root, dir, nil
}

func ListTrash() ([]TrashItem, error) {
	trashMu.Lock()
	defer trashMu.Unlock()
	root, _, err := openTrash(false)
	if os.IsNotExist(err) {
		return []TrashItem{}, nil
	}
	if err != nil {
		return nil, err
	}
	defer root.Close()
	folder, err := root.Open("files")
	if err != nil {
		return nil, err
	}
	defer folder.Close()
	names, err := folder.Readdirnames(-1)
	if err != nil {
		return nil, err
	}
	items := make([]TrashItem, 0, len(names))
	for _, name := range names {
		item, err := readTrashItem(root, name)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].DeletedAt == items[j].DeletedAt {
			return items[i].ID < items[j].ID
		}
		return items[i].DeletedAt > items[j].DeletedAt
	})
	return items, nil
}

func readTrashItem(root *os.Root, id string) (TrashItem, error) {
	if id == "" || id == "." || id == ".." || strings.ContainsAny(id, "/\\\x00") {
		return TrashItem{}, fmt.Errorf("%w: invalid Trash item", ErrValidation)
	}
	info, err := root.Lstat("files/" + id)
	if err != nil {
		return TrashItem{}, err
	}
	item := TrashItem{ID: id, Name: id, Type: entryType(info), SizeBytes: info.Size()}
	if info.IsDir() {
		item.SizeBytes = 0
	}
	var metadata []byte
	metaPath := "info/" + id + ".trashinfo"
	if metaInfo, err := root.Lstat(metaPath); err == nil && metaInfo.Mode().IsRegular() {
		if file, err := root.Open(metaPath); err == nil {
			metadata, _ = io.ReadAll(io.LimitReader(file, 65537))
			file.Close()
		}
	}
	lines := strings.Split(string(metadata), "\n")
	if len(metadata) <= 65536 && len(lines) > 0 && strings.TrimSuffix(lines[0], "\r") == "[Trash Info]" {
		pathSeen, dateSeen := false, false
		for _, line := range lines[1:] {
			key, value, ok := strings.Cut(strings.TrimSuffix(line, "\r"), "=")
			if !ok {
				continue
			}
			if key == "Path" && !pathSeen {
				pathSeen = true
				path, err := url.PathUnescape(value)
				if err == nil && filepath.IsAbs(path) && filepath.Clean(path) == path && path != "/" && !strings.ContainsRune(path, 0) {
					item.OriginalPath = path
					item.Name = filepath.Base(path)
					item.CanRestore = true
				}
			}
			if key == "DeletionDate" && !dateSeen {
				dateSeen = true
				if date, err := time.ParseInLocation("2006-01-02T15:04:05", value, time.Local); err == nil {
					item.DeletedAt = date.Format(time.RFC3339)
				}
			}
		}
	}
	inode := uint64(0)
	if stat, ok := info.Sys().(*syscall.Stat_t); ok {
		inode = stat.Ino
	}
	item.Revision = fmt.Sprintf("sha256:%x", sha256.Sum256([]byte(fmt.Sprintf("%s|%d|%d|%d|%s", id, inode, info.ModTime().UnixNano(), info.Size(), metadata))))
	return item, nil
}

func RestoreTrash(selection TrashSelection) (string, error) {
	trashMu.Lock()
	defer trashMu.Unlock()
	root, dir, err := openTrash(false)
	if err != nil {
		return "", err
	}
	defer root.Close()
	item, err := checkedTrashItem(root, selection)
	if err != nil {
		return "", err
	}
	if !item.CanRestore {
		return "", fmt.Errorf("%w: original location is unavailable; this item cannot be restored automatically", ErrValidation)
	}
	parent, err := filepath.EvalSymlinks(filepath.Dir(item.OriginalPath))
	if err != nil {
		return "", fmt.Errorf("original folder is unavailable: %w", err)
	}
	target := filepath.Join(parent, filepath.Base(item.OriginalPath))
	if within(target, dir) || within(dir, target) {
		return "", fmt.Errorf("%w: invalid restore location", ErrValidation)
	}
	if err := renameExclusive(filepath.Join(dir, "files", item.ID), target); err != nil {
		return "", &os.LinkError{Op: "restore", Old: item.ID, New: target, Err: err}
	}
	_ = root.Remove("info/" + item.ID + ".trashinfo")
	return item.OriginalPath, nil
}

func checkedTrashItem(root *os.Root, selection TrashSelection) (TrashItem, error) {
	item, err := readTrashItem(root, selection.ID)
	if err != nil {
		return TrashItem{}, err
	}
	if selection.Revision == "" || selection.Revision != item.Revision {
		return TrashItem{}, fmt.Errorf("%w: this Trash item changed; refresh and try again", ErrStaleRevision)
	}
	return item, nil
}

func DeleteTrash(selections []TrashSelection) error {
	if len(selections) == 0 || len(selections) > 10000 {
		return fmt.Errorf("%w: select between 1 and 10000 Trash items", ErrValidation)
	}
	trashMu.Lock()
	defer trashMu.Unlock()
	root, _, err := openTrash(false)
	if err != nil {
		return err
	}
	defer root.Close()
	for _, selection := range selections {
		if _, err := checkedTrashItem(root, selection); err != nil {
			return err
		}
	}
	for _, selection := range selections {
		if err := root.RemoveAll("files/" + selection.ID); err != nil {
			return err
		}
		if err := root.Remove("info/" + selection.ID + ".trashinfo"); err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	return nil
}

func trashEscape(p string) string { return strings.ReplaceAll(url.PathEscape(p), "%2F", "/") }
