// SPDX-License-Identifier: AGPL-3.0-only
package containers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestResourcesSizesReferencesAndGuardedActions(t *testing.T) {
	imageID := "sha256:" + strings.Repeat("b", 64)
	containerID := strings.Repeat("a", 64)
	networkID := strings.Repeat("c", 64)
	used := false
	deleted := []string{}
	created := map[string]any{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "DELETE" {
			deleted = append(deleted, r.URL.RequestURI())
			w.WriteHeader(204)
			return
		}
		switch r.URL.Path {
		case "/version":
			json.NewEncoder(w).Encode(map[string]any{"Version": "27.5.1", "ApiVersion": "1.45"})
		case "/v1.45/system/df":
			users := []any{}
			ref := 0
			if used {
				ref = 1
				users = append(users, map[string]any{"Id": containerID, "Names": []string{"/database"}, "ImageID": imageID, "SizeRw": 32, "SizeRootFs": 232, "Mounts": []any{map[string]any{"Type": "volume", "Name": "data"}}})
			}
			json.NewEncoder(w).Encode(map[string]any{"LayersSize": 200, "Images": []any{map[string]any{"Id": imageID, "RepoTags": []string{"db:latest"}, "Size": 200, "SharedSize": 50}}, "Containers": users, "Volumes": []any{map[string]any{"Name": "data", "Driver": "local", "Scope": "local", "CreatedAt": "2026-09-01", "UsageData": map[string]any{"Size": 2048, "RefCount": ref}, "Options": map[string]string{"password": "do-not-expose"}}, map[string]any{"Name": "remote", "Driver": "nfs", "Scope": "global", "UsageData": map[string]any{"Size": -1, "RefCount": -1}}}, "BuildCache": []any{map[string]any{"Size": 128}}})
		case "/v1.45/networks":
			json.NewEncoder(w).Encode([]any{map[string]string{"Id": networkID, "Name": "custom"}})
		case "/v1.45/networks/" + networkID:
			members := map[string]any{}
			if used {
				members[containerID] = map[string]string{"Name": "database"}
			}
			json.NewEncoder(w).Encode(map[string]any{"Id": networkID, "Name": "custom", "Scope": "local", "Driver": "bridge", "Containers": members, "IPAM": map[string]any{"Config": []any{map[string]string{"Subnet": "172.20.0.0/16"}}}})
		case "/v1.45/volumes/create", "/v1.45/networks/create":
			if r.Method != "POST" {
				t.Fatal("wrong creation method")
			}
			json.NewDecoder(r.Body).Decode(&created)
			w.WriteHeader(201)
		default:
			t.Errorf("unexpected request %s", r.URL)
			w.WriteHeader(404)
		}
	}))
	defer server.Close()
	client := &Client{http: server.Client(), base: server.URL}
	resources, err := client.Resources(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if *resources.ImageBytes != 200 || *resources.BuildCacheBytes != 128 || *resources.Volumes[0].Size != 2048 || resources.Volumes[1].Size != nil || resources.Volumes[1].Removable {
		t.Fatalf("incorrect storage: %+v", resources)
	}
	encoded, _ := json.Marshal(resources)
	if strings.Contains(string(encoded), "do-not-expose") {
		t.Fatal("driver secret leaked")
	}
	if len(resources.Networks) != 1 || resources.Networks[0].Subnets[0] != "172.20.0.0/16" {
		t.Fatal("network inspection missing")
	}
	stale := ResourceRequest{"volume", "remove", "data", resources.Volumes[0].Revision}
	used = true
	if _, err := client.ResourceAction(context.Background(), stale, 1000); !errors.Is(err, ErrStale) {
		t.Fatalf("stale removal: %v", err)
	}
	current, err := client.Resources(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if current.Volumes[0].Removable || current.Networks[0].Removable || current.Images[0].Containers[0] != "database" || *current.Containers[0].WritableSize != 32 {
		t.Fatal("references or sizes lost")
	}
	for _, request := range []ResourceRequest{{"volume", "remove", "data", current.Volumes[0].Revision}, {"image", "remove", imageID, current.Images[0].Revision}, {"network", "remove", networkID, current.Networks[0].Revision}} {
		if _, err := client.ResourceAction(context.Background(), request, 1000); err == nil {
			t.Fatal("used resource removed")
		}
	}
	if len(deleted) > 0 {
		t.Fatal("unsafe delete reached engine")
	}
	used = false
	if _, err := client.ResourceAction(context.Background(), stale, 1000); err != nil {
		t.Fatal(err)
	}
	if len(deleted) != 1 || deleted[0] != "/v1.45/volumes/data?force=false" {
		t.Fatalf("delete=%v", deleted)
	}
	for kind, driver := range map[string]string{"volume": "local", "network": "bridge"} {
		if _, err := client.ResourceAction(context.Background(), ResourceRequest{kind, "create", "new-resource", "absent"}, 1000); err != nil {
			t.Fatal(err)
		}
		if created["Driver"] != driver || created["Name"] != "new-resource" || created["Options"] != nil {
			t.Fatalf("unexpected create %+v", created)
		}
	}
}

func TestDockerResourceValidation(t *testing.T) {
	for _, request := range []ResourceRequest{{"volume", "remove", "../data", "sha256:" + strings.Repeat("a", 64)}, {"image", "create", "alpine", "absent"}, {"network", "create", "--host", "absent"}, {"container", "remove", strings.Repeat("a", 64), "absent"}, {"volume", "prune", "all", "absent"}} {
		if ValidateResource(request) == nil {
			t.Fatalf("invalid resource accepted: %+v", request)
		}
	}
}

func TestCleanUninstallChecksActualDockerStorageAndLiveRestore(t *testing.T) {
	for _, raw := range []string{
		`{"DockerRootDir":"/var/lib/docker","DriverStatus":[["Backing Filesystem","extfs"]]}`,
		`{"DockerRootDir":"/srv/docker"}`,
		`{"DockerRootDir":"/var/lib/docker","DriverStatus":[["driver-type","io.containerd.snapshotter.v1"]]}`,
		`{"DockerRootDir":"/var/lib/docker","LiveRestoreEnabled":true,"ContainersRunning":1}`,
	} {
		t.Run(raw, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/info" {
					t.Error(r.URL.Path)
				}
				_, _ = w.Write([]byte(raw))
			}))
			defer server.Close()
			client := &Client{base: server.URL, http: server.Client()}
			err := client.CheckCleanUninstall(context.Background())
			allowed := strings.Contains(raw, "extfs")
			if (err == nil) != allowed {
				t.Fatalf("allowed=%v err=%v", allowed, err)
			}
		})
	}
}
