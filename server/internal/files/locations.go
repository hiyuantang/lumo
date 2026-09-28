// SPDX-License-Identifier: AGPL-3.0-only
package files

import (
	"bufio"
	"io"
	"os"
	"path/filepath"
	"strings"
)

type Location struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Path string `json:"path"`
}

var standardLocations = []struct{ id, name string }{
	{"DESKTOP", "Desktop"}, {"DOCUMENTS", "Documents"}, {"DOWNLOAD", "Downloads"},
	{"PICTURES", "Pictures"}, {"MUSIC", "Music"}, {"VIDEOS", "Videos"},
	{"TEMPLATES", "Templates"}, {"PUBLICSHARE", "Public"},
}

func UserLocations() []Location {
	if locationSettingsLock.TryLock() {
		err := recoverLocationMove()
		locationSettingsLock.Unlock()
		if err != nil {
			return []Location{}
		}
	}
	home, err := os.UserHomeDir()
	if err != nil || !filepath.IsAbs(home) {
		return []Location{}
	}
	config := os.Getenv("XDG_CONFIG_HOME")
	if !filepath.IsAbs(config) {
		config = filepath.Join(home, ".config")
	}
	return userLocations(home, filepath.Join(config, "user-dirs.dirs"))
}

func userLocations(home, config string) []Location {
	configured := map[string]string{}
	if file, err := os.Open(config); err == nil {
		defer file.Close()
		scanner := bufio.NewScanner(io.LimitReader(file, 65536))
		for scanner.Scan() {
			key, value, found := strings.Cut(strings.TrimSpace(scanner.Text()), "=")
			key = strings.TrimSpace(key)
			if found && strings.HasPrefix(key, "XDG_") && strings.HasSuffix(key, "_DIR") {
				configured[key] = userDirectoryPath(strings.TrimSpace(value), home)
			}
		}
	}
	out := []Location{}
	seen := map[string]bool{filepath.Clean(home): true}
	for _, item := range standardLocations {
		path, configuredPath := configured["XDG_"+item.id+"_DIR"]
		if !configuredPath {
			path = filepath.Join(home, item.name)
		}
		if path == "" {
			continue
		}
		path = filepath.Clean(path)
		info, err := os.Stat(path)
		if err != nil || !info.IsDir() {
			continue
		}
		real, err := filepath.EvalSymlinks(path)
		if err != nil {
			continue
		}
		homeReal, _ := filepath.EvalSymlinks(home)
		if real == homeReal || seen[real] || seen[path] {
			continue
		}
		seen[real], seen[path] = true, true
		out = append(out, Location{ID: strings.ToLower(item.id), Name: item.name, Path: path})
	}
	return out
}

func userDirectoryPath(value, home string) string {
	if len(value) < 2 || value[0] != '"' || value[len(value)-1] != '"' {
		return ""
	}
	value = value[1 : len(value)-1]
	var out strings.Builder
	for i := 0; i < len(value); i++ {
		switch value[i] {
		case '\\':
			if i+1 >= len(value) {
				return ""
			}
			i++
			if !strings.ContainsRune("$`\"\\", rune(value[i])) {
				out.WriteByte('\\')
			}
			out.WriteByte(value[i])
		case '$':
			if i == 0 && (value == "$HOME" || strings.HasPrefix(value, "$HOME/")) {
				out.WriteString(home)
				i += 4
			} else if i == 0 && (value == "${HOME}" || strings.HasPrefix(value, "${HOME}/")) {
				out.WriteString(home)
				i += 6
			} else {
				return ""
			}
		case '`', '"', 0:
			return ""
		default:
			out.WriteByte(value[i])
		}
	}
	path := out.String()
	if !filepath.IsAbs(path) {
		return ""
	}
	return filepath.Clean(path)
}
