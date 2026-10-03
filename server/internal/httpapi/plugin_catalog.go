// SPDX-License-Identifier: AGPL-3.0-only
package httpapi

import (
	"encoding/json"
	"errors"
	"lumo/server/internal/appplugins"
	"lumo/server/internal/strictjson"
	"net/http"
	"strings"
)

const maxPluginBody = 90 << 20

func (s *Server) handlePluginCatalog(w http.ResponseWriter, r *http.Request) {
	WriteData(w, appplugins.Catalog(s.home))
}
func (s *Server) handlePluginImport(w http.ResponseWriter, r *http.Request) {
	var request struct {
		RequestID string            `json:"requestId"`
		Bundle    appplugins.Bundle `json:"bundle"`
	}
	if strictjson.Decode(w, r, maxPluginBody, &request) != nil || !validRequestID(request.RequestID) {
		WriteError(w, NewError(CodeValidationFailed, "Invalid app package."))
		return
	}
	if _, err := appplugins.Import(s.home, request.Bundle); err != nil {
		WriteError(w, NewError(CodeValidationFailed, err.Error()))
		return
	}
	WriteData(w, appplugins.Catalog(s.home))
}
func (s *Server) handlePluginChange(w http.ResponseWriter, r *http.Request) {
	var request struct {
		RequestID string `json:"requestId"`
		appplugins.Change
	}
	if strictjson.Decode(w, r, maxBodyBytes, &request) != nil || !validRequestID(request.RequestID) {
		WriteError(w, NewError(CodeValidationFailed, "Invalid app change."))
		return
	}
	request.Change.RequestID = request.RequestID
	if err := appplugins.Apply(s.home, request.Change); err != nil {
		code := CodeValidationFailed
		if errors.Is(err, appplugins.ErrConflict) {
			code = CodeConflict
		}
		WriteError(w, NewError(code, err.Error()))
		return
	}
	WriteData(w, appplugins.Catalog(s.home))
}
func (s *Server) handlePluginAsset(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(r.PathValue("asset"), "/")
	if len(parts) != 2 {
		http.NotFound(w, r)
		return
	}
	p, err := appplugins.LoadFor(s.home, parts[0])
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if parts[1] == "manifest.json" {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(p.Manifest)
		return
	}
	if !strings.HasSuffix(parts[1], ".js") && !strings.HasSuffix(parts[1], ".css") {
		http.NotFound(w, r)
		return
	}
	bytes, err := p.Asset(parts[1])
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
	if strings.HasSuffix(parts[1], ".css") {
		w.Header().Set("Content-Type", "text/css; charset=utf-8")
	}
	w.Write(bytes)
}
