// SPDX-License-Identifier: AGPL-3.0-only
package httpapi

import (
	"lumo/server/internal/strictjson"
	"net/http"
	"os"
	"time"
)

func (s *Server) handleApps(w http.ResponseWriter, r *http.Request) {
	exists := func(path string) bool {
		info, err := os.Stat(path)
		return err == nil && info.Mode().IsRegular() && info.Mode().Perm()&0o111 != 0
	}
	entries := []any{map[string]any{"id": "git", "installed": exists("/usr/bin/git")}, map[string]any{"id": "docker", "installed": exists("/usr/bin/dockerd")}, map[string]any{"id": "nginx", "installed": exists("/usr/sbin/nginx")}}
	contributions, err := s.pluginContributions(r.Context(), "software")
	if err != nil {
		WriteError(w, NewError(CodeUnavailable, "App software status is unavailable."))
		return
	}
	entries = append(entries, contributions...)
	WriteData(w, map[string]any{"canInstall": exists("/usr/bin/apt-get") && s.deps.BrokerSocket != "", "apps": entries})
}

func (s *Server) handleAppPlan(w http.ResponseWriter, r *http.Request) {
	if s.deps.BrokerSocket == "" {
		s.handleUnavailable(w, r)
		return
	}
	var req struct {
		RequestID string `json:"requestId"`
		AppID     string `json:"appId"`
		Operation string `json:"operation"`
	}
	if err := strictjson.Decode(w, r, maxBodyBytes, &req); err != nil || !validRequestID(req.RequestID) || (req.AppID != "docker" && req.AppID != "nginx" && req.AppID != "git") || (req.Operation != "" && req.Operation != "install" && req.Operation != "uninstall" && req.Operation != "update") {
		WriteError(w, NewError(CodeValidationFailed, "Choose a supported app from the App Library."))
		return
	}
	s.forwardBrokerAction(w, r, brokerAction{RequestID: req.RequestID, Action: "apps.plan", Arguments: map[string]any{"appId": req.AppID, "operation": req.Operation}}, 2*time.Minute)
}
