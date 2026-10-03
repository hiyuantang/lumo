// SPDX-License-Identifier: AGPL-3.0-only
package appplugins

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
)

type AuthFlow struct {
	Start    string `json:"start"`
	Callback string `json:"callback"`
}
type Manifest struct {
	Auth           *AuthFlow  `json:"auth,omitempty"`
	SchemaVersion  int        `json:"schemaVersion"`
	HostAPIVersion int        `json:"hostApiVersion"`
	ID             string     `json:"id"`
	Version        string     `json:"version"`
	License        string     `json:"license"`
	Backend        *Backend   `json:"backend,omitempty"`
	Pi             *Extension `json:"pi,omitempty"`
}
type Backend struct {
	Privileged      bool     `json:"privileged,omitempty"`
	ProtocolVersion int      `json:"protocolVersion"`
	Entry           string   `json:"entry"`
	Platform        string   `json:"platform"`
	Routes          []string `json:"routes"`
	Serial          bool     `json:"serial"`
}
type Extension struct {
	Entry      string   `json:"entry"`
	Setting    string   `json:"setting"`
	ReadTools  []string `json:"readTools"`
	WriteTools []string `json:"writeTools"`
}
type Package struct {
	Name      string
	Directory string
	Manifest  Manifest
}

var names = map[string]string{"calendar": "calendar", "skills": "skills", "git": "git", "docker": "containers", "nginx": "websites", "monitor": "home"}
var assetName = regexp.MustCompile(`^[a-f0-9]{64}\.(bin|mjs)$`)
var version = regexp.MustCompile(`^\d+\.\d+\.\d+$`)

func Roots() []string {
	bundled := os.Getenv("LUMO_PLUGIN_BUNDLED_DIR")
	if bundled == "" {
		bundled = "/usr/local/lib/lumo/plugins"
		if exe, err := os.Executable(); err == nil {
			candidate := filepath.Join(filepath.Dir(exe), "plugins")
			if info, err := os.Stat(candidate); err == nil && info.IsDir() {
				bundled = candidate
			}
		}
	}
	override := os.Getenv("LUMO_PLUGIN_DIR")
	if override == "" {
		override = "/usr/local/lib/lumo/plugin-overrides"
	}
	return []string{override, bundled}
}
func Load(name string) (*Package, error) {
	if _, ok := names[name]; !ok {
		return nil, errors.New("unknown app plugin")
	}
	for _, directory := range Roots() {
		root, err := os.OpenRoot(directory)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return nil, err
		}
		raw, err := root.ReadFile(name + "/manifest.json")
		root.Close()
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return nil, err
		}
		var manifest Manifest
		if err = json.Unmarshal(raw, &manifest); err != nil {
			return nil, err
		}
		if manifest.ID != names[name] || manifest.SchemaVersion != 1 || manifest.HostAPIVersion != 1 || manifest.License != "AGPL-3.0-only" || !version.MatchString(manifest.Version) {
			return nil, errors.New("incompatible app plugin")
		}
		if name != "monitor" && manifest.Backend == nil {
			return nil, errors.New("incomplete app package")
		}
		if b := manifest.Backend; b != nil {
			if b.ProtocolVersion != 1 || b.Platform != runtime.GOOS+"/"+runtime.GOARCH || !assetName.MatchString(b.Entry) || !strings.HasSuffix(b.Entry, ".bin") {
				return nil, errors.New("incompatible app backend")
			}
			for _, route := range b.Routes {
				if !AllowedRoute(name, route) {
					return nil, errors.New("app route is outside its namespace")
				}
			}
		}
		if a := manifest.Auth; a != nil {
			if !AllowedRoute(name, "POST "+a.Start) || !AllowedRoute(name, "GET "+a.Callback) {
				return nil, errors.New("invalid app authentication paths")
			}
		}
		if p := manifest.Pi; p != nil {
			if p.Setting != name || !assetName.MatchString(p.Entry) || !strings.HasSuffix(p.Entry, ".mjs") {
				return nil, errors.New("invalid app extension")
			}
			for _, tool := range append(append([]string{}, p.ReadTools...), p.WriteTools...) {
				if !regexp.MustCompile(`^lumo_` + name + `_[a-z0-9_]+$`).MatchString(tool) {
					return nil, errors.New("invalid app tool name")
				}
			}
		}
		return &Package{Name: name, Directory: filepath.Join(directory, name), Manifest: manifest}, nil
	}
	return nil, os.ErrNotExist
}
func AllowedRoute(name, route string) bool {
	parts := strings.Split(route, " ")
	if len(parts) != 2 || (parts[0] != "GET" && parts[0] != "POST") {
		return false
	}
	prefixes := []string{"/api/v1/" + name}
	if name == "docker" {
		prefixes = append(prefixes, "/api/v1/containers")
	}
	if name == "nginx" {
		prefixes = []string{"/api/v1/websites"}
	}
	if strings.ContainsAny(parts[1], "{}?#%") || strings.Contains(parts[1], "..") {
		return false
	}
	for _, prefix := range prefixes {
		if parts[1] == prefix || strings.HasPrefix(parts[1], prefix+"/") {
			return true
		}
	}
	return false
}
func Owner(path string) string {
	for name := range names {
		if AllowedRoute(name, "GET "+path) {
			return name
		}
	}
	return ""
}
func (p *Package) Asset(name string) ([]byte, error) {
	if !assetName.MatchString(name) {
		return nil, errors.New("invalid app asset")
	}
	root, err := os.OpenRoot(p.Directory)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	bytes, err := root.ReadFile(name)
	if err != nil {
		return nil, err
	}
	sum := sha256.Sum256(bytes)
	if hex.EncodeToString(sum[:]) != strings.Split(name, ".")[0] {
		return nil, fmt.Errorf("app asset checksum mismatch")
	}
	return bytes, nil
}
func (p *Package) Executable() (string, error) {
	if p.Manifest.Backend == nil {
		return "", errors.New("app has no backend")
	}
	entry := p.Manifest.Backend.Entry
	if _, err := p.Asset(entry); err != nil {
		return "", err
	}
	return filepath.Join(p.Directory, entry), nil
}
func (p *Package) HasRoute(method, path string) bool {
	if p.Manifest.Backend == nil {
		return false
	}
	for _, route := range p.Manifest.Backend.Routes {
		if route == method+" "+path {
			return true
		}
	}
	return false
}
func AllowsBroker(name, action string) bool {
	switch name {
	case "docker":
		return action == "containers.start" || action == "containers.stop" || action == "containers.restart" || action == "docker.resource"
	case "nginx":
		return action == "websites.save"
	}
	return false
}

func Names() []string {
	result := make([]string, 0, len(names))
	for name := range names {
		result = append(result, name)
	}
	sort.Strings(result)
	return result
}

func AuthForPath(path string, callback bool) *Package {
	name := Owner(path)
	if name == "" {
		return nil
	}
	app, err := Load(name)
	if err != nil || app.Manifest.Auth == nil {
		return nil
	}
	expected := app.Manifest.Auth.Start
	if callback {
		expected = app.Manifest.Auth.Callback
	}
	if expected != path {
		return nil
	}
	return app
}
