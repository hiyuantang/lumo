// SPDX-License-Identifier: AGPL-3.0-only
package httpapi

import (
	"lumo/server/internal/files"
	"lumo/server/internal/strictjson"
	"net/http"
)

func (s *Server) handleTrashList(w http.ResponseWriter, r *http.Request) {
	items, err := files.ListTrash()
	if err != nil {
		WriteError(w, err)
		return
	}
	WriteData(w, map[string]any{"items": items})
}

func (s *Server) handleTrashRestore(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RequestID string               `json:"requestId"`
		Item      files.TrashSelection `json:"item"`
	}
	if err := strictjson.Decode(w, r, maxBodyBytes, &req); err != nil || !validRequestID(req.RequestID) {
		WriteError(w, NewError(CodeValidationFailed, "Choose a Trash item and provide a requestId."))
		return
	}
	s.mutate(w, req.RequestID, func(w http.ResponseWriter) {
		path, err := files.RestoreTrash(req.Item)
		if err != nil {
			WriteError(w, err)
			return
		}
		WriteData(w, map[string]any{"path": path})
	})
}

func (s *Server) handleTrashDelete(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RequestID string                 `json:"requestId"`
		Items     []files.TrashSelection `json:"items"`
	}
	if err := strictjson.Decode(w, r, maxBodyBytes, &req); err != nil || !validRequestID(req.RequestID) {
		WriteError(w, NewError(CodeValidationFailed, "Choose Trash items and provide a requestId."))
		return
	}
	s.mutate(w, req.RequestID, func(w http.ResponseWriter) {
		if err := files.DeleteTrash(req.Items); err != nil {
			WriteError(w, err)
			return
		}
		WriteData(w, map[string]any{"deleted": true})
	})
}
