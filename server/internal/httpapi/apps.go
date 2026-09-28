// SPDX-License-Identifier: AGPL-3.0-only
package httpapi

import (
	"lumo/server/internal/files"
	"lumo/server/internal/strictjson"
	"lumo/server/internal/terminal"
	"net/http"
	"os"
	"os/exec"
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
		map[string]any{"id": "pi", "installed": terminal.PiPath() != "", "canUninstall": removablePi(terminal.PiPath()), "canInstall": piNPMAvailable(), "canUpdate": removablePi(terminal.PiPath())},
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

func removablePi(path string) bool {
	u, err := user.Current()
	if err != nil || path == "" {
		return false
	}
	return path == filepath.Join(u.HomeDir, ".local/share/lumo/pi/bin/pi")

}

func (s *Server) handlePiUninstall(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RequestID string `json:"requestId"`
		Clean     bool   `json:"clean"`
	}
	if err := strictjson.Decode(w, r, maxBodyBytes, &req); err != nil || !validRequestID(req.RequestID) {
		WriteError(w, NewError(CodeValidationFailed, "requestId is required."))
		return
	}
	s.mutate(w, req.RequestID, func(w http.ResponseWriter) {
		if !s.pi.operation.TryLock() {
			WriteError(w, NewError(CodeConflict, "Wait for the Pi operation to finish."))
			return
		}
		defer s.pi.operation.Unlock()
		if s.piRunning() {
			WriteError(w, NewError(CodeConflict, "Close Pi projects before uninstalling."))
			return
		}
		path := terminal.PiPath()
		if path == "" && !req.Clean {
			WriteData(w, map[string]any{"uninstalled": true})
			return
		}
		if path != "" && !removablePi(path) {
			WriteError(w, NewError(CodeForbidden, "Uninstall this copy of Pi using the package manager that installed it."))
			return
		}
		paths := []string{filepath.Join(s.pi.home, ".local/share/lumo/pi")}
		if req.Clean {
			var err error
			paths, err = piRemovalPaths(path)
			if err != nil {
				WriteError(w, err)
				return
			}
		}
		if err := files.TrashMany(paths); err != nil {
			WriteError(w, err)
			return
		}
		WriteData(w, map[string]any{"uninstalled": terminal.PiPath() == ""})
	})
}

func piRemovalPaths(binary string) ([]string, error) {
	u, err := user.Current()
	if err != nil {
		return nil, err
	}
	paths := []string{}
	for _, path := range []string{filepath.Join(u.HomeDir, ".local/share/lumo/pi"), filepath.Join(u.HomeDir, ".pi/agent"), filepath.Join(u.HomeDir, ".local/state/lumo/pi-sessions")} {
		if _, err := os.Lstat(path); os.IsNotExist(err) {
			continue
		} else if err != nil {
			return nil, err
		}
		paths = append(paths, path)
	}
	return paths, nil
}
func piNPMAvailable() bool { _, err := exec.LookPath("npm"); return err == nil }
