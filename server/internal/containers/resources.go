// SPDX-License-Identifier: AGPL-3.0-only
package containers

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"time"
)

type Image struct {
	ID         string   `json:"id"`
	Tags       []string `json:"tags"`
	Created    int64    `json:"created"`
	Size       *int64   `json:"size"`
	SharedSize *int64   `json:"sharedSize"`
	Containers []string `json:"containers"`
	Revision   string   `json:"revision"`
}
type Volume struct {
	Removable  bool     `json:"removable"`
	Name       string   `json:"name"`
	Driver     string   `json:"driver"`
	Scope      string   `json:"scope"`
	Created    string   `json:"created"`
	Size       *int64   `json:"size"`
	Containers []string `json:"containers"`
	Revision   string   `json:"revision"`
}
type Network struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	Driver     string   `json:"driver"`
	Scope      string   `json:"scope"`
	Internal   bool     `json:"internal"`
	Subnets    []string `json:"subnets"`
	Containers []string `json:"containers"`
	Removable  bool     `json:"removable"`
	Revision   string   `json:"revision"`
}
type ContainerUsage struct {
	ID           string `json:"id"`
	WritableSize *int64 `json:"writableSize"`
	RootSize     *int64 `json:"rootSize"`
}
type Resources struct {
	Images          []Image          `json:"images"`
	Volumes         []Volume         `json:"volumes"`
	Networks        []Network        `json:"networks"`
	Containers      []ContainerUsage `json:"containers"`
	ImageBytes      *int64           `json:"imageBytes"`
	BuildCacheBytes *int64           `json:"buildCacheBytes"`
	SampledAt       string           `json:"sampledAt"`
}
type ResourceRequest struct {
	Kind     string `json:"kind"`
	Action   string `json:"action"`
	ID       string `json:"id"`
	Revision string `json:"revision"`
}
type ResourceResult struct {
	ID     string `json:"id"`
	Action string `json:"action"`
}

var resourceName = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_.-]{1,127}$`)

func ValidateResource(r ResourceRequest) error {
	if r.Action == "create" && (r.Kind == "volume" || r.Kind == "network") && resourceName.MatchString(r.ID) && r.Revision == "absent" {
		return nil
	}
	validID := (r.Kind == "volume" && resourceName.MatchString(r.ID)) || ((r.Kind == "container" || r.Kind == "network") && idPattern.MatchString(r.ID)) || (r.Kind == "image" && revisionPattern.MatchString(r.ID))
	if r.Action == "remove" && validID && revisionPattern.MatchString(r.Revision) {
		return nil
	}
	return ErrValidation
}
func knownBytes(value *int64) *int64 {
	if value == nil || *value < 0 {
		return nil
	}
	return value
}
func resourceRevision(value any) string {
	raw, _ := json.Marshal(value)
	sum := sha256.Sum256(raw)
	return "sha256:" + hex.EncodeToString(sum[:])
}
func (c *Client) Resources(ctx context.Context) (Resources, error) {
	result := Resources{Images: []Image{}, Volumes: []Volume{}, Networks: []Network{}, Containers: []ContainerUsage{}}
	prefix, _, err := c.version(ctx)
	if err != nil {
		return result, err
	}
	body, err := c.request(ctx, "GET", prefix+"/system/df")
	if err != nil {
		return result, err
	}
	var df struct {
		LayersSize *int64
		Images     []struct {
			ID               string `json:"Id"`
			RepoTags         []string
			Created          int64
			Size, SharedSize *int64
		}
		Containers []struct {
			ID                 string `json:"Id"`
			Names              []string
			ImageID            string
			SizeRw, SizeRootFs *int64
			Mounts             []struct{ Type, Name string }
		}
		Volumes []struct {
			Name, Driver, Scope, CreatedAt string
			UsageData                      *struct {
				Size     *int64
				RefCount *int64
			}
			Options map[string]string
		}
		BuildCache []struct{ Size *int64 }
	}
	if err := json.Unmarshal(body, &df); err != nil {
		return result, err
	}
	imageUsers, volumeUsers := map[string][]string{}, map[string][]string{}
	for _, item := range df.Containers {
		name := item.ID
		if len(item.Names) > 0 {
			name = strings.TrimPrefix(item.Names[0], "/")
		}
		imageUsers[item.ImageID] = append(imageUsers[item.ImageID], name)
		for _, mount := range item.Mounts {
			if mount.Type == "volume" {
				volumeUsers[mount.Name] = append(volumeUsers[mount.Name], name)
			}
		}
		result.Containers = append(result.Containers, ContainerUsage{item.ID, knownBytes(item.SizeRw), knownBytes(item.SizeRootFs)})
	}
	for _, item := range df.Images {
		tags := []string{}
		for _, tag := range item.RepoTags {
			if tag != "<none>:<none>" {
				tags = append(tags, tag)
			}
		}
		sort.Strings(tags)
		users := append([]string{}, imageUsers[item.ID]...)
		sort.Strings(users)
		result.Images = append(result.Images, Image{item.ID, tags, item.Created, knownBytes(item.Size), knownBytes(item.SharedSize), users, resourceRevision(struct {
			ID          string
			Tags, Users []string
		}{item.ID, tags, users})})
	}
	for _, item := range df.Volumes {
		users := append([]string{}, volumeUsers[item.Name]...)
		sort.Strings(users)
		var size *int64
		if item.UsageData != nil {
			size = knownBytes(item.UsageData.Size)
		}
		result.Volumes = append(result.Volumes, Volume{item.UsageData != nil && item.UsageData.RefCount != nil && *item.UsageData.RefCount == 0 && len(users) == 0 && item.Scope == "local", item.Name, item.Driver, item.Scope, item.CreatedAt, size, users, resourceRevision(struct {
			Name, Driver, Created string
			Options               map[string]string
			Users                 []string
		}{item.Name, item.Driver, item.CreatedAt, item.Options, users})})
	}
	result.ImageBytes = knownBytes(df.LayersSize)
	var cache int64
	cacheKnown := df.BuildCache != nil
	for _, item := range df.BuildCache {
		if knownBytes(item.Size) == nil {
			cacheKnown = false
		} else {
			cache += *item.Size
		}
	}
	if cacheKnown {
		result.BuildCacheBytes = &cache
	}
	body, err = c.request(ctx, "GET", prefix+"/networks")
	if err != nil {
		return result, err
	}
	var networks []struct {
		ID                           string `json:"Id"`
		Name, Driver, Scope, Created string
		Internal                     bool
		IPAM                         struct{ Config []struct{ Subnet string } }
		Containers                   map[string]struct{ Name string }
		Options                      map[string]string
	}
	if err := json.Unmarshal(body, &networks); err != nil {
		return result, err
	}
	for _, item := range networks {
		if !idPattern.MatchString(item.ID) {
			return result, errors.New("Docker returned an invalid network ID")
		}
		raw, err := c.request(ctx, "GET", prefix+"/networks/"+item.ID)
		if err != nil {
			return result, err
		}
		if err := json.Unmarshal(raw, &item); err != nil {
			return result, err
		}
		users, subnets := []string{}, []string{}
		for _, container := range item.Containers {
			users = append(users, container.Name)
		}
		sort.Strings(users)
		for _, config := range item.IPAM.Config {
			if config.Subnet != "" {
				subnets = append(subnets, config.Subnet)
			}
		}
		sort.Strings(subnets)
		removable := item.Name != "bridge" && item.Name != "host" && item.Name != "none" && item.Scope == "local" && len(users) == 0
		result.Networks = append(result.Networks, Network{item.ID, item.Name, item.Driver, item.Scope, item.Internal, subnets, users, removable, resourceRevision(item)})
	}
	sort.Slice(result.Images, func(i, j int) bool {
		return strings.Join(result.Images[i].Tags, ",")+result.Images[i].ID < strings.Join(result.Images[j].Tags, ",")+result.Images[j].ID
	})
	sort.Slice(result.Volumes, func(i, j int) bool { return result.Volumes[i].Name < result.Volumes[j].Name })
	sort.Slice(result.Networks, func(i, j int) bool { return result.Networks[i].Name < result.Networks[j].Name })
	result.SampledAt = time.Now().UTC().Format(time.RFC3339)
	return result, nil
}
func (c *Client) ResourceAction(ctx context.Context, r ResourceRequest, uid uint32) (ResourceResult, error) {
	result := ResourceResult{r.ID, r.Action}
	if err := ValidateResource(r); err != nil {
		return result, err
	}
	if c.socket != "" && !socketAccess(c.socket, uid) {
		return result, ErrPermission
	}
	prefix, _, err := c.version(ctx)
	if err != nil {
		return result, err
	}
	if r.Kind == "container" {
		before, err := c.inspect(ctx, prefix, r.ID)
		if err != nil {
			return result, err
		}
		if before.Revision != r.Revision {
			return result, ErrStale
		}
		if before.State != "exited" && before.State != "created" && before.State != "dead" {
			return result, errors.New("Stop the container before removing it")
		}
		_, err = c.request(ctx, "DELETE", prefix+"/containers/"+r.ID+"?force=false&v=false")
		return result, err
	}
	resources, err := c.Resources(ctx)
	if err != nil {
		return result, err
	}
	revision, used, path := "", false, ""
	switch r.Kind {
	case "image":
		for _, item := range resources.Images {
			if item.ID == r.ID {
				revision = item.Revision
				used = len(item.Containers) > 0
			}
		}
		path = "/images/" + url.PathEscape(r.ID) + "?force=false&noprune=true"
	case "volume":
		for _, item := range resources.Volumes {
			if item.Name == r.ID {
				revision = item.Revision
				used = !item.Removable
			}
		}
		path = "/volumes/" + url.PathEscape(r.ID) + "?force=false"
	case "network":
		for _, item := range resources.Networks {
			if item.ID == r.ID || item.Name == r.ID {
				revision = item.Revision
				used = !item.Removable
			}
		}
		path = "/networks/" + url.PathEscape(r.ID)
	}
	if r.Action == "create" {
		if revision != "" {
			return result, ErrStale
		}
		payload := map[string]any{"Name": r.ID, "Driver": "local"}
		endpoint := "/volumes/create"
		if r.Kind == "network" {
			payload["Driver"] = "bridge"
			payload["CheckDuplicate"] = true
			endpoint = "/networks/create"
		}
		raw, _ := json.Marshal(payload)
		req, err := http.NewRequestWithContext(ctx, "POST", c.base+prefix+endpoint, bytes.NewReader(raw))
		if err != nil {
			return result, err
		}
		req.Header.Set("Content-Type", "application/json")
		response, err := c.http.Do(req)
		if err != nil {
			return result, ErrUnavailable
		}
		defer response.Body.Close()
		if response.StatusCode < 200 || response.StatusCode >= 300 {
			return result, errors.New("Docker could not create this resource; refresh and check the name")
		}
		return result, nil
	}
	if revision == "" {
		return result, ErrNotFound
	}
	if revision != r.Revision {
		return result, ErrStale
	}
	if used {
		return result, errors.New("This resource is in use or protected and cannot be removed")
	}
	_, err = c.request(ctx, "DELETE", prefix+path)
	return result, err
}
