// SPDX-License-Identifier: AGPL-3.0-only
package broker

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"lumo/server/internal/containers"
	"lumo/server/internal/websites"
)

type fakeContainers struct {
	calls int
	uid   uint32
	err   error
}

func (f *fakeContainers) Act(_ context.Context, id, action, revision string, uid uint32) (containers.Detail, error) {
	f.calls++
	f.uid = uid
	return containers.Detail{Container: containers.Container{ID: id, State: "running"}, Revision: revision}, f.err
}

func (f *fakeContainers) ResourceAction(_ context.Context, request containers.ResourceRequest, uid uint32) (containers.ResourceResult, error) {
	f.calls++
	f.uid = uid
	return containers.ResourceResult{ID: request.ID, Action: request.Action}, f.err
}

type fakeWebsites struct {
	calls int
	err   error
}

func (f *fakeWebsites) Apply(_ context.Context, id string, definition websites.Definition, revision, requestID string) (websites.Result, error) {
	f.calls++
	return websites.Result{Site: websites.Site{ID: id, Definition: &definition}, Reloaded: true}, f.err
}

func serverAppPayload(action, id string) string {
	args := `{"containerId":"` + strings.Repeat("a", 64) + `"}`
	revision := "sha256:" + strings.Repeat("b", 64)
	if action == "docker.resource" {
		args = `{"resource":{"kind":"volume","action":"remove","id":"test-data","revision":"` + revision + `"}}`
	}
	if action == "websites.save" {
		args = `{"siteId":"notes","website":{"domain":"notes.example.com","kind":"proxy","port":3000,"root":"","enabled":true}}`
		revision = "absent"
	}
	return fmt.Sprintf(`{"requestId":%q,"action":%q,"arguments":%s,"expected":{"revision":%q},"sessionToken":"session"}`, id, action, args, revision)
}

func TestServerAppsPolicyAuditAndIdempotency(t *testing.T) {
	for action, expectedPolicy := range map[string]string{"docker.resource": containersManageActionID, "containers.start": containersManageActionID, "containers.stop": containersManageActionID, "containers.restart": containersManageActionID, "websites.save": websitesManageActionID} {
		t.Run(action, func(t *testing.T) {
			var policy string
			s, client, _ := testBroker(t, StaticAuthorizer{Rules: func(_ uint32, id string, _ map[string]string) Result { policy = id; return Allow }}, nil)
			container, website := &fakeContainers{}, &fakeWebsites{}
			s.containers, s.websites = container, website
			for i := 0; i < 2; i++ {
				status, headers, body := callAction(t, client, serverAppPayload(action, "app-action"))
				if status != 200 || body["ok"] != true || (i == 1 && headers.Get("X-Lumo-Idempotent-Replay") != "true") {
					t.Fatalf("status=%d headers=%v body=%v", status, headers, body)
				}
			}
			if policy != expectedPolicy || container.calls+website.calls != 1 {
				t.Fatalf("policy=%s calls=%d", policy, container.calls+website.calls)
			}
			if (containerAction(action) || action == "docker.resource") && container.uid != uint32(os.Getuid()) {
				t.Fatalf("requester UID lost: %d", container.uid)
			}
			var outcome string
			if err := s.audit.db.QueryRow(`SELECT outcome FROM audit WHERE request_id='app-action' AND kind='end'`).Scan(&outcome); err != nil || outcome != "success" {
				t.Fatalf("audit=%s err=%v", outcome, err)
			}
		})
	}
}

func TestServerAppsRequirePermissionAndFreshAuthentication(t *testing.T) {
	for _, action := range []string{"docker.resource", "containers.stop", "websites.save"} {
		for _, policy := range []Result{Deny, Challenge} {
			for _, fresh := range []bool{false, true} {
				t.Run(fmt.Sprintf("%s-%v-%v", action, policy, fresh), func(t *testing.T) {
					s, client, _ := testBroker(t, StaticAuthorizer{Rules: func(uint32, string, map[string]string) Result { return policy }}, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						until := int64(0)
						if fresh {
							until = time.Now().Add(time.Minute).UnixMilli()
						}
						_ = json.NewEncoder(w).Encode(map[string]any{"uid": os.Getuid(), "reauthUntil": until})
					}))
					container, website := &fakeContainers{}, &fakeWebsites{}
					s.containers, s.websites = container, website
					status, _, _ := callAction(t, client, serverAppPayload(action, "permission"))
					allowed := policy == Challenge && fresh
					if allowed && (status != 200 || container.calls+website.calls != 1) || !allowed && (status != 403 || container.calls+website.calls != 0) {
						t.Fatalf("allowed=%v status=%d calls=%d", allowed, status, container.calls+website.calls)
					}
				})
			}
		}
	}
}

func TestServerAppsConflictValidationAndUnavailableAudit(t *testing.T) {
	s, client, _ := testBroker(t, StaticAuthorizer{Rules: func(uint32, string, map[string]string) Result { return Allow }}, nil)
	container, website := &fakeContainers{}, &fakeWebsites{}
	s.containers, s.websites = container, website
	for _, payload := range []string{
		strings.Replace(serverAppPayload("containers.stop", "invalid"), strings.Repeat("a", 64), "../containers/create", 1),
		strings.Replace(serverAppPayload("containers.stop", "invalid"), "containers.stop", "containers.exec", 1),
		strings.Replace(serverAppPayload("websites.save", "invalid"), "notes.example.com", "notes.example.com;include /etc/passwd", 1),
		strings.Replace(serverAppPayload("websites.save", "invalid"), `"siteId":"notes"`, `"siteId":"../../etc/passwd"`, 1),
		`{"requestId":"invalid","action":"apps.plan","arguments":{"appId":"nginx;id"}}`,
	} {
		if status, _, _ := callAction(t, client, payload); status != 400 {
			t.Fatalf("invalid payload accepted: %d", status)
		}
	}
	if container.calls+website.calls != 0 {
		t.Fatal("invalid input reached controller")
	}
	container.err, website.err = containers.ErrStale, websites.ErrStale
	for _, action := range []string{"docker.resource", "containers.stop", "websites.save"} {
		status, _, body := callAction(t, client, serverAppPayload(action, action))
		if status != 409 || body["error"].(map[string]any)["code"] != "stale_revision" {
			t.Fatalf("conflict: %d %v", status, body)
		}
	}
	_ = s.audit.db.Close()
	for _, action := range []string{"docker.resource", "containers.stop", "websites.save"} {
		if status, _, _ := callAction(t, client, serverAppPayload(action, "no-audit-"+action)); status != 503 {
			t.Fatalf("audit failure status=%d", status)
		}
	}
	if container.calls+website.calls != 3 {
		t.Fatal("mutation executed without audit")
	}
}
