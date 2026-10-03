// SPDX-License-Identifier: AGPL-3.0-only
package appplugins

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"syscall"
	"time"
)

type Bundle struct {
	Name     string            `json:"name"`
	Manifest json.RawMessage   `json:"manifest"`
	Files    map[string][]byte `json:"files"`
}
type Selection struct {
	Receipts  []Receipt `json:"receipts,omitempty"`
	Installed bool      `json:"installed"`
	Digest    string    `json:"digest"`
	Previous  string    `json:"previous,omitempty"`
	Revision  string    `json:"revision"`
	History   []History `json:"history"`
}
type History struct {
	From string `json:"from"`
	To   string `json:"to"`
	At   string `json:"at"`
}
type Release struct {
	Digest   string   `json:"digest"`
	Manifest Manifest `json:"manifest"`
}
type CatalogEntry struct {
	Name      string    `json:"name"`
	Installed bool      `json:"installed"`
	Current   *Release  `json:"current,omitempty"`
	Releases  []Release `json:"releases"`
	Revision  string    `json:"revision"`
	Previous  string    `json:"previous,omitempty"`
	History   []History `json:"history"`
	Error     string    `json:"error,omitempty"`
}
type Change struct {
	RequestID string `json:"requestId,omitempty"`
	Name      string `json:"name"`
	Action    string `json:"action"`
	Digest    string `json:"digest"`
	Revision  string `json:"revision"`
	Trust     bool   `json:"trust"`
	Clean     bool   `json:"clean"`
}

var ErrConflict = errors.New("app selection changed; refresh and try again")

func StoreRoot(home string) string           { return filepath.Join(home, ".local/share/lumo/native-plugins") }
func DataDirectory(home, name string) string { return filepath.Join(StoreRoot(home), "data", name) }
func selection(home, name string) (Selection, bool, error) {
	raw, err := os.ReadFile(filepath.Join(StoreRoot(home), "selections", name+".json"))
	if os.IsNotExist(err) {
		return Selection{}, false, nil
	}
	if err != nil {
		return Selection{}, false, err
	}
	var s Selection
	err = json.Unmarshal(raw, &s)
	return s, true, err
}
func LoadFor(home, name string) (*Package, error) {
	if Required(name) {
		return Load(name)
	}
	if !ValidName(name) {
		return nil, errors.New("invalid app name")
	}
	s, ok, err := selection(home, name)
	if err != nil {
		return nil, err
	}
	if !ok {
		return Load(name)
	}
	if !s.Installed {
		return nil, os.ErrNotExist
	}
	return release(home, name, s.Digest)
}
func NamesFor(home string) []string {
	found := map[string]bool{}
	for _, name := range append(Names(), namesIn([]string{filepath.Join(StoreRoot(home), "packages")})...) {
		found[name] = true
	}
	result := []string{}
	for name := range found {
		if _, err := LoadFor(home, name); err == nil {
			result = append(result, name)
		}
	}
	sort.Strings(result)
	return result
}
func release(home, name, digest string) (*Package, error) {
	if !ValidName(name) || !regexpDigest(digest) {
		return nil, errors.New("invalid app release")
	}
	directory := filepath.Join(StoreRoot(home), "packages", name, digest)
	raw, err := os.ReadFile(filepath.Join(directory, "manifest.json"))
	if err != nil {
		return nil, err
	}
	if manifestDigest(raw) != digest {
		return nil, errors.New("damaged app manifest")
	}
	return Parse(name, directory, raw)
}
func regexpDigest(value string) bool {
	if len(value) != 64 {
		return false
	}
	for _, c := range value {
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f') {
			return false
		}
	}
	return true
}
func describe(p *Package) (Release, error) {
	raw, err := os.ReadFile(filepath.Join(p.Directory, "manifest.json"))
	return Release{Digest: manifestDigest(raw), Manifest: p.Manifest}, err
}
func Import(home string, b Bundle) (result Release, err error) {
	err = locked(home, func() error { var e error; result, e = importBundle(home, b); return e })
	return
}
func importBundle(home string, b Bundle) (Release, error) {
	if Required(b.Name) {
		return Release{}, errors.New("required apps are managed with Lumo and cannot be imported per account")
	}
	if !ValidName(b.Name) || len(b.Files) > 16 || len(b.Manifest) > 65536 {
		return Release{}, errors.New("invalid app package")
	}
	root := filepath.Join(StoreRoot(home), "packages", b.Name)
	if err := os.MkdirAll(root, 0700); err != nil {
		return Release{}, err
	}
	temp, err := os.MkdirTemp(root, ".import-")
	if err != nil {
		return Release{}, err
	}
	defer os.RemoveAll(temp)
	p, err := Parse(b.Name, temp, b.Manifest)
	if err != nil {
		return Release{}, err
	}
	for _, app := range Catalog(home) {
		if app.Name == b.Name {
			for _, existing := range app.Releases {
				if existing.Manifest.Version == p.Manifest.Version && existing.Digest != manifestDigest(b.Manifest) {
					return Release{}, errors.New("a different package already uses this version; increase the app version")
				}
			}
		}
	}
	total := 0
	for _, name := range p.Assets() {
		bytes, ok := b.Files[name]
		total += len(bytes)
		if !ok || !assetName.MatchString(name) || total > 64<<20 {
			return Release{}, errors.New("missing or oversized app asset")
		}
		mode := os.FileMode(0600)
		if strings.HasSuffix(name, ".bin") {
			mode = 0700
		}
		if err = os.WriteFile(filepath.Join(temp, name), bytes, mode); err != nil {
			return Release{}, err
		}
	}
	if err = p.Validate(); err != nil {
		return Release{}, err
	}
	if err = os.WriteFile(filepath.Join(temp, "manifest.json"), b.Manifest, 0600); err != nil {
		return Release{}, err
	}
	result, _ := describe(p)
	destination := filepath.Join(root, result.Digest)
	if existing, err := release(home, b.Name, result.Digest); err == nil {
		if err = existing.Validate(); err != nil {
			return Release{}, err
		}
		return result, nil
	}
	if err = os.Rename(temp, destination); err != nil {
		return Release{}, err
	}
	return result, nil
}
func Catalog(home string) []CatalogEntry {
	names := map[string]bool{}
	for _, name := range append(Names(), namesIn([]string{filepath.Join(StoreRoot(home), "packages")})...) {
		names[name] = true
	}
	result := []CatalogEntry{}
	for name := range names {
		item := CatalogEntry{Name: name, Releases: []Release{}, History: []History{}}
		available := map[string]Release{}
		for _, root := range Roots() {
			if p, err := loadRoots(name, []string{root}); err == nil {
				if r, err := describe(p); err == nil {
					available[r.Digest] = r
				}
			}
		}
		entries, _ := os.ReadDir(filepath.Join(StoreRoot(home), "packages", name))
		for _, entry := range entries {
			if p, err := release(home, name, entry.Name()); err == nil {
				r, _ := describe(p)
				available[r.Digest] = r
			}
		}
		s, ok, err := selection(home, name)
		if err != nil {
			item.Error = err.Error()
		}
		if ok {
			item.Revision = s.Revision
			item.Previous = s.Previous
			item.History = s.History
		}
		if p, err := LoadFor(home, name); err == nil {
			r, _ := describe(p)
			item.Current = &r
			item.Installed = true
		} else if !os.IsNotExist(err) {
			item.Error = err.Error()
		}
		for _, r := range available {
			item.Releases = append(item.Releases, r)
		}
		sort.Slice(item.Releases, func(i, j int) bool {
			a, b := item.Releases[i], item.Releases[j]
			if a.Manifest.Version == b.Manifest.Version {
				return a.Digest < b.Digest
			}
			return newer(a.Manifest.Version, b.Manifest.Version)
		})
		result = append(result, item)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Name < result[j].Name })
	return result
}
func newer(a, b string) bool {
	var av, bv [3]int
	fmt.Sscanf(a, "%d.%d.%d", &av[0], &av[1], &av[2])
	fmt.Sscanf(b, "%d.%d.%d", &bv[0], &bv[1], &bv[2])
	for i := range av {
		if av[i] != bv[i] {
			return av[i] > bv[i]
		}
	}
	return false
}
func capture(home, name, digest string) (*Package, error) {
	if p, err := release(home, name, digest); err == nil {
		return p, nil
	}
	for _, root := range Roots() {
		p, err := loadRoots(name, []string{root})
		if err != nil {
			continue
		}
		r, _ := describe(p)
		if r.Digest != digest {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(p.Directory, "manifest.json"))
		if err != nil {
			return nil, err
		}
		b := Bundle{Name: name, Manifest: raw, Files: map[string][]byte{}}
		for _, file := range p.Assets() {
			bytes, err := p.Asset(file)
			if err != nil {
				return nil, err
			}
			b.Files[file] = bytes
		}
		if _, err = importBundle(home, b); err != nil {
			return nil, err
		}
		return release(home, name, digest)
	}
	return nil, errors.New("app release unavailable; import its package")
}
func Apply(home string, c Change) error { return locked(home, func() error { return apply(home, c) }) }
func apply(home string, c Change) error {
	if Required(c.Name) {
		return errors.New("required apps are managed with Lumo and cannot be removed or replaced per account")
	}
	if !ValidName(c.Name) {
		return errors.New("invalid app name")
	}
	s, _, err := selection(home, c.Name)
	if err != nil {
		return err
	}
	if len(c.RequestID) > 128 || strings.ContainsAny(c.RequestID, "\r\n\t ") {
		return errors.New("invalid request ID")
	}
	rawChange, _ := json.Marshal(c)
	changeHash := fmt.Sprintf("%x", sha256.Sum256(rawChange))
	for _, receipt := range s.Receipts {
		if c.RequestID != "" && receipt.ID == c.RequestID {
			if receipt.Hash != changeHash {
				return errors.New("request ID was used with different content")
			}
			return nil
		}
	}
	if s.Revision != c.Revision {
		return ErrConflict
	}
	current, _ := LoadFor(home, c.Name)
	oldVersion := ""
	oldDigest := ""
	if current != nil {
		r, _ := describe(current)
		oldVersion = r.Manifest.Version
		oldDigest = r.Digest
	}
	switch c.Action {
	case "install", "update", "rollback":
		if !c.Trust {
			return errors.New("trust this app's account access before installing")
		}
		target := c.Digest
		if c.Action == "rollback" {
			target = s.Previous
		}
		p, err := capture(home, c.Name, target)
		if err != nil {
			return err
		}
		if err = p.Validate(); err != nil {
			return err
		}
		if oldDigest != "" && oldDigest != target {
			if _, err = capture(home, c.Name, oldDigest); err != nil {
				return err
			}
		}
		s.Installed = true
		s.Digest = target
		if oldDigest != target {
			s.Previous = oldDigest
		}
		s.History = append(s.History, History{From: oldVersion, To: p.Manifest.Version, At: time.Now().UTC().Format(time.RFC3339)})
	case "uninstall":
		if c.Clean {
			if err = trashData(home, c.Name); err != nil {
				return err
			}
		}
		s.Installed = false
		s.Digest = ""
		s.Previous = oldDigest
	default:
		return errors.New("invalid app change")
	}
	if len(s.History) > 50 {
		s.History = s.History[len(s.History)-50:]
	}
	if c.RequestID != "" {
		s.Receipts = append(s.Receipts, Receipt{ID: c.RequestID, Hash: changeHash})
		if len(s.Receipts) > 64 {
			s.Receipts = s.Receipts[len(s.Receipts)-64:]
		}
	}
	s.Revision = fmt.Sprintf("%d", time.Now().UnixNano())
	directory := filepath.Join(StoreRoot(home), "selections")
	if err = os.MkdirAll(directory, 0700); err != nil {
		return err
	}
	raw, _ := json.Marshal(s)
	f, err := os.CreateTemp(directory, ".selection-")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	_, err = f.Write(raw)
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(f.Name(), filepath.Join(directory, c.Name+".json"))
}
func trashData(home, name string) error {
	source := DataDirectory(home, name)
	if _, err := os.Lstat(source); os.IsNotExist(err) {
		return nil
	} else if err != nil {
		return err
	}
	trash := filepath.Join(home, ".local/share/Trash")
	for _, part := range []string{"files", "info"} {
		if err := os.MkdirAll(filepath.Join(trash, part), 0700); err != nil {
			return err
		}
	}
	label := fmt.Sprintf("plugin-%s-%d", name, time.Now().UnixNano())
	info := filepath.Join(trash, "info", label+".trashinfo")
	text := "[Trash Info]\nPath=" + url.PathEscape(source) + "\nDeletionDate=" + time.Now().Format("2006-01-02T15:04:05") + "\n"
	if err := os.WriteFile(info, []byte(text), 0600); err != nil {
		return err
	}
	if err := os.Rename(source, filepath.Join(trash, "files", label)); err != nil {
		os.Remove(info)
		return err
	}
	return nil
}

func manifestDigest(raw []byte) string {
	var value any
	if json.Unmarshal(raw, &value) != nil {
		return ""
	}
	canonical, err := json.Marshal(value)
	if err != nil {
		return ""
	}
	return fmt.Sprintf("%x", sha256.Sum256(canonical))
}

type Receipt struct {
	ID   string `json:"id"`
	Hash string `json:"hash"`
}

func locked(home string, run func() error) error {
	if err := os.MkdirAll(StoreRoot(home), 0700); err != nil {
		return err
	}
	file, err := os.OpenFile(filepath.Join(StoreRoot(home), ".lock"), os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return err
	}
	defer file.Close()
	if err = syscall.Flock(int(file.Fd()), syscall.LOCK_EX); err != nil {
		return err
	}
	defer syscall.Flock(int(file.Fd()), syscall.LOCK_UN)
	return run()
}
func Staged(home, name, digest string) (*Package, error) { return release(home, name, digest) }

func Replay(home string, c Change) (bool, error) {
	if !ValidName(c.Name) {
		return false, errors.New("invalid app name")
	}
	s, _, err := selection(home, c.Name)
	if err != nil {
		return false, err
	}
	raw, _ := json.Marshal(c)
	hash := fmt.Sprintf("%x", sha256.Sum256(raw))
	for _, receipt := range s.Receipts {
		if c.RequestID != "" && receipt.ID == c.RequestID {
			if receipt.Hash != hash {
				return false, errors.New("request ID was used with different content")
			}
			return true, nil
		}
	}
	return false, nil
}
