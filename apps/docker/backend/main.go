// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"lumo/apps/docker/backend/containers"
	"lumo/plugin"
	"net/http"
	"os"
)

type Server struct {
	Home       string
	Containers containers.Reader
}

func main() {

	home, err := os.UserHomeDir()
	if err != nil {
		panic(err)
	}
	s := &Server{Home: home, Containers: containers.NewClient()}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/containers", s.handleContainers)
	mux.HandleFunc("GET /api/v1/containers/detail", s.handleContainers)
	mux.HandleFunc("GET /api/v1/containers/logs", s.handleContainers)
	mux.HandleFunc("POST /api/v1/containers/action", s.handleContainerAction)
	mux.HandleFunc("GET /api/v1/docker/resources", s.handleDockerResources)
	mux.HandleFunc("POST /api/v1/docker/resource", s.handleDockerResourceAction)
	plugin.Serve(mux)
}
