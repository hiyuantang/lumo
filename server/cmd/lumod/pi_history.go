// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"context"
	"fmt"
	"lumo/server/internal/appplugins"
	"os"
	"os/user"
)

func runPiHistory(args []string) {
	u, err := user.Current()
	if err == nil {
		var pkg *appplugins.Package
		pkg, err = appplugins.LoadFor(u.HomeDir, "pi")
		if err == nil {
			command, e := pkg.Command(context.Background(), u.HomeDir, append([]string{"pi-history"}, args...)...)
			err = e
			if err == nil {
				command.Stdout = os.Stdout
				command.Stderr = os.Stderr
				err = command.Run()
			}
		}
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
