// SPDX-License-Identifier: AGPL-3.0-only
package containers

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/user"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"
)

const Socket = "/var/run/docker.sock"
const maxResponse = 2 << 20
const maxLogs = 256 << 10

var ErrValidation = errors.New("invalid container request")
var ErrStale = errors.New("the container changed; refresh it before trying again")
var ErrPermission = errors.New("this Linux user does not have access to Docker")
var ErrNotFound = errors.New("the container no longer exists")
var ErrUnavailable = errors.New("Docker is unavailable")
var idPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)
var revisionPattern = regexp.MustCompile(`^sha256:[a-f0-9]{64}$`)

type Container struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Image   string `json:"image"`
	State   string `json:"state"`
	Status  string `json:"status"`
	Project string `json:"project"`
}

type Snapshot struct {
	Status     string      `json:"status"`
	Message    string      `json:"message"`
	Version    string      `json:"version"`
	Containers []Container `json:"containers"`
}

type Port struct {
	Container string `json:"container"`
	Address   string `json:"address"`
	Host      string `json:"host"`
}

type Mount struct {
	Type        string `json:"type"`
	Source      string `json:"source"`
	Destination string `json:"destination"`
	Writable    bool   `json:"writable"`
}

type Detail struct {
	Container
	Revision  string  `json:"revision"`
	Created   string  `json:"created"`
	StartedAt string  `json:"startedAt"`
	ExitCode  int     `json:"exitCode"`
	Ports     []Port  `json:"ports"`
	Mounts    []Mount `json:"mounts"`
	TTY       bool    `json:"-"`
}

type Logs struct {
	Text      string `json:"text"`
	Truncated bool   `json:"truncated"`
}

type Reader interface {
	Snapshot(context.Context) (Snapshot, error)
	Inspect(context.Context, string) (Detail, error)
	Logs(context.Context, string) (Logs, error)
}

type Client struct {
	http   *http.Client
	base   string
	socket string
}

func NewClient() *Client {
	return &Client{socket: Socket, base: "http://docker", http: &http.Client{
		Timeout: 40 * time.Second,
		Transport: &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, "unix", Socket)
		}},
	}}
}

func Validate(id, action, revision string) error {
	if !idPattern.MatchString(id) || (action != "start" && action != "stop" && action != "restart") || !revisionPattern.MatchString(revision) {
		return ErrValidation
	}
	return nil
}

func (c *Client) request(ctx context.Context, method, path string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, method, c.base+path, nil)
	if err != nil {
		return nil, err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		if errors.Is(err, os.ErrPermission) {
			return nil, ErrPermission
		}
		return nil, fmt.Errorf("%w: unable to connect to the local engine", ErrUnavailable)
	}
	defer resp.Body.Close()
	if resp.StatusCode == 404 {
		return nil, ErrNotFound
	}
	if resp.StatusCode == 403 {
		return nil, ErrPermission
	}
	if resp.StatusCode == 304 {
		return nil, nil
	}
	limit := int64(maxResponse)
	if strings.Contains(path, "/logs?") {
		limit = maxLogs + 4096
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, limit+1))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		var message struct{ Message string }
		_ = json.Unmarshal(body, &message)
		if len(message.Message) > 500 {
			message.Message = message.Message[:500]
		}
		return nil, fmt.Errorf("Docker rejected the operation (%d): %s", resp.StatusCode, message.Message)
	}
	if len(body) > maxResponse {
		return nil, errors.New("Docker's response is too large")
	}
	return body, nil
}

func (c *Client) version(ctx context.Context) (string, string, error) {
	body, err := c.request(ctx, "GET", "/version")
	if err != nil {
		return "", "", err
	}
	var v struct{ Version, ApiVersion, MinAPIVersion string }
	if err := json.Unmarshal(body, &v); err != nil {
		return "", "", err
	}
	major, minor := 0, 0
	if _, err := fmt.Sscanf(v.ApiVersion, "%d.%d", &major, &minor); err != nil || major != 1 || minor < 41 {
		return "", "", errors.New("Docker API 1.41 or newer is required")
	}
	minMajor, minMinor := 1, 0
	if v.MinAPIVersion != "" {
		_, _ = fmt.Sscanf(v.MinAPIVersion, "%d.%d", &minMajor, &minMinor)
	}
	if minMajor != 1 || minMinor > 45 {
		return "", "", errors.New("this Docker version requires a newer Lumo integration")
	}
	return fmt.Sprintf("/v1.%d", min(minor, 45)), v.Version, nil
}

func (c *Client) Snapshot(ctx context.Context) (Snapshot, error) {
	snapshot := Snapshot{Status: "ready", Containers: []Container{}}
	if c.socket != "" {
		if _, err := os.Stat(c.socket); errors.Is(err, os.ErrNotExist) {
			snapshot.Status, snapshot.Message = "stopped", "Docker's local engine is not running."
			if _, err := os.Stat("/usr/bin/dockerd"); errors.Is(err, os.ErrNotExist) {
				snapshot.Status, snapshot.Message = "not-installed", "Install Docker Engine on this server to manage containers."
			}
			return snapshot, nil
		}
	}
	prefix, version, err := c.version(ctx)
	if err != nil {
		snapshot.Status, snapshot.Message = "unavailable", err.Error()
		if errors.Is(err, ErrPermission) {
			snapshot.Status = "permission-denied"
		}
		return snapshot, nil
	}
	snapshot.Version = version
	body, err := c.request(ctx, "GET", prefix+"/containers/json?all=true")
	if err != nil {
		return snapshot, err
	}
	var list []struct {
		ID                   string `json:"Id"`
		Names                []string
		Image, State, Status string
		Labels               map[string]string
	}
	if err := json.Unmarshal(body, &list); err != nil {
		return snapshot, err
	}
	for _, item := range list {
		if !idPattern.MatchString(item.ID) {
			continue
		}
		name := item.ID[:12]
		if len(item.Names) > 0 {
			name = strings.TrimPrefix(item.Names[0], "/")
		}
		snapshot.Containers = append(snapshot.Containers, Container{ID: item.ID, Name: name, Image: item.Image, State: item.State, Status: item.Status, Project: item.Labels["com.docker.compose.project"]})
	}
	sort.Slice(snapshot.Containers, func(i, j int) bool { return snapshot.Containers[i].Name < snapshot.Containers[j].Name })
	return snapshot, nil
}

func (c *Client) Inspect(ctx context.Context, id string) (Detail, error) {
	if !idPattern.MatchString(id) {
		return Detail{}, ErrValidation
	}
	prefix, _, err := c.version(ctx)
	if err != nil {
		return Detail{}, err
	}
	return c.inspect(ctx, prefix, id)
}

func (c *Client) inspect(ctx context.Context, prefix, id string) (Detail, error) {
	body, err := c.request(ctx, "GET", prefix+"/containers/"+id+"/json")
	if err != nil {
		return Detail{}, err
	}
	var v struct {
		ID            string `json:"Id"`
		Name, Created string
		RestartCount  int
		State         struct {
			Status, StartedAt, FinishedAt     string
			ExitCode                          int
			Running, Paused, Restarting, Dead bool
		}
		Config struct {
			Image  string
			Tty    bool
			Labels map[string]string
		}
		NetworkSettings struct {
			Ports map[string][]struct{ HostIp, HostPort string }
		}
		Mounts []struct {
			Type, Source, Destination string
			RW                        bool
		}
	}
	if err := json.Unmarshal(body, &v); err != nil {
		return Detail{}, err
	}
	if v.ID != id {
		return Detail{}, errors.New("Docker returned a different container")
	}
	state, _ := json.Marshal(struct {
		ID       string
		State    any
		Restarts int
	}{id, v.State, v.RestartCount})
	hash := sha256.Sum256(state)
	detail := Detail{Container: Container{ID: id, Name: strings.TrimPrefix(v.Name, "/"), Image: v.Config.Image, State: v.State.Status, Status: v.State.Status, Project: v.Config.Labels["com.docker.compose.project"]}, Revision: "sha256:" + hex.EncodeToString(hash[:]), Created: v.Created, StartedAt: v.State.StartedAt, ExitCode: v.State.ExitCode, TTY: v.Config.Tty, Ports: []Port{}, Mounts: []Mount{}}
	for port, bindings := range v.NetworkSettings.Ports {
		if len(bindings) == 0 {
			detail.Ports = append(detail.Ports, Port{Container: port})
		}
		for _, binding := range bindings {
			detail.Ports = append(detail.Ports, Port{Container: port, Address: binding.HostIp, Host: binding.HostPort})
		}
	}
	sort.Slice(detail.Ports, func(i, j int) bool {
		a, b := detail.Ports[i], detail.Ports[j]
		return a.Container+a.Address+a.Host < b.Container+b.Address+b.Host
	})
	for _, m := range v.Mounts {
		detail.Mounts = append(detail.Mounts, Mount{m.Type, m.Source, m.Destination, m.RW})
	}
	return detail, nil
}

func (c *Client) Logs(ctx context.Context, id string) (Logs, error) {
	if !idPattern.MatchString(id) {
		return Logs{}, ErrValidation
	}
	prefix, _, err := c.version(ctx)
	if err != nil {
		return Logs{}, err
	}
	detail, err := c.inspect(ctx, prefix, id)
	if err != nil {
		return Logs{}, err
	}
	body, err := c.request(ctx, "GET", prefix+"/containers/"+id+"/logs?stdout=true&stderr=true&timestamps=true&tail=200&follow=false")
	if err != nil {
		return Logs{}, err
	}
	return decodeLogs(body, detail.TTY)
}

func decodeLogs(body []byte, tty bool) (Logs, error) {
	text := body
	truncated := len(body) > maxLogs
	if !tty {
		text = []byte{}
		for len(body) > 0 {
			if len(body) < 8 {
				if truncated {
					break
				}
				return Logs{}, errors.New("invalid Docker log frame")
			}
			if body[0] > 2 || body[1] != 0 || body[2] != 0 || body[3] != 0 {
				return Logs{}, errors.New("invalid Docker log frame")
			}
			size := uint64(binary.BigEndian.Uint32(body[4:8]))
			body = body[8:]
			if size > uint64(len(body)) {
				if !truncated {
					return Logs{}, errors.New("incomplete Docker log frame")
				}
				size = uint64(len(body))
			}
			text = append(text, body[:int(size)]...)
			body = body[int(size):]
		}
	}
	if len(text) > maxLogs {
		text = text[:maxLogs]
		truncated = true
	}
	return Logs{Text: strings.ToValidUTF8(string(text), "�"), Truncated: truncated}, nil
}

func (c *Client) Act(ctx context.Context, id, action, expected string, uid uint32) (Detail, error) {
	if err := Validate(id, action, expected); err != nil {
		return Detail{}, err
	}
	if c.socket != "" && !socketAccess(c.socket, uid) {
		return Detail{}, ErrPermission
	}
	prefix, _, err := c.version(ctx)
	if err != nil {
		return Detail{}, err
	}
	before, err := c.inspect(ctx, prefix, id)
	if err != nil {
		return Detail{}, err
	}
	if before.Revision != expected {
		return Detail{}, ErrStale
	}
	path := prefix + "/containers/" + id + "/" + action
	if action != "start" {
		path += "?t=10"
	}
	if _, err := c.request(ctx, "POST", path); err != nil {
		return Detail{}, err
	}
	return c.inspect(ctx, prefix, id)
}

func socketAccess(path string, uid uint32) bool {
	info, err := os.Stat(path)
	if err != nil || info.Mode()&os.ModeSocket == 0 {
		return false
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || stat.Uid != 0 {
		return false
	}
	if uid == 0 || info.Mode().Perm()&0o002 != 0 {
		return true
	}
	u, err := user.LookupId(strconv.FormatUint(uint64(uid), 10))
	if err != nil {
		return false
	}
	groups, err := u.GroupIds()
	if err != nil {
		return false
	}
	for _, group := range groups {
		if group == strconv.FormatUint(uint64(stat.Gid), 10) && info.Mode().Perm()&0o020 != 0 {
			return true
		}
	}
	return false
}

func (c *Client) CheckCleanUninstall(ctx context.Context) error {
	raw, err := c.request(ctx, "GET", "/info")
	if err != nil {
		return fmt.Errorf("start Docker so its storage location can be checked before a clean uninstall: %w", err)
	}
	var info struct {
		DockerRootDir      string
		DriverStatus       [][]string
		LiveRestoreEnabled bool
		ContainersRunning  int
	}
	if err := json.Unmarshal(raw, &info); err != nil {
		return err
	}
	if info.DockerRootDir != "/var/lib/docker" {
		return errors.New("Docker uses a custom data folder; use normal uninstall and manage that folder separately")
	}
	for _, row := range info.DriverStatus {
		for _, value := range row {
			if strings.Contains(strings.ToLower(value), "containerd") {
				return errors.New("Docker uses shared containerd storage; use normal uninstall to preserve other workloads")
			}
		}
	}
	if info.LiveRestoreEnabled && info.ContainersRunning > 0 {
		return errors.New("stop running containers before clean uninstall; Docker live restore keeps them running after the engine stops")
	}
	return nil
}
