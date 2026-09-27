// SPDX-License-Identifier: AGPL-3.0-only
package httpapi

import (
	"context"
	"errors"
	"lumo/server/internal/containers"
	"lumo/server/internal/strictjson"
	"lumo/server/internal/websites"
	"net/http"
	"os"
	"strings"
	"time"
)

func (s *Server) handleContainers(w http.ResponseWriter, r *http.Request) {
	if s.deps.Containers == nil {
		s.handleUnavailable(w, r)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	var data any
	var err error
	switch r.URL.Path {
	case "/api/v1/containers":
		data, err = s.deps.Containers.Snapshot(ctx)
	case "/api/v1/containers/detail":
		data, err = s.deps.Containers.Inspect(ctx, r.URL.Query().Get("id"))
	case "/api/v1/containers/logs":
		data, err = s.deps.Containers.Logs(ctx, r.URL.Query().Get("id"))
	}
	if err != nil {
		writeServerAppError(w, err)
		return
	}
	WriteData(w, data)
}

func (s *Server) handleContainerAction(w http.ResponseWriter, r *http.Request) {
	if s.deps.BrokerSocket == "" {
		s.handleUnavailable(w, r)
		return
	}
	var req struct {
		RequestID        string `json:"requestId"`
		ID               string `json:"id"`
		Action           string `json:"action"`
		ExpectedRevision string `json:"expectedRevision"`
	}
	if err := strictjson.Decode(w, r, maxBodyBytes, &req); err != nil || !validRequestID(req.RequestID) || containers.Validate(req.ID, req.Action, req.ExpectedRevision) != nil {
		WriteError(w, NewError(CodeValidationFailed, "A container ID, supported action and current revision are required."))
		return
	}
	s.forwardBrokerAction(w, r, brokerAction{RequestID: req.RequestID, Action: "containers." + req.Action, Arguments: map[string]any{"containerId": req.ID}, Expected: map[string]any{"revision": req.ExpectedRevision}}, 50*time.Second)
}

func (s *Server) handleWebsites(w http.ResponseWriter, r *http.Request) {
	if s.deps.Websites == nil {
		s.handleUnavailable(w, r)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	var data any
	var err error
	if strings.HasSuffix(r.URL.Path, "/logs") {
		data, err = s.deps.Websites.Logs(ctx, r.URL.Query().Get("kind"))
	} else {
		data, err = s.deps.Websites.Snapshot(ctx)
	}
	if err != nil {
		writeServerAppError(w, err)
		return
	}
	WriteData(w, data)
}

func (s *Server) handleWebsiteSave(w http.ResponseWriter, r *http.Request) {
	if s.deps.BrokerSocket == "" {
		s.handleUnavailable(w, r)
		return
	}
	var req struct {
		RequestID        string              `json:"requestId"`
		ID               string              `json:"id"`
		Definition       websites.Definition `json:"definition"`
		ExpectedRevision string              `json:"expectedRevision"`
	}
	if err := strictjson.Decode(w, r, maxBodyBytes, &req); err != nil || !validRequestID(req.RequestID) {
		WriteError(w, NewError(CodeValidationFailed, "A typed website definition is required."))
		return
	}
	if err := websites.Validate(req.ID, req.Definition, req.ExpectedRevision); err != nil {
		WriteError(w, NewError(CodeValidationFailed, err.Error()))
		return
	}
	s.forwardBrokerAction(w, r, brokerAction{RequestID: req.RequestID, Action: "websites.save", Arguments: map[string]any{"siteId": req.ID, "website": req.Definition}, Expected: map[string]any{"revision": req.ExpectedRevision}}, 50*time.Second)
}

func writeServerAppError(w http.ResponseWriter, err error) {
	code := CodeInternal
	switch {
	case errors.Is(err, containers.ErrValidation), errors.Is(err, websites.ErrValidation):
		code = CodeValidationFailed
	case errors.Is(err, containers.ErrPermission), errors.Is(err, os.ErrPermission):
		code = CodeForbidden
	case errors.Is(err, containers.ErrNotFound), errors.Is(err, os.ErrNotExist):
		code = CodeNotFound
	case errors.Is(err, containers.ErrUnavailable):
		code = CodeUnavailable
	}
	WriteError(w, NewError(code, err.Error()))
}

func (s *Server) handleDockerResources(w http.ResponseWriter, r *http.Request) {
	reader, ok := s.deps.Containers.(interface {
		Resources(context.Context) (containers.Resources, error)
	})
	if !ok {
		s.handleUnavailable(w, r)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 40*time.Second)
	defer cancel()
	data, err := reader.Resources(ctx)
	if err != nil {
		writeServerAppError(w, err)
		return
	}
	WriteData(w, data)
}
func (s *Server) handleDockerResourceAction(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RequestID string `json:"requestId"`
		containers.ResourceRequest
	}
	if err := strictjson.Decode(w, r, maxBodyBytes, &req); err != nil || !validRequestID(req.RequestID) || containers.ValidateResource(req.ResourceRequest) != nil {
		WriteError(w, NewError(CodeValidationFailed, "Choose a supported Docker resource and current revision."))
		return
	}
	s.forwardBrokerAction(w, r, brokerAction{RequestID: req.RequestID, Action: "docker.resource", Arguments: map[string]any{"resource": req.ResourceRequest}}, 50*time.Second)
}
