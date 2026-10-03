// SPDX-License-Identifier: AGPL-3.0-only
package gitrepo

import (
	"context"
	"strings"
)

type Branch struct {
	Name     string `json:"name"`
	Ref      string `json:"ref"`
	Remote   string `json:"remote,omitempty"`
	Date     string `json:"date,omitempty"`
	Upstream string `json:"upstream,omitempty"`
	Default  bool   `json:"default"`
}

func branchDetails(ctx context.Context, s Snapshot) ([]Branch, string, error) {
	raw, err := read(ctx, s.Path, "for-each-ref", "--sort=-committerdate", "--format=%(refname)%00%(symref)%00%(committerdate:iso-strict)%00%(upstream:short)%00%(objectname)", "refs/heads/", "refs/remotes/")
	if err != nil {
		return nil, "", err
	}
	branches := []Branch{}
	defaults := map[string]string{}
	for _, line := range strings.Split(strings.TrimSpace(raw), "\n") {
		fields := strings.Split(line, "\x00")
		if len(fields) != 5 {
			continue
		}
		if fields[1] != "" {
			defaults[fields[0]] = fields[1]
			continue
		}
		b := Branch{Ref: fields[0], Date: fields[2], Upstream: fields[3]}
		if strings.HasPrefix(b.Ref, "refs/heads/") {
			b.Name = strings.TrimPrefix(b.Ref, "refs/heads/")
		} else {
			b.Name = strings.TrimPrefix(b.Ref, "refs/remotes/")
			for _, remote := range s.Remotes {
				if strings.HasPrefix(b.Name, remote+"/") && len(remote) > len(b.Remote) {
					b.Remote = remote
				}
			}
			if b.Remote == "" {
				continue
			}
		}
		branches = append(branches, b)
	}
	preferred := "origin"
	for _, remote := range s.Remotes {
		if strings.HasPrefix(s.Upstream, remote+"/") {
			preferred = remote
			break
		}
	}
	if !contains(s.Remotes, preferred) && len(s.Remotes) > 0 {
		preferred = s.Remotes[0]
	}
	defaultRef := defaults["refs/remotes/"+preferred+"/HEAD"]
	for i := range branches {
		b := &branches[i]
		if defaultRef != "" {
			b.Default = b.Ref == defaultRef || (b.Remote == "" && b.Name == strings.TrimPrefix(defaultRef, "refs/remotes/"+preferred+"/"))
		}
	}
	if s.Branch != "" && s.Head == "" {
		branches = append(branches, Branch{Name: s.Branch, Ref: "refs/heads/" + s.Branch})
	}
	return branches, raw, nil
}
