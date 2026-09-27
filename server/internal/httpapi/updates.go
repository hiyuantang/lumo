// SPDX-License-Identifier: AGPL-3.0-only
package httpapi

import (
	"net/http"
	"regexp"
	"time"

	"lumo/server/internal/strictjson"
)

var planIDPattern = regexp.MustCompile(`^pln_[a-f0-9]{24}$`)

func (s *Server) handleUpdatesRefresh(w http.ResponseWriter, r *http.Request) {
	if s.deps.BrokerSocket == "" {
		s.handleUnavailable(w, r)
		return
	}
	requestID, ok := decodeUpdateRequest(w, r)
	if !ok {
		return
	}
	s.forwardBrokerAction(w, r, brokerAction{
		RequestID: requestID,
		Action:    "updates.refresh",
		Arguments: map[string]any{},
	}, 11*time.Minute)
}

func (s *Server) handleUpdatesPlan(w http.ResponseWriter, r *http.Request) {
	if s.deps.BrokerSocket == "" {
		s.handleUnavailable(w, r)
		return
	}
	requestID, ok := decodeUpdateRequest(w, r)
	if !ok {
		return
	}
	s.forwardBrokerAction(w, r, brokerAction{
		RequestID: requestID,
		Action:    "updates.plan",
		Arguments: map[string]any{},
	}, 3*time.Minute)
}

func (s *Server) handleUpdatesApply(w http.ResponseWriter, r *http.Request) {
	if s.deps.BrokerSocket == "" {
		s.handleUnavailable(w, r)
		return
	}
	var req struct {
		RequestID string `json:"requestId"`
		PlanID    string `json:"planId"`
	}
	if err := strictjson.Decode(w, r, maxBodyBytes, &req); err != nil {
		WriteError(w, NewError(CodeValidationFailed, "Body must be a JSON object."))
		return
	}
	if !validRequestID(req.RequestID) {
		WriteError(w, NewError(CodeValidationFailed, "requestId is required."))
		return
	}
	if !planIDPattern.MatchString(req.PlanID) {
		WriteError(w, NewError(CodeValidationFailed, "invalid planId."))
		return
	}
	s.forwardBrokerAction(w, r, brokerAction{
		RequestID: req.RequestID,
		Action:    "packages.applyPlan",
		Arguments: map[string]any{"planId": req.PlanID},
		Expected:  map[string]any{"planId": req.PlanID},
	}, 30*time.Second)
}

func decodeUpdateRequest(w http.ResponseWriter, r *http.Request) (string, bool) {
	var req struct {
		RequestID string `json:"requestId"`
	}
	if err := strictjson.Decode(w, r, maxBodyBytes, &req); err != nil {
		WriteError(w, NewError(CodeValidationFailed, "Body must be a JSON object."))
		return "", false
	}
	if !validRequestID(req.RequestID) {
		WriteError(w, NewError(CodeValidationFailed, "requestId is required."))
		return "", false
	}
	return req.RequestID, true
}
