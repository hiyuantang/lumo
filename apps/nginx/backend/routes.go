// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"context"
	"errors"
	"lumo/apps/nginx/backend/websites"
	. "lumo/plugin"
	"lumo/plugin/strictjson"
	"net/http"
	"os"
	"strings"
	"time"
)

func (s *Server) handleWebsites(w http.ResponseWriter, r *http.Request) {
	if s.Websites == nil {
		Unavailable(w, r)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	var data any
	var err error
	if strings.HasSuffix(r.URL.Path, "/logs") {
		data, err = s.Websites.Logs(ctx, r.URL.Query().Get("kind"))
	} else {
		data, err = s.Websites.Snapshot(ctx)
	}
	if err != nil {
		writeServerAppError(w, err)
		return
	}
	WriteData(w, data)
}

func (s *Server) handleWebsiteSave(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RequestID        string              `json:"requestId"`
		ID               string              `json:"id"`
		Definition       websites.Definition `json:"definition"`
		ExpectedRevision string              `json:"expectedRevision"`
	}
	if err := strictjson.Decode(w, r, MaxBodyBytes, &req); err != nil || !ValidRequestID(req.RequestID) {
		WriteError(w, NewError(CodeValidationFailed, "A typed website definition is required."))
		return
	}
	if err := websites.Validate(req.ID, req.Definition, req.ExpectedRevision); err != nil {
		WriteError(w, NewError(CodeValidationFailed, err.Error()))
		return
	}
	ForwardBrokerAction(w, r, BrokerAction{RequestID: req.RequestID, Action: "websites.save", Arguments: map[string]any{"siteId": req.ID, "website": req.Definition}, Expected: map[string]any{"revision": req.ExpectedRevision}}, 50*time.Second)
}

func writeServerAppError(w http.ResponseWriter, err error) {
	code := CodeInternal
	switch {
	case errors.Is(err, websites.ErrValidation):
		code = CodeValidationFailed
	case errors.Is(err, os.ErrPermission):
		code = CodeForbidden
	case errors.Is(err, os.ErrNotExist):
		code = CodeNotFound
	}
	WriteError(w, NewError(code, err.Error()))
}
