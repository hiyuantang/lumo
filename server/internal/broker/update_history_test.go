// SPDX-License-Identifier: AGPL-3.0-only
package broker

import (
	"context"
	"lumo/server/internal/updates"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestAppUpdateHistoryPersistsAndIsolatesAccounts(t *testing.T) {
	path := filepath.Join(t.TempDir(), "audit.db")
	audit, err := OpenAudit(path)
	if err != nil {
		t.Fatal(err)
	}
	record := func(uid uint32, id, operation, outcome string, completed bool) {
		plan := updates.Plan{ID: id, AppID: "docker", Operation: operation, Packages: []updates.Package{{Name: "docker.io", FromVersion: "27.5.1", ToVersion: "27.5.2"}}}
		audit.End(1, ActionRequest{RequestID: "plan-" + id, Action: "apps.plan"}, uid, "user", "allow", "success", "", map[string]any{"plan": plan}, time.Second)
		if completed {
			progress := updates.Progress{RequestID: "apply-" + id, PlanID: id, Done: true, Success: outcome == "success"}
			audit.End(2, ActionRequest{RequestID: progress.RequestID, Action: "packages.applyPlan"}, uid, "user", "allow", outcome, "", map[string]any{"planId": id, "progress": progress}, time.Second)
		}
	}
	record(1000, "one", "update", "success", true)
	record(2000, "other", "update", "success", true)
	record(1000, "planned", "update", "success", false)
	record(1000, "remove", "uninstall", "success", true)
	record(1000, "failed", "update", "failed", true)
	audit.End(3, ActionRequest{RequestID: "rejected", Action: "packages.applyPlan"}, 1000, "user", "allow", "failed", "stale plan", nil, time.Second)
	if err := audit.db.Close(); err != nil {
		t.Fatal(err)
	}
	audit, err = OpenAudit(path)
	if err != nil {
		t.Fatal(err)
	}
	defer audit.db.Close()
	entries, err := audit.AppUpdateHistory(1000)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 2 || entries[0].RequestID != "apply-failed" || entries[0].Success || !entries[1].Success {
		t.Fatalf("history=%+v", entries)
	}
	if entries[1].AppID != "docker" || entries[1].Packages[0].FromVersion != "27.5.1" || entries[1].Packages[0].ToVersion != "27.5.2" {
		t.Fatalf("entry=%+v", entries[1])
	}
	empty, err := audit.AppUpdateHistory(3000)
	if err != nil || empty == nil || len(empty) != 0 {
		t.Fatalf("empty=%v err=%v", empty, err)
	}
}

func TestAppUpdateHistoryUsesPeerAccount(t *testing.T) {
	s, _, _ := testBroker(t, StaticAuthorizer{}, nil)
	uid := uint32(os.Getuid())
	plan := updates.Plan{ID: "history-plan", AppID: "nginx", Operation: "update", Packages: []updates.Package{{Name: "nginx", FromVersion: "1.24.0", ToVersion: "1.24.1"}}}
	for _, owner := range []uint32{uid, uid + 1} {
		s.audit.End(1, ActionRequest{RequestID: "plan", Action: "apps.plan"}, owner, "user", "allow", "success", "", map[string]any{"plan": plan}, time.Second)
		s.audit.End(2, ActionRequest{RequestID: "apply", Action: "packages.applyPlan"}, owner, "user", "allow", "success", "", map[string]any{"planId": plan.ID, "progress": updates.Progress{Done: true, Success: true}}, time.Second)
	}
	entries, err := AppUpdateHistory(context.Background(), s.cfg.SocketPath)
	if err != nil || len(entries) != 1 || entries[0].AppID != "nginx" {
		t.Fatalf("entries=%v err=%v", entries, err)
	}
}
