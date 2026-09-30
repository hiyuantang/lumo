// SPDX-License-Identifier: AGPL-3.0-only
package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func piImageSettingsRequest(t *testing.T, s *Server, id string, value piImageSettings) *httptest.ResponseRecorder {
	t.Helper()
	body, _ := json.Marshal(map[string]any{"requestId": id, "mode": value.Mode, "revision": value.Revision})
	response := httptest.NewRecorder()
	s.Handler().ServeHTTP(response, httptest.NewRequest("POST", "/api/v1/pi/image-settings", bytes.NewReader(body)))
	return response
}

func piImageCodecFixture(t *testing.T) {
	t.Helper()
	bin := t.TempDir()
	for _, name := range []string{"node", "npm"} {
		if err := os.WriteFile(filepath.Join(bin, name), nil, 0700); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("PATH", bin)
}

func TestPiImageSettingsSaveReplayAndPreservation(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("PI_CODING_AGENT_DIR", dir)
	piImageCodecFixture(t)
	s := NewServer(Deps{})
	s.pi.home = t.TempDir()
	checks := 0
	s.pi.run = func(_ context.Context, name string, args ...string) (string, error) {
		if filepath.Base(name) != "node" || len(args) != 4 || args[2] != filepath.Join(s.pi.home, ".local/share/lumo/pi/lib/package.json") || args[3] != piImageCodecVersion {
			t.Fatalf("unexpected codec command: %s %v", name, args)
		}
		checks++
		return "", nil
	}
	initial, err := readPiImageSettings(dir)
	if err != nil || initial.Mode != "original" || initial.Revision == "" {
		t.Fatalf("defaults: %+v %v", initial, err)
	}
	path := filepath.Join(dir, "settings.json")
	if err := os.WriteFile(path, []byte(`{"defaultModel":"existing","theme":"custom","compaction":{"enabled":false}}`), 0600); err != nil {
		t.Fatal(err)
	}
	before, _ := readPiImageSettings(dir)
	changed := before
	changed.Mode = "quality90"
	for i := 0; i < 2; i++ {
		if response := piImageSettingsRequest(t, s, "quality90", changed); response.Code != 200 {
			t.Fatal(response.Body.String())
		}
	}
	if checks != 1 {
		t.Fatalf("replay repeated preparation: %d", checks)
	}
	if response := piImageSettingsRequest(t, s, "stale", changed); response.Code != 409 {
		t.Fatalf("stale revision accepted: %d", response.Code)
	}
	settings, _, _ := readPiSettingsJSON(dir)
	compaction, _ := piSettingsObject(settings, "compaction")
	if string(settings["defaultModel"]) != `"existing"` || string(settings["theme"]) != `"custom"` || string(compaction["enabled"]) != "false" || string(settings["lumoImageQuality"]) != `"quality90"` {
		t.Fatal("unrelated settings changed")
	}
	updated, _ := readPiImageSettings(dir)
	updated.Mode = "original"
	if response := piImageSettingsRequest(t, s, "original", updated); response.Code != 200 {
		t.Fatal(response.Body.String())
	}
	if checks != 1 {
		t.Fatal("Original prepared a codec")
	}
	response := httptest.NewRecorder()
	s.Handler().ServeHTTP(response, httptest.NewRequest("GET", "/api/v1/pi/image-settings", nil))
	if response.Code != 200 || !strings.Contains(response.Body.String(), `"mode":"original"`) {
		t.Fatal(response.Body.String())
	}
	info, _ := os.Stat(path)
	if info.Mode().Perm() != 0600 {
		t.Fatal("settings permissions")
	}
}

func TestPiImageSettingsCodecPreparationAndFailure(t *testing.T) {
	for _, fail := range []bool{false, true} {
		t.Run(map[bool]string{false: "prepare", true: "failure"}[fail], func(t *testing.T) {
			dir := t.TempDir()
			t.Setenv("PI_CODING_AGENT_DIR", dir)
			piImageCodecFixture(t)
			s := NewServer(Deps{})
			s.pi.home = t.TempDir()
			checks, installs := 0, 0
			s.pi.run = func(_ context.Context, name string, args ...string) (string, error) {
				if filepath.Base(name) == "node" {
					checks++
					if checks == 1 {
						return "", errors.New("missing codec")
					}
					return "", nil
				}
				installs++
				if strings.Join(args, " ") != "install --global --ignore-scripts --no-audit --no-fund --prefix "+filepath.Join(s.pi.home, ".local/share/lumo/pi")+" sharp@"+piImageCodecVersion {
					t.Fatalf("unexpected installation: %v", args)
				}
				if fail {
					return "", errors.New("offline")
				}
				return "", nil
			}
			before, _ := readPiImageSettings(dir)
			request := before
			request.Mode = "quality90"
			response := piImageSettingsRequest(t, s, "codec", request)
			after, _ := readPiImageSettings(dir)
			if fail {
				if response.Code != 400 || after != before {
					t.Fatalf("failed preparation changed settings: %+v %s", after, response.Body.String())
				}
			} else if response.Code != 200 || after.Mode != "quality90" || checks != 2 {
				t.Fatal(response.Body.String())
			}
			if installs != 1 {
				t.Fatalf("installs: %d", installs)
			}
		})
	}
}

func TestPiImageSettingsPreservesUnrelatedChangeDuringPreparation(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("PI_CODING_AGENT_DIR", dir)
	piImageCodecFixture(t)
	s := NewServer(Deps{})
	s.pi.run = func(context.Context, string, ...string) (string, error) {
		return "", os.WriteFile(filepath.Join(dir, "settings.json"), []byte(`{"defaultModel":"changed-over-ssh"}`), 0600)
	}
	before, _ := readPiImageSettings(dir)
	before.Mode = "quality90"
	if response := piImageSettingsRequest(t, s, "external", before); response.Code != 200 {
		t.Fatal(response.Body.String())
	}
	settings, _, _ := readPiSettingsJSON(dir)
	if string(settings["defaultModel"]) != `"changed-over-ssh"` || string(settings["lumoImageQuality"]) != `"quality90"` {
		t.Fatal("unrelated change or image setting lost")
	}
}

func TestPiImageSettingsRejectsInvalidOrLinkedSettings(t *testing.T) {
	for _, content := range []string{`{`, `null`, `{"lumoImageQuality":null}`, `{"lumoImageQuality":90}`, `{"lumoImageQuality":"quality95"}`} {
		dir := t.TempDir()
		if err := os.WriteFile(filepath.Join(dir, "settings.json"), []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := readPiImageSettings(dir); err == nil {
			t.Fatalf("accepted invalid settings: %s", content)
		}
	}
	dir := t.TempDir()
	target := filepath.Join(t.TempDir(), "target")
	os.WriteFile(target, []byte(`{"lumoImageQuality":"quality90"}`), 0600)
	os.Symlink(target, filepath.Join(dir, "settings.json"))
	if _, err := readPiImageSettings(dir); err == nil {
		t.Fatal("followed linked settings")
	}
	t.Setenv("PI_CODING_AGENT_DIR", t.TempDir())
	s := NewServer(Deps{})
	for _, body := range []string{`{"requestId":"invalid","mode":"quality95"}`, `{"requestId":"invalid","mode":null}`, `{"mode":"original"}`, `{"requestId":"invalid","mode":"original","extra":true}`} {
		response := httptest.NewRecorder()
		s.Handler().ServeHTTP(response, httptest.NewRequest("POST", "/api/v1/pi/image-settings", strings.NewReader(body)))
		if response.Code != 400 {
			t.Fatalf("accepted invalid request: %s", response.Body.String())
		}
	}
}

func TestPiModelImagesExtensionUsesPrivateAccountPaths(t *testing.T) {
	dir := t.TempDir()
	agentDir := filepath.Join(t.TempDir(), "settings with 'quotes'")
	home := filepath.Join(t.TempDir(), "account")
	path, err := writePiModelImagesExtension(dir, agentDir, home)
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil || !strings.Contains(string(data), filepath.Join(agentDir, "settings.json")) || !strings.Contains(string(data), filepath.Join(home, ".local/share/lumo/pi/lib/package.json")) || strings.Contains(string(data), "const settingsPath = '';") {
		t.Fatalf("extension paths: %v", err)
	}
	info, _ := os.Stat(path)
	if info.Mode().Perm() != 0600 {
		t.Fatal("extension permissions")
	}
}

func TestPiManagedStartRequiresImageHandshake(t *testing.T) {
	t.Setenv("LUMO_PI_RPC_FIXTURE", "1")
	t.Setenv("LUMO_PI_RPC_READY", "ask")
	t.Setenv("LUMO_PI_RPC_IMAGES_MISSING", "1")
	home := t.TempDir()
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	if process, err := startManagedPiProcess(ctx, os.Args[0], []string{"-test.run=^TestPiRPCFixtureProcess$"}, home, home, "ask"); err == nil || process != nil {
		t.Fatal("started without image controls")
	}
	t.Setenv("LUMO_PI_RPC_IMAGES_MISSING", "")
	ctx, cancel = context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	process, err := startManagedPiProcess(ctx, os.Args[0], []string{"-test.run=^TestPiRPCFixtureProcess$"}, home, home, "ask")
	if err != nil {
		t.Fatal(err)
	}
	defer process.cancel()
}
