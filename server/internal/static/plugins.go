// SPDX-License-Identifier: AGPL-3.0-only
package static

import (
	"net/http"
	"os"
	"regexp"
	"strings"
)

var pluginAsset = regexp.MustCompile(`^[a-f0-9]{64}\.(js|css)$`)
var pluginName = regexp.MustCompile(`^[a-z][a-z0-9-]{0,47}$`)

func WithPlugins(fallback http.Handler, directory string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/plugins/") {
			fallback.ServeHTTP(w, r)
			return
		}
		parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/plugins/"), "/")
		if len(parts) != 2 || !pluginName.MatchString(parts[0]) || (parts[1] != "manifest.json" && !pluginAsset.MatchString(parts[1])) {
			http.NotFound(w, r)
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		if directory != "" {
			root, err := os.OpenRoot(directory)
			if err == nil {
				defer root.Close()
				file, err := root.Open(parts[0] + "/" + parts[1])
				if err == nil {
					defer file.Close()
					info, err := file.Stat()
					if err == nil && info.Mode().IsRegular() {
						http.ServeContent(w, r, parts[1], info.ModTime(), file)
						return
					}
				}
			}
		}
		fallback.ServeHTTP(w, r)
	})
}
