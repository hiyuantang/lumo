// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"context"
	"errors"
	"lumo/apps/docker/backend/containers"
	. "lumo/plugin"
	"lumo/plugin/strictjson"
	"net/http"
	"os"
	"time"
)

func (s *Server) handleContainers(w http.ResponseWriter, r *http.Request) {
	if s.Containers == nil {
		Unavailable(w, r)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	var data any
	var err error
	switch r.URL.Path {
	case "/api/v1/containers":
		data, err = s.Containers.Snapshot(ctx)
	case "/api/v1/containers/detail":
		data, err = s.Containers.Inspect(ctx, r.URL.Query().Get("id"))
	case "/api/v1/containers/logs":
		data, err = s.Containers.Logs(ctx, r.URL.Query().Get("id"))
	}
	if err != nil {
		writeServerAppError(w, err)
		return
	}
	WriteData(w, data)
}

func (s *Server) handleContainerAction(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RequestID        string `json:"requestId"`
		ID               string `json:"id"`
		Action           string `json:"action"`
		ExpectedRevision string `json:"expectedRevision"`
	}
	if err := strictjson.Decode(w, r, MaxBodyBytes, &req); err != nil || !ValidRequestID(req.RequestID) || containers.Validate(req.ID, req.Action, req.ExpectedRevision) != nil {
		WriteError(w, NewError(CodeValidationFailed, "A container ID, supported action and current revision are required."))
		return
	}
	ForwardBrokerAction(w, r, BrokerAction{RequestID: req.RequestID, Action: "containers." + req.Action, Arguments: map[string]any{"containerId": req.ID}, Expected: map[string]any{"revision": req.ExpectedRevision}}, 50*time.Second)
}

func writeServerAppError(w http.ResponseWriter, err error) {
	code := CodeInternal
	switch {
	case errors.Is(err, containers.ErrValidation):
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
	reader, ok := s.Containers.(interface {
		Resources(context.Context) (containers.Resources, error)
	})
	if !ok {
		Unavailable(w, r)
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
	if err := strictjson.Decode(w, r, MaxBodyBytes, &req); err != nil || !ValidRequestID(req.RequestID) || containers.ValidateResource(req.ResourceRequest) != nil {
		WriteError(w, NewError(CodeValidationFailed, "Choose a supported Docker resource and current revision."))
		return
	}
	ForwardBrokerAction(w, r, BrokerAction{RequestID: req.RequestID, Action: "docker.resource", Arguments: map[string]any{"resource": req.ResourceRequest}}, 50*time.Second)
}
