// SPDX-License-Identifier: AGPL-3.0-only
package broker

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"lumo/server/internal/hostsettings"
)

func (s *Server) handleSettingsAction(w http.ResponseWriter, r *http.Request, req ActionRequest, uid uint32, userName, polkitResult string) {
	beginID := s.audit.Begin(req, uid, userName, polkitResult)
	if beginID == 0 {
		s.writeErr(w, http.StatusServiceUnavailable, &apiError{Code: "unavailable", Message: "The audit log is unavailable. No setting was changed."})
		return
	}
	started := time.Now()
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	snapshot, err := s.settings.Apply(ctx, req.Arguments.Change, req.Expected.Revision)
	if err != nil {
		status := http.StatusInternalServerError
		apiErr := &apiError{Code: "internal", Message: err.Error()}
		if errors.Is(err, hostsettings.ErrValidation) {
			status = http.StatusBadRequest
			apiErr.Code = "validation_failed"
		} else if errors.Is(err, hostsettings.ErrStale) {
			status = http.StatusConflict
			apiErr.Code = "stale_revision"
		}
		s.audit.End(beginID, req, uid, userName, polkitResult, "failed", err.Error(), nil, time.Since(started))
		s.writeErr(w, status, apiErr)
		return
	}
	encoded, _ := json.Marshal(snapshot)
	var result map[string]any
	_ = json.Unmarshal(encoded, &result)
	s.audit.End(beginID, req, uid, userName, polkitResult, "success", "", result, time.Since(started))
	s.writeData(w, result)
}
