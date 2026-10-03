// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"fmt"
	"lumo/server/internal/appplugins"
	"os"
	"os/exec"
)

func runPlugin(args []string) {
	if len(args) < 2 {
		fmt.Fprintln(os.Stderr, "Usage: lumod plugin <app> <command>")
		os.Exit(2)
	}
	home, _ := os.UserHomeDir()
	app, err := appplugins.LoadFor(home, args[0])
	if err != nil {
		fmt.Fprintln(os.Stderr, "App package unavailable.")
		os.Exit(1)
	}
	executable, err := app.Executable()
	if err != nil {
		fmt.Fprintln(os.Stderr, "App backend unavailable.")
		os.Exit(1)
	}
	command := exec.Command(executable, args[1:]...)
	command.Env = append(os.Environ(), "LUMO_APP_DATA="+appplugins.DataDirectory(home, args[0]))
	command.Stdin = os.Stdin
	command.Stdout = os.Stdout
	command.Stderr = os.Stderr
	if err = command.Run(); err != nil {
		if e, ok := err.(*exec.ExitError); ok {
			os.Exit(e.ExitCode())
		}
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
