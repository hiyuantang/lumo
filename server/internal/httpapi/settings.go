// SPDX-License-Identifier: AGPL-3.0-only
package httpapi

import (
	"context"
	"net/http"
	"time"

	"lumo/server/internal/hostsettings"
	"lumo/server/internal/strictjson"
)

func (s *Server) handleSystemSettings(w http.ResponseWriter, r *http.Request) {
	if s.deps.Settings == nil {
		s.handleUnavailable(w, r)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	snapshot, err := s.deps.Settings.Snapshot(ctx)
	if err != nil {
		WriteError(w, NewError(CodeUnavailable, "System settings are unavailable on this host."))
		return
	}
	WriteData(w, snapshot)
}

func (s *Server) handleTimezones(w http.ResponseWriter, r *http.Request) {
	if s.deps.Settings == nil {
		s.handleUnavailable(w, r)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	zones, err := s.deps.Settings.Timezones(ctx)
	if err != nil {
		WriteError(w, NewError(CodeUnavailable, "The server's time zones are unavailable."))
		return
	}
	WriteData(w, map[string]any{"timezones": zones})
}

func (s *Server) handleSettingsApply(w http.ResponseWriter, r *http.Request) {
	if s.deps.BrokerSocket == "" {
		s.handleUnavailable(w, r)
		return
	}
	var req struct {
		RequestID        string              `json:"requestId"`
		ExpectedRevision string              `json:"expectedRevision"`
		Change           hostsettings.Change `json:"change"`
	}
	if err := strictjson.Decode(w, r, maxBodyBytes, &req); err != nil {
		WriteError(w, NewError(CodeValidationFailed, "Body must contain a typed settings change."))
		return
	}
	if !validRequestID(req.RequestID) || !hostsettings.ValidRevision(req.ExpectedRevision) {
		WriteError(w, NewError(CodeValidationFailed, "requestId and expectedRevision are required."))
		return
	}
	if err := req.Change.Validate(); err != nil {
		WriteError(w, NewError(CodeValidationFailed, err.Error()))
		return
	}
	s.forwardBrokerAction(w, r, brokerAction{
		RequestID: req.RequestID,
		Action:    "system.settings",
		Arguments: map[string]any{"change": req.Change},
		Expected:  map[string]any{"revision": req.ExpectedRevision},
	}, 35*time.Second)
}
