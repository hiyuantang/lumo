// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"unicode/utf8"

	"lumo/server/internal/files"
	"lumo/server/internal/strictjson"
)

type piTemplate struct {
	Name     string `json:"name"`
	Content  string `json:"content"`
	Revision string `json:"revision"`
	Path     string `json:"path"`
}

var piTemplateName = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$`)

func (s *Server) piTemplateDir() (string, error) {
	dir, err := s.piAgentDir()
	if err != nil {
		return "", err
	}
	dir = filepath.Join(dir, "prompts")
	if info, err := os.Lstat(dir); err == nil && !info.IsDir() {
		return "", NewError(CodeValidationFailed, "The prompts folder must be a regular directory.")
	} else if err != nil && !errors.Is(err, os.ErrNotExist) {
		return "", err
	}
	return dir, nil
}
func readPiTemplate(dir, name string) (piTemplate, error) {
	value := piTemplate{Name: name, Path: filepath.Join(dir, name+".md")}
	info, err := os.Lstat(value.Path)
	if errors.Is(err, os.ErrNotExist) {
		return value, nil
	}
	if err != nil {
		return value, err
	}
	if !info.Mode().IsRegular() {
		return value, NewError(CodeValidationFailed, "Linked templates must be edited in Files.")
	}
	f, err := os.Open(value.Path)
	if err != nil {
		return value, err
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, piInstructionLimit+1))
	if err != nil {
		return value, err
	}
	if len(data) > piInstructionLimit || !utf8.Valid(data) {
		return value, NewError(CodeValidationFailed, "Templates must be UTF-8 text no larger than 128 KiB.")
	}
	hash := sha256.Sum256(data)
	value.Content = string(data)
	value.Revision = "sha256:" + hex.EncodeToString(hash[:])
	return value, nil
}
func (s *Server) handlePiTemplates(w http.ResponseWriter, r *http.Request) {
	dir, err := s.piTemplateDir()
	if err != nil {
		WriteError(w, err)
		return
	}
	if r.Method == http.MethodGet {
		entries, err := os.ReadDir(dir)
		if err != nil && !errors.Is(err, os.ErrNotExist) {
			WriteError(w, err)
			return
		}
		templates := []piTemplate{}
		total := 0
		for _, entry := range entries {
			name := strings.TrimSuffix(entry.Name(), ".md")
			if !strings.HasSuffix(entry.Name(), ".md") || !piTemplateName.MatchString(name) || entry.Type()&os.ModeSymlink != 0 || entry.IsDir() {
				continue
			}
			value, err := readPiTemplate(dir, name)
			if err != nil {
				WriteError(w, err)
				return
			}
			total += len(value.Content)
			if len(templates) >= 100 || total > 2<<20 {
				WriteError(w, NewError(CodeValidationFailed, "Keep at most 100 templates totaling 2 MiB in the prompts folder."))
				return
			}
			templates = append(templates, value)
		}
		sort.Slice(templates, func(i, j int) bool { return templates[i].Name < templates[j].Name })
		WriteData(w, map[string]any{"templates": templates})
		return
	}
	var req struct {
		Name      string `json:"name"`
		Content   string `json:"content"`
		Revision  string `json:"revision"`
		Delete    bool   `json:"delete"`
		RequestID string `json:"requestId"`
	}
	if strictjson.Decode(w, r, maxBodyBytes, &req) != nil || !validRequestID(req.RequestID) || !piTemplateName.MatchString(req.Name) || len(req.Content) > piInstructionLimit || !utf8.ValidString(req.Content) {
		WriteError(w, NewError(CodeValidationFailed, "Use a short template name with letters, numbers, hyphens or underscores, and UTF-8 content up to 128 KiB."))
		return
	}
	if req.Name == "undo" || req.Name == "rename" || req.Name == "compact" {
		WriteError(w, NewError(CodeValidationFailed, "That name is already used by a chat command."))
		return
	}
	s.mutate(w, req.RequestID, func(w http.ResponseWriter) {
		s.pi.operation.Lock()
		defer s.pi.operation.Unlock()
		before, err := readPiTemplate(dir, req.Name)
		if err != nil {
			WriteError(w, err)
			return
		}
		if before.Revision != req.Revision {
			WriteError(w, NewError(CodeConflict, "This template changed. Reload before saving."))
			return
		}
		if req.Delete {
			if before.Revision != "" {
				_, err = files.Trash(before.Path)
			}
			if err != nil {
				WriteError(w, err)
				return
			}
			WriteData(w, map[string]bool{"deleted": true})
			return
		}
		if strings.TrimSpace(req.Content) == "" {
			WriteError(w, NewError(CodeValidationFailed, "Write a prompt first."))
			return
		}
		if err = os.MkdirAll(dir, 0700); err != nil {
			WriteError(w, err)
			return
		}
		tmp, err := os.CreateTemp(dir, ".lumo-template-*")
		if err != nil {
			WriteError(w, err)
			return
		}
		defer os.Remove(tmp.Name())
		if _, err = tmp.WriteString(req.Content); err == nil {
			err = tmp.Sync()
		}
		closeErr := tmp.Close()
		if err == nil {
			err = closeErr
		}
		if err == nil {
			if before.Revision == "" {
				err = os.Link(tmp.Name(), before.Path)
			} else {
				err = os.Rename(tmp.Name(), before.Path)
			}
		}
		if err != nil {
			WriteError(w, err)
			return
		}
		value, err := readPiTemplate(dir, req.Name)
		if err != nil {
			WriteError(w, err)
			return
		}
		WriteData(w, value)
	})
}
