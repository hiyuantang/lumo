// SPDX-License-Identifier: AGPL-3.0-only
package appplugins

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"lumo/server/internal/appruntime"
	"os"
	"os/exec"
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
type Window struct {
	Width     int `json:"width"`
	Height    int `json:"height"`
	MinWidth  int `json:"minWidth"`
	MinHeight int `json:"minHeight"`
}
type Terminal struct {
	Candidates []string `json:"candidates"`
	Path       []string `json:"path"`
}
type Manifest struct {
	Terminal        *Terminal  `json:"terminal,omitempty"`
	Required        bool       `json:"required,omitempty"`
	Provider        bool       `json:"provider,omitempty"`
	Assistant       bool       `json:"assistant,omitempty"`
	Name            string     `json:"name"`
	Description     string     `json:"description,omitempty"`
	Icon            string     `json:"icon"`
	Window          Window     `json:"window"`
	Entry           string     `json:"entry"`
	Styles          string     `json:"styles,omitempty"`
	Background      string     `json:"background,omitempty"`
	RequiredPackage string     `json:"requiredPackage,omitempty"`
	Permissions     []string   `json:"permissions,omitempty"`
	Auth            *AuthFlow  `json:"auth,omitempty"`
	SchemaVersion   int        `json:"schemaVersion"`
	HostAPIVersion  int        `json:"hostApiVersion"`
	ID              string     `json:"id"`
	Version         string     `json:"version"`
	License         string     `json:"license"`
	Backend         *Backend   `json:"backend,omitempty"`
	Pi              *Extension `json:"pi,omitempty"`
}
type Backend struct {
	MaxBodyBytes    int64    `json:"maxBodyBytes,omitempty"`
	Resident        bool     `json:"resident,omitempty"`
	Contributions   []string `json:"contributions,omitempty"`
	Runtime         string   `json:"runtime,omitempty"`
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

var requiredNames = map[string]bool{"pi": true, "files": true, "preview": true, "terminal": true, "settings": true, "library": true, "trash": true}

func Required(name string) bool { return requiredNames[name] }

var legacyIDs = map[string]string{"calendar": "calendar", "skills": "skills", "git": "git", "docker": "containers", "nginx": "websites", "monitor": "home"}
var assetName = regexp.MustCompile(`^[a-f0-9]{64}\.(bin|mjs|js|css)$`)
var packageName = regexp.MustCompile(`^[a-z][a-z0-9-]{0,47}$`)

func ValidName(name string) bool {
	return packageName.MatchString(name) && !map[string]bool{"app": true, "plugin": true, "home": true, "containers": true, "websites": true}[name]
}
func AppID(name string) string {
	if Required(name) {
		return name
	}
	if id, ok := legacyIDs[name]; ok {
		return id
	}
	return "plugin:" + name
}

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
func Load(name string) (*Package, error) { return loadRoots(name, Roots()) }
func loadRoots(name string, roots []string) (*Package, error) {
	if !ValidName(name) {
		return nil, errors.New("invalid app plugin name")
	}
	for _, directory := range roots {
		raw, err := os.ReadFile(filepath.Join(directory, name, "manifest.json"))
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return nil, err
		}
		return Parse(name, filepath.Join(directory, name), raw)
	}
	return nil, os.ErrNotExist
}
func Parse(name, directory string, raw []byte) (*Package, error) {
	var m Manifest
	if !ValidName(name) || len(raw) > 65536 || json.Unmarshal(raw, &m) != nil {
		return nil, errors.New("invalid app manifest")
	}
	if m.Required != Required(name) || (m.Provider || m.Assistant) && !m.Required || m.ID != AppID(name) || m.SchemaVersion != 1 || m.HostAPIVersion != 1 || m.License != "AGPL-3.0-only" || !version.MatchString(m.Version) {
		return nil, errors.New("incompatible app plugin")
	}
	if m.Terminal != nil && !m.Required {
		return nil, errors.New("terminal contributions require a system app")
	}
	if b := m.Backend; b != nil {
		if b.MaxBodyBytes < 0 || b.MaxBodyBytes > 12<<20 {
			return nil, errors.New("invalid app body limit")
		}
		if b.Resident && (!m.Required || b.Runtime != "" || b.Privileged) || len(b.Contributions) > 0 && !b.Resident {
			return nil, errors.New("unsupported resident backend")
		}
		for _, c := range b.Contributions {
			if c != "software" && c != "history" {
				return nil, errors.New("unsupported app contribution")
			}
		}

		if (b.Runtime != "" && b.Runtime != "node") || b.ProtocolVersion != 1 || b.Platform != runtime.GOOS+"/"+runtime.GOARCH || !assetName.MatchString(b.Entry) || !strings.HasSuffix(b.Entry, ".bin") {
			return nil, errors.New("incompatible app backend")
		}
		for _, route := range b.Routes {
			if !AllowedRoute(name, route) {
				return nil, errors.New("app route is outside its namespace")
			}
		}
	}
	if a := m.Auth; a != nil {
		if !AllowedRoute(name, "POST "+a.Start) || !AllowedRoute(name, "GET "+a.Callback) {
			return nil, errors.New("invalid app authentication paths")
		}
	}
	if p := m.Pi; p != nil {
		if p.Setting != name || !assetName.MatchString(p.Entry) || !strings.HasSuffix(p.Entry, ".mjs") {
			return nil, errors.New("invalid app extension")
		}
		for _, tool := range append(append([]string{}, p.ReadTools...), p.WriteTools...) {
			if !regexp.MustCompile(`^lumo_` + strings.ReplaceAll(name, "-", "_") + `_[a-z0-9_]+$`).MatchString(tool) {
				return nil, errors.New("invalid app tool name")
			}
		}
	}
	for _, permission := range m.Permissions {
		if permission != "account" && (!strings.HasPrefix(permission, "broker.") || !supportedBroker[strings.TrimPrefix(permission, "broker.")]) {
			return nil, errors.New("unsupported app permission")
		}
	}
	return &Package{Name: name, Directory: directory, Manifest: m}, nil
}

var supportedBroker = map[string]bool{"containers.start": true, "containers.stop": true, "containers.restart": true, "docker.resource": true, "websites.save": true}

func (p *Package) AllowsBroker(action string) bool {
	for _, permission := range p.Manifest.Permissions {
		if permission == "broker."+action && supportedBroker[action] {
			return true
		}
	}
	return false
}
func (p *Package) Validate() error {
	m := p.Manifest
	if m.Name == "" || len(m.Name) > 80 || len(m.Description) > 1000 || m.Window.MinWidth < 280 || m.Window.MinHeight < 200 || m.Window.Width < m.Window.MinWidth || m.Window.Height < m.Window.MinHeight || m.Window.Width > 4096 || m.Window.Height > 4096 {
		return errors.New("invalid app display information")
	}
	if m.RequiredPackage != "" && m.RequiredPackage != "git" && m.RequiredPackage != "docker" && m.RequiredPackage != "nginx" {
		return errors.New("unsupported system dependency")
	}
	if m.Entry == "" || !strings.HasSuffix(m.Entry, ".js") || m.Styles != "" && !strings.HasSuffix(m.Styles, ".css") || m.Background != "" && !strings.HasSuffix(m.Background, ".js") {
		return errors.New("invalid frontend assets")
	}
	for _, name := range p.Assets() {
		if _, err := p.Asset(name); err != nil {
			return err
		}
	}
	return nil
}
func (p *Package) Assets() []string {
	m := p.Manifest
	files := []string{m.Entry}
	if m.Styles != "" {
		files = append(files, m.Styles)
	}
	if m.Background != "" {
		files = append(files, m.Background)
	}
	if m.Backend != nil {
		files = append(files, m.Backend.Entry)
	}
	if m.Pi != nil {
		files = append(files, m.Pi.Entry)
	}
	return files
}
func AllowedRoute(name, route string) bool {
	parts := strings.Split(route, " ")
	if len(parts) != 2 || (parts[0] != "GET" && parts[0] != "POST") {
		return false
	}
	prefixes := []string{"/api/v1/plugins/" + name}
	if _, ok := legacyIDs[name]; ok {
		prefixes = append(prefixes, "/api/v1/"+name)
	}
	if name == "pi" {
		prefixes = append(prefixes, "/api/v1/pi", "/api/v1/apps/pi")
	}
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
	if AllowedRoute("pi", "GET "+path) {
		return "pi"
	}
	for name := range legacyIDs {
		if AllowedRoute(name, "GET "+path) {
			return name
		}
	}
	parts := strings.Split(strings.TrimPrefix(path, "/api/v1/plugins/"), "/")
	if strings.HasPrefix(path, "/api/v1/plugins/") && ValidName(parts[0]) {
		return parts[0]
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

func Names() []string { return namesIn(Roots()) }
func namesIn(roots []string) []string {
	found := map[string]bool{}
	for _, root := range roots {
		entries, _ := os.ReadDir(root)
		for _, entry := range entries {
			if entry.IsDir() && ValidName(entry.Name()) {
				found[entry.Name()] = true
			}
		}
	}
	result := make([]string, 0, len(found))
	for name := range found {
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

func (p *Package) Command(ctx context.Context, home string, args ...string) (*exec.Cmd, error) {
	executable, err := p.Executable()
	if err != nil {
		return nil, err
	}
	if p.Manifest.Backend.Runtime == "node" {
		node, err := appruntime.Lookup(home, "node")
		if err != nil {
			return nil, fmt.Errorf("Node.js is unavailable; set up Pi's runtime: %w", err)
		}
		args = append([]string{executable}, args...)
		executable = node
	}
	return exec.CommandContext(ctx, executable, args...), nil
}
