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
	"unicode/utf8"

	"lumo/server/internal/strictjson"
)

const piInstructionLimit = 128 << 10

type piInstruction struct {
	Kind     string `json:"kind"`
	Path     string `json:"path"`
	Content  string `json:"content"`
	Revision string `json:"revision"`
	Exists   bool   `json:"exists"`
}

func (s *Server) piInstructionPath(kind string) (string, error) {
	names := []string{"AGENTS.override.md", "AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"}
	if kind == "append" {
		names = []string{"APPEND_SYSTEM.md"}
	} else if kind != "instructions" {
		return "", NewError(CodeValidationFailed, "Choose an instruction file.")
	}
	dir, err := s.piAgentDir()
	if err != nil {
		return "", err
	}
	for _, name := range names {
		path := filepath.Join(dir, name)
		info, err := os.Lstat(path)
		if err == nil {
			if !info.Mode().IsRegular() {
				return "", NewError(CodeValidationFailed, "Edit the linked instruction file directly in Files.")
			}
			return path, nil
		}
		if !errors.Is(err, os.ErrNotExist) {
			return "", err
		}
	}
	name := "AGENTS.md"
	if kind == "append" {
		name = "APPEND_SYSTEM.md"
	}
	return filepath.Join(dir, name), nil
}

func (s *Server) readPiInstruction(kind string) (piInstruction, error) {
	path, err := s.piInstructionPath(kind)
	result := piInstruction{Kind: kind, Path: path}
	if err != nil {
		return result, err
	}
	f, err := os.Open(path)
	if errors.Is(err, os.ErrNotExist) {
		return result, nil
	}
	if err != nil {
		return result, err
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, piInstructionLimit+1))
	if err != nil {
		return result, err
	}
	if len(data) > piInstructionLimit || !utf8.Valid(data) {
		return result, NewError(CodeValidationFailed, "Instructions must be UTF-8 text no larger than 128 KiB.")
	}
	hash := sha256.Sum256(append([]byte(path+"\x00"), data...))
	result.Content = string(data)
	result.Revision = "sha256:" + hex.EncodeToString(hash[:])
	result.Exists = true
	return result, nil
}

func (s *Server) handlePiSettings(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		result, err := s.readPiInstruction(r.URL.Query().Get("kind"))
		if err != nil {
			WriteError(w, err)
			return
		}
		WriteData(w, result)
		return
	}
	var req struct {
		Kind      string `json:"kind"`
		Content   string `json:"content"`
		Revision  string `json:"revision"`
		RequestID string `json:"requestId"`
	}
	if strictjson.Decode(w, r, maxBodyBytes, &req) != nil || !validRequestID(req.RequestID) || len(req.Content) > piInstructionLimit || !utf8.ValidString(req.Content) {
		WriteError(w, NewError(CodeValidationFailed, "Instructions must be UTF-8 text no larger than 128 KiB."))
		return
	}
	s.mutate(w, req.RequestID, func(w http.ResponseWriter) {
		s.pi.operation.Lock()
		defer s.pi.operation.Unlock()
		before, err := s.readPiInstruction(req.Kind)
		if err != nil {
			WriteError(w, err)
			return
		}
		if before.Revision != req.Revision {
			WriteError(w, NewError(CodeConflict, "Instructions changed on the server. Reload before saving."))
			return
		}
		if err := os.MkdirAll(filepath.Dir(before.Path), 0700); err != nil {
			WriteError(w, err)
			return
		}
		temp, err := os.CreateTemp(filepath.Dir(before.Path), ".lumo-pi-*")
		if err != nil {
			WriteError(w, err)
			return
		}
		defer os.Remove(temp.Name())
		if _, err = temp.WriteString(req.Content); err == nil {
			err = temp.Sync()
		}
		closeErr := temp.Close()
		if err == nil {
			err = closeErr
		}
		if err == nil {
			if before.Exists {
				err = os.Rename(temp.Name(), before.Path)
			} else {
				err = os.Link(temp.Name(), before.Path)
			}
		}
		if err != nil {
			WriteError(w, err)
			return
		}
		result, err := s.readPiInstruction(req.Kind)
		if err != nil {
			WriteError(w, err)
			return
		}
		WriteData(w, result)
	})
}
