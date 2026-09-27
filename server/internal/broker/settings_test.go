// SPDX-License-Identifier: AGPL-3.0-only
package broker

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"lumo/server/internal/hostsettings"
)

type fakeSettings struct {
	calls int
	err   error
}

func (f *fakeSettings) Apply(_ context.Context, change hostsettings.Change, _ string) (hostsettings.Snapshot, error) {
	f.calls++
	return hostsettings.Snapshot{Values: hostsettings.Values{Timezone: *change.Timezone}, Revision: "sha256:" + strings.Repeat("1", 64)}, f.err
}

func settingsPayload(id string) string {
	return `{"requestId":"` + id + `","action":"system.settings","arguments":{"change":{"timezone":"America/New_York"}},"expected":{"revision":"sha256:` + strings.Repeat("0", 64) + `"},"sessionToken":"session"}`
}

func TestSettingsPolicyAuditAndReplay(t *testing.T) {
	var policy string
	s, client, _ := testBroker(t, StaticAuthorizer{Rules: func(_ uint32, action string, _ map[string]string) Result { policy = action; return Allow }}, nil)
	fake := &fakeSettings{}
	s.settings = fake
	for i := 0; i < 2; i++ {
		status, headers, body := callAction(t, client, settingsPayload("settings-save"))
		if status != 200 || body["ok"] != true {
			t.Fatalf("status=%d body=%v", status, body)
		}
		if i == 1 && headers.Get("X-Lumo-Idempotent-Replay") != "true" {
			t.Fatal("missing replay marker")
		}
	}
	if policy != systemSettingsActionID || fake.calls != 1 {
		t.Fatalf("policy=%s calls=%d", policy, fake.calls)
	}
	var outcome string
	_ = s.audit.db.QueryRow(`SELECT outcome FROM audit WHERE request_id = 'settings-save' AND kind = 'end'`).Scan(&outcome)
	if outcome != "success" {
		t.Fatalf("audit=%s", outcome)
	}
}

func TestSettingsAuthorizationAndFreshSession(t *testing.T) {
	for _, result := range []Result{Deny, Challenge} {
		s, client, _ := testBroker(t, StaticAuthorizer{Rules: func(uint32, string, map[string]string) Result { return result }}, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			_ = json.NewEncoder(w).Encode(map[string]any{"uid": os.Getuid(), "reauthUntil": 0})
		}))
		fake := &fakeSettings{}
		s.settings = fake
		status, _, _ := callAction(t, client, settingsPayload("settings-denied"))
		if status != 403 || fake.calls != 0 {
			t.Fatalf("status=%d calls=%d", status, fake.calls)
		}
	}
	s, client, _ := testBroker(t, StaticAuthorizer{Rules: func(uint32, string, map[string]string) Result { return Challenge }}, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"uid": os.Getuid(), "reauthUntil": time.Now().Add(time.Minute).UnixMilli()})
	}))
	s.settings = &fakeSettings{}
	status, _, _ := callAction(t, client, settingsPayload("settings-fresh"))
	if status != 200 {
		t.Fatalf("fresh session status=%d", status)
	}
}

func TestSettingsValidationAndConflicts(t *testing.T) {
	s, client, _ := testBroker(t, StaticAuthorizer{Rules: func(uint32, string, map[string]string) Result { return Allow }}, nil)
	fake := &fakeSettings{}
	s.settings = fake
	for _, payload := range []string{
		strings.Replace(settingsPayload("invalid"), `"timezone":"America/New_York"`, `"hostname":"new-host"`, 1),
		strings.Replace(settingsPayload("invalid"), `"timezone":"America/New_York"`, `"timezone":"../etc/passwd"`, 1),
		strings.Replace(settingsPayload("invalid"), `"timezone":"America/New_York"`, `"timezone":"Etc/UTC","ntp":true`, 1),
		strings.Replace(settingsPayload("invalid"), `"timezone":"America/New_York"`, `"command":"id"`, 1),
		strings.Replace(settingsPayload("invalid"), `"timezone":"America/New_York"`, `"ntp":"false"`, 1),
		strings.Replace(settingsPayload("invalid"), "sha256:", "invalid:", 1),
	} {
		status, _, _ := callAction(t, client, payload)
		if status != 400 {
			t.Fatalf("invalid status=%d", status)
		}
	}
	if fake.calls != 0 {
		t.Fatal("invalid settings reached controller")
	}
	fake.err = hostsettings.ErrStale
	status, _, body := callAction(t, client, settingsPayload("settings-stale"))
	if status != 409 || body["error"].(map[string]any)["code"] != "stale_revision" {
		t.Fatalf("stale status=%d body=%v", status, body)
	}
	fake.err = errors.New("write failed")
	status, _, _ = callAction(t, client, settingsPayload("settings-error"))
	if status != 500 {
		t.Fatal("write failure reported success")
	}
}

func TestSettingsRefuseMutationWithoutAudit(t *testing.T) {
	s, client, _ := testBroker(t, StaticAuthorizer{Rules: func(uint32, string, map[string]string) Result { return Allow }}, nil)
	fake := &fakeSettings{}
	s.settings = fake
	_ = s.audit.db.Close()
	status, _, _ := callAction(t, client, settingsPayload("settings-no-audit"))
	if status != 503 || fake.calls != 0 {
		t.Fatalf("status=%d calls=%d", status, fake.calls)
	}
}
