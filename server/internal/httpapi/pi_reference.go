// SPDX-License-Identifier: AGPL-3.0-only
package httpapi

import (
	"lumo/server/internal/pihistory"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

func (s *Server) handlePiReference(w http.ResponseWriter, r *http.Request) {
	project, dir, err := s.piFolder(r.URL.Query().Get("project"))
	if err != nil {
		WriteError(w, NewError(CodeValidationFailed, err.Error()))
		return
	}
	session := r.URL.Query().Get("session")
	if session == "" || filepath.Base(session) != session || strings.ContainsAny(session, "/\\\x00") || !strings.HasSuffix(session, ".jsonl") {
		WriteError(w, NewError(CodeValidationFailed, "Choose a saved conversation."))
		return
	}
	path := filepath.Join(dir, session)
	if _, err := pihistory.Read(path, pihistory.Options{Before: 2}); err != nil {
		WriteError(w, NewError(CodeNotFound, "This saved conversation is unavailable."))
		return
	}
	reader, err := os.Executable()
	if err != nil {
		WriteError(w, err)
		return
	}
	WriteData(w, map[string]string{"project": project, "session": session, "path": path, "reader": reader})
}
