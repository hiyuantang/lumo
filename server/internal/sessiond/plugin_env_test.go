// SPDX-License-Identifier: AGPL-3.0-only
package sessiond

import (
	"os/user"
	"strings"
	"testing"
)

func TestAgentReceivesOnlyAdministratorPluginPaths(t *testing.T) {
	t.Setenv("LUMO_PLUGIN_DIR", "/srv/lumo/plugins")
	t.Setenv("LUMO_PLUGIN_BUNDLED_DIR", "/opt/lumo/plugins")
	t.Setenv("UNRELATED_SECRET", "must-not-be-forwarded")
	env := strings.Join(agentEnv(&user.User{Username: "fixture", HomeDir: "/home/fixture"}), "\n")
	for _, value := range []string{"HOME=/home/fixture", "LUMO_PLUGIN_DIR=/srv/lumo/plugins", "LUMO_PLUGIN_BUNDLED_DIR=/opt/lumo/plugins"} {
		if !strings.Contains(env, value) {
			t.Fatal("missing configured path", value)
		}
	}
	if strings.Contains(env, "UNRELATED_SECRET") {
		t.Fatal("unrelated root environment leaked")
	}
	t.Setenv("LUMO_PLUGIN_DIR", "relative/path")
	for _, value := range agentEnv(&user.User{Username: "fixture", HomeDir: "/home/fixture"}) {
		if strings.HasPrefix(value, "LUMO_PLUGIN_DIR=") {
			t.Fatal("relative plugin path accepted")
		}
	}
}
