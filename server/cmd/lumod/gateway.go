// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"context"
	"errors"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"lumo/server/internal/appplugins"
	"lumo/server/internal/gateway"
	"lumo/server/internal/static"
)

func runGateway(args []string) {
	fs := flag.NewFlagSet("gateway", flag.ContinueOnError)
	addr := fs.String("addr", "127.0.0.1:8080", "listen address")
	web := fs.String("web", "", "serve the frontend from this directory instead of the embedded assets")
	plugins := fs.String("plugins", appplugins.Roots()[0], "administrator-managed app plugin directory")
	runDir := fs.String("run-dir", "/run/lumo", "runtime directory")
	certFile := fs.String("tls-cert", "", "PEM certificate chain")
	keyFile := fs.String("tls-key", "", "PEM private key")
	insecure := fs.Bool("insecure-http", false, "TEST ONLY: allow unencrypted non-loopback HTTP")
	if err := fs.Parse(args); err != nil {
		os.Exit(2)
	}
	if err := gateway.ValidateTransport(*addr, *certFile, *keyFile, *insecure); err != nil {
		log.Fatal(err)
	}
	if *insecure {
		log.Print("WARNING: -insecure-http is for isolated test containers only")
	}

	var staticHandler http.Handler
	if *web != "" {
		staticHandler = static.DirHandler(*web)
	} else {
		staticHandler = static.Handler()
	}

	gw := gateway.New(gateway.Config{
		Addr:           *addr,
		SessiondSocket: filepath.Join(*runDir, "sessiond.sock"),
		Static:         static.WithPlugins(static.WithPlugins(staticHandler, appplugins.Roots()[1]), *plugins),
		Version:        version,
	})

	srv := &http.Server{
		Addr:              *addr,
		Handler:           gw.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       90 * time.Second,
	}
	var certificate *gateway.Certificate
	if *certFile != "" {
		var err error
		certificate, err = gateway.NewCertificate(*certFile, *keyFile)
		if err != nil {
			log.Fatalf("TLS certificate: %v", err)
		}
		srv.TLSConfig = certificate.Config()
	}

	go func() {
		sig := make(chan os.Signal, 1)
		signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
		<-sig
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = srv.Shutdown(ctx)
	}()
	if certificate != nil {
		go func() {
			reload := make(chan os.Signal, 1)
			signal.Notify(reload, syscall.SIGHUP)
			for range reload {
				if err := certificate.Reload(); err != nil {
					log.Printf("TLS reload failed; keeping the previous certificate: %v", err)
				}
			}
		}()
	}

	log.Printf("lumod-gateway %s listening on %s", version, *addr)
	var err error
	if certificate != nil {
		err = srv.ListenAndServeTLS("", "")
	} else {
		err = srv.ListenAndServe()
	}
	if err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("listen: %v", err)
	}
}
