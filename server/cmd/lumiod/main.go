// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"runtime"

	"lumio-os/server/internal/auth"
	"lumio-os/server/internal/static"
)

var version = "0.4.0"

func main() {
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "gateway":
			runGateway(os.Args[2:])
			return
		case "sessiond":
			runSessiond(os.Args[2:])
			return
		case "agent":
			runAgent(os.Args[2:])
			return
		case "broker":
			runBroker(os.Args[2:])
			return
		case "version", "--version":
			_ = json.NewEncoder(os.Stdout).Encode(map[string]any{
				"version": version, "pam": auth.Available, "web": static.Available(),
				"os": runtime.GOOS, "arch": runtime.GOARCH,
			})
			return
		}
	}
	fmt.Fprintln(os.Stderr, "Usage: lumiod {gateway|sessiond|agent|broker|version}")
	os.Exit(2)
}
