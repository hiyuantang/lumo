// SPDX-License-Identifier: AGPL-3.0-only
package updates

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
)

type catalogRunner struct {
	outputs  map[string]string
	calls    []string
	failPlan bool
}

func (r *catalogRunner) Output(_ context.Context, name string, args ...string) ([]byte, error) {
	key := commandKey(name, args...)
	r.calls = append(r.calls, key)
	if r.failPlan && name == "apt-get" {
		return []byte("Unmet dependencies"), errors.New("exit status 100")
	}
	return []byte(r.outputs[key]), nil
}
func (r *catalogRunner) Stream(context.Context, string, []string, func(string)) error {
	return errors.New("catalog must never install packages")
}
func catalogWorker(r *catalogRunner) *Worker {
	return &Worker{runner: r, aptGet: "apt-get", aptCache: "apt-cache", dpkg: "dpkg-query"}
}

const repositoryFixture = `Package files:
 100 /var/lib/dpkg/status
     release a=now
 500 http://mirror.test/ubuntu noble/main amd64 Packages
     release v=24.04,o=Ubuntu,a=noble,n=noble,l=Ubuntu,c=main,b=amd64
 500 http://mirror.test/ubuntu noble-security/main amd64 Packages
     release v=24.04,o=Ubuntu,a=noble-security,n=noble,l=Ubuntu,c=main,b=amd64
 500 https://vendor.test/linux noble/stable amd64 Packages
     release o=Docker,a=noble,l=Docker CE,c=stable,b=amd64
 500 https://ppa.test/ubuntu noble/main amd64 Packages
     release o=LP-PPA-example,a=noble,l=Example,b=amd64
`

func TestCatalogUsesExactVersionOriginsAndKeepsHeldPackages(t *testing.T) {
	r := &catalogRunner{outputs: map[string]string{}}
	r.outputs[commandKey("dpkg-query", "-W", "-f="+installedFormat)] = "openssl\t1.0\tamd64\tinstalled\tinstall\tTLS library\n" +
		"docker-ce\t2.0\tamd64\tinstalled\tinstall\tContainers\n" +
		"local-tool\t3.0\tall\tinstalled\tinstall\tLocal tool\n" +
		"held\t1.0\tamd64\tinstalled\thold\tHeld package\n" +
		"libtest:amd64\t1.0\tamd64\tinstalled\tinstall\tNative library\n" +
		"removed\t1.0\tall\tconfig-files\tdeinstall\tRemoved package\n"
	r.outputs[commandKey("apt-cache", "policy")] = repositoryFixture
	r.outputs[commandKey("apt-cache", "policy", "--", "docker-ce", "held", "libtest:amd64", "local-tool", "openssl")] = `docker-ce:
  Installed: 2.0
  Candidate: 2.1
  Version table:
     2.1 500
        500 https://vendor.test/linux noble/stable amd64 Packages
 *** 2.0 100
        500 https://vendor.test/linux noble/stable amd64 Packages
        100 /var/lib/dpkg/status
held:
  Installed: 1.0
  Candidate: 2.0
  Version table:
     2.0 500
        500 http://mirror.test/ubuntu noble/main amd64 Packages
 *** 1.0 500
        500 http://mirror.test/ubuntu noble/main amd64 Packages
libtest:amd64:
  Installed: 1.0
  Version table:
     2.0 500
        500 http://mirror.test/ubuntu noble/main amd64 Packages
 *** 1.0 500
        500 http://mirror.test/ubuntu noble/main amd64 Packages
local-tool:
  Installed: 3.0
  Version table:
 *** 3.0 100
        100 /var/lib/dpkg/status
openssl:
  Installed: 1.0
  Candidate: 1.1
  Version table:
     1.1 500
        500 http://mirror.test/ubuntu noble-security/main amd64 Packages
 *** 1.0 100
        100 /var/lib/dpkg/status
`
	r.outputs[commandKey("apt-get", "-s", "-V", "-o", "Dpkg::Use-Pty=0", "upgrade")] = "Inst openssl [1.0] (1.1 Ubuntu:24.04/noble-security [amd64])\nInst docker-ce [2.0] (2.1 Docker:noble [amd64])\nInst held [1.0] (2.0 Ubuntu:noble [amd64])\nInst libtest [1.0] (2.0 Ubuntu:noble [amd64])\n"
	catalog, err := catalogWorker(r).Catalog(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(catalog.Packages) != 5 || len(r.calls) != 4 {
		t.Fatalf("catalog=%+v calls=%v", catalog, r.calls)
	}
	byName := map[string]InstalledPackage{}
	for _, pkg := range catalog.Packages {
		byName[pkg.Name] = pkg
	}
	if p := byName["openssl"]; p.Group != "unknown" || p.UpdateGroup != "system" || p.UpdateVersion != "1.1" || !p.Security {
		t.Fatalf("security source/version: %+v", p)
	}
	if p := byName["docker-ce"]; p.Group != "third-party" || p.Origin != "Docker" || p.UpdateGroup != "third-party" {
		t.Fatalf("vendor: %+v", p)
	}
	if p := byName["held"]; !p.Held || p.UpdateVersion != "" {
		t.Fatalf("held: %+v", p)
	}
	if p := byName["libtest:amd64"]; p.UpdateVersion != "2.0" {
		t.Fatalf("multiarch: %+v", p)
	}
	if p := byName["local-tool"]; p.Group != "unknown" || p.UpdateVersion != "" {
		t.Fatalf("local: %+v", p)
	}
	r.failPlan = true
	catalog, err = catalogWorker(r).Catalog(context.Background())
	if err != nil || len(catalog.Packages) != 5 || catalog.UpdateError == "" {
		t.Fatalf("broken APT hid installed inventory: %+v %v", catalog, err)
	}
	for _, pkg := range catalog.Packages {
		if pkg.UpdateVersion != "" {
			t.Fatal("failed check fabricated updates")
		}
	}
}

func TestCatalogBatchingAndRepositoryClassification(t *testing.T) {
	r := &catalogRunner{outputs: map[string]string{}}
	var installed strings.Builder
	for i := 0; i < 451; i++ {
		fmt.Fprintf(&installed, "pkg-%03d\t1\tamd64\tinstalled\tinstall\tPackage\n", i)
	}
	r.outputs[commandKey("dpkg-query", "-W", "-f="+installedFormat)] = installed.String()
	catalog, err := catalogWorker(r).Catalog(context.Background())
	if err != nil || len(catalog.Packages) != 451 || len(r.calls) != 6 {
		t.Fatalf("packages=%d calls=%d err=%v", len(catalog.Packages), len(r.calls), err)
	}
	for _, call := range r.calls {
		if strings.Contains(call, "apt-get") && !strings.Contains(call, " -s ") {
			t.Fatalf("non-simulated package operation: %s", call)
		}
	}
	for _, tc := range []struct {
		repos []repository
		group string
	}{
		{[]repository{{origin: "Ubuntu", archive: "noble"}}, "system"},
		{[]repository{{origin: "LP-PPA-example", archive: "noble"}}, "third-party"},
		{[]repository{{origin: "Ubuntu"}, {origin: "Docker"}}, "unknown"},
		{nil, "unknown"},
	} {
		group, _, _ := classifyRepositories(tc.repos)
		if group != tc.group {
			t.Fatalf("%+v classified %s", tc.repos, group)
		}
	}
}
