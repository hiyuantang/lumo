// SPDX-License-Identifier: AGPL-3.0-only
package httpapi

import (
	"encoding/base64"
	"net/http"
	"regexp"
	"strings"
	"time"

	"lumo/server/internal/files"
	"lumo/server/internal/privfiles"
	"lumo/server/internal/strictjson"
)

func (s *Server) handleFilesList(w http.ResponseWriter, r *http.Request) {
	res, err := files.List(r.URL.Query().Get("path"))
	if err != nil {
		WriteError(w, err)
		return
	}
	WriteData(w, res)
}

func (s *Server) handleFilesRead(w http.ResponseWriter, r *http.Request) {
	read := files.Read
	if r.URL.Query().Get("preview") == "image" {
		read = files.ReadImage
	}
	res, err := read(r.URL.Query().Get("path"))
	if err != nil {
		WriteError(w, err)
		return
	}
	WriteData(w, res)
}

func (s *Server) handleFilesWrite(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Path             string `json:"path"`
		Content          string `json:"content"`
		ExpectedRevision string `json:"expectedRevision"`
		RequestID        string `json:"requestId"`
	}
	if err := strictjson.Decode(w, r, maxWriteBodyBytes, &req); err != nil {
		WriteError(w, NewError(CodeValidationFailed, "Body must be a JSON object."))
		return
	}
	if !validRequestID(req.RequestID) {
		WriteError(w, NewError(CodeValidationFailed, "requestId is required."))
		return
	}
	content, err := base64.StdEncoding.DecodeString(req.Content)
	if err != nil {
		WriteError(w, NewError(CodeValidationFailed, "content must be base64."))
		return
	}
	if len(content) > files.MaxWriteBytes {
		WriteError(w, NewError(CodeValidationFailed, "content exceeds the 8 MiB limit for files.write."))
		return
	}
	s.mutate(w, req.RequestID, func(w http.ResponseWriter) {
		res, err := files.Write(req.Path, content, req.ExpectedRevision)
		if err != nil {
			WriteError(w, err)
			return
		}
		WriteData(w, res)
	})
}

func (s *Server) handleFilesDelete(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Path      string `json:"path"`
		RequestID string `json:"requestId"`
	}
	if err := strictjson.Decode(w, r, maxBodyBytes, &req); err != nil {
		WriteError(w, NewError(CodeValidationFailed, "Body must be a JSON object."))
		return
	}
	if !validRequestID(req.RequestID) {
		WriteError(w, NewError(CodeValidationFailed, "requestId is required."))
		return
	}
	s.mutate(w, req.RequestID, func(w http.ResponseWriter) {
		res, err := files.Trash(req.Path)
		if err != nil {
			WriteError(w, err)
			return
		}
		WriteData(w, res)
	})
}

func (s *Server) handleFilesWritePrivileged(w http.ResponseWriter, r *http.Request) {
	if s.deps.BrokerSocket == "" {
		s.handleUnavailable(w, r)
		return
	}
	var req struct {
		Path             string `json:"path"`
		Content          string `json:"content"`
		ExpectedRevision string `json:"expectedRevision"`
		Mode             string `json:"mode"`
		RestartUnit      string `json:"restartUnit"`
		RequestID        string `json:"requestId"`
	}
	if err := strictjson.Decode(w, r, maxPrivilegedWriteBodyBytes, &req); err != nil {
		WriteError(w, NewError(CodeValidationFailed, "Body must be a JSON object."))
		return
	}
	if !validRequestID(req.RequestID) {
		WriteError(w, NewError(CodeValidationFailed, "requestId is required."))
		return
	}
	if req.Path == "" || !strings.HasPrefix(req.Path, "/etc/") {
		WriteError(w, NewError(CodeValidationFailed, "path must be below /etc."))
		return
	}
	content, err := base64.StdEncoding.DecodeString(req.Content)
	if err != nil || len(content) > privfiles.MaxWriteBytes {
		WriteError(w, NewError(CodeValidationFailed, "content must be base64 and no larger than 1 MiB."))
		return
	}
	if !revisionPattern.MatchString(req.ExpectedRevision) {
		WriteError(w, NewError(CodeValidationFailed, "expectedRevision is required."))
		return
	}
	if req.RestartUnit != "" && !actionUnitPattern.MatchString(req.RestartUnit) {
		WriteError(w, NewError(CodeValidationFailed, "invalid restart unit."))
		return
	}
	s.forwardBrokerAction(w, r, brokerAction{
		RequestID: req.RequestID,
		Action:    "files.writePrivileged",
		Arguments: map[string]any{
			"path":          req.Path,
			"contentBase64": req.Content,
			"mode":          req.Mode,
			"restartUnit":   req.RestartUnit,
		},
		Expected: map[string]any{"revision": req.ExpectedRevision},
	}, 45*time.Second)
}

var revisionPattern = regexp.MustCompile(`^sha256:[a-f0-9]{64}$`)

func (s *Server) handleFilesCreate(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Path      string `json:"path"`
		Kind      string `json:"kind"`
		RequestID string `json:"requestId"`
	}
	if err := strictjson.Decode(w, r, maxBodyBytes, &req); err != nil {
		WriteError(w, NewError(CodeValidationFailed, "Body must be a JSON object."))
		return
	}
	if !validRequestID(req.RequestID) {
		WriteError(w, NewError(CodeValidationFailed, "requestId is required."))
		return
	}
	s.mutate(w, req.RequestID, func(w http.ResponseWriter) {
		result, err := files.Create(req.Path, req.Kind)
		if err != nil {
			WriteError(w, err)
			return
		}
		WriteData(w, result)
	})
}

func (s *Server) handleFilesMove(w http.ResponseWriter, r *http.Request) {
	var req struct {
		From      string `json:"from"`
		To        string `json:"to"`
		RequestID string `json:"requestId"`
	}
	if err := strictjson.Decode(w, r, maxBodyBytes, &req); err != nil {
		WriteError(w, NewError(CodeValidationFailed, "Body must be a JSON object."))
		return
	}
	if !validRequestID(req.RequestID) {
		WriteError(w, NewError(CodeValidationFailed, "requestId is required."))
		return
	}
	s.mutate(w, req.RequestID, func(w http.ResponseWriter) {
		result, err := files.Move(req.From, req.To)
		if err != nil {
			WriteError(w, err)
			return
		}
		WriteData(w, result)
	})
}

func (s *Server) handleFileLocations(w http.ResponseWriter, r *http.Request) {
	WriteData(w, map[string]any{"locations": files.UserLocations()})
}

func (s *Server) handleLocationSettings(w http.ResponseWriter, r *http.Request) {
	result, err := files.GetLocationSettings()
	if err != nil {
		WriteError(w, err)
		return
	}
	WriteData(w, result)
}

func (s *Server) handleSetLocation(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Path             string `json:"path"`
		ID               string `json:"id"`
		Remove           bool   `json:"remove"`
		ExpectedRevision string `json:"expectedRevision"`
		RequestID        string `json:"requestId"`
	}
	if err := strictjson.Decode(w, r, maxBodyBytes, &req); err != nil {
		WriteError(w, NewError(CodeValidationFailed, "Body must be a JSON object."))
		return
	}
	if !validRequestID(req.RequestID) {
		WriteError(w, NewError(CodeValidationFailed, "requestId is required."))
		return
	}
	s.mutate(w, req.RequestID, func(w http.ResponseWriter) {
		s.folderMoves.Add(1)
		defer s.folderMoves.Add(-1)
		var result files.LocationSettings
		var err error
		if req.ID != "" {
			result, err = files.SetIndividualLocation(req.ID, req.Path, req.Remove, req.ExpectedRevision)
		} else if req.Remove {
			err = NewError(CodeValidationFailed, "Folder id is required.")
		} else {
			result, err = files.SetLocationBase(req.Path, req.ExpectedRevision)
		}
		if err != nil {
			WriteError(w, err)
			return
		}
		WriteData(w, result)
	})
}

func (s *Server) handleLocationMovePlan(w http.ResponseWriter, r *http.Request) {
	var result files.LocationMovePlan
	var err error
	if id := r.URL.Query().Get("id"); id != "" {
		result, err = files.PlanIndividualLocation(id, r.URL.Query().Get("path"), r.URL.Query().Get("revision"))
	} else {
		result, err = files.PlanLocationMove(r.URL.Query().Get("path"), r.URL.Query().Get("revision"))
	}
	if err != nil {
		WriteError(w, err)
		return
	}
	WriteData(w, result)
}
