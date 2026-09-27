// SPDX-License-Identifier: AGPL-3.0-only
package httpapi

import (
	"context"
	"net/http"
	"regexp"
	"time"

	"lumo/server/internal/network"
	"lumo/server/internal/strictjson"
)

func (s *Server) handleNetworkSnapshot(w http.ResponseWriter, r *http.Request) {
	if s.deps.Network == nil || !s.deps.Network.Available() {
		s.handleUnavailable(w, r)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	snapshot, err := s.deps.Network.Snapshot(ctx)
	if err != nil {
		WriteError(w, NewError(CodeUnavailable, "Network configuration is unavailable."))
		return
	}
	WriteData(w, snapshot)
}

func (s *Server) handleNetworkApply(w http.ResponseWriter, r *http.Request) {
	if s.deps.BrokerSocket == "" {
		s.handleUnavailable(w, r)
		return
	}
	var req struct {
		RequestID        string         `json:"requestId"`
		Config           network.Config `json:"config"`
		ExpectedRevision string         `json:"expectedRevision"`
		ConfirmTimeout   int            `json:"confirmTimeoutSec"`
	}
	if err := strictjson.Decode(w, r, maxBodyBytes, &req); err != nil {
		WriteError(w, NewError(CodeValidationFailed, "Body must be a JSON object."))
		return
	}
	if !validRequestID(req.RequestID) {
		WriteError(w, NewError(CodeValidationFailed, "requestId is required."))
		return
	}
	if !network.ValidRevision(req.ExpectedRevision) {
		WriteError(w, NewError(CodeValidationFailed, "expectedRevision is required."))
		return
	}
	if req.ConfirmTimeout == 0 {
		req.ConfirmTimeout = network.DefaultConfirmTimeout
	}
	if req.ConfirmTimeout < network.MinConfirmTimeout || req.ConfirmTimeout > network.MaxConfirmTimeout {
		WriteError(w, NewError(CodeValidationFailed, "confirmTimeoutSec must be between 30 and 300."))
		return
	}
	if err := network.ValidateConfig(req.Config); err != nil {
		WriteError(w, NewError(CodeValidationFailed, err.Error()))
		return
	}
	s.forwardBrokerAction(w, r, brokerAction{
		RequestID: req.RequestID,
		Action:    "network.applyWithRollback",
		Arguments: map[string]any{
			"config":            req.Config,
			"confirmTimeoutSec": req.ConfirmTimeout,
		},
		Expected: map[string]any{"revision": req.ExpectedRevision},
	}, 45*time.Second)
}

func (s *Server) handleNetworkConfirm(w http.ResponseWriter, r *http.Request) {
	if s.deps.BrokerSocket == "" {
		s.handleUnavailable(w, r)
		return
	}
	var req struct {
		RequestID string `json:"requestId"`
		Token     string `json:"token"`
	}
	if err := strictjson.Decode(w, r, maxBodyBytes, &req); err != nil {
		WriteError(w, NewError(CodeValidationFailed, "Body must be a JSON object."))
		return
	}
	if !validRequestID(req.RequestID) {
		WriteError(w, NewError(CodeValidationFailed, "requestId is required."))
		return
	}
	if !networkConfirmToken.MatchString(req.Token) {
		WriteError(w, NewError(CodeValidationFailed, "token must be a network confirmation token."))
		return
	}
	s.forwardBrokerAction(w, r, brokerAction{
		RequestID: req.RequestID,
		Action:    "network.confirm",
		Arguments: map[string]any{"token": req.Token},
		Expected:  map[string]any{},
	}, 15*time.Second)
}

var networkConfirmToken = regexp.MustCompile(`^[a-f0-9]{64}$`)
