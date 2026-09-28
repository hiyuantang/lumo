// SPDX-License-Identifier: AGPL-3.0-only
package httpapi

import (
	"context"
	"encoding/json"
	"lumo/server/internal/broker"
	"lumo/server/internal/files"
	"lumo/server/internal/strictjson"
	"net/http"
	"strings"
	"time"
)

func (s *Server) handleTrashList(w http.ResponseWriter, r *http.Request) {
	items, err := files.ListTrash()
	if err != nil {
		WriteError(w, err)
		return
	}
	if s.deps.BrokerSocket != "" {
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		protected, err := broker.AppTrash(ctx, s.deps.BrokerSocket)
		if err != nil {
			WriteError(w, NewError(CodeUnavailable, "App Trash is unavailable. Try again."))
			return
		}
		items = append(items, protected...)
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
	if strings.HasPrefix(req.Item.ID, "apptrash_") {
		s.forwardBrokerAction(w, r, brokerAction{RequestID: req.RequestID, Action: "apps.trashRestore", Arguments: map[string]any{"item": req.Item}}, time.Minute)
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
	if len(req.Items) == 0 || len(req.Items) > 10000 {
		WriteError(w, NewError(CodeValidationFailed, "Choose between 1 and 10000 Trash items."))
		return
	}
	protected := []files.TrashSelection{}
	personal := []files.TrashSelection{}
	for _, item := range req.Items {
		if strings.HasPrefix(item.ID, "apptrash_") {
			protected = append(protected, item)
		} else {
			personal = append(personal, item)
		}
	}
	if len(protected) > 0 {
		if s.deps.BrokerSocket == "" {
			s.handleUnavailable(w, r)
			return
		}
		payload, _ := json.Marshal(brokerAction{RequestID: req.RequestID, Action: "apps.trashDelete", Arguments: map[string]any{"items": protected}, SessionToken: r.Header.Get("X-Lumo-Session")})
		ctx, cancel := context.WithTimeout(r.Context(), time.Minute)
		defer cancel()
		status, _, body, err := broker.CallAction(ctx, s.deps.BrokerSocket, payload)
		if err != nil {
			WriteError(w, NewError(CodeUnavailable, "App Trash is unavailable."))
			return
		}
		if status != http.StatusOK {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(status)
			_, _ = w.Write(body)
			return
		}
	}
	s.mutate(w, req.RequestID, func(w http.ResponseWriter) {
		if len(personal) == 0 {
			WriteData(w, map[string]any{"deleted": true})
			return
		}
		if err := files.DeleteTrash(personal); err != nil {
			WriteError(w, err)
			return
		}
		WriteData(w, map[string]any{"deleted": true})
	})
}
