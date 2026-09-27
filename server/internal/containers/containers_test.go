// SPDX-License-Identifier: AGPL-3.0-only
package containers

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestContainerReadsAndRevisionGuard(t *testing.T) {
	id := strings.Repeat("a", 64)
	state := "running"
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/version":
			_ = json.NewEncoder(w).Encode(map[string]any{"Version": "27.5.1", "ApiVersion": "1.47", "MinAPIVersion": "1.24"})
		case "/v1.45/containers/json":
			if r.URL.Query().Get("all") != "true" {
				t.Error("stopped containers omitted")
			}
			_ = json.NewEncoder(w).Encode([]any{map[string]any{"Id": id, "Names": []string{"/notes"}, "Image": "nginx:stable", "State": state, "Labels": map[string]string{"com.docker.compose.project": "notes"}}})
		case "/v1.45/containers/" + id + "/json":
			_ = json.NewEncoder(w).Encode(map[string]any{"Id": id, "Name": "/notes", "State": map[string]any{"Status": state, "StartedAt": "2026-09-25T00:00:00Z"}, "Config": map[string]any{"Image": "nginx:stable", "Env": []string{"SECRET=hidden"}, "Labels": map[string]string{"com.docker.compose.project": "notes"}}, "NetworkSettings": map[string]any{"Ports": map[string]any{"80/tcp": []any{map[string]string{"HostIp": "127.0.0.1", "HostPort": "8088"}}}}, "Mounts": []any{map[string]any{"Type": "bind", "Source": "/srv/notes", "Destination": "/data", "RW": false}}})
		case "/v1.45/containers/" + id + "/stop":
			if r.Method != "POST" || r.URL.Query().Get("t") != "10" {
				t.Errorf("request=%v", r)
			}
			calls++
			state = "exited"
			w.WriteHeader(204)
		default:
			t.Errorf("unexpected path %s", r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	defer server.Close()
	c := &Client{http: server.Client(), base: server.URL}
	snapshot, err := c.Snapshot(context.Background())
	if err != nil || len(snapshot.Containers) != 1 || snapshot.Containers[0].Name != "notes" {
		t.Fatalf("%+v %v", snapshot, err)
	}
	detail, err := c.Inspect(context.Background(), id)
	if err != nil || len(detail.Ports) != 1 || detail.Ports[0].Host != "8088" || len(detail.Mounts) != 1 {
		t.Fatalf("%+v %v", detail, err)
	}
	encoded, _ := json.Marshal(detail)
	if strings.Contains(string(encoded), "SECRET") {
		t.Fatal("environment variables leaked")
	}
	_, err = c.Act(context.Background(), id, "stop", "sha256:"+strings.Repeat("0", 64), 1000)
	if !errors.Is(err, ErrStale) || calls != 0 {
		t.Fatalf("stale request executed: %v %d", err, calls)
	}
	after, err := c.Act(context.Background(), id, "stop", detail.Revision, 1000)
	if err != nil || calls != 1 || after.State != "exited" || after.Revision == detail.Revision {
		t.Fatalf("%+v %v", after, err)
	}
	for _, bad := range []string{"../version", "notes", strings.Repeat("a", 63), id + "?x=1"} {
		if _, err = c.Inspect(context.Background(), bad); !errors.Is(err, ErrValidation) {
			t.Fatal("invalid id accepted")
		}
	}
}

func TestLogFramingAndLimits(t *testing.T) {
	frame := func(kind byte, text string) []byte {
		body := make([]byte, 8)
		body[0] = kind
		binary.BigEndian.PutUint32(body[4:], uint32(len(text)))
		return append(body, []byte(text)...)
	}
	logs, err := decodeLogs(append(frame(1, "first\n"), frame(2, "second\n")...), false)
	if err != nil || logs.Text != "first\nsecond\n" {
		t.Fatalf("%+v %v", logs, err)
	}
	logs, err = decodeLogs([]byte("plain tty\n"), true)
	if err != nil || logs.Text != "plain tty\n" {
		t.Fatal("TTY output lost")
	}
	for _, body := range [][]byte{{1}, {3, 0, 0, 0, 0, 0, 0, 0}, {1, 0, 0, 0, 255, 255, 255, 255}} {
		if _, err := decodeLogs(body, false); err == nil {
			t.Fatal("malformed frame accepted")
		}
	}
	logs, err = decodeLogs([]byte(strings.Repeat("x", maxLogs+100)), true)
	if err != nil || !logs.Truncated || len(logs.Text) != maxLogs {
		t.Fatal("log bound failed")
	}
}

func TestEngineErrorsAndNoRemoteFallback(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(403) }))
	defer server.Close()
	c := &Client{http: server.Client(), base: server.URL}
	snapshot, err := c.Snapshot(context.Background())
	if err != nil || snapshot.Status != "permission-denied" {
		t.Fatalf("%+v %v", snapshot, err)
	}
	if socketAccess("/no/docker/socket", 1000) {
		t.Fatal("absent socket granted access")
	}
	if NewClient().socket != Socket {
		t.Fatal("engine endpoint changed")
	}
}
