// SPDX-License-Identifier: AGPL-3.0-only
package appbuilder

import (
	"bytes"
	"context"
	"crypto/sha256"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"lumo/server/internal/appicons"
	"lumo/server/internal/appplugins"
	"lumo/server/internal/appruntime"
	"lumo/server/internal/desktopapps"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

//go:embed GUIDE.md templates/*
var resources embed.FS

type Diagnostic struct {
	File    string `json:"file"`
	Code    string `json:"code"`
	Message string `json:"message"`
	Fix     string `json:"fix"`
	Line    int    `json:"line,omitempty"`
	Column  int    `json:"column,omitempty"`
}
type Report struct {
	OK          bool                `json:"ok"`
	Diagnostics []Diagnostic        `json:"diagnostics"`
	Files       map[string]string   `json:"-"`
	Release     *appplugins.Release `json:"release,omitempty"`
}

func failure(file, code string, err error, fix string) Report {
	return Report{Diagnostics: []Diagnostic{{File: file, Code: code, Message: err.Error(), Fix: fix}}}
}
func API() any {
	guide, _ := resources.ReadFile("GUIDE.md")
	return map[string]any{"apiVersion": 1, "kind": "native", "guide": string(guide), "frontendImports": []string{"react", "react/jsx-runtime", "@lumo/sdk/app", "@lumo/sdk/shell/appMenus", "@lumo/sdk/shell/useAppState", "@lumo/sdk/apps/FilePicker", "@lumo/sdk/shell/AppModal", "@lumo/sdk/shell/ContextMenu", "@lumo/sdk/api/plugins", "@lumo/sdk/api/notifications", "@lumo/sdk/shell/ShellContext", "@lumo/sdk/shell/WindowContext"}, "backendRuntime": "node", "platform": runtime.GOOS + "/" + runtime.GOARCH, "validation": "Static checks do not execute app code and do not replace runtime or visual tests."}
}
func Create(project, name, title string, backend, extension bool) (any, error) {
	if !filepath.IsAbs(project) || !appplugins.ValidName(name) || appplugins.AppID(name) != "plugin:"+name || strings.TrimSpace(title) == "" || len(title) > 80 || extension && !backend {
		return nil, errors.New("Choose a new plugin name, absolute project path and title; the Pi template requires its backend")
	}
	if err := os.Mkdir(project, 0700); err != nil {
		return nil, err
	}
	m := appplugins.Manifest{SchemaVersion: 1, HostAPIVersion: 1, ID: "plugin:" + name, Name: title, Description: "A personal notebook.", Version: "0.1.0", License: "AGPL-3.0-only", Icon: "IconGrid", Window: appplugins.Window{Multiple: true, Width: 640, Height: 460, MinWidth: 320, MinHeight: 280}, Entry: "src/main.tsx", Styles: "src/style.css", Permissions: []string{"account"}}
	if backend {
		m.Backend = &appplugins.Backend{Runtime: "node", ProtocolVersion: 1, Entry: "backend/main.mjs", Platform: runtime.GOOS + "/" + runtime.GOARCH, Routes: []string{"GET /api/v1/plugins/" + name, "POST /api/v1/plugins/" + name}}
	}
	if extension {
		m.Pi = &appplugins.Extension{Entry: "pi/extension.mjs", Setting: name, ReadTools: []string{"lumo_" + strings.ReplaceAll(name, "-", "_") + "_read"}, WriteTools: []string{"lumo_" + strings.ReplaceAll(name, "-", "_") + "_save"}}
	}
	if !backend {
		m.Description = "A local counter."
	}
	raw, _ := json.MarshalIndent(m, "", "  ")
	if err := os.WriteFile(filepath.Join(project, "lumo.plugin.json"), append(raw, '\n'), 0600); err != nil {
		return nil, err
	}
	templates := map[string]string{"src/main.tsx": "frontend.tsx", "src/style.css": "style.css", "validate.mjs": "validate.mjs"}
	if !backend {
		templates["src/main.tsx"] = "frontend-only.tsx"
	}
	if backend {
		templates["backend/main.mjs"] = "backend.mjs"
	}
	if extension {
		templates["pi/extension.mjs"] = "extension.mjs"
	}
	for dest, source := range templates {
		raw, err := resources.ReadFile("templates/" + source)
		if err != nil {
			return nil, err
		}
		titleJSON, _ := json.Marshal(title)
		code := strings.NewReplacer("__APP__", name, "__TOOL__", strings.ReplaceAll(name, "-", "_"), "__TITLE__", string(titleJSON)).Replace(string(raw))
		if err = os.MkdirAll(filepath.Dir(filepath.Join(project, dest)), 0700); err != nil {
			return nil, err
		}
		if err = os.WriteFile(filepath.Join(project, dest), []byte(code), 0600); err != nil {
			return nil, err
		}
	}
	guide, _ := resources.ReadFile("GUIDE.md")
	if err := os.WriteFile(filepath.Join(project, "APP_BUILD.md"), guide, 0600); err != nil {
		return nil, err
	}
	return map[string]string{"project": project, "name": name, "guide": "APP_BUILD.md", "validate": "node validate.mjs"}, nil
}
func read(root *os.Root, name string, max int64) ([]byte, error) {
	if !fs.ValidPath(name) || strings.Contains(name, "\\") {
		return nil, errors.New("Use a relative path inside the project")
	}
	for part := name; part != "."; part = filepath.Dir(part) {
		info, err := root.Lstat(part)
		if err != nil {
			return nil, err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return nil, errors.New("Symlinks are unsupported; keep source inside this project")
		}
		if part == name && !info.Mode().IsRegular() {
			return nil, errors.New("Source must be a regular file")
		}
	}
	f, err := root.Open(name)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	raw, err := io.ReadAll(io.LimitReader(f, max+1))
	if int64(len(raw)) > max {
		return nil, errors.New("Source file exceeds its size limit")
	}
	return raw, err
}
func projectInput(project string) (appplugins.Manifest, map[string]string, error) {
	var m appplugins.Manifest
	if !filepath.IsAbs(project) {
		return m, nil, errors.New("Use an absolute project path")
	}
	info, err := os.Lstat(project)
	if err != nil {
		return m, nil, err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return m, nil, errors.New("Use a project directory, not a symlink")
	}
	root, err := os.OpenRoot(project)
	if err != nil {
		return m, nil, err
	}
	defer root.Close()
	raw, err := read(root, "lumo.plugin.json", 65536)
	if err != nil {
		return m, nil, err
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(&m); err != nil {
		return m, nil, err
	}
	if decoder.Decode(new(any)) != io.EOF {
		return m, nil, errors.New("Manifest must contain one JSON object")
	}
	m.IconImage, err = appicons.Resolve(m.IconImage, func(path string, limit int64) ([]byte, error) { return read(root, path, limit) })
	if err != nil {
		return m, nil, err
	}
	name := strings.TrimPrefix(m.ID, "plugin:")
	if m.ID != "plugin:"+name || appplugins.AppID(name) != m.ID || !appplugins.ValidName(name) {
		return m, nil, errors.New("Set id to plugin:<new-name>; built-in and shipped names are reserved")
	}
	if !strings.HasPrefix(m.Entry, "src/") || m.Background != "" && !strings.HasPrefix(m.Background, "src/") || m.Auth != nil {
		return m, nil, errors.New("Use frontend entries under src/; OAuth entries require administrator packaging")
	}
	if m.Backend != nil && (m.Backend.Runtime != "node" || m.Backend.Entry != "backend/main.mjs") {
		return m, nil, errors.New("Use backend/main.mjs with backend.runtime=node")
	}
	if m.Pi != nil && m.Pi.Entry != "pi/extension.mjs" {
		return m, nil, errors.New("Use pi/extension.mjs for the Pi extension")
	}
	files := map[string]string{}
	total := 0
	var walk func(string) error
	walk = func(dir string) error {
		f, e := root.Open(dir)
		if e != nil {
			return e
		}
		entries, e := f.ReadDir(-1)
		f.Close()
		if e != nil {
			return e
		}
		for _, entry := range entries {
			name := dir + "/" + entry.Name()
			if entry.Type()&os.ModeSymlink != 0 {
				return fmt.Errorf("%s: symlinks are unsupported", name)
			}
			if entry.IsDir() {
				if e = walk(name); e != nil {
					return e
				}
				continue
			}
			if len(files) >= 32 {
				return errors.New("Keep at most 32 frontend source files")
			}
			raw, e := read(root, name, 256<<10)
			if e != nil {
				return fmt.Errorf("%s: %w", name, e)
			}
			total += len(raw)
			if total > 4<<20 {
				return errors.New("Keep source under 4 MiB")
			}
			files[name] = string(raw)
		}
		return nil
	}
	if err = walk("src"); err != nil {
		return m, nil, err
	}
	for _, entry := range []string{m.Entry, m.Styles, m.Background} {
		if entry != "" {
			if _, ok := files[entry]; !ok {
				return m, nil, fmt.Errorf("Missing source: %s", entry)
			}
		}
	}
	for _, entry := range []string{func() string {
		if m.Backend != nil {
			return m.Backend.Entry
		}
		return ""
	}(), func() string {
		if m.Pi != nil {
			return m.Pi.Entry
		}
		return ""
	}()} {
		if entry != "" {
			raw, e := read(root, entry, 256<<10)
			if e != nil {
				return m, nil, fmt.Errorf("%s: %w", entry, e)
			}
			files[entry] = string(raw)
		}
	}
	return m, files, nil
}
func compile(ctx context.Context, home string, m appplugins.Manifest, files map[string]string, compiled bool) Report {
	node, err := appruntime.Lookup(home, "node")
	if err != nil {
		return failure("runtime", "runtime", err, "Set up Pi's Node.js runtime, then retry.")
	}
	input, _ := json.Marshal(map[string]any{"manifest": m, "files": files, "compiled": compiled})
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	raw, err := desktopapps.CompilePlugin(ctx, node, home, input)
	if err != nil {
		return failure("runtime", "validator", err, "Check the runtime and retry the installed Lumo validator.")
	}
	var value struct {
		OK          bool              `json:"ok"`
		Diagnostics []Diagnostic      `json:"diagnostics"`
		Files       map[string]string `json:"files"`
	}
	if err = json.Unmarshal(raw, &value); err != nil {
		return failure("runtime", "validator", err, "Rebuild Lumo's validator.")
	}
	if value.OK && m.Background != "" {
		background := m
		background.Entry = m.Background
		background.Background = ""
		background.Styles = ""
		background.Backend = nil
		background.Pi = nil
		checked := compile(ctx, home, background, files, compiled)
		if !checked.OK {
			return checked
		}
		value.Files[m.Background] = checked.Files[m.Background]
	}
	return Report{OK: value.OK, Diagnostics: value.Diagnostics, Files: value.Files}
}
func bundle(m appplugins.Manifest, files map[string]string) appplugins.Bundle {
	b := appplugins.Bundle{Name: strings.TrimPrefix(m.ID, "plugin:"), Files: map[string][]byte{}}
	asset := func(source, extension string) string {
		raw := []byte(files[source])
		name := fmt.Sprintf("%x%s", sha256.Sum256(raw), extension)
		b.Files[name] = raw
		return name
	}
	m.Entry = asset(m.Entry, ".js")
	if m.Background != "" {
		m.Background = asset(m.Background, ".js")
	}
	if m.Styles != "" {
		m.Styles = asset(m.Styles, ".css")
	}
	if m.Backend != nil {
		copy := *m.Backend
		m.Backend = &copy
		m.Backend.Entry = asset(m.Backend.Entry, ".bin")
	}
	if m.Pi != nil {
		copy := *m.Pi
		m.Pi = &copy
		m.Pi.Entry = asset(m.Pi.Entry, ".mjs")
	}
	b.Manifest, _ = json.Marshal(m)
	return b
}
func validateBundle(b appplugins.Bundle) error {
	dir, err := os.MkdirTemp("", "lumo-plugin-validation-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)
	p, err := appplugins.Parse(b.Name, dir, b.Manifest)
	if err != nil {
		return err
	}
	for name, raw := range b.Files {
		if err = os.WriteFile(filepath.Join(dir, name), raw, 0600); err != nil {
			return err
		}
	}
	return p.Validate()
}
func Build(ctx context.Context, home, project string, stage bool) Report {
	m, files, err := projectInput(project)
	if err != nil {
		return failure("lumo.plugin.json", "source", err, "Correct the manifest or source path. Use the generated template and APP_BUILD.md.")
	}
	initial := bundle(m, files)
	if err = validateBundle(initial); err != nil {
		return failure("lumo.plugin.json", "manifest", err, "Correct the named manifest contract (version, display, route, permission or tool name); run validation again.")
	}
	report := compile(ctx, home, m, files, false)
	if !report.OK {
		return report
	}
	b := bundle(m, report.Files)
	if err = validateBundle(b); err != nil {
		return failure("lumo.plugin.json", "package", err, "Fix the manifest and rebuild all parts together.")
	}
	if stage {
		release, err := appplugins.Import(home, b)
		if err != nil {
			return failure("lumo.plugin.json", "stage", err, "Increase version for changed source; fix any reported package error and rebuild.")
		}
		report.Release = &release
	}
	return report
}
func Install(ctx context.Context, home string, change appplugins.Change) Report {
	if matched, err := appplugins.Replay(home, change); err != nil {
		return failure("manifest.json", "replay", err, "Use a new request ID for a different action.")
	} else if matched {
		return Report{OK: true, Diagnostics: []Diagnostic{}}
	}
	digest := change.Digest
	if change.Action == "rollback" {
		for _, item := range appplugins.Catalog(home) {
			if item.Name == change.Name {
				digest = item.Previous
			}
		}
	}
	p, err := appplugins.Staged(home, change.Name, digest)
	if err != nil {
		return failure("manifest.json", "release", err, "Build and stage this app first; use its returned digest.")
	}
	if err = p.Validate(); err != nil {
		return failure("manifest.json", "integrity", err, "Rebuild the damaged package before installing.")
	}
	if p.Manifest.Backend != nil && p.Manifest.Backend.Runtime != "node" {
		return failure("manifest.json", "runtime", errors.New("Builder installs require a Node.js backend"), "Use App Library for packages from another build toolchain.")
	}
	files := map[string]string{}
	for _, name := range p.Assets() {
		raw, err := p.Asset(name)
		if err != nil {
			return failure(name, "integrity", err, "Rebuild this asset.")
		}
		files[name] = string(raw)
	}
	report := compile(ctx, home, p.Manifest, files, true)
	if !report.OK {
		return report
	}
	if err = appplugins.Apply(home, change); err != nil {
		return failure("manifest.json", "install", err, "Read the latest catalog revision; confirm account access and retry with the correct digest and request ID.")
	}
	return report
}
