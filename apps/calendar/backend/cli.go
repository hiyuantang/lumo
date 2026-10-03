// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"

	"time"

	"lumo/apps/calendar/backend/calendar"
)

func runCalendar(args []string) {
	fail := func(err error) { fmt.Fprintln(os.Stderr, err); os.Exit(1) }
	if len(args) != 1 || (args[0] != "list" && args[0] != "change") {
		fail(calendar.ErrInvalid)
	}
	home, err := os.UserHomeDir()
	if err != nil {
		fail(err)
	}
	store, err := calendar.Open(home)
	if err != nil {
		fail(err)
	}
	defer store.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	decoder := json.NewDecoder(io.LimitReader(os.Stdin, 1<<20))
	decoder.DisallowUnknownFields()
	var value any
	if args[0] == "list" {
		var req struct {
			From string `json:"from"`
			To   string `json:"to"`
		}
		if err = decoder.Decode(&req); err != nil {
			fail(err)
		}
		var extra any
		if decoder.Decode(&extra) != io.EOF {
			fail(calendar.ErrInvalid)
		}
		from, e := time.Parse(time.RFC3339, req.From)
		if e != nil {
			fail(e)
		}
		to, e := time.Parse(time.RFC3339, req.To)
		if e != nil {
			fail(e)
		}
		value, err = store.Snapshot(ctx, from, to)
	} else {
		var req calendar.Change
		if err = decoder.Decode(&req); err != nil {
			fail(err)
		}
		var extra any
		if decoder.Decode(&extra) != io.EOF {
			fail(calendar.ErrInvalid)
		}
		value, err = store.Change(ctx, req)
	}
	if err != nil {
		fail(err)
	}
	if err = json.NewEncoder(os.Stdout).Encode(value); err != nil {
		fail(err)
	}
}
