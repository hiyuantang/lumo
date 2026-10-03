// SPDX-License-Identifier: AGPL-3.0-only
package httpapi

import (
	"errors"
	"lumo/server/internal/appplugins"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

func writePiPluginExtension(app *appplugins.Package, dir, mode string) (string, error) {
	if mode != "ask" && mode != "auto" && mode != "read-only" {
		return "", errors.New("Invalid Pi permission mode.")
	}
	executable, err := os.Executable()
	if err != nil {
		return "", err
	}
	raw, err := app.Asset(app.Manifest.Pi.Entry)
	if err != nil {
		return "", err
	}
	code := strings.Replace(string(raw), "const executable = 'lumod';", "const executable = "+strconv.Quote(executable)+";", 1)
	code = strings.Replace(code, "const permissionMode = 'ask';", "const permissionMode = "+strconv.Quote(mode)+";", 1)
	file, err := os.CreateTemp(dir, ".lumo-plugin-"+app.Name+"-*.mjs")
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
	path := filepath.Join(dir, ".lumo-plugin-"+app.Name+"-"+app.Manifest.Pi.Entry+"-"+mode+".mjs")
	return path, os.Rename(file.Name(), path)
}

func piPluginExtensions(home string, settings piExtensionSettings) []*appplugins.Package {
	result := []*appplugins.Package{}
	for _, name := range appplugins.NamesFor(home) {
		app, err := appplugins.LoadFor(home, name)
		if err != nil || app.Manifest.Pi == nil {
			continue
		}
		if app.Manifest.Pi.Setting == "calendar" && !settings.Calendar {
			continue
		}
		result = append(result, app)
	}
	return result
}
