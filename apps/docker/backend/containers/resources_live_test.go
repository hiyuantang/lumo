// SPDX-License-Identifier: AGPL-3.0-only
package containers

import (
	"context"
	"net"
	"net/http"
	"os"
	"testing"
	"time"
)

func TestLiveDockerResourceInventory(t *testing.T) {
	socket := os.Getenv("LUMO_TEST_DOCKER_SOCKET")
	if socket == "" {
		t.Skip("set LUMO_TEST_DOCKER_SOCKET for read-only Engine verification")
	}
	transport := &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "unix", socket)
	}}
	defer transport.CloseIdleConnections()
	client := &Client{base: "http://docker", http: &http.Client{Transport: transport, Timeout: 40 * time.Second}}
	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Second)
	defer cancel()
	resources, err := client.Resources(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range resources.Images {
		if !revisionPattern.MatchString(item.Revision) {
			t.Fatal("invalid image revision")
		}
	}
	for _, item := range resources.Volumes {
		if item.Size != nil && *item.Size < 0 {
			t.Fatal("negative volume size escaped normalization")
		}
	}
	for _, item := range resources.Networks {
		if (item.Name == "bridge" || item.Name == "host" || item.Name == "none" || len(item.Containers) > 0) && item.Removable {
			t.Fatal("protected network marked removable")
		}
	}
	t.Logf("Read-only Engine inventory verified: %d images, %d volumes, %d networks, %d containers", len(resources.Images), len(resources.Volumes), len(resources.Networks), len(resources.Containers))
}
