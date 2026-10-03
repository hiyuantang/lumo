// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"lumo/plugin"
	"net/http"
	"os"
)

type Server struct{ Home string }

func main() {

	home, err := os.UserHomeDir()
	if err != nil {
		panic(err)
	}
	s := &Server{Home: home}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/skills", s.handleSkills)
	mux.HandleFunc("GET /api/v1/skills/detail", s.handleSkills)
	plugin.Serve(mux)
}
