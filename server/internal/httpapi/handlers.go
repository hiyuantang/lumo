// SPDX-License-Identifier: AGPL-3.0-only
package httpapi

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"lumo/server/internal/journal"
	"lumo/server/internal/strictjson"
	"lumo/server/internal/system"
)

func (s *Server) handleVersion(w http.ResponseWriter, _ *http.Request) {
	WriteData(w, map[string]any{
		"version":          s.deps.Version,
		"protocolVersions": []int{1},
	})
}

func (s *Server) handleIdentity(w http.ResponseWriter, _ *http.Request) {
	WriteData(w, system.ReadIdentity())
}

func (s *Server) handleOverview(w http.ResponseWriter, r *http.Request) {
	failed := 0
	if s.deps.Services != nil && s.deps.Services.Available() {
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		if units, err := s.deps.Services.List(ctx); err == nil {
			for _, u := range units {
				if u.ActiveState == "failed" {
					failed++
				}
			}
		}
	}
	WriteData(w, system.CollectOverview(failed))
}

func (s *Server) handleMetrics(w http.ResponseWriter, _ *http.Request) {
	WriteData(w, s.deps.Sampler.Sample())
}

func (s *Server) handleSystemPower(w http.ResponseWriter, r *http.Request) {
	if s.deps.BrokerSocket == "" {
		s.handleUnavailable(w, r)
		return
	}
	var req struct {
		RequestID string `json:"requestId"`
		Action    string `json:"action"`
	}
	if err := strictjson.Decode(w, r, maxBodyBytes, &req); err != nil {
		WriteError(w, NewError(CodeValidationFailed, "Body must be a JSON object."))
		return
	}
	if !validRequestID(req.RequestID) {
		WriteError(w, NewError(CodeValidationFailed, "requestId is required."))
		return
	}
	if req.Action != "reboot" && req.Action != "poweroff" {
		WriteError(w, NewError(CodeValidationFailed, "action must be reboot or poweroff."))
		return
	}
	s.forwardBrokerAction(w, r, brokerAction{
		RequestID: req.RequestID,
		Action:    "system." + req.Action,
		Arguments: map[string]any{},
		Expected:  map[string]any{},
	}, 15*time.Second)
}

func (s *Server) handleJournal(w http.ResponseWriter, r *http.Request) {
	if !s.deps.Journal.Available() {
		WriteError(w, journal.ErrUnavailable)
		return
	}
	values := r.URL.Query()
	q := journal.Query{
		Unit:     values.Get("unit"),
		Priority: values.Get("priority"),
		Since:    values.Get("since"),
		Boot:     values.Get("boot"),
		After:    values.Get("after-cursor"),
	}
	if raw := values.Get("limit"); raw != "" {
		limit, err := strconv.Atoi(raw)
		if err != nil {
			WriteError(w, NewError(CodeValidationFailed, "limit must be an integer"))
			return
		}
		q.Limit = limit
	}
	if err := q.Validate(); err != nil {
		WriteError(w, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	res, err := s.deps.Journal.Query(ctx, q)
	if err != nil {
		WriteError(w, err)
		return
	}
	WriteData(w, res)
}

func (s *Server) handleUnavailable(w http.ResponseWriter, _ *http.Request) {
	WriteError(w, NewError(CodeUnavailable, "This capability is not available in this build."))
}

func (s *Server) handleNotFound(w http.ResponseWriter, _ *http.Request) {
	WriteError(w, NewError(CodeNotFound, "Unknown endpoint."))
}

func (s *Server) handleProcesses(w http.ResponseWriter, _ *http.Request) {
	processes, err := s.processes.Sample()
	if err != nil {
		WriteError(w, err)
		return
	}
	WriteData(w, map[string]any{"processes": processes})
}
