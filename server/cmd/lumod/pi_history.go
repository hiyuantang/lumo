// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"lumo/server/internal/pihistory"
	"os"
)

func runPiHistory(args []string) {
	flags := flag.NewFlagSet("pi-history", flag.ExitOnError)
	file := flags.String("file", "", "Absolute saved Pi session path")
	query := flags.String("query", "", "Search user and assistant text, returning short excerpts")
	entry := flags.String("entry", "", "Read one entry by ID, up to 4000 characters")
	before := flags.Int("before", 0, "Return matching entries before this line")
	offset := flags.Int("offset", 0, "Character offset within a selected entry")
	limit := flags.Int("limit", 8, "Maximum excerpts (1–20)")
	flags.Parse(args)
	result, err := pihistory.Read(*file, pihistory.Options{Query: *query, Entry: *entry, Before: *before, Offset: *offset, Limit: *limit})
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if err = json.NewEncoder(os.Stdout).Encode(result); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
