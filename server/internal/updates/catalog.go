// SPDX-License-Identifier: AGPL-3.0-only
package updates

import (
	"context"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"
)

type InstalledPackage struct {
	Name          string `json:"name"`
	Version       string `json:"version"`
	Architecture  string `json:"architecture"`
	Summary       string `json:"summary"`
	Group         string `json:"group"`
	Origin        string `json:"origin"`
	Held          bool   `json:"held"`
	UpdateVersion string `json:"updateVersion,omitempty"`
	UpdateGroup   string `json:"updateGroup,omitempty"`
	UpdateOrigin  string `json:"updateOrigin,omitempty"`
	Security      bool   `json:"security"`
}

type Catalog struct {
	UpdateError    string             `json:"updateError,omitempty"`
	Packages       []InstalledPackage `json:"packages"`
	CheckedAt      time.Time          `json:"checkedAt"`
	RebootRequired bool               `json:"rebootRequired"`
}

type repository struct{ origin, archive string }
type packagePolicy map[string][]repository

const installedFormat = "${binary:Package}\t${Version}\t${Architecture}\t${db:Status-Status}\t${db:Status-Want}\t${binary:Summary}\n"

func (w *Worker) Catalog(ctx context.Context) (Catalog, error) {
	if !w.Available() {
		return Catalog{}, ErrUnavailable
	}
	if !w.opMu.TryLock() {
		return Catalog{}, ErrBusy
	}
	defer w.opMu.Unlock()
	output, err := w.runner.Output(ctx, w.dpkg, "-W", "-f="+installedFormat)
	if err != nil {
		return Catalog{}, fmt.Errorf("installed packages unavailable: %s", commandFailure(output, err))
	}
	packages := parseInstalledPackages(string(output))
	output, err = w.runner.Output(ctx, w.aptCache, "policy")
	if err != nil {
		return Catalog{}, fmt.Errorf("package sources unavailable: %s", commandFailure(output, err))
	}
	repositories := parseRepositories(string(output))
	policies := map[string]packagePolicy{}
	for start := 0; start < len(packages); start += 200 {
		batch := packages[start:min(start+200, len(packages))]
		args := []string{"policy", "--"}
		for _, pkg := range batch {
			args = append(args, pkg.Name)
		}
		output, err = w.runner.Output(ctx, w.aptCache, args...)
		if err != nil {
			return Catalog{}, fmt.Errorf("package versions unavailable: %s", commandFailure(output, err))
		}
		for name, policy := range parsePackagePolicies(string(output), repositories) {
			policies[name] = policy
		}
	}
	output, err = w.runner.Output(ctx, w.aptGet, "-s", "-V", "-o", "Dpkg::Use-Pty=0", "upgrade")
	updateError := ""
	if err != nil {
		updateError = fmt.Sprintf("Available updates could not be checked: %s", commandFailure(output, err))
		output = nil
	}
	pending := map[string]Package{}
	for _, pkg := range parsePlanOutput(string(output)) {
		pending[pkg.Name] = pkg
	}
	for i := range packages {
		pkg := &packages[i]
		policy := policies[pkg.Name]
		if policy == nil && !strings.Contains(pkg.Name, ":") {
			policy = policies[pkg.Name+":"+pkg.Architecture]
		}
		pkg.Group, pkg.Origin, _ = classifyRepositories(policy[pkg.Version])
		update, ok := pending[pkg.Name]
		if !ok && !strings.Contains(pkg.Name, ":") {
			update, ok = pending[pkg.Name+":"+pkg.Architecture]
		}
		if !ok && strings.HasSuffix(pkg.Name, ":"+pkg.Architecture) {
			candidate, found := pending[strings.TrimSuffix(pkg.Name, ":"+pkg.Architecture)]
			if found && candidate.Architecture == pkg.Architecture {
				update, ok = candidate, true
			}
		}
		if ok && update.FromVersion == pkg.Version && !pkg.Held {
			pkg.UpdateVersion = update.ToVersion
			pkg.UpdateGroup, pkg.UpdateOrigin, pkg.Security = classifyRepositories(policy[update.ToVersion])
			pkg.Security = pkg.Security || update.Security
		}
	}
	return Catalog{UpdateError: updateError, Packages: packages, CheckedAt: time.Now().UTC(), RebootRequired: fileExists("/var/run/reboot-required")}, nil
}

func parseInstalledPackages(output string) []InstalledPackage {
	packages := []InstalledPackage{}
	for _, line := range strings.Split(output, "\n") {
		fields := strings.SplitN(line, "\t", 6)
		if len(fields) != 6 || fields[3] != "installed" || fields[0] == "" {
			continue
		}
		packages = append(packages, InstalledPackage{Name: fields[0], Version: fields[1], Architecture: fields[2], Summary: fields[5], Held: fields[4] == "hold", Group: "unknown"})
	}
	sort.Slice(packages, func(i, j int) bool { return packages[i].Name < packages[j].Name })
	return packages
}

func policySource(line string) string {
	fields := strings.Fields(line)
	if len(fields) < 3 || fields[len(fields)-1] != "Packages" {
		return ""
	}
	if _, err := strconv.Atoi(fields[0]); err != nil {
		return ""
	}
	return strings.Join(fields[1:], " ")
}

func parseRepositories(output string) map[string]repository {
	result := map[string]repository{}
	source := ""
	for _, line := range strings.Split(output, "\n") {
		if key := policySource(line); key != "" {
			source = key
			continue
		}
		text := strings.TrimSpace(line)
		if source == "" || !strings.HasPrefix(text, "release ") {
			continue
		}
		repo := repository{}
		for _, field := range strings.Split(strings.TrimPrefix(text, "release "), ",") {
			key, value, _ := strings.Cut(strings.TrimSpace(field), "=")
			if key == "o" {
				repo.origin = value
			}
			if key == "a" {
				repo.archive = value
			}
		}
		result[source] = repo
		source = ""
	}
	return result
}

func parsePackagePolicies(output string, repositories map[string]repository) map[string]packagePolicy {
	result := map[string]packagePolicy{}
	name, version := "", ""
	for _, line := range strings.Split(output, "\n") {
		text := strings.TrimSpace(line)
		if text == "" {
			continue
		}
		if line[0] != ' ' && strings.HasSuffix(text, ":") {
			name = strings.TrimSuffix(text, ":")
			version = ""
			result[name] = packagePolicy{}
			continue
		}
		if name == "" {
			continue
		}
		if key := policySource(text); key != "" {
			if version != "" {
				if repo, ok := repositories[key]; ok {
					result[name][version] = append(result[name][version], repo)
				}
			}
			continue
		}
		fields := strings.Fields(strings.TrimPrefix(text, "*** "))
		if len(fields) >= 2 {
			if _, err := strconv.Atoi(fields[1]); err == nil {
				version = fields[0]
			}
		}
	}
	return result
}

func classifyRepositories(repositories []repository) (string, string, bool) {
	origins := map[string]bool{}
	system, thirdParty, security := false, false, false
	for _, repo := range repositories {
		if repo.origin == "" {
			continue
		}
		origins[repo.origin] = true
		if repo.origin == "Ubuntu" {
			system = true
		} else {
			thirdParty = true
		}
		if strings.HasSuffix(repo.archive, "-security") || strings.Contains(repo.archive, "-security/") {
			security = true
		}
	}
	names := []string{}
	for name := range origins {
		names = append(names, name)
	}
	sort.Strings(names)
	group := "unknown"
	if system && !thirdParty {
		group = "system"
	} else if thirdParty && !system {
		group = "third-party"
	}
	return group, strings.Join(names, ", "), security
}
