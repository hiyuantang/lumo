// SPDX-License-Identifier: AGPL-3.0-only
package desktopapps

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"lumo/server/internal/files"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"syscall"
	"time"
)

var ErrInvalid = errors.New("Invalid desktop app package or request.")
var ErrConflict = errors.New("The app changed. Refresh before retrying.")
var ErrMissing = errors.New("The app or build is unavailable.")
var idPattern = regexp.MustCompile(`^local\.[a-z][a-z0-9-]{0,63}$`)
var digestPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)
var versionPattern = regexp.MustCompile(`^[0-9]+\.[0-9]+\.[0-9]+$`)

func ValidDigest(s string) bool { return digestPattern.MatchString(s) }
func Token() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

type Capability struct {
	Name string `json:"name"`
}
type Window struct {
	Width     int `json:"width"`
	Height    int `json:"height"`
	MinWidth  int `json:"minWidth"`
	MinHeight int `json:"minHeight"`
}
type Manifest struct {
	SchemaVersion int          `json:"schemaVersion"`
	ID            string       `json:"id"`
	Name          string       `json:"name"`
	Version       string       `json:"version"`
	Description   string       `json:"description"`
	License       string       `json:"license"`
	APIVersion    int          `json:"apiVersion"`
	Entry         string       `json:"entry"`
	Styles        string       `json:"styles"`
	Window        Window       `json:"window"`
	Capabilities  []Capability `json:"capabilities"`
}
type Bundle struct {
	Manifest Manifest `json:"manifest"`
	Digest   string   `json:"digest"`
	JS       string   `json:"js,omitempty"`
	CSS      string   `json:"css,omitempty"`
}
type History struct {
	From string `json:"from"`
	To   string `json:"to"`
	At   string `json:"at"`
}
type App struct {
	Manifest Manifest  `json:"manifest"`
	Digest   string    `json:"digest"`
	Previous string    `json:"previous,omitempty"`
	Revision string    `json:"revision"`
	Enabled  bool      `json:"enabled"`
	History  []History `json:"history"`
}
type Catalog struct {
	Apps   []App    `json:"apps"`
	Builds []Bundle `json:"builds"`
}
type Change struct {
	RequestID string `json:"requestId"`
	Action    string `json:"action"`
	ID        string `json:"id"`
	Digest    string `json:"digest,omitempty"`
	Revision  string `json:"revision"`
	Clean     bool   `json:"clean,omitempty"`
}
type receipt struct {
	At   int64  `json:"at"`
	Hash string `json:"hash"`
	App  App    `json:"app"`
}
type state struct {
	Builds   map[string]Bundle  `json:"builds"`
	Removed  map[string]bool    `json:"removed,omitempty"`
	Apps     map[string]App     `json:"apps"`
	Receipts map[string]receipt `json:"receipts"`
}
type Store struct {
	Home string
	Dir  string
}

func New(home string) *Store {
	return &Store{Home: home, Dir: filepath.Join(home, ".local", "share", "lumo", "desktop-apps")}
}
func strict(data []byte, v any) error {
	d := json.NewDecoder(bytes.NewReader(data))
	d.DisallowUnknownFields()
	if err := d.Decode(v); err != nil {
		return ErrInvalid
	}
	if d.Decode(new(any)) != io.EOF {
		return ErrInvalid
	}
	return nil
}
func hash(data []byte) string { h := sha256.Sum256(data); return hex.EncodeToString(h[:]) }
func atomicWrite(path string, data []byte) error {
	f, e := os.CreateTemp(filepath.Dir(path), ".stage-")
	if e != nil {
		return e
	}
	defer os.Remove(f.Name())
	if _, e = f.Write(data); e == nil {
		e = f.Sync()
	}
	c := f.Close()
	if e != nil {
		return e
	}
	if c != nil {
		return c
	}
	if e = os.Rename(f.Name(), path); e != nil {
		return e
	}
	dir, e := os.Open(filepath.Dir(path))
	if e != nil {
		return e
	}
	defer dir.Close()
	return dir.Sync()
}
func (s *Store) locked(fn func(*state) error) error {
	if e := os.MkdirAll(filepath.Join(s.Dir, "builds"), 0700); e != nil {
		return e
	}
	f, e := os.OpenFile(filepath.Join(s.Dir, ".lock"), os.O_CREATE|os.O_RDWR, 0600)
	if e != nil {
		return e
	}
	defer f.Close()
	if e = syscall.Flock(int(f.Fd()), syscall.LOCK_EX); e != nil {
		return e
	}
	defer syscall.Flock(int(f.Fd()), syscall.LOCK_UN)
	st := state{Apps: map[string]App{}, Receipts: map[string]receipt{}}
	data, e := os.ReadFile(filepath.Join(s.Dir, "state.json"))
	if e == nil {
		if len(data) > 4<<20 {
			return ErrInvalid
		}
		if e = strict(data, &st); e != nil {
			return e
		}
	} else if !os.IsNotExist(e) {
		return e
	}
	if st.Apps == nil || st.Receipts == nil {
		return ErrInvalid
	}
	if st.Builds == nil {
		st.Builds = map[string]Bundle{}
	}
	if st.Removed == nil {
		st.Removed = map[string]bool{}
	}
	return fn(&st)
}
func validate(m Manifest) error {
	if len(m.Version) > 32 || m.SchemaVersion != 1 || m.APIVersion != 1 || !idPattern.MatchString(m.ID) || !versionPattern.MatchString(m.Version) || len(m.Name) < 1 || len(m.Name) > 80 || len(m.Description) > 500 || m.License != "AGPL-3.0-only" || m.Entry != "src/main.js" || m.Styles != "src/style.css" {
		return ErrInvalid
	}
	if strings.ContainsAny(m.Name, "\x00\r\n") || m.Window.MinWidth < 320 || m.Window.MinWidth > 1600 || m.Window.MinHeight < 240 || m.Window.MinHeight > 1200 || m.Window.Width < m.Window.MinWidth || m.Window.Width > 2400 || m.Window.Height < m.Window.MinHeight || m.Window.Height > 1600 {
		return ErrInvalid
	}
	if len(m.Capabilities) > 2 {
		return ErrInvalid
	}
	seen := map[string]bool{}
	for _, c := range m.Capabilities {
		if (c.Name != "system.metrics.read" && c.Name != "app.storage") || seen[c.Name] {
			return ErrInvalid
		}
		seen[c.Name] = true
	}
	return nil
}
func bundleDigest(b Bundle) string { b.Digest = ""; data, _ := json.Marshal(b); return hash(data) }
func (s *Store) bundle(digest string) (Bundle, error) {
	var b Bundle
	if !ValidDigest(digest) {
		return b, ErrInvalid
	}
	data, e := os.ReadFile(filepath.Join(s.Dir, "builds", digest+".json"))
	if os.IsNotExist(e) {
		return b, ErrMissing
	}
	if e != nil {
		return b, e
	}
	if len(data) > 3<<20 || strict(data, &b) != nil || validate(b.Manifest) != nil || b.Digest != digest || bundleDigest(b) != digest {
		return b, ErrInvalid
	}
	return b, nil
}
func (s *Store) Bundle(digest string) (Bundle, error) { return s.bundle(digest) }
func (s *Store) Stage(b Bundle) (Bundle, error) {
	if validate(b.Manifest) != nil || len(b.JS) == 0 || len(b.JS) > 1<<20 || len(b.CSS) > 128<<10 {
		return Bundle{}, ErrInvalid
	}
	b.Digest = bundleDigest(b)
	err := s.locked(func(st *state) error {
		if len(st.Builds) >= 64 {
			if _, ok := st.Builds[b.Digest]; !ok {
				return errors.New("Build storage is full. Remove unused apps before building more versions.")
			}
		}
		for _, old := range st.Builds {
			if old.Manifest.ID == b.Manifest.ID && old.Manifest.Version == b.Manifest.Version && old.Digest != b.Digest {
				return errors.New("Increase the app version before changing an existing build.")
			}
		}
		data, _ := json.Marshal(b)
		if len(data) > 3<<20 {
			return ErrInvalid
		}
		if e := atomicWrite(filepath.Join(s.Dir, "builds", b.Digest+".json"), data); e != nil {
			return e
		}
		metadata := b
		metadata.JS = ""
		metadata.CSS = ""
		st.Builds[b.Digest] = metadata
		delete(st.Removed, b.Digest)
		stateData, _ := json.Marshal(st)
		return atomicWrite(filepath.Join(s.Dir, "state.json"), stateData)
	})
	return b, err
}
func (s *Store) Catalog() (Catalog, error) {
	result := Catalog{Apps: []App{}, Builds: []Bundle{}}
	err := s.locked(func(st *state) error {
		for _, app := range st.Apps {
			if validate(app.Manifest) != nil {
				return ErrInvalid
			}
			result.Apps = append(result.Apps, app)
		}
		for digest, b := range st.Builds {
			if st.Removed[digest] {
				continue
			}
			if validate(b.Manifest) != nil || !ValidDigest(digest) {
				return ErrInvalid
			}
			if _, e := os.Lstat(filepath.Join(s.Dir, "builds", digest+".json")); e != nil {
				continue
			}
			result.Builds = append(result.Builds, b)
		}
		return nil
	})
	sort.Slice(result.Apps, func(i, j int) bool { return result.Apps[i].Manifest.Name < result.Apps[j].Manifest.Name })
	sort.Slice(result.Builds, func(i, j int) bool { return result.Builds[i].Manifest.Version > result.Builds[j].Manifest.Version })
	return result, err
}
func (s *Store) Change(req Change) (App, error) {
	var result App
	if !idPattern.MatchString(req.ID) || len(req.RequestID) < 8 || len(req.RequestID) > 128 {
		return result, ErrInvalid
	}
	raw, _ := json.Marshal(req)
	fingerprint := hash(raw)
	err := s.locked(func(st *state) error {
		for key, entry := range st.Receipts {
			if entry.At > 0 && time.Since(time.Unix(entry.At, 0)) > 24*time.Hour {
				delete(st.Receipts, key)
			}
		}
		if old, ok := st.Receipts[req.RequestID]; ok {
			if old.Hash != fingerprint {
				return ErrConflict
			}
			result = old.App
			return nil
		}
		if len(st.Receipts) >= 2048 {
			return errors.New("Too many app operations in this catalog. Try again after older operation receipts expire.")
		}
		app, exists := st.Apps[req.ID]
		if app.Revision != req.Revision {
			return ErrConflict
		}
		switch req.Action {
		case "install", "restore":
			digest := req.Digest
			if req.Action == "restore" {
				digest = app.Previous
			}
			if _, staged := st.Builds[digest]; !staged || st.Removed[digest] {
				return ErrMissing
			}
			b, e := s.bundle(digest)
			if e != nil {
				return e
			}
			if b.Manifest.ID != req.ID {
				return ErrInvalid
			}
			if !exists && len(st.Apps) >= 32 {
				return ErrInvalid
			}
			from := ""
			if exists {
				from = app.Manifest.Version
			}
			previous := app.Digest
			if previous == digest {
				previous = app.Previous
			}
			app = App{Manifest: b.Manifest, Digest: digest, Previous: previous, Enabled: true, History: append(app.History, History{From: from, To: b.Manifest.Version, At: time.Now().UTC().Format(time.RFC3339)})}
			if len(app.History) > 20 {
				app.History = app.History[len(app.History)-20:]
			}
		case "disable", "enable":
			if !exists {
				return ErrMissing
			}
			app.Enabled = req.Action == "enable"
		case "uninstall":
			if !exists {
				return ErrMissing
			}
			app.Enabled = false
		default:
			return ErrInvalid
		}
		app.Revision = Token()
		result = app
		if req.Action == "uninstall" {
			archive, e := os.MkdirTemp(s.Dir, "removed-"+req.ID+"-")
			if e != nil {
				return e
			}
			defer os.RemoveAll(archive)
			for digest, build := range st.Builds {
				if build.Manifest.ID != req.ID {
					continue
				}
				if !ValidDigest(digest) {
					return ErrInvalid
				}
				data, e := os.ReadFile(filepath.Join(s.Dir, "builds", digest+".json"))
				if e != nil && !os.IsNotExist(e) {
					return e
				}
				if e == nil {
					if e = os.WriteFile(filepath.Join(archive, digest+".json"), data, 0600); e != nil {
						return e
					}
				}
				st.Removed[digest] = true
				delete(st.Builds, digest)
			}
			snapshot, _ := json.Marshal(app)
			if e = os.WriteFile(filepath.Join(archive, "app.json"), snapshot, 0600); e != nil {
				return e
			}
			if _, e = files.Trash(archive); e != nil {
				return e
			}
			if req.Clean {
				dataPath := filepath.Join(s.Dir, "data", req.ID)
				if _, e = os.Lstat(dataPath); e == nil {
					if _, e = files.Trash(dataPath); e != nil {
						return e
					}
				} else if !os.IsNotExist(e) {
					return e
				}
			}
			delete(st.Apps, req.ID)
		} else {
			st.Apps[req.ID] = app
		}
		st.Receipts[req.RequestID] = receipt{Hash: fingerprint, App: result, At: time.Now().Unix()}
		data, _ := json.Marshal(st)
		if e := atomicWrite(filepath.Join(s.Dir, "state.json"), data); e != nil {
			return e
		}
		for digest := range st.Removed {
			_ = os.Remove(filepath.Join(s.Dir, "builds", digest+".json"))
		}
		return nil
	})
	return result, err
}
func (s *Store) Check(digest string, preview bool) (Bundle, error) {
	b, e := s.bundle(digest)
	if e != nil {
		return b, e
	}
	e = s.locked(func(st *state) error {
		if st.Removed[digest] {
			return ErrMissing
		}
		if preview {
			if _, ok := st.Builds[digest]; ok {
				return nil
			}
			return ErrMissing
		}
		for _, a := range st.Apps {
			if a.Digest == digest && a.Enabled {
				return nil
			}
		}
		return ErrMissing
	})
	return b, e
}
func (s *Store) Revision(digest string) (string, error) {
	revision := ""
	e := s.locked(func(st *state) error {
		for _, app := range st.Apps {
			if app.Digest == digest && app.Enabled {
				revision = app.Revision
			}
		}
		return nil
	})
	return revision, e
}
func (s *Store) Report(digest, status, message string) error {
	if !ValidDigest(digest) || len(message) > 2000 || (status != "ready" && status != "error") {
		return ErrInvalid
	}
	data, _ := json.Marshal(map[string]string{"digest": digest, "status": status, "message": message, "at": time.Now().UTC().Format(time.RFC3339)})
	return atomicWrite(filepath.Join(s.Dir, digest+".status.json"), data)
}
func (s *Store) Status(digest string) (json.RawMessage, error) {
	if !ValidDigest(digest) {
		return nil, ErrInvalid
	}
	b, e := os.ReadFile(filepath.Join(s.Dir, digest+".status.json"))
	if os.IsNotExist(e) {
		return json.RawMessage(`{"status":"not-opened"}`), nil
	}
	return b, e
}
func API() any {
	return map[string]any{"apiVersion": 1, "capabilities": []string{"system.metrics.read", "app.storage"}, "entry": "src/main.js", "styles": "src/style.css", "sdk": "await lumo.call('system.metrics.read') returns {cpuPercent,memoryUsedBytes,memoryTotalBytes,at}. Declare app.storage to use lumo.call('app.storage.get') returning {revision,value}, initially {revision:'',value:null}. Save with lumo.call('app.storage.set',{revision,value}) using the last revision; returns a new snapshot. Values are JSON up to 65536 UTF-8 bytes. Errors expose code, including conflict; reload before retrying. Preview storage is empty per launch and discarded on close; installed storage survives updates and normal uninstall, while clean uninstall moves it to Trash. Rollback changes code only; keep data backward compatible. lumo_app_create accepts template 'counter' or 'notes' for saved-data examples. Call lumo.setDirty(true) immediately when edits differ from saved data; clear it only after a successful save or explicit discard. Lumo then guards close, quit, logout and reload. Activation changes preserve dirty frames but revoke their old capabilities; let users copy their work before reloading. Browser unload prompts are best effort, not crash recovery. lumo.ready() reports successful rendering. document.documentElement.dataset.theme follows Lumo. Source files are plain JavaScript and CSS. No imports, package scripts or downloads. Increase manifest.version for every changed build. lumo_app_status is diagnostic evidence, not independent visual verification."}
}
