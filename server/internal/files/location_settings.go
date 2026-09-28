// SPDX-License-Identifier: AGPL-3.0-only
package files

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

type LocationSetting struct {
	Location
	DefaultPath string `json:"defaultPath"`
	Exists      bool   `json:"exists"`
	Enabled     bool   `json:"enabled"`
}

type LocationSettings struct {
	Locations []LocationSetting `json:"locations"`
	Revision  string            `json:"revision"`
	Choices   []Location        `json:"choices"`
}

var locationSettingsLock sync.Mutex

func locationConfigPath() (string, string, error) {
	home, err := os.UserHomeDir()
	if err != nil || !filepath.IsAbs(home) {
		return "", "", fmt.Errorf("%w: home directory unavailable", ErrValidation)
	}
	config := os.Getenv("XDG_CONFIG_HOME")
	if !filepath.IsAbs(config) {
		config = filepath.Join(home, ".config")
	}
	return home, filepath.Join(config, "user-dirs.dirs"), nil
}

func readLocationConfig(path string) ([]byte, string, error) {
	f, err := os.Open(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, "missing", nil
	}
	if err != nil {
		return nil, "", err
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, 65537))
	if err != nil {
		return nil, "", err
	}
	if len(data) > 65536 {
		return nil, "", fmt.Errorf("%w: folder configuration is too large", ErrValidation)
	}
	sum := sha256.Sum256(data)
	return data, "sha256:" + hex.EncodeToString(sum[:]), nil
}

func GetLocationSettings() (LocationSettings, error) {
	if locationSettingsLock.TryLock() {
		err := recoverLocationMove()
		locationSettingsLock.Unlock()
		if err != nil {
			return LocationSettings{}, err
		}
	}
	home, config, err := locationConfigPath()
	if err != nil {
		return LocationSettings{}, err
	}
	data, revision, err := readLocationConfig(config)
	if err != nil {
		return LocationSettings{}, err
	}
	values := map[string]string{}
	for _, line := range strings.Split(string(data), "\n") {
		key, value, found := strings.Cut(line, "=")
		if found {
			values[strings.TrimSpace(key)] = userDirectoryPath(strings.TrimSpace(value), home)
		}
	}
	out := LocationSettings{Locations: []LocationSetting{}, Revision: revision}
	for _, item := range standardLocations {
		fallback := filepath.Join(home, item.name)
		path, found := values["XDG_"+item.id+"_DIR"]
		if !found {
			path = fallback
		}
		info, err := os.Stat(path)
		exists := err == nil && info.IsDir()
		real, _ := filepath.EvalSymlinks(path)
		homeReal, _ := filepath.EvalSymlinks(home)
		out.Locations = append(out.Locations, LocationSetting{Location: Location{ID: strings.ToLower(item.id), Name: item.name, Path: path}, DefaultPath: fallback, Exists: exists, Enabled: path != "" && path != home && (real == "" || real != homeReal)})
	}
	mounts, _ := os.ReadFile("/proc/self/mountinfo")
	out.Choices = locationChoices(home, string(mounts))
	return out, nil
}

func SetLocationBase(base, expectedRevision string) (LocationSettings, error) {
	return setLocation(base, "", false, expectedRevision)
}

func SetIndividualLocation(id, path string, remove bool, expectedRevision string) (LocationSettings, error) {
	if id == "" {
		return LocationSettings{}, fmt.Errorf("%w: folder id is required", ErrValidation)
	}
	return setLocation(path, id, remove, expectedRevision)
}

func setLocation(base, id string, remove bool, expectedRevision string) (result LocationSettings, resultErr error) {
	locationSettingsLock.Lock()
	defer locationSettingsLock.Unlock()
	if err := recoverLocationMove(); err != nil {
		return LocationSettings{}, err
	}
	home, config, err := locationConfigPath()
	if err != nil {
		return LocationSettings{}, err
	}
	if expectedRevision == "" {
		return LocationSettings{}, fmt.Errorf("%w: revision is required", ErrValidation)
	}
	data, revision, err := readLocationConfig(config)
	if err != nil {
		return LocationSettings{}, err
	}
	if revision != expectedRevision {
		return LocationSettings{}, &StaleError{Expected: expectedRevision, Actual: revision}
	}
	if info, err := os.Lstat(config); err == nil && info.Mode()&os.ModeSymlink != 0 {
		return LocationSettings{}, fmt.Errorf("%w: folder configuration is a symbolic link; edit its target directly", ErrValidation)
	}
	settings, err := GetLocationSettings()
	if err != nil {
		return LocationSettings{}, err
	}
	targets := map[string]string{}
	var plan LocationMovePlan
	var trashInfo string
	if id == "" {
		plan, err = PlanLocationMove(base, expectedRevision)
		for _, item := range settings.Locations {
			targets[item.ID] = filepath.Join(base, item.Name)
		}
	} else if remove {
		trashMu.Lock()
		defer trashMu.Unlock()
		plan, trashInfo, err = planLocationRemoval(settings, id)
		targets[id] = home
	} else {
		plan, err = PlanIndividualLocation(id, base, expectedRevision)
		targets[id] = filepath.Clean(base)
	}
	if err != nil {
		return LocationSettings{}, err
	}
	created := []string{}
	committed := false
	staged := false
	defer func() {
		if !committed && !staged && trashInfo != "" {
			_ = os.Remove(trashInfo)
		}
	}()
	defer func() {
		if !committed {
			for i := len(created) - 1; i >= 0; i-- {
				_ = os.Remove(created[i])
			}
		}
	}()
	for _, item := range standardLocations {
		path, changing := targets[strings.ToLower(item.id)]
		if !changing || remove {
			continue
		}
		if err := os.Mkdir(path, 0755); err == nil {
			created = append(created, path)
		} else if !errors.Is(err, os.ErrExist) {
			return LocationSettings{}, err
		}
		info, err := os.Stat(path)
		if err != nil {
			return LocationSettings{}, err
		}
		if !info.IsDir() {
			return LocationSettings{}, fmt.Errorf("%w: %s is not a folder", ErrValidation, item.name)
		}
		folder, err := os.Open(path)
		if err != nil {
			return LocationSettings{}, err
		}
		_, err = folder.Readdirnames(1)
		folder.Close()
		if err != nil && !errors.Is(err, io.EOF) {
			return LocationSettings{}, err
		}
	}
	escape := strings.NewReplacer("\\", "\\\\", "\"", "\\\"", "$", "\\$", "`", "\\`")
	assignments := map[string]string{}
	for _, item := range standardLocations {
		path, changing := targets[strings.ToLower(item.id)]
		if !changing {
			continue
		}
		value := escape.Replace(path)
		if strings.HasPrefix(path, home+"/") {
			value = "$HOME/" + escape.Replace(strings.TrimPrefix(path, home+"/"))
		}
		key := "XDG_" + item.id + "_DIR"
		assignments[key] = key + "=\"" + value + "\""
	}
	lines := []string{}
	for _, line := range strings.Split(strings.TrimSuffix(string(data), "\n"), "\n") {
		field, _, found := strings.Cut(line, "=")
		if found && strings.HasPrefix(strings.TrimSpace(field), "XDG_") {
			if _, known := assignments[strings.TrimSpace(field)]; known {
				continue
			}
		}
		lines = append(lines, line)
	}
	for _, item := range standardLocations {
		if assignment, ok := assignments["XDG_"+item.id+"_DIR"]; ok {
			lines = append(lines, assignment)
		}
	}
	content := []byte(strings.Join(lines, "\n") + "\n")
	if len(content) > 65536 {
		return LocationSettings{}, fmt.Errorf("%w: folder configuration is too large", ErrValidation)
	}
	if err := os.MkdirAll(filepath.Dir(config), 0700); err != nil {
		return LocationSettings{}, err
	}
	sum := sha256.Sum256(content)
	nextRevision := "sha256:" + hex.EncodeToString(sum[:])
	staged = true
	moved, err := stageLocationMovesWith(plan, renameExclusive, func(entries []movedLocationEntry) error {
		return saveLocationMoveWithTrash(config, revision, nextRevision, entries, trashInfo)
	})
	defer func() {
		if !committed {
			if rollbackErr := rollbackLocationMoves(moved); rollbackErr != nil {
				resultErr = errors.Join(resultErr, rollbackErr)
				return
			}
		} else {
			finishLocationMoves(moved)
		}
		if !committed && trashInfo != "" {
			_ = os.Remove(trashInfo)
		}
		_ = os.Remove(config + ".lumo-move.json")
	}()
	if err != nil {
		return LocationSettings{}, err
	}
	if revision == "missing" {
		if err := os.MkdirAll(filepath.Dir(config), 0700); err != nil {
			return LocationSettings{}, err
		}
		tmp, err := os.CreateTemp(filepath.Dir(config), ".lumo-folders-*")
		if err != nil {
			return LocationSettings{}, err
		}
		defer os.Remove(tmp.Name())
		if _, err = tmp.Write(content); err == nil {
			err = tmp.Sync()
		}
		closeErr := tmp.Close()
		if err != nil {
			return LocationSettings{}, err
		}
		if closeErr != nil {
			return LocationSettings{}, closeErr
		}
		if err := os.Link(tmp.Name(), config); err != nil {
			if errors.Is(err, os.ErrExist) {
				return LocationSettings{}, &StaleError{Expected: revision, Actual: "changed"}
			}
			return LocationSettings{}, err
		}
		syncDir(filepath.Dir(config))
	} else if _, err := Write(config, content, revision); err != nil {
		return LocationSettings{}, err
	}
	committed = true
	return GetLocationSettings()
}
