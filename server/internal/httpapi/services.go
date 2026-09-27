// SPDX-License-Identifier: AGPL-3.0-only
package httpapi

import (
	"context"
	"net/http"
	"regexp"
	"time"

	"lumo/server/internal/services"
	"lumo/server/internal/strictjson"
)

func (s *Server) handleServices(w http.ResponseWriter, r *http.Request) {
	if !s.deps.Services.Available() {
		WriteError(w, services.ErrUnavailable)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	units, err := s.deps.Services.List(ctx)
	if err != nil {
		WriteError(w, err)
		return
	}
	if units == nil {
		units = []services.Unit{}
	}
	WriteData(w, map[string]any{"units": units})
}

func (s *Server) handleServiceDetail(w http.ResponseWriter, r *http.Request) {
	if !s.deps.Services.Available() {
		WriteError(w, services.ErrUnavailable)
		return
	}
	name := r.URL.Query().Get("name")
	if !actionUnitPattern.MatchString(name) {
		WriteError(w, NewError(CodeValidationFailed, "invalid unit name."))
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	detail, err := s.deps.Services.Detail(ctx, name)
	if err != nil {
		WriteError(w, err)
		return
	}
	if detail.Documentation == nil {
		detail.Documentation = []string{}
	}
	if detail.Dependencies == nil {
		detail.Dependencies = []services.Dependency{}
	}
	if detail.Files == nil {
		detail.Files = []services.UnitFile{}
	}
	WriteData(w, detail)
}

var actionNamePattern = regexp.MustCompile(`^(start|stop|restart|reload|enable|disable)$`)

var actionUnitPattern = regexp.MustCompile(`^[a-zA-Z0-9@:._\-]+\.service$`)

func (s *Server) handleServicesAction(w http.ResponseWriter, r *http.Request) {
	if s.deps.BrokerSocket == "" {
		WriteError(w, NewError(CodeUnavailable, "This capability is not available in this build."))
		return
	}
	var req struct {
		RequestID string `json:"requestId"`
		Action    string `json:"action"`
		Unit      string `json:"unit"`
		Expected  *struct {
			ActiveState string `json:"activeState"`
		} `json:"expected"`
	}
	if err := strictjson.Decode(w, r, maxBodyBytes, &req); err != nil {
		WriteError(w, NewError(CodeValidationFailed, "Body must be a JSON object."))
		return
	}
	if !validRequestID(req.RequestID) {
		WriteError(w, NewError(CodeValidationFailed, "requestId is required."))
		return
	}
	if !actionNamePattern.MatchString(req.Action) {
		WriteError(w, NewError(CodeValidationFailed, "unknown action."))
		return
	}
	if !actionUnitPattern.MatchString(req.Unit) {
		WriteError(w, NewError(CodeValidationFailed, "invalid unit name."))
		return
	}
	payload := brokerAction{
		RequestID: req.RequestID,
		Action:    "services." + req.Action,
		Arguments: map[string]any{"unit": req.Unit},
	}
	if req.Expected != nil {
		payload.Expected = req.Expected
	}
	s.forwardBrokerAction(w, r, payload, 30*time.Second)
}
