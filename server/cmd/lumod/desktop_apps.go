// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"lumo/server/internal/desktopapps"
	"os"
	"os/user"
	"time"
)

func runDesktopApps(args []string) {
	fail := func(err error) { fmt.Fprintln(os.Stderr, err); os.Exit(1) }
	if len(args) != 1 {
		fail(desktopapps.ErrInvalid)
	}
	var req struct {
		Template  string `json:"template"`
		Project   string `json:"project"`
		ID        string `json:"id"`
		Name      string `json:"name"`
		Digest    string `json:"digest"`
		Revision  string `json:"revision"`
		RequestID string `json:"requestId"`
	}
	decoder := json.NewDecoder(io.LimitReader(os.Stdin, 16385))
	decoder.DisallowUnknownFields()
	if e := decoder.Decode(&req); e != nil {
		fail(e)
	}
	if decoder.Decode(new(any)) != io.EOF {
		fail(desktopapps.ErrInvalid)
	}
	account, e := user.Current()
	if e != nil {
		fail(e)
	}
	s := desktopapps.New(account.HomeDir)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	var value any
	switch args[0] {
	case "api":
		value = desktopapps.API()
	case "create":
		value, e = desktopapps.Create(req.Project, req.ID, req.Name, req.Template)
	case "build":
		value, e = s.Build(ctx, req.Project)
	case "list":
		value, e = s.Catalog()
	case "status":
		value, e = s.Status(req.Digest)
	case "install", "restore":
		value, e = s.Change(desktopapps.Change{RequestID: req.RequestID, Action: args[0], ID: req.ID, Digest: req.Digest, Revision: req.Revision})
	default:
		e = desktopapps.ErrInvalid
	}
	if e != nil {
		fail(e)
	}
	if b, ok := value.(desktopapps.Bundle); ok {
		b.JS = ""
		b.CSS = ""
		value = b
	}
	if e = json.NewEncoder(os.Stdout).Encode(value); e != nil {
		fail(e)
	}
}
