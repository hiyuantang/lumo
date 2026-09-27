// SPDX-License-Identifier: AGPL-3.0-only
package httpapi

import (
	"lumo/server/internal/files"
	"lumo/server/internal/strictjson"
	"lumo/server/internal/terminal"
	"net/http"
	"os"
	"os/user"
	"path/filepath"
	"time"
)

func (s *Server) handleApps(w http.ResponseWriter, r *http.Request) {
	exists := func(path string) bool {
		info, err := os.Stat(path)
		return err == nil && info.Mode().IsRegular() && info.Mode().Perm()&0o111 != 0
	}
	WriteData(w, map[string]any{"canInstall": exists("/usr/bin/apt-get") && s.deps.BrokerSocket != "", "apps": []any{
		map[string]any{"id": "docker", "installed": exists("/usr/bin/dockerd")},
		map[string]any{"id": "nginx", "installed": exists("/usr/sbin/nginx")},
		map[string]any{"id": "opencode", "installed": terminal.OpenCodePath() != "", "canUninstall": removableOpenCode(terminal.OpenCodePath())},
	}})
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
	if err := strictjson.Decode(w, r, maxBodyBytes, &req); err != nil || !validRequestID(req.RequestID) || (req.AppID != "docker" && req.AppID != "nginx") || (req.Operation != "" && req.Operation != "install" && req.Operation != "uninstall" && req.Operation != "update") {
		WriteError(w, NewError(CodeValidationFailed, "Choose Docker or Nginx from the App Library."))
		return
	}
	s.forwardBrokerAction(w, r, brokerAction{RequestID: req.RequestID, Action: "apps.plan", Arguments: map[string]any{"appId": req.AppID, "operation": req.Operation}}, 2*time.Minute)
}

func removableOpenCode(path string) bool {
	u, err := user.Current()
	if err != nil || path == "" {
		return false
	}
	if path != filepath.Join(u.HomeDir, ".opencode/bin/opencode") && path != filepath.Join(u.HomeDir, ".local/bin/opencode") {
		return false
	}
	resolved, err := filepath.EvalSymlinks(path)
	return err == nil && resolved == path
}

func (s *Server) handleOpenCodeUninstall(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RequestID string `json:"requestId"`
	}
	if err := strictjson.Decode(w, r, maxBodyBytes, &req); err != nil || !validRequestID(req.RequestID) {
		WriteError(w, NewError(CodeValidationFailed, "requestId is required."))
		return
	}
	s.mutate(w, req.RequestID, func(w http.ResponseWriter) {
		path := terminal.OpenCodePath()
		if path == "" {
			WriteData(w, map[string]any{"uninstalled": true})
			return
		}
		if !removableOpenCode(path) {
			WriteError(w, NewError(CodeForbidden, "Uninstall this copy of OpenCode using the package manager that installed it."))
			return
		}
		if _, err := files.Trash(path); err != nil {
			WriteError(w, err)
			return
		}
		WriteData(w, map[string]any{"uninstalled": terminal.OpenCodePath() == ""})
	})
}
