// SPDX-License-Identifier: AGPL-3.0-only
package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"lumo/server/internal/broker"
	"lumo/server/internal/piruntime"
	"lumo/server/internal/updates"
)

type piFixture struct {
	mu            sync.Mutex
	path, version string
	calls         [][]string
	failure       bool
}

func piTestWorker(t *testing.T, version string) (*piWorker, *piFixture) {
	t.Helper()
	home := t.TempDir()
	bin := piruntime.Bin(home)
	if err := os.MkdirAll(bin, 0700); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"node", "npm"} {
		if err := os.WriteFile(filepath.Join(bin, name), []byte("#!/bin/sh\nexit 0\n"), 0700); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	fixture := &piFixture{version: version}
	if version != "" {
		fixture.path = filepath.Join(home, ".local/share/lumo/pi/bin/pi")
	}
	worker := &piWorker{home: home, plans: map[string]piPlan{}, saved: piSaved{Jobs: map[string]updates.Progress{}, History: []broker.AppUpdateHistoryEntry{}}, latest: func(context.Context) (string, error) { return "1.2.1", nil }}
	worker.path = func() string { fixture.mu.Lock(); defer fixture.mu.Unlock(); return fixture.path }
	worker.run = func(_ context.Context, name string, args ...string) (string, error) {
		fixture.mu.Lock()
		defer fixture.mu.Unlock()
		fixture.calls = append(fixture.calls, append([]string{name}, args...))
		if filepath.Base(name) == "node" {
			return "v" + piruntime.Version, nil
		}
		if len(args) > 0 && args[0] == "--version" {
			return fixture.version, nil
		}
		if fixture.failure {
			return "Download failed", errors.New("network unavailable")
		}
		if filepath.Base(name) == "npm" {
			fixture.path = filepath.Join(home, ".local/share/lumo/pi/bin/pi")
			fixture.version = "1.2.1"
		}
		return "", nil
	}
	return worker, fixture
}
func waitPi(t *testing.T, worker *piWorker, id string) updates.Progress {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		worker.mu.Lock()
		progress := worker.saved.Jobs[id]
		worker.mu.Unlock()
		if progress.Done {
			return progress
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("Pi operation did not finish")
	return updates.Progress{}
}
func TestPiInstallAndReplay(t *testing.T) {
	worker, fixture := piTestWorker(t, "")
	plan, err := worker.plan(context.Background(), "install")
	if err != nil {
		t.Fatal(err)
	}
	if plan.AppID != "pi" || len(plan.Packages) != 1 || plan.Packages[0].ToVersion != "1.2.1" {
		t.Fatalf("plan: %+v", plan)
	}
	if err := worker.start("pi_install", plan.ID); err != nil {
		t.Fatal(err)
	}
	if err := worker.start("pi_install", plan.ID); err != nil {
		t.Fatal(err)
	}
	if progress := waitPi(t, worker, "pi_install"); !progress.Success {
		t.Fatalf("progress: %+v", progress)
	}
	if err := worker.start("pi_other", plan.ID); err == nil {
		t.Fatal("reapplied consumed plan")
	}
	fixture.mu.Lock()
	defer fixture.mu.Unlock()
	if len(fixture.calls) != 3 || filepath.Base(fixture.calls[0][0]) != "node" || filepath.Base(fixture.calls[1][0]) != "npm" || fixture.calls[2][1] != "--version" {
		t.Fatalf("commands: %v", fixture.calls)
	}
	call := strings.Join(fixture.calls[1], " ")
	if !strings.Contains(call, "--ignore-scripts") || !strings.Contains(call, "@earendil-works/pi-coding-agent@1.2.1") || !strings.Contains(call, filepath.Join(worker.home, ".local/share/lumo/pi")) {
		t.Fatalf("unexpected npm invocation: %s", call)
	}

}
func TestPiUpdateRecordsActualVersionAndFailure(t *testing.T) {
	for _, failure := range []bool{false, true} {
		t.Run(map[bool]string{false: "success", true: "failure"}[failure], func(t *testing.T) {
			worker, fixture := piTestWorker(t, "1.2.0")
			fixture.failure = failure
			plan, err := worker.plan(context.Background(), "update")
			if err != nil {
				t.Fatal(err)
			}
			if err := worker.start("pi_update", plan.ID); err != nil {
				t.Fatal(err)
			}
			progress := waitPi(t, worker, "pi_update")
			if progress.Success == failure {
				t.Fatalf("progress: %+v", progress)
			}
			var saved piSaved
			data, err := os.ReadFile(worker.statePath())
			if err != nil {
				t.Fatal(err)
			}
			if err := json.Unmarshal(data, &saved); err != nil {
				t.Fatal(err)
			}
			if len(saved.History) != 1 || saved.History[0].Packages[0].FromVersion != "1.2.0" || saved.History[0].Packages[0].ToVersion != "1.2.1" || saved.History[0].Success == failure {
				t.Fatalf("history: %+v", saved.History)
			}
			fixture.mu.Lock()
			defer fixture.mu.Unlock()
			found := false
			for _, call := range fixture.calls {
				if len(call) > 2 && filepath.Base(call[0]) == "npm" && call[len(call)-1] == "@earendil-works/pi-coding-agent@1.2.1" {
					found = true
				}
			}
			if !found {
				t.Fatal("documented upgrade command not executed")
			}
		})
	}
}
func TestPiRejectsChangedOrExpiredInstallation(t *testing.T) {
	worker, fixture := piTestWorker(t, "1.2.0")
	plan, err := worker.plan(context.Background(), "update")
	if err != nil {
		t.Fatal(err)
	}
	fixture.version = "1.3.0"
	if err := worker.start("pi_changed", plan.ID); err != nil {
		t.Fatal(err)
	}
	if progress := waitPi(t, worker, "pi_changed"); progress.Success || !strings.Contains(progress.Error, "changed") {
		t.Fatalf("progress: %+v", progress)
	}
	fixture.mu.Lock()
	for _, call := range fixture.calls {
		if len(call) > 1 && filepath.Base(call[0]) == "npm" {
			t.Fatal("changed binary was upgraded")
		}
	}
	fixture.mu.Unlock()
	worker.mu.Lock()
	expired := worker.plans[plan.ID]
	expired.ExpiresAt = time.Now().Add(-time.Second)
	worker.plans[plan.ID] = expired
	worker.mu.Unlock()
	if err := worker.start("pi_expired", plan.ID); err == nil {
		t.Fatal("expired plan accepted")
	}
}
func TestPiRoutesRejectArbitraryCommandsAndReturnProgress(t *testing.T) {
	worker, _ := piTestWorker(t, "")
	server := NewServer(Deps{})
	server.pi = worker
	handler := server.Handler()
	for _, body := range []string{`{"requestId":"bad","operation":"install","command":"id"}`, `{"requestId":"bad","operation":"remove"}`, `{"requestId":"bad","operation":"install","url":"https://other.example"}`} {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest("POST", "/api/v1/apps/pi/plan", strings.NewReader(body)))
		if response.Code != http.StatusBadRequest {
			t.Fatalf("invalid request accepted: %s %d", body, response.Code)
		}
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest("GET", "/api/v1/apps/pi/progress?requestId=unknown", nil))
	if response.Code != http.StatusNotFound {
		t.Fatalf("progress: %d", response.Code)
	}
}
func TestPiCommandUsesAccountHomeAndStopsChildren(t *testing.T) {
	worker, _ := piTestWorker(t, "")
	output, err := worker.command(context.Background(), "/bin/sh", "-c", `printf '%s' "$HOME"`)
	if err != nil || output != worker.home {
		t.Fatalf("account environment: %q %v", output, err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	start := time.Now()
	_, err = worker.command(ctx, "/bin/sh", "-c", "sleep 20 & wait")
	if err == nil || time.Since(start) > 3*time.Second {
		t.Fatalf("command did not stop promptly: %v", err)
	}
}

func TestPiDoesNotDowngradeOrReinstall(t *testing.T) {
	for _, version := range []string{"1.2.1", "2.0.0", "1.3.0-beta.1"} {
		worker, _ := piTestWorker(t, version)
		plan, err := worker.plan(context.Background(), "update")
		if err != nil || len(plan.Packages) != 0 {
			t.Fatalf("unnecessary update for %s: %+v %v", version, plan, err)
		}
		if _, err := worker.plan(context.Background(), "install"); err == nil {
			t.Fatal("install accepted for existing CLI")
		}
	}
}

func TestPiOperationKeepsAgentActiveAndExcludesAnotherMutation(t *testing.T) {
	worker, _ := piTestWorker(t, "")
	entered, release := make(chan struct{}), make(chan struct{})
	run := worker.run
	worker.run = func(ctx context.Context, name string, args ...string) (string, error) {
		if filepath.Base(name) == "npm" {
			close(entered)
			<-release
		}
		return run(ctx, name, args...)
	}
	server := NewServer(Deps{})
	server.pi = worker
	plan, err := worker.plan(context.Background(), "install")
	if err != nil {
		t.Fatal(err)
	}
	if err := worker.start("pi_active", plan.ID); err != nil {
		t.Fatal(err)
	}
	select {
	case <-entered:
	case <-time.After(3 * time.Second):
		t.Fatal("Pi installation did not reach npm")
	}
	if server.ActiveOperations() != 1 {
		t.Error("running operation not counted")
	}
	if _, err := worker.plan(context.Background(), "install"); err == nil {
		t.Error("concurrent operation permitted")
	}
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, httptest.NewRequest("POST", "/api/v1/apps/pi/uninstall", strings.NewReader(`{"requestId":"remove-during-install"}`)))
	if response.Code != http.StatusConflict {
		t.Errorf("removal not blocked: %d", response.Code)
	}
	close(release)
	if !waitPi(t, worker, "pi_active").Success || server.ActiveOperations() != 0 {
		t.Fatal("operation did not settle")
	}
	var saved piSaved
	data, err := os.ReadFile(worker.statePath())
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(data, &saved); err != nil {
		t.Fatal(err)
	}
	restored, _ := piTestWorker(t, "1.2.1")
	restored.saved = saved
	if err := restored.start("pi_active", plan.ID); err != nil {
		t.Fatal("saved completed request was not replayed", err)
	}
}

func TestPiInstallDoesNotRequireSystemNodeOrNPM(t *testing.T) {
	worker, fixture := piTestWorker(t, "")
	t.Setenv("PATH", t.TempDir())
	plan, err := worker.plan(context.Background(), "install")
	if err != nil {
		t.Fatal(err)
	}
	if err := worker.start("pi_private_runtime", plan.ID); err != nil {
		t.Fatal(err)
	}
	if progress := waitPi(t, worker, "pi_private_runtime"); !progress.Success {
		t.Fatalf("progress: %+v", progress)
	}
	fixture.mu.Lock()
	defer fixture.mu.Unlock()
	if fixture.calls[1][0] != filepath.Join(piruntime.Bin(worker.home), "npm") {
		t.Fatal("did not use private npm")
	}
	output, err := worker.command(context.Background(), "/bin/sh", "-c", `printf '%s' "$PATH"`)
	if err != nil || !strings.HasPrefix(output, piruntime.Bin(worker.home)+":") {
		t.Fatalf("private PATH: %s %v", output, err)
	}
}

func TestPiCatalogInstallationIgnoresMissingNPM(t *testing.T) {
	t.Setenv("PATH", t.TempDir())
	server := NewServer(Deps{})
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, httptest.NewRequest("GET", "/api/v1/apps", nil))
	var payload struct {
		Data struct {
			Apps []struct {
				ID         string `json:"id"`
				CanInstall bool   `json:"canInstall"`
			} `json:"apps"`
		} `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	for _, app := range payload.Data.Apps {
		if app.ID == "pi" {
			if app.CanInstall != piruntime.Supported() {
				t.Fatalf("catalog: %s", response.Body.String())
			}
			return
		}
	}
	t.Fatal("Pi missing from catalog")
}
