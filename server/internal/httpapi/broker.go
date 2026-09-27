// SPDX-License-Identifier: AGPL-3.0-only
package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"lumo/server/internal/broker"
)

type brokerAction struct {
	RequestID    string         `json:"requestId"`
	Action       string         `json:"action"`
	Arguments    map[string]any `json:"arguments"`
	Expected     any            `json:"expected,omitempty"`
	SessionToken string         `json:"sessionToken"`
}

func (s *Server) forwardBrokerAction(w http.ResponseWriter, r *http.Request, action brokerAction, timeout time.Duration) {
	if s.deps.BrokerSocket == "" {
		WriteError(w, NewError(CodeUnavailable, "This capability is not available in this build."))
		return
	}
	action.SessionToken = r.Header.Get("X-Lumo-Session")
	encoded, err := json.Marshal(action)
	if err != nil {
		WriteError(w, NewError(CodeInternal, "Internal server error."))
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), timeout)
	defer cancel()
	status, headers, body, err := broker.CallAction(ctx, s.deps.BrokerSocket, encoded)
	if err != nil {
		WriteError(w, NewError(CodeUnavailable, "The privileged broker is unavailable."))
		return
	}
	if replay := headers.Get("X-Lumo-Idempotent-Replay"); replay != "" {
		w.Header().Set("X-Lumo-Idempotent-Replay", replay)
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_, _ = w.Write(body)
}
