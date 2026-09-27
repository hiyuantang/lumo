// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"flag"
	"log"
	"os"
	"path/filepath"

	"lumo/server/internal/broker"
)

func runBroker(args []string) {
	fs := flag.NewFlagSet("broker", flag.ContinueOnError)
	runDir := fs.String("run-dir", "/run/lumo", "runtime directory")
	dbPath := fs.String("db", "/var/lib/lumo/audit.db", "audit database path")
	if err := fs.Parse(args); err != nil {
		os.Exit(2)
	}
	server, err := broker.New(broker.Config{
		SocketPath:     filepath.Join(*runDir, "broker.sock"),
		DBPath:         *dbPath,
		SessiondSocket: filepath.Join(*runDir, "sessiond.sock"),
	})
	if err != nil {
		log.Fatalf("broker: %v", err)
	}
	if err := server.Run(); err != nil {
		log.Fatalf("broker: %v", err)
	}
}
