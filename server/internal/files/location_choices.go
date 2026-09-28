// SPDX-License-Identifier: AGPL-3.0-only
package files

import (
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/sys/unix"
)

func locationChoices(home, mounts string) []Location {
	candidates := []string{filepath.Join("/mnt/data", filepath.Base(home)), filepath.Join("/data", filepath.Base(home)), "/mnt/data", "/data", "/mnt/storage", "/srv/data", "/srv/storage", "/storage", filepath.Join(home, "Files"), filepath.Join(home, "Data")}
	candidates = append(candidates, storageMountPaths(mounts)...)
	return existingLocationChoices(home, candidates)
}

func existingLocationChoices(home string, candidates []string) []Location {
	out := []Location{{ID: "home", Name: "Home", Path: home}}
	homeReal, _ := filepath.EvalSymlinks(home)
	seen := map[string]bool{homeReal: true}
	for _, path := range candidates {
		real, err := filepath.EvalSymlinks(path)
		if err != nil || seen[real] {
			continue
		}
		info, err := os.Stat(path)
		if err != nil || !info.IsDir() || unix.Access(path, unix.W_OK|unix.X_OK) != nil {
			continue
		}
		seen[real] = true
		out = append(out, Location{ID: path, Name: "Data storage", Path: path})
	}
	return out
}

func storageMountPaths(content string) []string {
	out := []string{}
	seen := map[string]bool{}
	unescape := strings.NewReplacer(`\040`, " ", `\011`, "\t", `\012`, "\n", `\134`, `\`)
	for _, line := range strings.Split(content, "\n") {
		parts := strings.SplitN(line, " - ", 2)
		if len(parts) != 2 {
			continue
		}
		fields, fs := strings.Fields(parts[0]), strings.Fields(parts[1])
		if len(fields) < 6 || len(fs) < 3 || !strings.Contains(","+fields[5]+",", ",rw,") {
			continue
		}
		switch fs[0] {
		case "tmpfs", "devtmpfs", "proc", "sysfs", "cgroup", "cgroup2", "overlay", "squashfs", "autofs", "ramfs", "devpts", "mqueue", "securityfs", "debugfs", "tracefs", "hugetlbfs", "fusectl":
			continue
		}
		path := unescape.Replace(fields[4])
		if path == "/" || !filepath.IsAbs(path) || strings.ContainsAny(path, "\x00\r\n") || seen[path] {
			continue
		}
		system := false
		for _, root := range []string{"/boot", "/dev", "/proc", "/sys", "/etc", "/usr", "/var", "/bin", "/sbin", "/lib", "/lib64", "/snap", "/tmp"} {
			if containsLocation(root, path) {
				system = true
				break
			}
		}
		if containsLocation("/run", path) && !containsLocation("/run/media", path) {
			system = true
		}
		if system {
			continue
		}
		seen[path] = true
		out = append(out, path)
	}
	return out
}
