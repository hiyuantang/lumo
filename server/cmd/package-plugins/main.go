// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"lumo/server/internal/appplugins"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

func main() {
	source := flag.String("source", "../public/plugins", "built frontend packages")
	apps := flag.String("apps", "../apps", "app source packages")
	output := flag.String("output", "../.tools/plugin-packages", "complete package output")
	selected := flag.String("app", "", "build one app")
	flag.Parse()
	if err := build(*source, *apps, *output, *selected); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
func build(source, apps, output, selected string) error {
	entries, err := os.ReadDir(apps)
	if err != nil {
		return err
	}
	found := false
	for _, entry := range entries {
		name := entry.Name()
		if !entry.IsDir() || selected != "" && selected != name {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(apps, name, "lumo.plugin.json"))
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return err
		}
		found = true
		var definition map[string]any
		if err = json.Unmarshal(raw, &definition); err != nil {
			return err
		}
		raw, err = os.ReadFile(filepath.Join(source, name, "manifest.json"))
		if err != nil {
			return err
		}
		var manifest map[string]any
		if err = json.Unmarshal(raw, &manifest); err != nil {
			return err
		}
		if definition["version"] != manifest["version"] || definition["id"] != manifest["id"] {
			return fmt.Errorf("rebuild frontend for %s", name)
		}
		destination := filepath.Join(output, name)
		if err = os.MkdirAll(destination, 0755); err != nil {
			return err
		}
		asset := func(bytes []byte, suffix string, mode os.FileMode) (string, error) {
			hash := sha256.Sum256(bytes)
			filename := hex.EncodeToString(hash[:]) + suffix
			return filename, os.WriteFile(filepath.Join(destination, filename), bytes, mode)
		}
		for _, field := range []string{"entry", "styles", "background"} {
			file, ok := manifest[field].(string)
			if !ok {
				continue
			}
			bytes, err := os.ReadFile(filepath.Join(source, name, file))
			if err != nil {
				return err
			}
			sum := sha256.Sum256(bytes)
			if hex.EncodeToString(sum[:])+filepath.Ext(file) != file {
				return fmt.Errorf("corrupt %s asset", name)
			}
			if _, err = asset(bytes, filepath.Ext(file), 0644); err != nil {
				return err
			}
		}
		if backend, ok := definition["backend"].(map[string]any); ok {
			temp, err := os.CreateTemp("", "lumo-plugin-build-*")
			if err != nil {
				return err
			}
			temp.Close()
			defer os.Remove(temp.Name())
			goexe := filepath.Join(runtime.GOROOT(), "bin", "go")
			command := exec.Command(goexe, "build", "-trimpath", "-o", temp.Name(), "./"+name+"/backend")
			command.Dir = apps
			if _, err := os.Stat(filepath.Join(apps, name, "backend", "go.mod")); err == nil {
				command = exec.Command(goexe, "build", "-trimpath", "-o", temp.Name(), ".")
				command.Dir = filepath.Join(apps, name, "backend")
			}
			command.Stdout = os.Stdout
			command.Stderr = os.Stderr
			if err = command.Run(); err != nil {
				return err
			}
			bytes, err := os.ReadFile(temp.Name())
			if err != nil {
				return err
			}
			filename, err := asset(bytes, ".bin", 0755)
			if err != nil {
				return err
			}
			backend["entry"] = filename
			backend["platform"] = runtime.GOOS + "/" + runtime.GOARCH
			manifest["backend"] = backend
		}
		if extension, ok := definition["pi"].(map[string]any); ok {
			bytes, err := os.ReadFile(filepath.Join(apps, name, extension["entry"].(string)))
			if err != nil {
				return err
			}
			filename, err := asset(bytes, ".mjs", 0644)
			if err != nil {
				return err
			}
			extension["entry"] = filename
			manifest["pi"] = extension
		}
		raw, err = json.MarshalIndent(manifest, "", "  ")
		if err != nil {
			return err
		}
		temp := filepath.Join(destination, "manifest.next")
		if err = os.WriteFile(temp, append(raw, '\n'), 0644); err != nil {
			return err
		}
		if err = os.Rename(temp, filepath.Join(destination, "manifest.json")); err != nil {
			return err
		}
		bundle := appplugins.Bundle{Name: name, Manifest: raw, Files: map[string][]byte{}}
		p, err := appplugins.Parse(name, destination, raw)
		if err != nil {
			return err
		}
		if err = p.Validate(); err != nil {
			return err
		}
		for _, filename := range p.Assets() {
			bytes, err := p.Asset(filename)
			if err != nil {
				return err
			}
			bundle.Files[filename] = bytes
		}
		archive, err := json.Marshal(bundle)
		if err != nil {
			return err
		}
		if err = os.WriteFile(filepath.Join(output, name+".lumoplugin"), archive, 0644); err != nil {
			return err
		}
		fmt.Printf("Packaged %s %v (%s/%s)\n", name, manifest["version"], runtime.GOOS, runtime.GOARCH)
	}
	if !found {
		return fmt.Errorf("no matching app packages")
	}
	return nil
}
