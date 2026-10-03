// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"lumo/server/internal/appruntime"
	"net/http"
	"os"
)

const (
	maxBodyBytes      = 1 << 20
	maxWriteBodyBytes = 12 << 20
)

type Deps struct{}
type Server struct {
	idem   *idemStore
	pi     *piWorker
	piRPC  piRuntime
	piAuth piAuthRuntime
}

func NewServer(_ Deps) *Server {
	return &Server{idem: newIdemStore(), pi: newPiWorker(), piRPC: piRuntime{processes: map[string]*piProcess{}}}
}
func hostExecutable() (string, error) {
	if path := os.Getenv("LUMO_HOST_EXECUTABLE"); path != "" {
		return path, nil
	}
	return os.Executable()
}
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/pi/providers", s.handlePiProviders)
	mux.HandleFunc("GET /api/v1/pi/connections", s.handlePiConnections)
	mux.HandleFunc("POST /api/v1/pi/auth/start", s.handlePiAuthStart)
	mux.HandleFunc("GET /api/v1/pi/auth", s.handlePiAuthState)
	mux.HandleFunc("POST /api/v1/pi/auth/reply", s.handlePiAuthReply)
	mux.HandleFunc("POST /api/v1/pi/auth/cancel", s.handlePiAuthCancel)
	mux.HandleFunc("GET /api/v1/pi/reference", s.handlePiReference)
	mux.HandleFunc("GET /api/v1/pi/compaction", s.handlePiCompaction)
	mux.HandleFunc("POST /api/v1/pi/compaction", s.handlePiCompaction)
	mux.HandleFunc("GET /api/v1/pi/image-settings", s.handlePiImageSettings)
	mux.HandleFunc("POST /api/v1/pi/image-settings", s.handlePiImageSettings)
	mux.HandleFunc("GET /api/v1/pi/templates", s.handlePiTemplates)
	mux.HandleFunc("POST /api/v1/pi/templates", s.handlePiTemplates)
	mux.HandleFunc("POST /api/v1/pi/images", s.handlePiImage)
	mux.HandleFunc("GET /api/v1/pi/settings", s.handlePiSettings)
	mux.HandleFunc("POST /api/v1/pi/settings", s.handlePiSettings)
	mux.HandleFunc("GET /api/v1/pi/sessions", s.handlePiSessions)
	mux.HandleFunc("POST /api/v1/pi/sessions/delete", s.handlePiDeleteSession)
	mux.HandleFunc("GET /api/v1/pi/sessions/archived", s.handlePiArchivedSessions)
	mux.HandleFunc("POST /api/v1/pi/sessions/archive", s.handlePiArchiveSession)
	mux.HandleFunc("POST /api/v1/pi/sessions/restore", s.handlePiRestoreSession)
	mux.HandleFunc("POST /api/v1/pi/start", s.handlePiStart)
	mux.HandleFunc("POST /api/v1/pi/command", s.handlePiCommand)
	mux.HandleFunc("GET /api/v1/pi/events", s.handlePiEvents)
	mux.HandleFunc("POST /api/v1/pi/answer", s.handlePiAnswer)
	mux.HandleFunc("GET /api/v1/pi/extensions", s.handlePiExtensions)
	mux.HandleFunc("POST /api/v1/pi/extensions", s.handlePiExtensions)
	mux.HandleFunc("POST /api/v1/pi/desktop/claim", s.handlePiDesktop)
	mux.HandleFunc("POST /api/v1/pi/desktop/result", s.handlePiDesktop)
	mux.HandleFunc("POST /api/v1/pi/stop", s.handlePiStop)
	mux.HandleFunc("POST /api/v1/apps/pi/uninstall", s.handlePiUninstall)
	mux.HandleFunc("POST /api/v1/apps/pi/plan", s.handlePiPlan)
	mux.HandleFunc("POST /api/v1/apps/pi/apply", s.handlePiApply)
	mux.HandleFunc("GET /api/v1/apps/pi/progress", s.handlePiProgress)

	mux.HandleFunc("GET /_lumo/status", func(w http.ResponseWriter, r *http.Request) {
		WriteData(w, map[string]any{"activeOperations": s.ActiveOperations()})
	})
	mux.HandleFunc("GET /_lumo/software", func(w http.ResponseWriter, r *http.Request) {
		WriteData(w, []any{map[string]any{"id": "pi", "installed": piPath() != "", "canUninstall": removablePi(piPath()), "canInstall": appruntime.Supported(), "canUpdate": removablePi(piPath())}})
	})
	mux.HandleFunc("GET /_lumo/history", func(w http.ResponseWriter, r *http.Request) {
		s.pi.mu.Lock()
		defer s.pi.mu.Unlock()
		if s.pi.loadError != nil {
			WriteError(w, NewError(CodeUnavailable, "Pi update history is unavailable."))
			return
		}
		WriteData(w, s.pi.saved.History)
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if recover() != nil {
				WriteError(w, NewError(CodeInternal, "Internal server error."))
			}
		}()
		limit := int64(maxBodyBytes)
		if r.URL.Path == "/api/v1/pi/images" {
			limit = maxWriteBodyBytes
		}
		r.Body = http.MaxBytesReader(w, r.Body, limit)
		mux.ServeHTTP(w, r)
	})
}
