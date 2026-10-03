// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"lumo/server/internal/files"
	"lumo/server/internal/strictjson"
	"net/http"
	"os"
	"os/user"
	"path/filepath"
)

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
		path := piPath()
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
		WriteData(w, map[string]any{"uninstalled": piPath() == ""})
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
