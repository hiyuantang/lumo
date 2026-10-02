// SPDX-License-Identifier: AGPL-3.0-only
package httpapi

import (
	"encoding/json"
	"errors"
	"lumo/server/internal/desktopapps"
	"lumo/server/internal/strictjson"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

type desktopLaunch struct {
	Digest, Frame, Session, Revision, Handshake string
	Preview                                     bool
	Expires                                     time.Time
	LastCall                                    time.Time
	Calls                                       int
	WindowStart                                 time.Time
	Data                                        desktopapps.DataSnapshot
}
type desktopAppRuntime struct {
	mu       sync.Mutex
	launches map[string]*desktopLaunch
}

func appStore() (*desktopapps.Store, error) {
	home, e := os.UserHomeDir()
	return desktopapps.New(home), e
}
func appError(w http.ResponseWriter, e error) {
	code := CodeValidationFailed
	if errors.Is(e, desktopapps.ErrConflict) || errors.Is(e, desktopapps.ErrDataConflict) {
		code = CodeConflict
	} else if errors.Is(e, desktopapps.ErrCapability) {
		code = CodeForbidden
	} else if errors.Is(e, desktopapps.ErrMissing) {
		code = CodeNotFound
	}
	WriteError(w, NewError(code, e.Error()))
}
func (s *Server) handleDesktopApps(w http.ResponseWriter, r *http.Request) {
	store, e := appStore()
	if e != nil {
		WriteError(w, e)
		return
	}
	if r.Method == "GET" {
		v, e := store.Catalog()
		if e != nil {
			appError(w, e)
			return
		}
		WriteData(w, v)
		return
	}
	var req desktopapps.Change
	if strictjson.Decode(w, r, maxBodyBytes, &req) != nil {
		appError(w, desktopapps.ErrInvalid)
		return
	}
	v, e := store.Change(req)
	if e != nil {
		appError(w, e)
		return
	}
	s.desktopApps.mu.Lock()
	for token, launch := range s.desktopApps.launches {
		b, e := store.Bundle(launch.Digest)
		if e != nil || b.Manifest.ID == req.ID {
			delete(s.desktopApps.launches, token)
		}
	}
	s.desktopApps.mu.Unlock()
	WriteData(w, v)
}
func (s *Server) handleDesktopLaunch(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Digest  string `json:"digest"`
		Preview bool   `json:"preview"`
	}
	if strictjson.Decode(w, r, 4096, &req) != nil {
		appError(w, desktopapps.ErrInvalid)
		return
	}
	store, e := appStore()
	if e != nil {
		WriteError(w, e)
		return
	}
	if _, e = store.Check(req.Digest, req.Preview); e != nil {
		appError(w, e)
		return
	}
	s.desktopApps.mu.Lock()
	defer s.desktopApps.mu.Unlock()
	if s.desktopApps.launches == nil {
		s.desktopApps.launches = map[string]*desktopLaunch{}
	}
	for token, l := range s.desktopApps.launches {
		if time.Now().After(l.Expires) {
			delete(s.desktopApps.launches, token)
		}
	}
	if len(s.desktopApps.launches) >= 64 {
		WriteError(w, NewError(CodeBusy, "Close an app window before opening another."))
		return
	}
	revision, e := store.Revision(req.Digest)
	if e != nil {
		appError(w, e)
		return
	}
	token := desktopapps.Token()
	frame := desktopapps.Token()
	s.desktopApps.launches[token] = &desktopLaunch{Digest: req.Digest, Revision: revision, Preview: req.Preview, Data: desktopapps.EmptyData(), Frame: frame, Handshake: desktopapps.Token(), Session: r.Header.Get("X-Lumo-Session"), Expires: time.Now().Add(time.Hour)}
	WriteData(w, map[string]string{"token": token, "handshake": s.desktopApps.launches[token].Handshake, "url": "/api/v1/desktop-apps/frame?frame=" + frame})
}
func (s *Server) handleDesktopFrame(w http.ResponseWriter, r *http.Request) {
	s.desktopApps.mu.Lock()
	var launch *desktopLaunch
	for _, item := range s.desktopApps.launches {
		if item.Frame == r.URL.Query().Get("frame") && item.Session == r.Header.Get("X-Lumo-Session") && time.Now().Before(item.Expires) {
			copy := *item
			launch = &copy
			break
		}
	}
	s.desktopApps.mu.Unlock()
	if launch == nil {
		appError(w, desktopapps.ErrMissing)
		return
	}
	store, e := appStore()
	if e != nil {
		WriteError(w, e)
		return
	}
	b, e := store.Check(launch.Digest, launch.Preview)
	if e != nil {
		appError(w, e)
		return
	}
	document, policy := desktopapps.Document(b, launch.Handshake)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Content-Security-Policy", policy)
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	_, _ = w.Write([]byte(document))
}
func (s *Server) handleDesktopCall(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Token   string          `json:"token"`
		Method  string          `json:"method"`
		Status  string          `json:"status"`
		Message string          `json:"message"`
		Params  json.RawMessage `json:"params,omitempty"`
	}
	if strictjson.Decode(w, r, desktopapps.MaxDataBytes*6+4096, &req) != nil {
		appError(w, desktopapps.ErrInvalid)
		return
	}
	s.desktopApps.mu.Lock()
	defer s.desktopApps.mu.Unlock()
	launch := s.desktopApps.launches[req.Token]
	if launch == nil || launch.Session != r.Header.Get("X-Lumo-Session") || time.Now().After(launch.Expires) {
		appError(w, desktopapps.ErrMissing)
		return
	}
	if r.URL.Path == "/api/v1/desktop-apps/close" {
		delete(s.desktopApps.launches, req.Token)
		WriteData(w, map[string]bool{"closed": true})
		return
	}
	store, e := appStore()
	if e != nil {
		WriteError(w, e)
		return
	}
	b, e := store.Check(launch.Digest, launch.Preview)
	if e != nil {
		delete(s.desktopApps.launches, req.Token)
		appError(w, e)
		return
	}
	if !launch.Preview {
		revision, e := store.Revision(launch.Digest)
		if e != nil {
			appError(w, e)
			return
		}
		if revision == "" || revision != launch.Revision {
			delete(s.desktopApps.launches, req.Token)
			appError(w, desktopapps.ErrMissing)
			return
		}
	}

	if r.URL.Path == "/api/v1/desktop-apps/report" {
		if e = store.Report(launch.Digest, req.Status, req.Message); e != nil {
			appError(w, e)
			return
		}
		WriteData(w, map[string]bool{"accepted": true})
		return
	}
	capability := req.Method
	if strings.HasPrefix(req.Method, "app.storage.") {
		capability = "app.storage"
	}
	if (req.Method != "system.metrics.read" && req.Method != "app.storage.get" && req.Method != "app.storage.set") || !desktopapps.HasCapability(b.Manifest, capability) {
		appError(w, desktopapps.ErrCapability)
		return
	}
	if time.Since(launch.WindowStart) >= 10*time.Second {
		launch.WindowStart = time.Now()
		launch.Calls = 0
	}
	launch.Calls++
	if launch.Calls > 30 || (req.Method == "system.metrics.read" && time.Since(launch.LastCall) < 250*time.Millisecond) {
		WriteError(w, NewError(CodeBusy, "Too many app requests."))
		return
	}
	if capability == "app.storage" {
		var value desktopapps.DataSnapshot
		if launch.Preview {
			if req.Method == "app.storage.get" {
				if len(req.Params) != 0 {
					e = desktopapps.ErrInvalid
				} else {
					value = launch.Data
				}
			} else {
				value, e = desktopapps.UpdateData(launch.Data, req.Params)
				if e == nil {
					launch.Data = value
				}
			}
		} else {
			value, e = store.Data(launch.Digest, launch.Revision, req.Method, req.Params)
		}
		if e != nil {
			appError(w, e)
			return
		}
		WriteData(w, value)
		return
	}
	if len(req.Params) != 0 {
		appError(w, desktopapps.ErrInvalid)
		return
	}
	launch.LastCall = time.Now()
	if s.deps.Sampler == nil {
		WriteError(w, NewError(CodeUnavailable, "System metrics are unavailable."))
		return
	}
	v := s.deps.Sampler.Sample()
	WriteData(w, map[string]any{"cpuPercent": v.CPU.UsagePercent, "memoryUsedBytes": v.Memory.UsedBytes, "memoryTotalBytes": v.Memory.TotalBytes, "at": time.Now().UnixMilli()})
}
