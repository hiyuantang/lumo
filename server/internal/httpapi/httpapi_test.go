// SPDX-License-Identifier: AGPL-3.0-only
package httpapi

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"syscall"
	"testing"

	"lumo/server/internal/journal"
	"lumo/server/internal/network"
	"lumo/server/internal/services"
	"lumo/server/internal/static"
	"lumo/server/internal/system"
)

type fakeServices struct {
	available bool
	units     []services.Unit
}

func (f fakeServices) Available() bool { return f.available }
func (f fakeServices) List(context.Context) ([]services.Unit, error) {
	if !f.available {
		return nil, services.ErrUnavailable
	}
	return f.units, nil
}
func (f fakeServices) Detail(_ context.Context, name string) (services.Detail, error) {
	if !f.available {
		return services.Detail{}, services.ErrUnavailable
	}
	return services.Detail{
		Name:         name,
		Dependencies: []services.Dependency{{Name: "network.target", Relation: "requires"}},
		Files:        []services.UnitFile{{Path: "/usr/lib/systemd/system/cron.service", Content: "[Service]\nExecStart=/usr/sbin/cron\n"}},
	}, nil
}
func (f fakeServices) SubscribeChanges(context.Context) (<-chan services.Unit, error) {
	return nil, services.ErrUnavailable
}

type fakeJournal struct {
	available bool
}

type fakeNetworkSnapshotter struct {
	available bool
	snapshot  network.Snapshot
}

func (f fakeNetworkSnapshotter) Available() bool { return f.available }
func (f fakeNetworkSnapshotter) Snapshot(context.Context) (network.Snapshot, error) {
	if !f.available {
		return network.Snapshot{}, errors.New("unavailable")
	}
	return f.snapshot, nil
}

func (f fakeJournal) Available() bool { return f.available }
func (f fakeJournal) Query(_ context.Context, q journal.Query) (journal.Result, error) {
	if err := q.Validate(); err != nil {
		return journal.Result{}, err
	}
	return journal.Result{
		Entries: []journal.Entry{{
			Cursor:   "s=abc;i=1",
			TS:       "2026-07-19T00:10:02.113Z",
			Priority: "info",
			Unit:     "cron.service",
			Message:  "hello",
		}},
		NextCursor: "s=abc;i=1",
	}, nil
}
func (f fakeJournal) Follow(context.Context, journal.Query, func(journal.Entry) bool) error {
	return nil
}

func testServer(svc services.API, jb journal.Backend) *httptest.Server {
	s := NewServer(Deps{
		Version:  "test",
		Sampler:  system.NewSampler(),
		Services: svc,
		Journal:  jb,
		Static:   static.Handler(),
	})
	return httptest.NewServer(s.Handler())
}

type testEnvelope struct {
	OK    bool            `json:"ok"`
	Data  json.RawMessage `json:"data"`
	Error *Error          `json:"error"`
}

func get(t *testing.T, url string) (int, testEnvelope) {
	t.Helper()
	res, err := http.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var env testEnvelope
	if err := json.NewDecoder(res.Body).Decode(&env); err != nil {
		t.Fatalf("decode %s: %v", url, err)
	}
	return res.StatusCode, env
}

func TestMetaVersion(t *testing.T) {
	ts := testServer(fakeServices{}, fakeJournal{})
	defer ts.Close()
	status, env := get(t, ts.URL+"/api/v1/meta/version")
	if status != 200 || !env.OK {
		t.Fatalf("status=%d env=%+v", status, env)
	}
	if !strings.Contains(string(env.Data), `"protocolVersions":[1]`) {
		t.Errorf("data = %s", env.Data)
	}
	if !strings.Contains(string(env.Data), `"version":"test"`) {
		t.Errorf("data = %s", env.Data)
	}
}

func TestIdentity(t *testing.T) {
	ts := testServer(fakeServices{}, fakeJournal{})
	defer ts.Close()
	status, env := get(t, ts.URL+"/api/v1/system/identity")
	if status != 200 || !env.OK {
		t.Fatalf("status=%d", status)
	}
	if !strings.Contains(string(env.Data), `"serverTime"`) || !strings.Contains(string(env.Data), `"architecture"`) {
		t.Errorf("data = %s", env.Data)
	}
}

func TestServicesUnavailable(t *testing.T) {
	ts := testServer(fakeServices{available: false}, fakeJournal{})
	defer ts.Close()
	status, env := get(t, ts.URL+"/api/v1/services")
	if status != 503 {
		t.Fatalf("status=%d", status)
	}
	if env.OK || env.Error == nil || env.Error.Code != CodeUnavailable {
		t.Errorf("env = %+v", env)
	}
}

func TestServicesList(t *testing.T) {
	svc := fakeServices{available: true, units: []services.Unit{{
		Name: "cron.service", ActiveState: "active", SubState: "running",
	}}}
	ts := testServer(svc, fakeJournal{})
	defer ts.Close()
	status, env := get(t, ts.URL+"/api/v1/services")
	if status != 200 || !env.OK {
		t.Fatalf("status=%d", status)
	}
	if !strings.Contains(string(env.Data), `"name":"cron.service"`) {
		t.Errorf("data = %s", env.Data)
	}
}

func TestServiceDetail(t *testing.T) {
	ts := testServer(fakeServices{available: true}, fakeJournal{})
	defer ts.Close()
	status, env := get(t, ts.URL+"/api/v1/services/detail?name=cron.service")
	if status != 200 || !env.OK {
		t.Fatalf("status=%d", status)
	}
	data := string(env.Data)
	if !strings.Contains(data, `"name":"cron.service"`) || !strings.Contains(data, `"relation":"requires"`) || !strings.Contains(data, `ExecStart=/usr/sbin/cron`) {
		t.Errorf("data = %s", data)
	}
	status, env = get(t, ts.URL+"/api/v1/services/detail?name=../../etc/passwd")
	if status != 400 || env.Error == nil || env.Error.Code != CodeValidationFailed {
		t.Errorf("status=%d env=%+v", status, env)
	}
}

func TestJournalQuery(t *testing.T) {
	ts := testServer(fakeServices{}, fakeJournal{available: true})
	defer ts.Close()
	status, env := get(t, ts.URL+"/api/v1/journal?unit=cron.service&limit=5")
	if status != 200 || !env.OK {
		t.Fatalf("status=%d", status)
	}
	if !strings.Contains(string(env.Data), `"nextCursor":"s=abc;i=1"`) {
		t.Errorf("data = %s", env.Data)
	}
}

func TestJournalValidation(t *testing.T) {
	ts := testServer(fakeServices{}, fakeJournal{available: true})
	defer ts.Close()
	status, env := get(t, ts.URL+"/api/v1/journal?priority=bogus")
	if status != 400 || env.Error == nil || env.Error.Code != CodeValidationFailed {
		t.Errorf("status=%d env=%+v", status, env)
	}
	status, env = get(t, ts.URL+"/api/v1/journal?limit=abc")
	if status != 400 || env.Error == nil || env.Error.Code != CodeValidationFailed {
		t.Errorf("status=%d env=%+v", status, env)
	}
	status, env = get(t, ts.URL+"/api/v1/journal?boot=old")
	if status != 400 || env.Error == nil || env.Error.Code != CodeValidationFailed {
		t.Errorf("status=%d env=%+v", status, env)
	}
}

func TestUnavailableEndpoints(t *testing.T) {
	ts := testServer(fakeServices{}, fakeJournal{})
	defer ts.Close()
	for _, tc := range []struct {
		method string
		path   string
	}{
		{"POST", "/api/v1/services/action"},
		{"POST", "/api/v1/updates/refresh"},
		{"POST", "/api/v1/updates/plan"},
		{"POST", "/api/v1/updates/apply"},
		{"POST", "/api/v1/system/power"},
		{"GET", "/api/v1/network"},
		{"POST", "/api/v1/network/apply"},
		{"POST", "/api/v1/network/confirm"},
	} {
		req, _ := http.NewRequest(tc.method, ts.URL+tc.path, nil)
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		var env testEnvelope
		_ = json.NewDecoder(res.Body).Decode(&env)
		res.Body.Close()
		if res.StatusCode != 503 || env.Error == nil || env.Error.Code != CodeUnavailable {
			t.Errorf("%s %s: status=%d env=%+v", tc.method, tc.path, res.StatusCode, env)
		}
	}
}

func TestSystemPowerValidation(t *testing.T) {
	s := NewServer(Deps{
		Version:      "test",
		Sampler:      system.NewSampler(),
		Services:     fakeServices{},
		Journal:      fakeJournal{},
		BrokerSocket: "/missing/broker.sock",
	})
	ts := httptest.NewServer(s.Handler())
	defer ts.Close()

	for _, body := range []string{
		`{"requestId":"power-1","action":"restart; shutdown"}`,
		`{"requestId":"","action":"reboot"}`,
	} {
		res, err := http.Post(ts.URL+"/api/v1/system/power", "application/json", strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		var env testEnvelope
		_ = json.NewDecoder(res.Body).Decode(&env)
		res.Body.Close()
		if res.StatusCode != http.StatusBadRequest || env.Error == nil || env.Error.Code != CodeValidationFailed {
			t.Errorf("body=%s status=%d env=%+v", body, res.StatusCode, env)
		}
	}
}

func TestNetworkSnapshot(t *testing.T) {
	s := NewServer(Deps{
		Version:  "test",
		Sampler:  system.NewSampler(),
		Services: fakeServices{},
		Journal:  fakeJournal{},
		Network: fakeNetworkSnapshotter{available: true, snapshot: network.Snapshot{
			Revision: "sha256:" + strings.Repeat("0", 64),
			Interfaces: []network.Interface{{
				Name:      "eth0",
				Addresses: []string{"192.0.2.10/24"},
				Up:        true,
			}},
		}},
	})
	ts := httptest.NewServer(s.Handler())
	defer ts.Close()
	status, env := get(t, ts.URL+"/api/v1/network")
	if status != http.StatusOK || !strings.Contains(string(env.Data), `"name":"eth0"`) {
		t.Fatalf("status=%d data=%s", status, env.Data)
	}
}

func TestNetworkMutationValidation(t *testing.T) {
	s := NewServer(Deps{
		Version:      "test",
		Sampler:      system.NewSampler(),
		Services:     fakeServices{},
		Journal:      fakeJournal{},
		BrokerSocket: "/missing/broker.sock",
	})
	ts := httptest.NewServer(s.Handler())
	defer ts.Close()

	applyBodies := []string{
		`{"requestId":"network-1","expectedRevision":"bad","config":{"version":2,"ethernets":{"eth0":{"dhcp4":true}}}}`,
		`{"requestId":"network-2","expectedRevision":"sha256:` + strings.Repeat("0", 64) + `","config":{"version":2,"ethernets":{"eth0.dhcp4=false":{"dhcp4":true}}}}`,
		`{"requestId":"network-3","expectedRevision":"sha256:` + strings.Repeat("0", 64) + `","confirmTimeoutSec":10,"config":{"version":2,"ethernets":{"eth0":{"dhcp4":true}}}}`,
	}
	for _, body := range applyBodies {
		res, err := http.Post(ts.URL+"/api/v1/network/apply", "application/json", strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		var env testEnvelope
		_ = json.NewDecoder(res.Body).Decode(&env)
		res.Body.Close()
		if res.StatusCode != http.StatusBadRequest || env.Error == nil || env.Error.Code != CodeValidationFailed {
			t.Errorf("body=%s status=%d env=%+v", body, res.StatusCode, env)
		}
	}
	res, err := http.Post(ts.URL+"/api/v1/network/confirm", "application/json", strings.NewReader(`{"requestId":"network-4","token":"bad"}`))
	if err != nil {
		t.Fatal(err)
	}
	var env testEnvelope
	_ = json.NewDecoder(res.Body).Decode(&env)
	res.Body.Close()
	if res.StatusCode != http.StatusBadRequest || env.Error == nil || env.Error.Code != CodeValidationFailed {
		t.Errorf("confirm status=%d env=%+v", res.StatusCode, env)
	}
}

func TestUnknownRoute(t *testing.T) {
	ts := testServer(fakeServices{}, fakeJournal{})
	defer ts.Close()
	status, env := get(t, ts.URL+"/api/v1/nope")
	if status != 404 || env.Error == nil || env.Error.Code != CodeNotFound {
		t.Errorf("status=%d env=%+v", status, env)
	}
}

func TestFilesEndpoints(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(dir+"/note.txt", []byte("hi"), 0644); err != nil {
		t.Fatal(err)
	}
	ts := testServer(fakeServices{}, fakeJournal{})
	defer ts.Close()
	status, env := get(t, ts.URL+"/api/v1/files/list?path="+dir)
	if status != 200 || !strings.Contains(string(env.Data), `"name":"note.txt"`) {
		t.Errorf("list: status=%d data=%s", status, env.Data)
	}
	status, env = get(t, ts.URL+"/api/v1/files/read?path="+dir+"/note.txt")
	if status != 200 || !strings.Contains(string(env.Data), `"revision":"sha256:`) {
		t.Errorf("read: status=%d data=%s", status, env.Data)
	}
	if err := os.WriteFile(dir+"/image.webp", []byte{0, 1, 2, 255}, 0600); err != nil {
		t.Fatal(err)
	}
	status, env = get(t, ts.URL+"/api/v1/files/read?preview=image&path="+dir+"/image.webp")
	if status != 200 || !strings.Contains(string(env.Data), `"content":"AAEC/w=="`) {
		t.Errorf("image: status=%d data=%s", status, env.Data)
	}
	status, env = get(t, ts.URL+"/api/v1/files/read?path=/missing/nope")
	if status != 404 || env.Error == nil || env.Error.Code != CodeNotFound {
		t.Errorf("missing: status=%d env=%+v", status, env)
	}
	if p, ok := env.Error.Details["path"].(string); !ok || p == "" {
		t.Errorf("details.path missing: %v", env.Error.Details)
	}
}

func TestFilesWriteHandler(t *testing.T) {
	dir := t.TempDir()
	path := dir + "/w.txt"
	ts := testServer(fakeServices{}, fakeJournal{})
	defer ts.Close()

	put := func(body string) (int, map[string]string, testEnvelope) {
		req, _ := http.NewRequest("PUT", ts.URL+"/api/v1/files/write", strings.NewReader(body))
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		var env testEnvelope
		_ = json.NewDecoder(res.Body).Decode(&env)
		headers := map[string]string{}
		for k := range res.Header {
			headers[k] = res.Header.Get(k)
		}
		return res.StatusCode, headers, env
	}

	status, _, env := put(`{"path":"` + path + `","content":"` + base64.StdEncoding.EncodeToString([]byte("v1")) + `","requestId":"req-1"}`)
	if status != 200 || !env.OK {
		t.Fatalf("write v1: status=%d env=%+v", status, env)
	}
	rev1 := jsonField(string(env.Data), "revision")
	if rev1 == "" {
		t.Fatalf("no revision in %s", env.Data)
	}

	status, headers, env2 := put(`{"path":"` + path + `","content":"` + base64.StdEncoding.EncodeToString([]byte("v1")) + `","requestId":"req-1"}`)
	if status != 200 || headers["X-Lumo-Idempotent-Replay"] != "true" {
		t.Errorf("replay: status=%d headers=%v", status, headers)
	}
	if string(env2.Data) != string(env.Data) {
		t.Errorf("replay body differs: %s vs %s", env2.Data, env.Data)
	}

	status, _, env = put(`{"path":"` + path + `","content":"` + base64.StdEncoding.EncodeToString([]byte("v2")) + `","expectedRevision":` + jsonString(rev1) + `,"requestId":"req-2"}`)
	if status != 200 || !env.OK {
		t.Fatalf("write v2: status=%d env=%+v", status, env)
	}

	status, _, env = put(`{"path":"` + path + `","content":"` + base64.StdEncoding.EncodeToString([]byte("v3")) + `","expectedRevision":` + jsonString(rev1) + `,"requestId":"req-3"}`)
	if status != 409 || env.Error == nil || env.Error.Code != CodeStaleRevision {
		t.Fatalf("stale: status=%d env=%+v", status, env)
	}
	if env.Error.Details["expectedRevision"] != rev1 {
		t.Errorf("details = %v", env.Error.Details)
	}
	data, _ := os.ReadFile(path)
	if string(data) != "v2" {
		t.Errorf("file = %q, want v2", data)
	}

	status, _, env = put(`{"path":"` + path + `","content":"!!!not-base64!!!","requestId":"req-4"}`)
	if status != 400 || env.Error == nil || env.Error.Code != CodeValidationFailed {
		t.Errorf("bad base64: status=%d env=%+v", status, env)
	}
	status, _, env = put(`{"path":"` + path + `","content":""}`)
	if status != 400 || env.Error == nil || env.Error.Code != CodeValidationFailed {
		t.Errorf("missing requestId: status=%d env=%+v", status, env)
	}
}

func TestMutationBodiesRejectUnknownFieldsAndTrailingJSON(t *testing.T) {
	ts := testServer(fakeServices{}, fakeJournal{})
	defer ts.Close()
	path := t.TempDir() + "/strict.txt"
	content := base64.StdEncoding.EncodeToString([]byte("value"))
	for _, body := range []string{
		`{"path":"` + path + `","content":"` + content + `","requestId":"strict-1","unexpected":true}`,
		`{"path":"` + path + `","content":"` + content + `","requestId":"strict-2"} {}`,
	} {
		req, _ := http.NewRequest("PUT", ts.URL+"/api/v1/files/write", strings.NewReader(body))
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		var env testEnvelope
		_ = json.NewDecoder(res.Body).Decode(&env)
		res.Body.Close()
		if res.StatusCode != http.StatusBadRequest || env.Error == nil || env.Error.Code != CodeValidationFailed {
			t.Fatalf("body=%s status=%d env=%+v", body, res.StatusCode, env)
		}
	}
	if _, err := os.Stat(path); !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("malformed request wrote the file: %v", err)
	}
}

func jsonField(data, field string) string {
	var m map[string]any
	if err := json.Unmarshal([]byte(data), &m); err != nil {
		return ""
	}
	s, _ := m[field].(string)
	return s
}

func jsonString(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}

func TestFilesDeleteHandler(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("XDG_DATA_HOME", "")
	path := home + "/doomed.txt"
	if err := os.WriteFile(path, []byte("bye"), 0o644); err != nil {
		t.Fatal(err)
	}
	ts := testServer(fakeServices{}, fakeJournal{})
	defer ts.Close()

	post := func(body string) (int, testEnvelope) {
		req, _ := http.NewRequest("POST", ts.URL+"/api/v1/files/delete", strings.NewReader(body))
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		var env testEnvelope
		_ = json.NewDecoder(res.Body).Decode(&env)
		return res.StatusCode, env
	}

	status, env := post(`{"path":"` + path + `"}`)
	if status != 400 || env.Error == nil || env.Error.Code != CodeValidationFailed {
		t.Errorf("missing requestId: status=%d env=%+v", status, env)
	}
	status, env = post(`{"path":"` + path + `","requestId":"del-1"}`)
	if status != 200 || !strings.Contains(string(env.Data), `"trashed":true`) {
		t.Fatalf("delete: status=%d env=%+v", status, env)
	}
	if _, err := os.Lstat(home + "/.local/share/Trash/files/doomed.txt"); err != nil {
		t.Errorf("trash copy missing: %v", err)
	}
}

func TestMapError(t *testing.T) {
	cases := []struct {
		err  error
		code string
	}{
		{&os.PathError{Op: "open", Path: "/x", Err: fs.ErrPermission}, CodeForbidden},
		{&os.PathError{Op: "open", Path: "/x", Err: fs.ErrNotExist}, CodeNotFound},
		{&os.LinkError{Op: "rename", Old: "/x", New: "/y", Err: syscall.EBUSY}, CodeForbidden},
		{services.ErrUnavailable, CodeUnavailable},
		{journal.ErrUnavailable, CodeUnavailable},
		{journal.ErrValidation, CodeValidationFailed},
		{errors.New("boom"), CodeInternal},
		{NewError(CodeBusy, "locked"), CodeBusy},
	}
	for _, tc := range cases {
		if got := MapError(tc.err); got.Code != tc.code {
			t.Errorf("MapError(%v) = %s, want %s", tc.err, got.Code, tc.code)
		}
	}
}

func TestFilesCreateHandler(t *testing.T) {
	dir := t.TempDir()
	ts := testServer(fakeServices{}, fakeJournal{})
	defer ts.Close()
	post := func(body string) (int, testEnvelope) {
		res, err := http.Post(ts.URL+"/api/v1/files/create", "application/json", strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		var env testEnvelope
		_ = json.NewDecoder(res.Body).Decode(&env)
		return res.StatusCode, env
	}
	body := `{"path":` + jsonString(dir+"/new") + `,"kind":"directory","requestId":"create-one"}`
	for i := 0; i < 2; i++ {
		status, env := post(body)
		if status != 200 || !env.OK {
			t.Fatalf("create/replay: %d %+v", status, env)
		}
	}
	status, env := post(strings.Replace(body, "create-one", "create-two", 1))
	if status != 409 || env.Error.Code != CodeConflict {
		t.Fatalf("duplicate: %d %+v", status, env)
	}
	status, _ = post(`{"path":` + jsonString(dir+"/other") + `,"kind":"file"}`)
	if status != 400 {
		t.Fatalf("request ID required: %d", status)
	}
}

func TestNetworkReadOnlySnapshotDoesNotRequireConfigurationService(t *testing.T) {
	server := NewServer(Deps{Network: network.NewReader()})
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, httptest.NewRequest("GET", "/api/v1/network", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	if strings.Contains(response.Body.String(), `"revision"`) || !strings.Contains(response.Body.String(), `"interfaces"`) {
		t.Fatalf("unexpected read-only snapshot: %s", response.Body.String())
	}
}

func TestFilesMoveHandler(t *testing.T) {
	dir := t.TempDir()
	from, to := dir+"/source", dir+"/target"
	if err := os.WriteFile(from, []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	ts := testServer(fakeServices{}, fakeJournal{})
	defer ts.Close()
	post := func(body string) int {
		res, err := http.Post(ts.URL+"/api/v1/files/move", "application/json", strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		return res.StatusCode
	}
	body := `{"from":` + jsonString(from) + `,"to":` + jsonString(to) + `,"requestId":"move-one"}`
	for i := 0; i < 2; i++ {
		if status := post(body); status != 200 {
			t.Fatalf("move/replay: %d", status)
		}
	}
	if status := post(`{"from":` + jsonString(to) + `,"to":` + jsonString(from) + `}`); status != 400 {
		t.Fatalf("request ID: %d", status)
	}
	if err := os.WriteFile(from, []byte("other"), 0600); err != nil {
		t.Fatal(err)
	}
	if status := post(strings.Replace(body, "move-one", "move-two", 1)); status != 409 {
		t.Fatalf("collision: %d", status)
	}
}

func TestFileLocations(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	if err := os.Mkdir(home+"/Documents", 0700); err != nil {
		t.Fatal(err)
	}
	ts := testServer(fakeServices{}, fakeJournal{})
	defer ts.Close()
	status, env := get(t, ts.URL+"/api/v1/files/locations")
	if status != 200 || !env.OK {
		t.Fatalf("status=%d, error=%v", status, env.Error)
	}
	var data struct {
		Locations []struct{ ID, Name, Path string }
	}
	if err := json.Unmarshal(env.Data, &data); err != nil {
		t.Fatal(err)
	}
	if len(data.Locations) != 1 || data.Locations[0].ID != "documents" || data.Locations[0].Path != home+"/Documents" {
		t.Fatalf("data = %s", env.Data)
	}
}

func TestFolderLocationSettingsApply(t *testing.T) {
	home, destination := t.TempDir(), t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("XDG_CONFIG_HOME", home+"/.config")
	if err := os.Mkdir(home+"/Documents", 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(home+"/Documents/notes.txt", []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	ts := testServer(fakeServices{}, fakeJournal{})
	defer ts.Close()
	status, env := get(t, ts.URL+"/api/v1/files/locations/settings")
	if status != 200 || !env.OK {
		t.Fatalf("settings: %d %s", status, env.Data)
	}
	var snapshot struct{ Revision string }
	if err := json.Unmarshal(env.Data, &snapshot); err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(map[string]string{"path": destination, "expectedRevision": snapshot.Revision, "requestId": "folder-move-test"})
	for i := 0; i < 2; i++ {
		response, err := http.Post(ts.URL+"/api/v1/files/locations/settings", "application/json", strings.NewReader(string(body)))
		if err != nil {
			t.Fatal(err)
		}
		var result testEnvelope
		err = json.NewDecoder(response.Body).Decode(&result)
		response.Body.Close()
		if err != nil || response.StatusCode != 200 || !result.OK {
			t.Fatalf("apply: %d %v %v", response.StatusCode, result.Error, err)
		}
	}
	if data, err := os.ReadFile(destination + "/Documents/notes.txt"); err != nil || string(data) != "keep" {
		t.Fatalf("moved file: %s %v", data, err)
	}
	if _, err := os.Stat(home + "/Documents/notes.txt"); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("source not moved")
	}
}

func TestIndividualFolderSettingsMoveAndRemove(t *testing.T) {
	home, destination := t.TempDir(), t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("XDG_CONFIG_HOME", home+"/.config")
	t.Setenv("XDG_DATA_HOME", home+"/.local/share")
	os.Mkdir(home+"/Documents", 0755)
	os.WriteFile(home+"/Documents/notes.txt", []byte("keep"), 0600)
	ts := testServer(fakeServices{}, fakeJournal{})
	defer ts.Close()
	_, env := get(t, ts.URL+"/api/v1/files/locations/settings")
	var snapshot struct{ Revision string }
	json.Unmarshal(env.Data, &snapshot)
	path := destination + "/Documents"
	status, planned := get(t, ts.URL+"/api/v1/files/locations/plan?id=documents&path="+url.QueryEscape(path)+"&revision="+url.QueryEscape(snapshot.Revision))
	if status != 200 || !planned.OK {
		t.Fatalf("plan: %d %+v", status, planned.Error)
	}
	apply := func(body map[string]any) testEnvelope {
		t.Helper()
		encoded, _ := json.Marshal(body)
		response, err := http.Post(ts.URL+"/api/v1/files/locations/settings", "application/json", strings.NewReader(string(encoded)))
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		var result testEnvelope
		if err := json.NewDecoder(response.Body).Decode(&result); err != nil || response.StatusCode != 200 || !result.OK {
			t.Fatalf("apply: %d %+v %v", response.StatusCode, result.Error, err)
		}
		return result
	}
	saved := apply(map[string]any{"id": "documents", "path": path, "expectedRevision": snapshot.Revision, "requestId": "individual-move"})
	if data, _ := os.ReadFile(path + "/notes.txt"); string(data) != "keep" {
		t.Fatal("missing moved contents")
	}
	if _, err := os.Stat(destination + "/Videos"); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("unrequested folder created")
	}
	json.Unmarshal(saved.Data, &snapshot)
	request := map[string]any{"id": "documents", "remove": true, "expectedRevision": snapshot.Revision, "requestId": "individual-remove"}
	apply(request)
	apply(request)
	status, listed := get(t, ts.URL+"/api/v1/trash")
	if status != 200 || !listed.OK || !strings.Contains(string(listed.Data), "Documents") {
		t.Fatalf("trash: %d %s", status, listed.Data)
	}
	_, locations := get(t, ts.URL+"/api/v1/files/locations")
	if strings.Contains(string(locations.Data), "documents") {
		t.Fatal("removed shortcut remains")
	}
}
