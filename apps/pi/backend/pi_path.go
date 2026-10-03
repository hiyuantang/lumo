// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"lumo/server/internal/appplugins"
	"os/user"
)

func piPath() string {
	u, err := user.Current()
	if err != nil {
		return ""
	}
	path, _ := appplugins.TerminalProgram(u.HomeDir, "pi")
	return path
}
