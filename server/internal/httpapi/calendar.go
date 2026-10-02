// SPDX-License-Identifier: AGPL-3.0-only
package httpapi

import (
	"context"
	"errors"
	"net/http"
	"time"

	"lumo/server/internal/calendar"
	"lumo/server/internal/strictjson"
)

func calendarError(w http.ResponseWriter, err error) {
	if errors.Is(err, calendar.ErrConflict) {
		WriteError(w, NewError(CodeConflict, err.Error()))
	} else {
		WriteError(w, NewError(CodeValidationFailed, err.Error()))
	}
}
func (s *Server) handleCalendar(w http.ResponseWriter, r *http.Request) {
	store, err := calendar.Open(s.pi.home)
	if err != nil {
		WriteError(w, NewError(CodeUnavailable, "Calendar storage is unavailable."))
		return
	}
	defer store.Close()
	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()
	if r.Method == http.MethodGet {
		from, err := time.Parse(time.RFC3339, r.URL.Query().Get("from"))
		if err != nil {
			calendarError(w, calendar.ErrInvalid)
			return
		}
		to, err := time.Parse(time.RFC3339, r.URL.Query().Get("to"))
		if err != nil {
			calendarError(w, calendar.ErrInvalid)
			return
		}
		google := r.URL.Query().Get("google")
		if google != "" && google != "0" && google != "1" {
			calendarError(w, calendar.ErrInvalid)
			return
		}
		value, err := store.Snapshot(ctx, from, to, google != "0")
		if err != nil {
			calendarError(w, err)
			return
		}
		WriteData(w, value)
		return
	}
	var req struct {
		RequestID string `json:"requestId"`
		calendar.Change
	}
	if strictjson.Decode(w, r, maxBodyBytes, &req) != nil || !validRequestID(req.RequestID) {
		calendarError(w, calendar.ErrInvalid)
		return
	}
	s.mutate(w, req.RequestID, func(w http.ResponseWriter) {
		value, err := store.Change(ctx, req.Change)
		if err != nil {
			calendarError(w, err)
			return
		}
		WriteData(w, value)
	})
}
func (s *Server) handleCalendarNotices(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RequestID string `json:"requestId"`
	}
	if strictjson.Decode(w, r, maxBodyBytes, &req) != nil || !validRequestID(req.RequestID) {
		calendarError(w, calendar.ErrInvalid)
		return
	}
	s.mutate(w, req.RequestID, func(w http.ResponseWriter) {
		store, err := calendar.Open(s.pi.home)
		if err != nil {
			WriteError(w, NewError(CodeUnavailable, "Calendar storage is unavailable."))
			return
		}
		defer store.Close()
		notices, err := store.Notices(r.Context(), time.Now())
		if err != nil {
			calendarError(w, err)
			return
		}
		WriteData(w, map[string]any{"notices": notices})
	})
}
func (s *Server) handleCalendarGoogle(w http.ResponseWriter, r *http.Request) {
	store, err := calendar.Open(s.pi.home)
	if err != nil {
		WriteError(w, NewError(CodeUnavailable, "Calendar storage is unavailable."))
		return
	}
	defer store.Close()
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	if r.Method == http.MethodGet {
		status, err := store.GoogleStatus(ctx)
		if err != nil {
			calendarError(w, err)
			return
		}
		WriteData(w, status)
		return
	}
	var req struct {
		RequestID string                 `json:"requestId"`
		Action    string                 `json:"action"`
		Config    *calendar.GoogleConfig `json:"config,omitempty"`
	}
	if strictjson.Decode(w, r, maxBodyBytes, &req) != nil || !validRequestID(req.RequestID) {
		calendarError(w, calendar.ErrInvalid)
		return
	}
	s.mutate(w, req.RequestID, func(w http.ResponseWriter) {
		switch req.Action {
		case "configure":
			if req.Config == nil {
				calendarError(w, calendar.ErrInvalid)
				return
			}
			err = store.ConfigureGoogle(ctx, *req.Config)
		case "connect":
			var target string
			target, err = store.AuthorizeGoogle(ctx)
			if err == nil {
				WriteData(w, map[string]string{"url": target})
				return
			}
		case "disconnect":
			err = store.DisconnectGoogle(ctx)
		default:
			err = calendar.ErrInvalid
		}
		if err != nil {
			calendarError(w, err)
			return
		}
		status, err := store.GoogleStatus(ctx)
		if err != nil {
			calendarError(w, err)
			return
		}
		WriteData(w, map[string]any{"status": status})
	})
}
func (s *Server) handleCalendarGoogleCallback(w http.ResponseWriter, r *http.Request) {
	store, err := calendar.Open(s.pi.home)
	if err != nil {
		WriteError(w, NewError(CodeUnavailable, "Calendar storage is unavailable."))
		return
	}
	defer store.Close()
	if r.URL.Query().Get("error") != "" {
		http.Redirect(w, r, "/?calendar=google-declined", http.StatusSeeOther)
		return
	}
	if err = store.FinishGoogle(r.Context(), r.URL.Query().Get("state"), r.URL.Query().Get("code")); err != nil {
		http.Redirect(w, r, "/?calendar=google-error", http.StatusSeeOther)
		return
	}
	http.Redirect(w, r, "/?calendar=google-connected", http.StatusSeeOther)
}
