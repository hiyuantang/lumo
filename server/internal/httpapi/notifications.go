// SPDX-License-Identifier: AGPL-3.0-only
package httpapi

import (
	"lumo/server/internal/notifications"
	"lumo/server/internal/strictjson"
	"net/http"
)

func (s *Server) handleNotifications(w http.ResponseWriter, r *http.Request) {
	store := notifications.Store{Home: s.home}
	if r.Method == "GET" {
		items, err := store.List()
		if err != nil {
			WriteError(w, err)
			return
		}
		WriteData(w, items)
		return
	}
	if r.URL.Path == "/api/v1/notifications/send" {
		var req struct {
			App string `json:"app"`
			notifications.Message
		}
		if err := strictjson.Decode(w, r, 16384, &req); err != nil {
			WriteError(w, NewError(CodeValidationFailed, "Invalid notification"))
			return
		}
		item, err := notifications.SendNative(s.home, req.App, req.Message)
		if err != nil {
			WriteError(w, NewError(CodeValidationFailed, err.Error()))
			return
		}
		WriteData(w, item)
		return
	}
	var req struct {
		Action string   `json:"action"`
		IDs    []string `json:"ids"`
	}
	if err := strictjson.Decode(w, r, 32768, &req); err != nil {
		WriteError(w, NewError(CodeValidationFailed, "Invalid notification change"))
		return
	}
	if err := store.Change(req.Action, req.IDs); err != nil {
		WriteError(w, NewError(CodeValidationFailed, err.Error()))
		return
	}
	WriteData(w, map[string]bool{"ok": true})
}
