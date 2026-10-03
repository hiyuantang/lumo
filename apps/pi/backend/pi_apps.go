// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	_ "embed"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

//go:embed pi_apps.mjs
var piAppsExtension string

func writePiAppsExtension(dir, mode string, desktop bool) (string, error) {
	executable, e := hostExecutable()
	if e != nil {
		return "", e
	}
	if _, e = writeLumoUseExtension(dir); e != nil {
		return "", e
	}
	code := strings.Replace(piAppsExtension, "const executable = 'lumod';", "const executable = "+strconv.Quote(executable)+";", 1)
	code = strings.Replace(code, "const permissionMode = 'ask';", "const permissionMode = "+strconv.Quote(mode)+";", 1)
	code = strings.Replace(code, "const desktopEnabled = true;", "const desktopEnabled = "+strconv.FormatBool(desktop)+";", 1)
	path := filepath.Join(dir, ".lumo-apps-"+mode+".mjs")
	return path, os.WriteFile(path, []byte(code), 0600)
}
