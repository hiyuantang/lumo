// SPDX-License-Identifier: AGPL-3.0-only
package updates

import (
	"context"
	"strings"
	"testing"
	"time"
)

type installRunner struct {
	fakeRunner
	calls   []string
	streams []string
}

func (f *installRunner) Output(ctx context.Context, name string, args ...string) ([]byte, error) {
	f.calls = append(f.calls, commandKey(name, args...))
	return f.fakeRunner.Output(ctx, name, args...)
}

func (f *installRunner) Stream(_ context.Context, name string, args []string, onLine func(string)) error {
	f.streams = append(f.streams, commandKey(name, args...))
	onLine("Setting up nginx (1.24.0)")
	return nil
}

func installWorker(runner *installRunner) *Worker {
	return &Worker{runner: runner, aptGet: "apt-get", aptCache: "apt-cache", dpkg: "dpkg-query", plans: map[string]Plan{}, progress: map[string]Progress{}}
}

func TestAppPlansUseFixedPackagesAndIncludeDependencies(t *testing.T) {
	for app, targets := range map[string]string{"docker": "docker.io docker-compose-v2", "nginx": "nginx"} {
		t.Run(app, func(t *testing.T) {
			command := "apt-get -s -V --no-remove -o Dpkg::Use-Pty=0 install -- " + targets
			runner := &installRunner{fakeRunner: fakeRunner{outputs: map[string]string{
				command: "Inst nginx (1.24.0 Ubuntu:24.04/noble [arm64])\nInst dependency (2.0 Ubuntu:24.04/noble [arm64])\n",
			}}}
			plan, err := installWorker(runner).CalculateInstallPlan(context.Background(), app)
			if err != nil || plan.AppID != app || len(plan.Packages) != 2 || plan.Packages[1].Name != "dependency" {
				t.Fatalf("plan=%+v err=%v", plan, err)
			}
			if runner.calls[0] != command || len(runner.streams) != 0 {
				t.Fatalf("planning executed an unexpected operation: %v %v", runner.calls, runner.streams)
			}
		})
	}
	runner := &installRunner{}
	worker := installWorker(runner)
	for _, app := range []string{"", "nginx; id", "--allow-unauthenticated", "postgresql"} {
		if _, err := worker.CalculateInstallPlan(context.Background(), app); err == nil {
			t.Fatalf("unsupported app accepted: %q", app)
		}
	}
	if len(runner.calls) != 0 || len(runner.streams) != 0 {
		t.Fatal("unsupported app reached package manager")
	}
}

func TestAppInstallRechecksReviewedVersionsBeforeApplying(t *testing.T) {
	for _, changed := range []bool{false, true} {
		t.Run(map[bool]string{false: "matching", true: "changed"}[changed], func(t *testing.T) {
			output := "Inst nginx (1.24.0 Ubuntu:24.04/noble [arm64])\n"
			if changed {
				output += "Inst unreviewed (1.0 Ubuntu:24.04/noble [arm64])\n"
			}
			runner := &installRunner{fakeRunner: fakeRunner{outputs: map[string]string{
				"apt-get -s -V --no-remove -o Dpkg::Use-Pty=0 install -- nginx=1.24.0": output,
			}}}
			worker := installWorker(runner)
			plan := Plan{ID: "pln_000000000000000000000000", AppID: "nginx", ExpiresAt: time.Now().Add(time.Minute), Packages: []Package{{Name: "nginx", ToVersion: "1.24.0"}}}
			worker.plans[plan.ID] = plan
			done := make(chan Progress, 1)
			if _, _, err := worker.StartApply(plan.ID, plan.ID, "install", func(p Progress) { done <- p }); err != nil {
				t.Fatal(err)
			}
			select {
			case progress := <-done:
				if !progress.Done || progress.Success == changed {
					t.Fatalf("progress=%+v", progress)
				}
				if changed && (!strings.Contains(progress.Error, "plan changed") || len(runner.streams) != 0) {
					t.Fatalf("unreviewed packages installed: %v %+v", runner.streams, progress)
				}
				if !changed && (len(runner.streams) != 1 || runner.streams[0] != "apt-get -y --no-remove -o Dpkg::Use-Pty=0 install -- nginx=1.24.0") {
					t.Fatalf("install=%v", runner.streams)
				}
			case <-time.After(time.Second):
				t.Fatal("installation did not complete")
			}
			_, replay, err := worker.StartApply(plan.ID, plan.ID, "install", func(Progress) { t.Error("replay started another installation") })
			if err != nil || !replay {
				t.Fatalf("replay=%v err=%v", replay, err)
			}
		})
	}
}

func TestAppRemovalReviewsDependenciesAndRechecksBeforeApply(t *testing.T) {
	for _, changed := range []bool{false, true} {
		t.Run(map[bool]string{false: "matching", true: "changed"}[changed], func(t *testing.T) {
			output := "Remv nginx [1.24.0]\nRemv dependent-app [2.0]\n"
			runner := &installRunner{fakeRunner: fakeRunner{outputs: map[string]string{
				"apt-get -s -V -o Dpkg::Use-Pty=0 remove -- nginx":               output,
				"apt-get -s -V -o Dpkg::Use-Pty=0 remove -- nginx dependent-app": output,
			}}}
			worker := installWorker(runner)
			plan, err := worker.CalculateRemovalPlan(context.Background(), "nginx")
			if err != nil || plan.Operation != "uninstall" || len(plan.Packages) != 2 || plan.Packages[1].FromVersion != "2.0" {
				t.Fatalf("plan=%+v err=%v", plan, err)
			}
			if changed {
				runner.outputs["apt-get -s -V -o Dpkg::Use-Pty=0 remove -- nginx dependent-app"] += "Remv unexpected [3.0]\n"
			}
			done := make(chan Progress, 1)
			if _, _, err := worker.StartApply(plan.ID, plan.ID, "remove", func(p Progress) { done <- p }); err != nil {
				t.Fatal(err)
			}
			select {
			case progress := <-done:
				if !progress.Done || progress.Success == changed {
					t.Fatalf("progress=%+v", progress)
				}
				if changed && len(runner.streams) != 0 {
					t.Fatal("changed plan was applied")
				}
				if !changed && (len(runner.streams) != 1 || runner.streams[0] != "apt-get -y -o Dpkg::Use-Pty=0 remove -- nginx dependent-app") {
					t.Fatalf("removal=%v", runner.streams)
				}
			case <-time.After(time.Second):
				t.Fatal("removal did not complete")
			}
		})
	}
}
