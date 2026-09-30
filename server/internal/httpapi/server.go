// SPDX-License-Identifier: AGPL-3.0-only
package httpapi

import (
	"context"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"

	"lumo/server/internal/containers"
	"lumo/server/internal/hostsettings"
	"lumo/server/internal/journal"
	"lumo/server/internal/network"
	"lumo/server/internal/services"
	"lumo/server/internal/system"
	"lumo/server/internal/updates"
	"lumo/server/internal/websites"
)

const (
	maxBodyBytes                = 1 << 20
	maxWriteBodyBytes           = 12 << 20
	maxPrivilegedWriteBodyBytes = 2 << 20
)

type Deps struct {
	Version    string
	Sampler    *system.Sampler
	Services   services.API
	Journal    journal.Backend
	Network    network.Snapshotter
	Settings   hostsettings.Reader
	Containers containers.Reader
	Websites   websites.Reader
	WS         http.Handler
	Static     http.Handler
	Packages   interface {
		Catalog(context.Context) (updates.Catalog, error)
	}
	BrokerSocket string
}

type Server struct {
	gitMu       sync.Mutex
	folderMoves atomic.Int64
	deps        Deps
	processes   system.ProcessSampler
	idem        *idemStore
	pi          *piWorker
	piRPC       piRuntime
	piAuth      piAuthRuntime
}

func NewServer(deps Deps) *Server {
	if deps.Packages == nil {
		deps.Packages = updates.NewWorker()
	}
	return &Server{deps: deps, idem: newIdemStore(), pi: newPiWorker(), piRPC: piRuntime{processes: map[string]*piProcess{}}}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/git/repository", s.handleGit)
	mux.HandleFunc("GET /api/v1/git/diff", s.handleGit)
	mux.HandleFunc("POST /api/v1/git/action", s.handleGit)
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
	mux.HandleFunc("GET /api/v1/meta/version", s.handleVersion)
	mux.HandleFunc("GET /api/v1/skills", s.handleSkills)
	mux.HandleFunc("GET /api/v1/skills/detail", s.handleSkills)
	mux.HandleFunc("GET /api/v1/apps", s.handleApps)
	mux.HandleFunc("POST /api/v1/apps/plan", s.handleAppPlan)
	mux.HandleFunc("POST /api/v1/apps/pi/uninstall", s.handlePiUninstall)
	mux.HandleFunc("POST /api/v1/apps/pi/plan", s.handlePiPlan)
	mux.HandleFunc("POST /api/v1/apps/pi/apply", s.handlePiApply)
	mux.HandleFunc("GET /api/v1/apps/pi/progress", s.handlePiProgress)
	mux.HandleFunc("GET /api/v1/docker/resources", s.handleDockerResources)
	mux.HandleFunc("POST /api/v1/docker/resource", s.handleDockerResourceAction)
	mux.HandleFunc("GET /api/v1/containers", s.handleContainers)
	mux.HandleFunc("GET /api/v1/containers/detail", s.handleContainers)
	mux.HandleFunc("GET /api/v1/containers/logs", s.handleContainers)
	mux.HandleFunc("POST /api/v1/containers/action", s.handleContainerAction)
	mux.HandleFunc("GET /api/v1/websites", s.handleWebsites)
	mux.HandleFunc("GET /api/v1/websites/logs", s.handleWebsites)
	mux.HandleFunc("POST /api/v1/websites/save", s.handleWebsiteSave)
	mux.HandleFunc("GET /api/v1/system/identity", s.handleIdentity)
	mux.HandleFunc("GET /api/v1/system/overview", s.handleOverview)
	mux.HandleFunc("GET /api/v1/system/metrics", s.handleMetrics)
	mux.HandleFunc("GET /api/v1/system/processes", s.handleProcesses)
	mux.HandleFunc("POST /api/v1/system/power", s.handleSystemPower)
	mux.HandleFunc("GET /api/v1/system/settings", s.handleSystemSettings)
	mux.HandleFunc("POST /api/v1/system/settings", s.handleSettingsApply)
	mux.HandleFunc("GET /api/v1/system/timezones", s.handleTimezones)
	mux.HandleFunc("GET /api/v1/network", s.handleNetworkSnapshot)
	mux.HandleFunc("POST /api/v1/network/apply", s.handleNetworkApply)
	mux.HandleFunc("POST /api/v1/network/confirm", s.handleNetworkConfirm)
	mux.HandleFunc("GET /api/v1/services", s.handleServices)
	mux.HandleFunc("GET /api/v1/services/detail", s.handleServiceDetail)
	mux.HandleFunc("GET /api/v1/journal", s.handleJournal)
	mux.HandleFunc("GET /api/v1/trash", s.handleTrashList)
	mux.HandleFunc("POST /api/v1/trash/restore", s.handleTrashRestore)
	mux.HandleFunc("POST /api/v1/trash/delete", s.handleTrashDelete)
	mux.HandleFunc("GET /api/v1/files/locations/plan", s.handleLocationMovePlan)
	mux.HandleFunc("GET /api/v1/files/locations/settings", s.handleLocationSettings)
	mux.HandleFunc("POST /api/v1/files/locations/settings", s.handleSetLocation)
	mux.HandleFunc("GET /api/v1/files/locations", s.handleFileLocations)
	mux.HandleFunc("GET /api/v1/files/list", s.handleFilesList)
	mux.HandleFunc("GET /api/v1/files/read", s.handleFilesRead)
	mux.HandleFunc("PUT /api/v1/files/write", s.handleFilesWrite)
	mux.HandleFunc("POST /api/v1/files/create", s.handleFilesCreate)
	mux.HandleFunc("POST /api/v1/files/move", s.handleFilesMove)
	mux.HandleFunc("POST /api/v1/files/delete", s.handleFilesDelete)
	mux.HandleFunc("POST /api/v1/files/write-privileged", s.handleFilesWritePrivileged)
	mux.HandleFunc("POST /api/v1/services/action", s.handleServicesAction)
	mux.HandleFunc("GET /api/v1/updates/packages", s.handleInstalledPackages)
	mux.HandleFunc("POST /api/v1/updates/refresh", s.handleUpdatesRefresh)
	mux.HandleFunc("GET /api/v1/apps/update-history", s.handleAppUpdateHistory)
	mux.HandleFunc("POST /api/v1/updates/plan", s.handleUpdatesPlan)
	mux.HandleFunc("POST /api/v1/updates/apply", s.handleUpdatesApply)
	if s.deps.WS != nil {
		mux.Handle("GET /api/v1/ws", s.deps.WS)
	}
	if s.deps.Static != nil {
		mux.Handle("GET /", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if strings.HasPrefix(r.URL.Path, "/api/") {
				s.handleNotFound(w, r)
				return
			}
			s.deps.Static.ServeHTTP(w, r)
		}))
	}
	mux.HandleFunc("/", s.handleNotFound)
	return s.wrap(mux)
}

func (s *Server) wrap(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if recover() != nil {
				WriteError(w, NewError(CodeInternal, "Internal server error."))
			}
		}()
		limit := int64(maxBodyBytes)
		if r.URL.Path == "/api/v1/files/write" || r.URL.Path == "/api/v1/pi/images" {
			limit = maxWriteBodyBytes
		} else if r.URL.Path == "/api/v1/files/write-privileged" {
			limit = maxPrivilegedWriteBodyBytes
		}
		r.Body = http.MaxBytesReader(w, r.Body, limit)
		next.ServeHTTP(w, r)
	})
}
