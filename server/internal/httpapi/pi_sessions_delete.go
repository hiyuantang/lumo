// SPDX-License-Identifier: AGPL-3.0-only
package httpapi

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"lumo/server/internal/strictjson"
)

func piProjectKey(project string) string {
	hash := sha256.Sum256([]byte(project))
	return hex.EncodeToString(hash[:16])
}
func (s *Server) handlePiArchivedSessions(w http.ResponseWriter, r *http.Request) {
	base := filepath.Join(s.pi.home, ".local/state/lumo/pi-sessions")
	dirs, err := os.ReadDir(base)
	if err != nil && !os.IsNotExist(err) {
		WriteError(w, err)
		return
	}
	result := []piSession{}
	for _, dir := range dirs {
		if !dir.IsDir() || dir.Type()&os.ModeSymlink != 0 {
			continue
		}
		archive := filepath.Join(base, dir.Name(), ".archive")
		info, err := os.Lstat(archive)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			WriteError(w, err)
			return
		}
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			continue
		}
		items, err := readPiSessions(archive)
		if err != nil {
			WriteError(w, err)
			return
		}
		for _, item := range items {
			if filepath.IsAbs(item.Project) && piProjectKey(item.Project) == dir.Name() {
				result = append(result, item)
			}
		}
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Modified > result[j].Modified })
	WriteData(w, map[string]any{"sessions": result})
}
func (s *Server) handlePiArchiveSession(w http.ResponseWriter, r *http.Request) {
	s.changePiSession(w, r, "archive")
}
func (s *Server) handlePiRestoreSession(w http.ResponseWriter, r *http.Request) {
	s.changePiSession(w, r, "restore")
}
func (s *Server) handlePiDeleteSession(w http.ResponseWriter, r *http.Request) {
	s.changePiSession(w, r, "delete")
}
func (s *Server) changePiSession(w http.ResponseWriter, r *http.Request, action string) {
	var req struct {
		RequestID string `json:"requestId"`
		Project   string `json:"project"`
		Session   string `json:"session"`
	}
	if err := strictjson.Decode(w, r, maxBodyBytes, &req); err != nil || !validRequestID(req.RequestID) || req.Session == "" || filepath.Base(req.Session) != req.Session || strings.ContainsAny(req.Session, "\\\x00") || !strings.HasSuffix(req.Session, ".jsonl") || !filepath.IsAbs(req.Project) || filepath.Clean(req.Project) != req.Project {
		WriteError(w, NewError(CodeValidationFailed, "Choose a saved conversation."))
		return
	}
	s.mutate(w, req.RequestID, func(w http.ResponseWriter) {
		if !s.pi.operation.TryLock() {
			WriteError(w, NewError(CodeConflict, "Wait for the current Pi operation to finish."))
			return
		}
		defer s.pi.operation.Unlock()
		project := req.Project
		dir := filepath.Join(s.pi.home, ".local/state/lumo/pi-sessions", piProjectKey(project))
		if action != "delete" {
			resolved, folder, err := s.piFolder(project)
			if err != nil || resolved != project {
				WriteError(w, NewError(CodeValidationFailed, "Project folder is unavailable or has moved."))
				return
			}
			dir = folder
		}
		s.piRPC.mu.Lock()
		defer s.piRPC.mu.Unlock()
		if action != "delete" {
			for _, process := range s.piRPC.processes {
				if process.project != project {
					continue
				}
				select {
				case <-process.done:
				default:
					WriteError(w, NewError(CodeConflict, "Close this project's Pi connection before moving a conversation."))
					return
				}
			}
		}
		info, err := os.Lstat(dir)
		if os.IsNotExist(err) && action == "delete" {
			WriteData(w, map[string]any{"deleted": true})
			return
		}
		if err != nil {
			WriteError(w, err)
			return
		}
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			WriteError(w, NewError(CodeValidationFailed, "Linked session folders cannot be modified here."))
			return
		}
		root, err := os.OpenRoot(dir)
		if err != nil {
			WriteError(w, err)
			return
		}
		defer root.Close()
		if action == "archive" {
			if err := root.Mkdir(".archive", 0700); err != nil && !os.IsExist(err) {
				WriteError(w, err)
				return
			}
		}
		info, err = root.Lstat(".archive")
		if os.IsNotExist(err) && action == "delete" {
			WriteData(w, map[string]any{"deleted": true})
			return
		}
		if err != nil {
			WriteError(w, err)
			return
		}
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			WriteError(w, NewError(CodeValidationFailed, "Linked archive folders cannot be modified here."))
			return
		}
		from, to := req.Session, filepath.Join(".archive", req.Session)
		if action != "archive" {
			from, to = to, from
		}
		info, err = root.Lstat(from)
		if os.IsNotExist(err) && action == "delete" {
			WriteData(w, map[string]any{"deleted": true})
			return
		}
		if err != nil {
			WriteError(w, NewError(CodeNotFound, "Conversation is unavailable. Refresh and try again."))
			return
		}
		if !info.Mode().IsRegular() {
			WriteError(w, NewError(CodeValidationFailed, "Only regular conversation files can be modified."))
			return
		}
		if action == "archive" {
			file, err := root.Open(from)
			if err != nil {
				WriteError(w, err)
				return
			}
			var header struct {
				Type string `json:"type"`
				Cwd  string `json:"cwd"`
			}
			err = json.NewDecoder(io.LimitReader(file, 1<<20)).Decode(&header)
			file.Close()
			if err != nil || header.Type != "session" || header.Cwd != project {
				WriteError(w, NewError(CodeValidationFailed, "Conversation header does not match this project."))
				return
			}
		}
		if action == "delete" {
			if err := root.Remove(from); err != nil && !os.IsNotExist(err) {
				WriteError(w, err)
				return
			}
			WriteData(w, map[string]any{"deleted": true})
			return
		}
		if _, err := root.Lstat(to); !os.IsNotExist(err) {
			WriteError(w, NewError(CodeConflict, "A conversation with this filename already exists. Nothing was replaced."))
			return
		}
		if err := root.Rename(from, to); err != nil {
			WriteError(w, err)
			return
		}
		WriteData(w, map[string]any{"moved": true})
	})
}
