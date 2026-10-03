// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"lumo/plugin"
	"net/http"
	"os"
)

type Server struct{ Home string }

func main() {
	if len(os.Args) > 1 && os.Args[1] != "serve" {
		runCalendar(os.Args[1:])
		return
	}
	home, err := os.UserHomeDir()
	if err != nil {
		panic(err)
	}
	s := &Server{Home: home}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/calendar", s.handleCalendar)
	mux.HandleFunc("POST /api/v1/calendar", s.handleCalendar)
	mux.HandleFunc("POST /api/v1/calendar/notices", s.handleCalendarNotices)
	mux.HandleFunc("GET /api/v1/calendar/google", s.handleCalendarGoogle)
	mux.HandleFunc("POST /api/v1/calendar/google", s.handleCalendarGoogle)
	mux.HandleFunc("GET /api/v1/calendar/google/callback", s.handleCalendarGoogleCallback)
	plugin.Serve(mux)
}
