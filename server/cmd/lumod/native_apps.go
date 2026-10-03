// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"lumo/server/internal/appbuilder"
	"lumo/server/internal/appplugins"
	"os"
	"os/user"
	"time"
)

func runNativeApps(args []string) {
	fail := func(err error) { fmt.Fprintln(os.Stderr, err); os.Exit(1) }
	if len(args) != 1 {
		fail(fmt.Errorf("Usage: lumod native-app api|create|validate|build|list|install|restore"))
	}
	var req struct {
		Project   string `json:"project"`
		Name      string `json:"name"`
		Title     string `json:"title"`
		Backend   *bool  `json:"backend"`
		Pi        *bool  `json:"pi"`
		Digest    string `json:"digest"`
		Revision  string `json:"revision"`
		RequestID string `json:"requestId"`
		Trust     bool   `json:"trust"`
	}
	decoder := json.NewDecoder(io.LimitReader(os.Stdin, 16385))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&req); err != nil {
		fail(err)
	}
	if decoder.Decode(new(any)) != io.EOF {
		fail(fmt.Errorf("Supply one JSON request"))
	}
	account, err := user.Current()
	if err != nil {
		fail(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	var value any
	switch args[0] {
	case "api":
		value = appbuilder.API()
	case "list":
		value = appplugins.Catalog(account.HomeDir)
	case "create":
		value, err = appbuilder.Create(req.Project, req.Name, req.Title, req.Backend == nil || *req.Backend, req.Pi == nil || *req.Pi)
	case "validate", "build":
		value = appbuilder.Build(ctx, account.HomeDir, req.Project, args[0] == "build")
	case "install", "restore":
		if req.RequestID == "" {
			fail(fmt.Errorf("A unique requestId is required"))
		}
		change := appplugins.Change{Name: req.Name, Action: "install", Digest: req.Digest, Revision: req.Revision, RequestID: req.RequestID, Trust: req.Trust}
		if args[0] == "restore" {
			change.Action = "rollback"
			change.Digest = ""
		}
		value = appbuilder.Install(ctx, account.HomeDir, change)
	default:
		err = fmt.Errorf("Unknown native app operation")
	}
	if err != nil {
		fail(err)
	}
	if err = json.NewEncoder(os.Stdout).Encode(value); err != nil {
		fail(err)
	}
	if report, ok := value.(appbuilder.Report); ok && !report.OK {
		os.Exit(1)
	}
}
