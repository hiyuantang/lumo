// SPDX-License-Identifier: AGPL-3.0-only
package appplugins

import (
	"os"
	"path/filepath"
	"strings"
)

func TerminalProgram(home, name string) (string, []string) {
	pkg, err := LoadFor(home, name)
	if err != nil || pkg.Manifest.Terminal == nil {
		return "", nil
	}
	expand := func(value string) string { return strings.ReplaceAll(value, "$HOME", home) }
	paths := []string{}
	for _, path := range pkg.Manifest.Terminal.Path {
		path = expand(path)
		if filepath.IsAbs(path) {
			paths = append(paths, path)
		}
	}
	for _, candidate := range pkg.Manifest.Terminal.Candidates {
		path := expand(candidate)
		if !filepath.IsAbs(path) {
			continue
		}
		if info, err := os.Stat(path); err == nil && info.Mode().IsRegular() && info.Mode().Perm()&0111 != 0 {
			return path, paths
		}
	}
	return "", paths
}
