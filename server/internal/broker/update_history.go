// SPDX-License-Identifier: AGPL-3.0-only
package broker

import (
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"

	"lumo/server/internal/ipc"
	"lumo/server/internal/updates"
)

type AppUpdateHistoryEntry struct {
	RequestID   string            `json:"requestId"`
	AppID       string            `json:"appId"`
	CompletedAt string            `json:"completedAt"`
	Success     bool              `json:"success"`
	Error       string            `json:"error,omitempty"`
	Packages    []updates.Package `json:"packages"`
}

func (a *Audit) AppUpdateHistory(uid uint32) ([]AppUpdateHistoryEntry, error) {
	rows, err := a.db.Query(`SELECT e.request_id, e.ts, e.outcome, e.error, p.result_json
 FROM audit e JOIN audit p ON p.id = (
 SELECT id FROM audit WHERE uid = e.uid AND kind = 'end' AND action = 'apps.plan' AND outcome = 'success'
 AND CASE WHEN json_valid(result_json) THEN json_extract(result_json, '$.plan.id') END =
 CASE WHEN json_valid(e.result_json) THEN json_extract(e.result_json, '$.planId') END
 ORDER BY id DESC LIMIT 1)
 WHERE e.uid = ? AND e.kind = 'end' AND e.action = 'packages.applyPlan'
 AND CASE WHEN json_valid(e.result_json) THEN json_extract(e.result_json, '$.progress.done') END = 1
 AND json_extract(p.result_json, '$.plan.operation') = 'update'
 ORDER BY e.id DESC LIMIT 50`, uid)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	entries := []AppUpdateHistoryEntry{}
	for rows.Next() {
		var entry AppUpdateHistoryEntry
		var outcome, raw string
		if err := rows.Scan(&entry.RequestID, &entry.CompletedAt, &outcome, &entry.Error, &raw); err != nil {
			return nil, err
		}
		var saved struct {
			Plan updates.Plan `json:"plan"`
		}
		if err := json.Unmarshal([]byte(raw), &saved); err != nil {
			return nil, err
		}
		if saved.Plan.AppID != "docker" && saved.Plan.AppID != "nginx" && saved.Plan.AppID != "git" {
			continue
		}
		entry.AppID = saved.Plan.AppID
		entry.Success = outcome == "success"
		entry.Packages = saved.Plan.Packages
		entries = append(entries, entry)
	}
	return entries, rows.Err()
}

func (s *Server) handleAppUpdateHistory(w http.ResponseWriter, r *http.Request) {
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
	entries, err := s.audit.AppUpdateHistory(uid)
	if err != nil {
		s.writeErr(w, 503, &apiError{Code: "unavailable", Message: "Update history is unavailable."})
		return
	}
	s.writeData(w, map[string]any{"entries": entries})
}

func AppUpdateHistory(ctx context.Context, socketPath string) ([]AppUpdateHistoryEntry, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", "http://broker/apps/update-history", nil)
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
			Entries []AppUpdateHistoryEntry `json:"entries"`
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
	return body.Data.Entries, nil
}
