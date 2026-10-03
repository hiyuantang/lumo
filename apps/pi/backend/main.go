// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"time"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
func run() error {
	if len(os.Args) > 1 && os.Args[1] == "pi-history" {
		runPiHistory(os.Args[2:])
		return nil
	}
	if len(os.Args) != 2 || os.Args[1] != "serve-resident" {
		return fmt.Errorf("Pi is started by the Lumo app host")
	}
	descriptor := os.NewFile(3, "lumo-app-listener")
	if descriptor == nil {
		return fmt.Errorf("missing app listener")
	}
	listener, err := net.FileListener(descriptor)
	descriptor.Close()
	if err != nil {
		return err
	}
	app := NewServer(Deps{})
	server := &http.Server{Handler: app.Handler(), ReadHeaderTimeout: 10 * time.Second}
	stopped := make(chan struct{})
	go func() {
		io.Copy(io.Discard, os.Stdin)
		app.Close()
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		server.Shutdown(ctx)
		close(stopped)
	}()
	err = server.Serve(listener)
	if err == http.ErrServerClosed {
		<-stopped
		return nil
	}
	return err
}
func (s *Server) Close() {
	s.piRPC.mu.Lock()
	for _, p := range s.piRPC.processes {
		p.cancel()
	}
	s.piRPC.mu.Unlock()
	s.piAuth.mu.Lock()
	if s.piAuth.flow != nil {
		s.piAuth.flow.stop()
	}
	s.piAuth.mu.Unlock()
}
