// SPDX-License-Identifier: AGPL-3.0-only
package gateway

import (
	"os"
	"path/filepath"
	"runtime"
)

func init() {
	if os.Getenv("LUMO_PLUGIN_BUNDLED_DIR") != "" {
		return
	}
	_, file, _, _ := runtime.Caller(0)
	os.Setenv("LUMO_PLUGIN_BUNDLED_DIR", filepath.Join(filepath.Dir(file), "../../../.tools/plugin-packages"))
}
