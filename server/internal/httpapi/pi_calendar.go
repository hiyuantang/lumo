// SPDX-License-Identifier: AGPL-3.0-only
package httpapi

import (
	_ "embed"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

//go:embed pi_calendar.mjs
var piCalendarExtension string

func writePiCalendarExtension(dir, mode string) (string, error) {
	if mode != "ask" && mode != "auto" && mode != "read-only" {
		return "", errors.New("Invalid Pi permission mode.")
	}
	executable, err := os.Executable()
	if err != nil {
		return "", err
	}
	code := strings.Replace(piCalendarExtension, "const executable = 'lumod';", "const executable = "+strconv.Quote(executable)+";", 1)
	code = strings.Replace(code, "const permissionMode = 'ask';", "const permissionMode = "+strconv.Quote(mode)+";", 1)
	file, err := os.CreateTemp(dir, ".lumo-calendar-*.mjs")
	if err != nil {
		return "", err
	}
	defer os.Remove(file.Name())
	_, err = file.WriteString(code)
	closeErr := file.Close()
	if err != nil {
		return "", err
	}
	if closeErr != nil {
		return "", closeErr
	}
	path := filepath.Join(dir, ".lumo-calendar-"+mode+".mjs")
	return path, os.Rename(file.Name(), path)
}
