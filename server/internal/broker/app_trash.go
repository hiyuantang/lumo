// SPDX-License-Identifier: AGPL-3.0-only
package broker

import (
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"time"

	"lumo/server/internal/files"
	"lumo/server/internal/ipc"
)

func (s *Server) handleAppTrashList(w http.ResponseWriter, r *http.Request) {
	conn, ok := r.Context().Value(connKey{}).(net.Conn)
	if !ok {
		s.writeErr(w, 500, &apiError{Code: "internal", Message: "peer credentials unavailable"})
		return
	}
	uid, _, err := ipc.PeerCreds(conn)
	if err != nil {
		s.writeErr(w, 500, &apiError{Code: "internal", Message: "peer credentials unavailable"})
		return
	}
	items, err := s.appTrash.List(uid)
	if err != nil {
		s.writeErr(w, 503, &apiError{Code: "unavailable", Message: "App Trash is unavailable."})
		return
	}
	s.writeData(w, map[string]any{"items": items})
}

func (s *Server) handleAppTrashAction(w http.ResponseWriter, r *http.Request, req ActionRequest, uid uint32, userName, polkitResult string) {
	begin := s.audit.Begin(req, uid, userName, polkitResult)
	if begin == 0 {
		s.writeErr(w, 503, &apiError{Code: "unavailable", Message: "Audit log unavailable. No files were changed."})
		return
	}
	started := time.Now()
	var err error
	result := map[string]any{}
	if req.Action == "apps.trashRestore" {
		var path string
		path, err = s.appTrash.Restore(uid, req.Arguments.Item)
		result["path"] = path
	} else {
		if len(req.Arguments.Items) == 0 || len(req.Arguments.Items) > 10000 {
			s.writeErr(w, 400, &apiError{Code: "validation_failed", Message: "Choose app Trash items."})
			return
		}
		err = s.appTrash.Delete(uid, req.Arguments.Items)
		result["deleted"] = true
	}
	if err != nil {
		s.audit.End(begin, req, uid, userName, polkitResult, "failed", err.Error(), nil, time.Since(started))
		s.writeErr(w, 400, &apiError{Code: "validation_failed", Message: err.Error()})
		return
	}
	s.audit.End(begin, req, uid, userName, polkitResult, "success", "", result, time.Since(started))
	s.writeData(w, result)
}

func AppTrash(ctx context.Context, socketPath string) ([]files.TrashItem, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", "http://broker/apps/trash", nil)
	if err != nil {
		return nil, err
	}
	resp, err := ipc.HTTPClient(socketPath).Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var body struct {
		OK   bool `json:"ok"`
		Data struct {
			Items []files.TrashItem `json:"items"`
		} `json:"data"`
		Error *apiError `json:"error"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 4<<20)).Decode(&body); err != nil {
		return nil, err
	}
	if !body.OK {
		if body.Error != nil {
			return nil, body.Error
		}
		return nil, io.ErrUnexpectedEOF
	}
	return body.Data.Items, nil
}
