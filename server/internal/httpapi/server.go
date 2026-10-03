// SPDX-License-Identifier: AGPL-3.0-only
package httpapi

import (
	"context"
	"net/http"
	"os/user"
	"strings"
	"sync"
	"sync/atomic"

	"lumo/server/internal/appplugins"
	"lumo/server/internal/hostsettings"
	"lumo/server/internal/journal"
	"lumo/server/internal/network"
	"lumo/server/internal/services"
	"lumo/server/internal/system"
	"lumo/server/internal/updates"
)

const (
	maxBodyBytes                = 1 << 20
	maxWriteBodyBytes           = 12 << 20
	maxPrivilegedWriteBodyBytes = 2 << 20
)

type Deps struct {
	Version  string
	Sampler  *system.Sampler
	Services services.API
	Journal  journal.Backend
	Network  network.Snapshotter
	Settings hostsettings.Reader
	WS       http.Handler
	Static   http.Handler
	Packages interface {
		Catalog(context.Context) (updates.Catalog, error)
	}
	BrokerSocket string
}

type Server struct {
	desktopApps desktopAppRuntime
	pluginLocks sync.Map
	folderMoves atomic.Int64
	deps        Deps
	processes   system.ProcessSampler
	idem        *idemStore
	home        string
	residents   residentRuntime
}

func NewServer(deps Deps) *Server {
	if deps.Packages == nil {
		deps.Packages = updates.NewWorker()
	}
	home := ""
	if u, err := user.Current(); err == nil {
		home = u.HomeDir
	}
	return &Server{deps: deps, idem: newIdemStore(), home: home}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/app-plugins", s.handlePluginCatalog)
	mux.HandleFunc("POST /api/v1/app-plugins/import", s.handlePluginImport)
	mux.HandleFunc("POST /api/v1/app-plugins/action", s.handlePluginChange)
	mux.HandleFunc("GET /api/v1/app-plugins/assets/{asset...}", s.handlePluginAsset)
	mux.HandleFunc("GET /api/v1/desktop-apps", s.handleDesktopApps)
	mux.HandleFunc("POST /api/v1/desktop-apps/action", s.handleDesktopApps)
	mux.HandleFunc("POST /api/v1/desktop-apps/launch", s.handleDesktopLaunch)
	mux.HandleFunc("GET /api/v1/desktop-apps/frame", s.handleDesktopFrame)
	mux.HandleFunc("POST /api/v1/desktop-apps/call", s.handleDesktopCall)
	mux.HandleFunc("POST /api/v1/desktop-apps/report", s.handleDesktopCall)
	mux.HandleFunc("POST /api/v1/desktop-apps/close", s.handleDesktopCall)
	mux.HandleFunc("GET /api/v1/meta/version", s.handleVersion)
	mux.HandleFunc("GET /api/v1/apps", s.handleApps)
	mux.HandleFunc("POST /api/v1/apps/plan", s.handleAppPlan)
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
		if name := appplugins.Owner(r.URL.Path); name != "" {
			s.handlePlugin(w, r, name)
			return
		}
		limit := int64(maxBodyBytes)
		if r.URL.Path == "/api/v1/app-plugins/import" {
			limit = maxPluginBody
		}
		if r.URL.Path == "/api/v1/files/write" {
			limit = maxWriteBodyBytes
		} else if r.URL.Path == "/api/v1/files/write-privileged" {
			limit = maxPrivilegedWriteBodyBytes
		}
		r.Body = http.MaxBytesReader(w, r.Body, limit)
		next.ServeHTTP(w, r)
	})
}
