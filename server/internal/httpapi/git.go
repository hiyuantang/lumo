// SPDX-License-Identifier: AGPL-3.0-only
package httpapi

import (
	"errors"
	"net/http"

	"lumo/server/internal/gitrepo"
	"lumo/server/internal/strictjson"
)

func (s *Server) handleGit(w http.ResponseWriter, r *http.Request) {
	if !s.gitMu.TryLock() {
		WriteError(w, NewError(CodeBusy, "Git is busy. Wait for the current operation to finish."))
		return
	}
	defer s.gitMu.Unlock()
	if r.Method == http.MethodPost {
		var req struct {
			RequestID string `json:"requestId"`
			gitrepo.Action
		}
		if err := strictjson.Decode(w, r, maxBodyBytes, &req); err != nil || !validRequestID(req.RequestID) {
			WriteError(w, NewError(CodeValidationFailed, "Provide a valid Git action."))
			return
		}
		s.mutate(w, "git:"+req.RequestID, func(w http.ResponseWriter) {
			if err := gitrepo.Run(r.Context(), req.Action); err != nil {
				code := CodeConflict
				if errors.Is(err, gitrepo.ErrStale) {
					code = CodeStaleRevision
				}
				WriteError(w, NewError(code, err.Error()))
				return
			}
			WriteData(w, map[string]bool{"done": true})
		})
		return
	}
	query := r.URL.Query()
	if r.URL.Path == "/api/v1/git/diff" {
		result, err := gitrepo.GetDiff(r.Context(), query.Get("path"), query.Get("file"), query.Get("commit"), query.Get("staged") == "true")
		if err != nil {
			WriteError(w, NewError(CodeValidationFailed, err.Error()))
			return
		}
		WriteData(w, result)
		return
	}
	result, err := gitrepo.Read(r.Context(), query.Get("path"))
	if err != nil {
		WriteError(w, NewError(CodeValidationFailed, err.Error()))
		return
	}
	WriteData(w, result)
}
