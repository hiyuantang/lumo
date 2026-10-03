// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPiAppBuilderPreferencePreservesOtherSettingsAndOlderClients(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("PI_CODING_AGENT_DIR", dir)
	if err := writePiSettingsJSON(dir, map[string]json.RawMessage{"theme": json.RawMessage(`"keep"`)}); err != nil {
		t.Fatal(err)
	}
	before, err := readPiExtensionSettings(dir)
	if err != nil || !before.AppBuilder {
		t.Fatal(before, err)
	}
	s := NewServer(Deps{})
	save := func(id, revision string, choice any, expected int) {
		t.Helper()
		body := map[string]any{"requestId": id, "revision": revision, "lumoUse": true}
		if choice != nil {
			body["appBuilder"] = choice
		}
		raw, _ := json.Marshal(body)
		w := httptest.NewRecorder()
		s.Handler().ServeHTTP(w, httptest.NewRequest("POST", "/api/v1/pi/extensions", bytes.NewReader(raw)))
		if w.Code != expected {
			t.Fatalf("status %d: %s", w.Code, w.Body.String())
		}
	}
	save("builder-off", before.Revision, false, 200)
	after, err := readPiExtensionSettings(dir)
	if err != nil || after.AppBuilder || after.Revision == before.Revision || !after.Calendar || !after.Questions || !after.LumoUse {
		t.Fatal(after, err)
	}
	save("builder-stale", before.Revision, true, 409)
	save("builder-invalid", after.Revision, "false", 400)
	save("older-client", after.Revision, nil, 200)
	retained, _ := readPiExtensionSettings(dir)
	if retained.AppBuilder {
		t.Fatal("older client reset App Builder")
	}
	settings, _, _ := readPiSettingsJSON(dir)
	if string(settings["theme"]) != `"keep"` {
		t.Fatal("unrelated settings changed")
	}
	save("builder-on", retained.Revision, true, 200)
	enabled, _ := readPiExtensionSettings(dir)
	if !enabled.AppBuilder {
		t.Fatal("App Builder was not enabled")
	}
	for _, value := range []string{`null`, `"yes"`, `1`} {
		if err := writePiSettingsJSON(dir, map[string]json.RawMessage{"lumoAppBuilder": json.RawMessage(value)}); err != nil {
			t.Fatal(err)
		}
		if _, err := readPiExtensionSettings(dir); err == nil {
			t.Fatal("invalid stored choice accepted", value)
		}
	}
}

func TestPiAppBuilderToolsRespectAvailabilityAndPermissionMode(t *testing.T) {
	for _, mode := range []string{"ask", "auto", "read-only"} {
		for _, desktop := range []bool{false, true} {
			if tools := piToolsForMode(mode, desktop, false); strings.Contains(tools, "lumo_app_") || strings.Contains(tools, "lumo_plugin_") {
				t.Fatal("disabled app tools exposed", tools)
			}
			tools := piToolsForMode(mode, desktop, true)
			for _, name := range []string{"lumo_app_api", "lumo_app_list", "lumo_app_status", "lumo_plugin_api", "lumo_plugin_list", "lumo_plugin_validate"} {
				if !strings.Contains(tools, name) {
					t.Fatal("missing read tool", tools)
				}
			}
			for _, name := range []string{"lumo_app_create", "lumo_app_build", "lumo_app_install", "lumo_app_restore", "lumo_plugin_create", "lumo_plugin_build", "lumo_plugin_install", "lumo_plugin_restore"} {
				if strings.Contains(tools, name) != (mode != "read-only") {
					t.Fatal("incorrect mutation availability", tools)
				}
			}
			if strings.Contains(tools, "lumo_app_preview") != (desktop && mode != "read-only") {
				t.Fatal("incorrect preview availability", tools)
			}
		}
	}
}

func TestPiAppBuilderExtensionLoadedOnlyWhenEnabled(t *testing.T) {
	for _, enabled := range []bool{false, true} {
		for _, local := range []bool{false, true} {
			t.Run(fmt.Sprintf("enabled-%t-local-%t", enabled, local), func(t *testing.T) {
				home := t.TempDir()
				agent := filepath.Join(home, ".pi", "agent")
				t.Setenv("HOME", home)
				t.Setenv("PI_CODING_AGENT_DIR", agent)
				t.Setenv("LUMO_PI_RPC_FIXTURE", "1")
				t.Setenv("LUMO_PI_RPC_READY", "ask")
				settings := map[string]json.RawMessage{"lumoAppBuilder": json.RawMessage(fmt.Sprint(enabled))}
				if err := writePiSettingsJSON(agent, settings); err != nil {
					t.Fatal(err)
				}
				if local {
					if err := os.MkdirAll(filepath.Join(agent, "extensions"), 0700); err != nil {
						t.Fatal(err)
					}
					if err := os.WriteFile(filepath.Join(agent, "extensions", "notes.mjs"), []byte("export default function() {}"), 0600); err != nil {
						t.Fatal(err)
					}
				}
				binary := filepath.Join(home, "pi")
				quote := func(value string) string { return "'" + strings.ReplaceAll(value, "'", "'\\''") + "'" }
				argsFile := filepath.Join(home, "args")
				script := "#!/bin/sh\nprintf '%s\\n' \"$@\" > " + quote(argsFile) + "\nexec " + quote(os.Args[0]) + " -test.run=^TestPiRPCFixtureProcess$\n"
				if err := os.WriteFile(binary, []byte(script), 0700); err != nil {
					t.Fatal(err)
				}
				s := NewServer(Deps{})
				s.pi.home = home
				s.pi.path = func() string { return binary }
				defer func() {
					for _, p := range s.piRPC.processes {
						p.cancel()
					}
				}()
				w := httptest.NewRecorder()
				s.Handler().ServeHTTP(w, httptest.NewRequest("POST", "/api/v1/pi/start", strings.NewReader(`{"requestId":"start-builder","project":"~","permissionMode":"ask"}`)))
				if w.Code != 200 {
					t.Fatal(w.Code, w.Body.String())
				}
				args, err := os.ReadFile(argsFile)
				if err != nil {
					t.Fatal(err)
				}
				if strings.Contains(string(args), ".lumo-apps-ask.mjs") != enabled {
					t.Fatal("incorrect bundled extension selection", string(args))
				}
				if !enabled && strings.Contains(string(args), "lumo_app_") {
					t.Fatal("disabled tools requested", string(args))
				}
				if strings.Contains(string(args), "notes.mjs") != local {
					t.Fatal("local extension selection changed", string(args))
				}
			})
		}
	}
}
