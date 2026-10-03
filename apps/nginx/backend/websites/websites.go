// SPDX-License-Identifier: AGPL-3.0-only
package websites

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"syscall"
)

const MaxConfig = 128 << 10

var ErrValidation = errors.New("invalid website configuration")
var ErrStale = errors.New("the website changed on disk; refresh before saving")
var idPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,62}$`)
var labelPattern = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$`)
var rootPattern = regexp.MustCompile(`^/(?:var/www|srv)/[a-zA-Z0-9/_. -]+$`)
var revisionPattern = regexp.MustCompile(`^sha256:[a-f0-9]{64}$`)

type Definition struct {
	Domain  string `json:"domain"`
	Kind    string `json:"kind"`
	Port    int    `json:"port"`
	Root    string `json:"root"`
	Enabled bool   `json:"enabled"`
}
type Site struct {
	ID         string      `json:"id"`
	Path       string      `json:"path"`
	Name       string      `json:"name"`
	Source     string      `json:"source"`
	Revision   string      `json:"revision"`
	Managed    bool        `json:"managed"`
	Definition *Definition `json:"definition,omitempty"`
}
type Snapshot struct {
	Installed bool     `json:"installed"`
	Sites     []Site   `json:"sites"`
	Warnings  []string `json:"warnings"`
}
type Logs struct {
	Text      string `json:"text"`
	Truncated bool   `json:"truncated"`
}
type Result struct {
	Site        Site   `json:"site"`
	RollbackRef string `json:"rollbackRef"`
	Reloaded    bool   `json:"reloaded"`
}
type Reader interface {
	Snapshot(context.Context) (Snapshot, error)
	Logs(context.Context, string) (Logs, error)
}
type Store struct {
	Root        string
	LogRoot     string
	RollbackDir string
	Binary      string
	Run         func(context.Context, ...string) ([]byte, error)
}

func NewStore() *Store {
	s := &Store{Root: "/etc/nginx", LogRoot: "/var/log/nginx", RollbackDir: "/var/lib/lumo/rollback/websites", Binary: "/usr/sbin/nginx"}
	s.Run = func(ctx context.Context, args ...string) ([]byte, error) {
		cmd := exec.CommandContext(ctx, s.Binary, args...)
		cmd.Env = []string{"PATH=/usr/sbin:/usr/bin:/sbin:/bin", "LC_ALL=C"}
		var output boundedOutput
		cmd.Stdout, cmd.Stderr = &output, &output
		err := cmd.Run()
		if output.overflow {
			return nil, errors.New("Nginx configuration output exceeds the supported size")
		}
		return output.Bytes(), err
	}
	return s
}

type boundedOutput struct {
	bytes.Buffer
	overflow bool
}

func (b *boundedOutput) Write(p []byte) (int, error) {
	n := len(p)
	remaining := (2 << 20) - b.Len()
	if len(p) > remaining {
		p = p[:max(remaining, 0)]
		b.overflow = true
	}
	_, _ = b.Buffer.Write(p)
	return n, nil
}

func Validate(id string, d Definition, expected string) error {
	if !idPattern.MatchString(id) || (expected != "absent" && !revisionPattern.MatchString(expected)) {
		return ErrValidation
	}
	if d.Domain == "" || len(d.Domain) > 253 || !strings.Contains(d.Domain, ".") {
		return fmt.Errorf("%w: enter a domain such as app.example.com", ErrValidation)
	}
	for _, label := range strings.Split(d.Domain, ".") {
		if !labelPattern.MatchString(label) {
			return fmt.Errorf("%w: the domain contains invalid characters", ErrValidation)
		}
	}
	switch d.Kind {
	case "proxy":
		if d.Port < 1 || d.Port > 65535 || d.Root != "" {
			return fmt.Errorf("%w: choose a local port from 1 to 65535", ErrValidation)
		}
	case "static":
		if !rootPattern.MatchString(d.Root) || filepath.Clean(d.Root) != d.Root || d.Port != 0 {
			return fmt.Errorf("%w: choose a folder below /var/www or /srv", ErrValidation)
		}
	default:
		return ErrValidation
	}
	return nil
}

func Render(d Definition) string {
	config := "# Managed by Lumo\nserver {\n    listen 80;\n    server_name " + d.Domain + ";\n"
	if d.Kind == "static" {
		config += "    root \"" + d.Root + "\";\n    index index.html;\n    location / {\n        try_files $uri $uri/ =404;\n    }\n"
	} else {
		config += "    location / {\n        proxy_pass http://127.0.0.1:" + strconv.Itoa(d.Port) + ";\n        proxy_set_header Host $host;\n        proxy_set_header X-Real-IP $remote_addr;\n        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n        proxy_set_header X-Forwarded-Proto $scheme;\n    }\n"
	}
	config += "}\n"
	if !d.Enabled {
		config = "# Disabled by Lumo\n" + strings.TrimSuffix("# "+strings.ReplaceAll(config, "\n", "\n# "), "# ")
	}
	return config
}

func parse(content string) *Definition {
	d := Definition{Enabled: true}
	text := content
	if strings.HasPrefix(text, "# Disabled by Lumo\n") {
		d.Enabled = false
		text = strings.TrimPrefix(text, "# Disabled by Lumo\n")
		text = strings.TrimPrefix(strings.ReplaceAll(text, "\n# ", "\n"), "# ")
	}
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "server_name ") {
			d.Domain = strings.TrimSuffix(strings.TrimPrefix(line, "server_name "), ";")
		}
		if strings.HasPrefix(line, "root \"") {
			d.Kind = "static"
			d.Root = strings.TrimSuffix(strings.TrimPrefix(line, "root \""), "\";")
		}
		if strings.HasPrefix(line, "proxy_pass http://127.0.0.1:") {
			d.Kind = "proxy"
			d.Port, _ = strconv.Atoi(strings.TrimSuffix(strings.TrimPrefix(line, "proxy_pass http://127.0.0.1:"), ";"))
		}
	}
	if Validate("site", d, "absent") != nil || Render(d) != content {
		return nil
	}
	return &d
}

func Revision(content []byte) string {
	sum := sha256.Sum256(content)
	return "sha256:" + hex.EncodeToString(sum[:])
}

func readConfig(path string) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Size() > MaxConfig {
		return nil, errors.New("configuration must be a regular file below 128 KiB")
	}
	content, err := io.ReadAll(io.LimitReader(f, MaxConfig+1))
	if len(content) > MaxConfig {
		return nil, errors.New("configuration is too large")
	}
	return content, err
}

func siteFrom(path string, content []byte) Site {
	id := strings.TrimSuffix(strings.TrimPrefix(filepath.Base(path), "lumo-"), ".conf")
	site := Site{ID: path, Path: path, Name: filepath.Base(path), Source: string(content), Revision: Revision(content)}
	if filepath.Base(filepath.Dir(path)) == "conf.d" && strings.HasPrefix(filepath.Base(path), "lumo-") && idPattern.MatchString(id) {
		if d := parse(string(content)); d != nil {
			site.ID = id
			site.Name = d.Domain
			site.Managed = true
			site.Definition = d
		}
	}
	return site
}

func (s *Store) Snapshot(ctx context.Context) (Snapshot, error) {
	snapshot := Snapshot{Sites: []Site{}, Warnings: []string{}}
	_, err := os.Stat(s.Binary)
	snapshot.Installed = err == nil
	seen := map[string]bool{}
	paths := []string{filepath.Join(s.Root, "nginx.conf")}
	for _, dir := range []string{"conf.d", "sites-enabled"} {
		entries, err := os.ReadDir(filepath.Join(s.Root, dir))
		if err != nil && !errors.Is(err, os.ErrNotExist) {
			snapshot.Warnings = append(snapshot.Warnings, "Cannot read "+dir+": "+err.Error())
		}
		for _, entry := range entries {
			if !entry.IsDir() && (dir == "sites-enabled" || strings.HasSuffix(entry.Name(), ".conf")) {
				paths = append(paths, filepath.Join(s.Root, dir, entry.Name()))
			}
		}
	}
	for _, path := range paths {
		if err := ctx.Err(); err != nil {
			return snapshot, err
		}
		real, err := filepath.EvalSymlinks(path)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil || !strings.HasPrefix(real, s.Root+string(filepath.Separator)) {
			snapshot.Warnings = append(snapshot.Warnings, "Cannot read configuration outside the Nginx directory: "+path)
			continue
		}
		if seen[real] {
			continue
		}
		seen[real] = true
		if len(snapshot.Sites) >= 100 {
			snapshot.Warnings = append(snapshot.Warnings, "Showing the first 100 configuration files.")
			break
		}
		content, err := readConfig(real)
		if err != nil {
			snapshot.Warnings = append(snapshot.Warnings, "Cannot read "+path+": "+err.Error())
			continue
		}
		snapshot.Sites = append(snapshot.Sites, siteFrom(real, content))
	}
	sort.Slice(snapshot.Sites, func(i, j int) bool {
		if snapshot.Sites[i].Managed != snapshot.Sites[j].Managed {
			return snapshot.Sites[i].Managed
		}
		return snapshot.Sites[i].Name < snapshot.Sites[j].Name
	})
	return snapshot, nil
}

func (s *Store) Logs(_ context.Context, kind string) (Logs, error) {
	if kind != "access" && kind != "error" {
		return Logs{}, ErrValidation
	}
	path := filepath.Join(s.LogRoot, kind+".log")
	real, err := filepath.EvalSymlinks(path)
	if err != nil {
		return Logs{}, err
	}
	if real != path {
		return Logs{}, errors.New("symlinked Nginx logs are not supported")
	}
	f, err := os.Open(path)
	if err != nil {
		return Logs{}, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return Logs{}, err
	}
	if !info.Mode().IsRegular() {
		return Logs{}, ErrValidation
	}
	truncated := info.Size() > 64<<10
	if truncated {
		_, err = f.Seek(-(64 << 10), io.SeekEnd)
		if err != nil {
			return Logs{}, err
		}
	}
	body, err := io.ReadAll(io.LimitReader(f, 64<<10))
	if err != nil {
		return Logs{}, err
	}
	if truncated {
		if i := bytes.IndexByte(body, '\n'); i >= 0 {
			body = body[i+1:]
		}
	}
	return Logs{Text: strings.ToValidUTF8(string(body), "�"), Truncated: truncated}, nil
}

func (s *Store) Apply(ctx context.Context, id string, d Definition, expected, requestID string) (Result, error) {
	if err := Validate(id, d, expected); err != nil {
		return Result{}, err
	}
	dir := filepath.Join(s.Root, "conf.d")
	real, err := filepath.EvalSymlinks(dir)
	if err != nil || real != dir {
		return Result{}, fmt.Errorf("%w: the standard Nginx conf.d directory is required", ErrValidation)
	}
	if info, err := os.Stat(dir); err != nil || info.Mode().Perm()&0o022 != 0 {
		return Result{}, fmt.Errorf("%w: the Nginx configuration directory must not be writable by other users", ErrValidation)
	}
	if s.Root == "/etc/nginx" {
		info, err := os.Stat(dir)
		if err != nil {
			return Result{}, err
		}
		stat, ok := info.Sys().(*syscall.Stat_t)
		if !ok || stat.Uid != 0 {
			return Result{}, fmt.Errorf("%w: the Nginx configuration directory must be owned by root", ErrValidation)
		}
	}
	path := filepath.Join(dir, "lumo-"+id+".conf")
	info, err := os.Lstat(path)
	exists := err == nil
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return Result{}, err
	}
	var old []byte
	mode := os.FileMode(0o644)
	if exists {
		if !info.Mode().IsRegular() {
			return Result{}, ErrValidation
		}
		old, err = readConfig(path)
		if err != nil {
			return Result{}, err
		}
		if Revision(old) != expected {
			return Result{}, ErrStale
		}
		if parse(string(old)) == nil {
			return Result{}, fmt.Errorf("%w: this file contains custom configuration; use the source editor", ErrValidation)
		}
		mode = info.Mode().Perm()
	} else if expected != "absent" {
		return Result{}, ErrStale
	}
	if d.Kind == "static" {
		realRoot, err := filepath.EvalSymlinks(d.Root)
		if err != nil || (!strings.HasPrefix(realRoot, "/var/www/") && !strings.HasPrefix(realRoot, "/srv/")) {
			return Result{}, fmt.Errorf("%w: the website folder must resolve below /var/www or /srv", ErrValidation)
		}
		info, err := os.Stat(d.Root)
		if err != nil || !info.IsDir() {
			return Result{}, fmt.Errorf("%w: the website folder does not exist", ErrValidation)
		}
	}
	if err := os.MkdirAll(s.RollbackDir, 0o700); err != nil {
		return Result{}, err
	}
	hash := sha256.Sum256([]byte(requestID))
	ref := hex.EncodeToString(hash[:])
	backup, _ := json.Marshal(struct {
		Path    string `json:"path"`
		Existed bool   `json:"existed"`
		Content []byte `json:"content"`
		Mode    uint32 `json:"mode"`
	}{path, exists, old, uint32(mode)})
	if err := atomicWrite(filepath.Join(s.RollbackDir, ref+".json"), backup, 0o600); err != nil {
		return Result{}, err
	}
	content := []byte(Render(d))
	restore := func(cause error) (Result, error) {
		var err error
		if exists {
			err = atomicWrite(path, old, mode)
		} else {
			err = os.Remove(path)
			if errors.Is(err, os.ErrNotExist) {
				err = nil
			}
			if err == nil {
				err = syncDirectory(dir)
			}
		}
		if err != nil {
			return Result{}, fmt.Errorf("%v; automatic restore failed: %v; recovery record %s", cause, err, ref)
		}
		return Result{}, fmt.Errorf("%w; previous file restored", cause)
	}
	if err := atomicWrite(path, content, mode); err != nil {
		return restore(err)
	}
	output, err := s.Run(ctx, "-T", "-c", filepath.Join(s.Root, "nginx.conf"))
	if err != nil {
		return restore(fmt.Errorf("%w: Nginx validation failed: %s", ErrValidation, tail(output, 800)))
	}
	if !bytes.Contains(output, []byte("# configuration file "+path+":")) {
		return restore(fmt.Errorf("%w: nginx.conf does not include this conf.d file", ErrValidation))
	}
	if output, err = s.Run(ctx, "-s", "reload"); err != nil {
		return restore(fmt.Errorf("Nginx reload failed: %s", tail(output, 800)))
	}
	return Result{Site: siteFrom(path, content), RollbackRef: ref, Reloaded: true}, nil
}

func tail(body []byte, n int) string {
	if len(body) > n {
		body = body[len(body)-n:]
	}
	return strings.TrimSpace(string(body))
}
func atomicWrite(path string, content []byte, mode os.FileMode) error {
	f, err := os.CreateTemp(filepath.Dir(path), ".lumo-site-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if _, err = f.Write(content); err != nil {
		_ = f.Close()
		return err
	}
	if err = f.Chmod(mode); err != nil {
		_ = f.Close()
		return err
	}
	if err = f.Sync(); err != nil {
		_ = f.Close()
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	if err = os.Rename(f.Name(), path); err != nil {
		return err
	}
	return syncDirectory(filepath.Dir(path))
}

func syncDirectory(path string) error {
	dir, err := os.Open(path)
	if err != nil {
		return err
	}
	defer dir.Close()
	return dir.Sync()
}
