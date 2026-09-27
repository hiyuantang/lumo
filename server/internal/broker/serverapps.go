// SPDX-License-Identifier: AGPL-3.0-only
package broker

import (
	"context"
	"encoding/json"
	"errors"
	"lumo/server/internal/containers"
	"lumo/server/internal/websites"
	"net/http"
	"strings"
	"time"
)

func containerAction(action string) bool {
	return action == "containers.start" || action == "containers.stop" || action == "containers.restart"
}

func (s *Server) handleServerAppAction(w http.ResponseWriter, r *http.Request, req ActionRequest, uid uint32, userName, polkitResult string) {
	beginID := s.audit.Begin(req, uid, userName, polkitResult)
	if beginID == 0 {
		s.writeErr(w, 503, &apiError{Code: "unavailable", Message: "The audit log is unavailable. Nothing was changed."})
		return
	}
	started := time.Now()
	ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), 45*time.Second)
	defer cancel()
	var data any
	var err error
	if containerAction(req.Action) {
		data, err = s.containers.Act(ctx, req.Arguments.ContainerID, strings.TrimPrefix(req.Action, "containers."), req.Expected.Revision, uid)
	} else {
		data, err = s.websites.Apply(ctx, req.Arguments.SiteID, req.Arguments.Website, req.Expected.Revision, req.RequestID)
	}
	if err != nil {
		status, code := 500, "internal"
		switch {
		case errors.Is(err, containers.ErrValidation), errors.Is(err, websites.ErrValidation):
			status, code = 400, "validation_failed"
		case errors.Is(err, containers.ErrStale), errors.Is(err, websites.ErrStale):
			status, code = 409, "stale_revision"
		case errors.Is(err, containers.ErrPermission):
			status, code = 403, "forbidden"
		case errors.Is(err, containers.ErrNotFound):
			status, code = 404, "not_found"
		case errors.Is(err, containers.ErrUnavailable):
			status, code = 503, "unavailable"
		}
		s.audit.End(beginID, req, uid, userName, polkitResult, "failed", err.Error(), nil, time.Since(started))
		s.writeErr(w, status, &apiError{Code: code, Message: err.Error()})
		return
	}
	encoded, _ := json.Marshal(data)
	var result map[string]any
	_ = json.Unmarshal(encoded, &result)
	s.audit.End(beginID, req, uid, userName, polkitResult, "success", "", result, time.Since(started))
	s.writeData(w, result)
}
