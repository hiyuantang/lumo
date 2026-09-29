// SPDX-License-Identifier: AGPL-3.0-only
package apptrash

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"lumo/server/internal/files"
)

var idPattern = regexp.MustCompile(`^apptrash_[a-f0-9]{24}$`)
var targets = map[string][]string{
	"docker": {"/etc/docker", "/var/lib/docker"},
	"git":    {"/etc/gitconfig"},
	"nginx":  {"/etc/nginx", "/var/cache/nginx", "/var/lib/nginx", "/var/log/nginx"},
}

type record struct {
	ID        string   `json:"id"`
	App       string   `json:"app"`
	Paths     []string `json:"paths"`
	DeletedAt string   `json:"deletedAt"`
}

type Store struct {
	Root   string
	FSRoot string
	Mounts string
	mu     sync.Mutex
}

func New(root string) *Store             { return &Store{Root: root, FSRoot: "/", Mounts: "/proc/self/mountinfo"} }
func (s *Store) host(path string) string { return filepath.Join(s.FSRoot, path) }
func (s *Store) directory(uid uint32) string {
	return filepath.Join(s.Root, strconv.FormatUint(uint64(uid), 10))
}

func (s *Store) protected(path string) error {
	for current := filepath.Clean(path); ; current = filepath.Dir(current) {
		info, err := os.Lstat(current)
		if err != nil {
			return err
		}
		stat, ok := info.Sys().(*syscall.Stat_t)
		if !ok || info.Mode()&os.ModeSymlink != 0 || stat.Uid != uint32(os.Geteuid()) || info.Mode().Perm()&0o022 != 0 {
			return fmt.Errorf("refusing unprotected app storage: %s", current)
		}
		if current == s.FSRoot || current == "/" {
			return nil
		}
	}
}

func (s *Store) Check(app string) error {
	if _, ok := targets[app]; !ok {
		return errors.New("unsupported app cleanup")
	}
	if app == "docker" {
		data, err := os.ReadFile(s.host("/etc/docker/daemon.json"))
		if err != nil && !os.IsNotExist(err) {
			return err
		}
		if err == nil {
			var config map[string]json.RawMessage
			if err := json.Unmarshal(data, &config); err != nil {
				return errors.New("Docker configuration could not be checked; use normal uninstall")
			}
			var root string
			if raw, exists := config["data-root"]; exists {
				if err := json.Unmarshal(raw, &root); err != nil || (root != "" && root != "/var/lib/docker") {
					return errors.New("Docker uses a custom data folder; use normal uninstall and manage that folder separately")
				}
			}
			var features map[string]bool
			if raw := config["features"]; raw != nil {
				if err := json.Unmarshal(raw, &features); err != nil || features["containerd-snapshotter"] {
					return errors.New("Docker uses shared containerd storage; use normal uninstall to preserve other workloads")
				}
			}
		}
	}
	for _, path := range targets[app] {
		host := s.host(path)
		if _, err := os.Lstat(host); os.IsNotExist(err) {
			continue
		} else if err != nil {
			return err
		}
		if err := s.protected(host); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) noMounts(paths []string) error {
	if s.Mounts == "" {
		return nil
	}
	data, err := os.ReadFile(s.Mounts)
	if err != nil {
		return err
	}
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 5 {
			continue
		}
		mount := strings.NewReplacer(`\040`, " ", `\011`, "\t", `\012`, "\n", `\134`, `\`).Replace(fields[4])
		for _, path := range paths {
			if mount == s.host(path) || strings.HasPrefix(mount, s.host(path)+"/") {
				return fmt.Errorf("%s still contains a mounted filesystem; unmount it before cleaning app data", path)
			}
		}
	}
	return nil
}

func (s *Store) Move(app string, uid uint32) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.Check(app); err != nil {
		return err
	}
	paths := []string{}
	for _, path := range targets[app] {
		if _, err := os.Lstat(s.host(path)); os.IsNotExist(err) {
			continue
		} else if err != nil {
			return err
		}
		paths = append(paths, path)
	}
	if len(paths) == 0 {
		return nil
	}
	if err := s.noMounts(paths); err != nil {
		return err
	}
	directory := s.directory(uid)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return err
	}
	if err := s.protected(directory); err != nil {
		return err
	}
	random := make([]byte, 12)
	if _, err := rand.Read(random); err != nil {
		return err
	}
	item := record{ID: "apptrash_" + hex.EncodeToString(random), App: app, Paths: paths, DeletedAt: time.Now().UTC().Format(time.RFC3339)}
	dir := filepath.Join(directory, item.ID)
	if err := os.Mkdir(dir, 0o700); err != nil {
		return err
	}
	data, _ := json.Marshal(item)
	metadata, err := os.OpenFile(filepath.Join(dir, "record.json"), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return err
	}
	if _, err = metadata.Write(data); err == nil {
		err = metadata.Sync()
	}
	closeErr := metadata.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	for _, path := range []string{dir, directory} {
		folder, err := os.Open(path)
		if err != nil {
			return err
		}
		err = folder.Sync()
		_ = folder.Close()
		if err != nil {
			return err
		}
	}
	for i, path := range paths {
		if _, err := files.Move(s.host(path), filepath.Join(dir, strconv.Itoa(i))); err != nil {
			for j := i - 1; j >= 0; j-- {
				if _, rollbackErr := files.Move(filepath.Join(dir, strconv.Itoa(j)), s.host(paths[j])); rollbackErr != nil {
					err = errors.Join(err, fmt.Errorf("%s remains recoverable in Trash: %w", paths[j], rollbackErr))
				}
			}
			return err
		}
	}
	return nil
}

func (s *Store) read(uid uint32, id string) (record, files.TrashItem, error) {
	if !idPattern.MatchString(id) {
		return record{}, files.TrashItem{}, errors.New("invalid app Trash item")
	}
	dir := filepath.Join(s.directory(uid), id)
	if err := s.protected(dir); err != nil {
		return record{}, files.TrashItem{}, err
	}
	raw, err := os.ReadFile(filepath.Join(dir, "record.json"))
	if err != nil {
		return record{}, files.TrashItem{}, err
	}
	var item record
	if err := json.Unmarshal(raw, &item); err != nil {
		return item, files.TrashItem{}, err
	}
	if item.ID != id || len(item.Paths) == 0 || len(item.Paths) > len(targets[item.App]) {
		return item, files.TrashItem{}, errors.New("invalid app Trash metadata")
	}
	allowed := map[string]bool{}
	for _, path := range targets[item.App] {
		allowed[path] = true
	}
	present := []string{}
	for i, path := range item.Paths {
		if !allowed[path] {
			return item, files.TrashItem{}, errors.New("invalid app Trash location")
		}
		delete(allowed, path)
		if _, err := os.Lstat(filepath.Join(dir, strconv.Itoa(i))); err == nil {
			present = append(present, path)
		} else if !os.IsNotExist(err) {
			return item, files.TrashItem{}, err
		}
	}
	if len(present) == 0 {
		return item, files.TrashItem{}, os.ErrNotExist
	}
	sum := sha256.Sum256(append(raw, []byte(strings.Join(present, "\n"))...))
	name := "Nginx settings and data"
	if item.App == "docker" {
		name = "Docker settings and data"
	}
	return item, files.TrashItem{ID: id, Name: name, OriginalPath: strings.Join(present, ", "), DeletedAt: item.DeletedAt, Type: "directory", Revision: hex.EncodeToString(sum[:]), CanRestore: true}, nil
}

func (s *Store) List(uid uint32) ([]files.TrashItem, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	directory := s.directory(uid)
	entries, err := os.ReadDir(directory)
	if os.IsNotExist(err) {
		return []files.TrashItem{}, nil
	}
	if err != nil {
		return nil, err
	}
	if err := s.protected(directory); err != nil {
		return nil, err
	}
	result := []files.TrashItem{}
	for _, entry := range entries {
		if !idPattern.MatchString(entry.Name()) {
			continue
		}
		_, item, err := s.read(uid, entry.Name())
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, nil
}

func (s *Store) Restore(uid uint32, selected files.TrashSelection) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	item, view, err := s.read(uid, selected.ID)
	if err != nil {
		return "", err
	}
	if selected.Revision != view.Revision {
		return "", errors.New("Trash item changed; refresh and try again")
	}
	dir := filepath.Join(s.directory(uid), item.ID)
	indices := []int{}
	for i, path := range item.Paths {
		if _, err := os.Lstat(filepath.Join(dir, strconv.Itoa(i))); os.IsNotExist(err) {
			continue
		} else if err != nil {
			return "", err
		}
		if err := s.protected(filepath.Dir(s.host(path))); err != nil {
			return "", err
		}
		if _, err := os.Lstat(s.host(path)); !os.IsNotExist(err) {
			return "", fmt.Errorf("%s already exists; move it before restoring", path)
		}
		indices = append(indices, i)
	}
	moved := []int{}
	for _, i := range indices {
		if _, err := files.Move(filepath.Join(dir, strconv.Itoa(i)), s.host(item.Paths[i])); err != nil {
			for j := len(moved) - 1; j >= 0; j-- {
				index := moved[j]
				if _, rollbackErr := files.Move(s.host(item.Paths[index]), filepath.Join(dir, strconv.Itoa(index))); rollbackErr != nil {
					err = errors.Join(err, rollbackErr)
				}
			}
			return "", err
		}
		moved = append(moved, i)
	}
	_ = os.Remove(filepath.Join(dir, "record.json"))
	_ = os.Remove(dir)
	return view.OriginalPath, nil
}

func (s *Store) Delete(uid uint32, selected []files.TrashSelection) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, selection := range selected {
		_, item, err := s.read(uid, selection.ID)
		if err != nil {
			return err
		}
		if item.Revision != selection.Revision {
			return errors.New("Trash item changed; refresh and try again")
		}
	}
	for _, selection := range selected {
		if err := os.RemoveAll(filepath.Join(s.directory(uid), selection.ID)); err != nil {
			return err
		}
	}
	return nil
}
