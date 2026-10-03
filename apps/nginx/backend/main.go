// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"lumo/apps/nginx/backend/websites"
	"lumo/plugin"
	"net/http"
	"os"
)

type Server struct {
	Home     string
	Websites websites.Reader
}

func main() {

	home, err := os.UserHomeDir()
	if err != nil {
		panic(err)
	}
	s := &Server{Home: home, Websites: websites.NewStore()}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/websites", s.handleWebsites)
	mux.HandleFunc("GET /api/v1/websites/logs", s.handleWebsites)
	mux.HandleFunc("POST /api/v1/websites/save", s.handleWebsiteSave)
	plugin.Serve(mux)
}
