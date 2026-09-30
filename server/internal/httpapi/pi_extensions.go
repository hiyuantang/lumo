// SPDX-License-Identifier: AGPL-3.0-only
package httpapi

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"lumo/server/internal/strictjson"
)

type piOptionalExtension struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Enabled bool   `json:"enabled"`
	Path    string `json:"-"`
}

type piExtensionSettings struct {
	Extensions []piOptionalExtension `json:"extensions"`
	Questions  bool                  `json:"questions"`
	LumoUse    bool                  `json:"lumoUse"`
	Revision   string                `json:"revision"`
}

func readPiExtensionSettings(dir string) (piExtensionSettings, error) {
	settings, _, err := readPiSettingsJSON(dir)
	value := piExtensionSettings{LumoUse: true, Questions: true, Extensions: []piOptionalExtension{}, Revision: piSettingsRevision(dir, settings, "lumoUse", "lumoQuestions", "lumoDisabledExtensions", "extensions")}
	if err != nil {
		return value, err
	}
	if raw, ok := settings["lumoUse"]; ok {
		var enabled *bool
		if json.Unmarshal(raw, &enabled) != nil || enabled == nil {
			return value, NewError(CodeValidationFailed, "Invalid Lumo Use setting.")
		}
		value.LumoUse = *enabled
	}
	if raw, ok := settings["lumoQuestions"]; ok {
		var enabled *bool
		if json.Unmarshal(raw, &enabled) != nil || enabled == nil {
			return value, NewError(CodeValidationFailed, "Invalid Questions setting.")
		}
		value.Questions = *enabled
	}
	var disabled []string
	if raw, ok := settings["lumoDisabledExtensions"]; ok && json.Unmarshal(raw, &disabled) != nil {
		return value, NewError(CodeValidationFailed, "Invalid extension settings.")
	}
	paths, err := piLocalExtensionPaths(dir, settings)
	if err != nil {
		return value, err
	}
	for _, path := range paths {
		hash := sha256.Sum256([]byte(path))
		id := hex.EncodeToString(hash[:16])
		enabled := true
		for _, stored := range disabled {
			if stored == id {
				enabled = false
			}
		}
		name := strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
		if name == "index" {
			name = filepath.Base(filepath.Dir(path))
		}
		value.Extensions = append(value.Extensions, piOptionalExtension{ID: id, Name: name, Enabled: enabled, Path: path})
	}
	metadata, _ := json.Marshal(value.Extensions)
	hash := sha256.Sum256(append([]byte(value.Revision), metadata...))
	value.Revision = hex.EncodeToString(hash[:])
	return value, nil
}

func piLocalExtensionPaths(dir string, settings map[string]json.RawMessage) ([]string, error) {
	configured := []string{}
	if raw, ok := settings["extensions"]; ok && json.Unmarshal(raw, &configured) != nil {
		return nil, NewError(CodeValidationFailed, "Invalid Pi extension paths.")
	}
	paths := map[string]bool{}
	add := func(path string) {
		info, err := os.Stat(path)
		if err != nil || !info.Mode().IsRegular() {
			return
		}
		switch filepath.Ext(path) {
		case ".ts", ".js", ".mjs", ".cjs":
			paths[filepath.Clean(path)] = true
		}
	}
	scan := func(path string) {
		info, err := os.Stat(path)
		if err != nil {
			return
		}
		if !info.IsDir() {
			add(path)
			return
		}
		entries, err := os.ReadDir(path)
		if err != nil {
			return
		}
		for _, entry := range entries {
			child := filepath.Join(path, entry.Name())
			if entry.IsDir() {
				for _, name := range []string{"index.ts", "index.js"} {
					candidate := filepath.Join(child, name)
					if info, err := os.Stat(candidate); err == nil && info.Mode().IsRegular() {
						add(candidate)
						break
					}
				}
			} else {
				add(child)
			}
		}
	}
	resolve := func(path string) string {
		if strings.HasPrefix(path, "~/") {
			home, _ := os.UserHomeDir()
			return filepath.Join(home, strings.TrimPrefix(path, "~/"))
		}
		if !filepath.IsAbs(path) {
			return filepath.Join(dir, path)
		}
		return path
	}
	scan(filepath.Join(dir, "extensions"))
	exclusions := []string{}
	for _, path := range configured {
		if strings.HasPrefix(path, "!") || strings.HasPrefix(path, "-") {
			exclusions = append(exclusions, resolve(path[1:]))
			continue
		}
		path = strings.TrimPrefix(path, "+")
		if strings.HasPrefix(path, "npm:") || strings.HasPrefix(path, "git:") || strings.HasPrefix(path, "builtin:") || strings.Contains(path, "://") {
			continue
		}
		matches, err := filepath.Glob(resolve(path))
		if err != nil {
			return nil, NewError(CodeValidationFailed, "Invalid Pi extension path pattern.")
		}
		for _, match := range matches {
			scan(match)
		}
	}
	result := []string{}
	for path := range paths {
		excluded := false
		for _, pattern := range exclusions {
			match, _ := filepath.Match(pattern, path)
			if match || strings.HasPrefix(path, filepath.Clean(pattern)+string(filepath.Separator)) {
				excluded = true
			}
		}
		if !excluded {
			result = append(result, path)
		}
	}
	sort.Strings(result)
	return result, nil
}

func piExtensionArgs(settings piExtensionSettings) []string {
	args := []string{}
	for _, extension := range settings.Extensions {
		if extension.Enabled {
			args = append(args, "--extension", extension.Path)
		}
	}
	return args
}

func (s *Server) handlePiExtensions(w http.ResponseWriter, r *http.Request) {
	dir, err := s.piAgentDir()
	if err != nil {
		WriteError(w, err)
		return
	}
	if r.Method == http.MethodGet {
		value, err := readPiExtensionSettings(dir)
		if err != nil {
			WriteError(w, err)
			return
		}
		WriteData(w, value)
		return
	}
	var req struct {
		RequestID  string `json:"requestId"`
		Revision   string `json:"revision"`
		LumoUse    *bool  `json:"lumoUse"`
		Questions  *bool  `json:"questions"`
		Extensions *[]struct {
			ID      string `json:"id"`
			Enabled *bool  `json:"enabled"`
		} `json:"extensions"`
	}
	if strictjson.Decode(w, r, maxBodyBytes, &req) != nil || !validRequestID(req.RequestID) || req.LumoUse == nil {
		WriteError(w, NewError(CodeValidationFailed, "Choose whether to enable Lumo Use."))
		return
	}
	s.mutate(w, req.RequestID, func(w http.ResponseWriter) {
		s.pi.operation.Lock()
		defer s.pi.operation.Unlock()
		settings, _, err := readPiSettingsJSON(dir)
		if err != nil {
			WriteError(w, err)
			return
		}
		current, err := readPiExtensionSettings(dir)
		if err != nil {
			WriteError(w, err)
			return
		}
		if current.Revision != req.Revision {
			WriteError(w, NewError(CodeConflict, "Pi settings changed on the server. Reload before saving."))
			return
		}
		if req.Extensions != nil {
			if len(*req.Extensions) != len(current.Extensions) {
				WriteError(w, NewError(CodeValidationFailed, "Choose from the installed extensions."))
				return
			}
			known := map[string]bool{}
			for _, extension := range current.Extensions {
				known[extension.ID] = true
			}
			disabled := []string{}
			for _, extension := range *req.Extensions {
				if !known[extension.ID] || extension.Enabled == nil {
					WriteError(w, NewError(CodeValidationFailed, "Choose from the installed extensions."))
					return
				}
				delete(known, extension.ID)
				if !*extension.Enabled {
					disabled = append(disabled, extension.ID)
				}
			}
			sort.Strings(disabled)
			settings["lumoDisabledExtensions"], _ = json.Marshal(disabled)
		}
		if req.Questions != nil {
			settings["lumoQuestions"], _ = json.Marshal(*req.Questions)
		}
		settings["lumoUse"], _ = json.Marshal(*req.LumoUse)
		if err := writePiSettingsJSON(dir, settings); err != nil {
			WriteError(w, err)
			return
		}
		if !*req.LumoUse {
			s.piRPC.mu.Lock()
			processes := make([]*piProcess, 0, len(s.piRPC.processes))
			for _, p := range s.piRPC.processes {
				processes = append(processes, p)
			}
			s.piRPC.mu.Unlock()
			for _, p := range processes {
				p.disableDesktop()
			}
		}
		value, err := readPiExtensionSettings(dir)
		if err != nil {
			WriteError(w, err)
			return
		}
		WriteData(w, value)
	})
}
