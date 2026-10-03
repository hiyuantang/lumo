// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
)

func piPermissionSettings(settings map[string]json.RawMessage) (string, map[string]string, error) {
	mode := "ask"
	if raw, ok := settings["lumoPermissionMode"]; ok {
		var saved *string
		if json.Unmarshal(raw, &saved) != nil || saved == nil || !validPiPermissionMode(*saved) {
			return "", nil, errors.New("Pi's saved approval mode is invalid; existing settings were preserved.")
		}
		mode = *saved
	}
	sessions := map[string]string{}
	if raw, ok := settings["lumoSessionPermissionModes"]; ok {
		if json.Unmarshal(raw, &sessions) != nil || sessions == nil {
			return "", nil, errors.New("Pi's saved chat approval modes are invalid; existing settings were preserved.")
		}
		for _, value := range sessions {
			if !validPiPermissionMode(value) {
				return "", nil, errors.New("Pi's saved chat approval mode is invalid; existing settings were preserved.")
			}
		}
	}
	return mode, sessions, nil
}

func readPiPermissionMode(agentDir, sessionPath string) (string, error) {
	settings, _, err := readPiSettingsJSON(agentDir)
	if err != nil {
		return "", err
	}
	mode, sessions, err := piPermissionSettings(settings)
	if err != nil {
		return "", err
	}
	if saved, ok := sessions[sessionPath]; ok {
		mode = saved
	}
	return mode, nil
}

func savePiPermissionMode(agentDir, sessionPath, mode string, remember bool) error {
	if !validPiPermissionMode(mode) {
		return errors.New("Pi did not confirm the approval mode.")
	}
	settings, _, err := readPiSettingsJSON(agentDir)
	if err != nil {
		return err
	}
	current, sessions, err := piPermissionSettings(settings)
	if err != nil {
		return err
	}
	changed := remember && current != mode
	if remember {
		settings["lumoPermissionMode"], _ = json.Marshal(mode)
	}
	if sessionPath != "" {
		info, err := os.Lstat(sessionPath)
		if err != nil && !os.IsNotExist(err) {
			return err
		}
		if err == nil && info.Mode().IsRegular() && sessions[sessionPath] != mode {
			sessions[sessionPath] = mode
			settings["lumoSessionPermissionModes"], _ = json.Marshal(sessions)
			changed = true
		}
	}
	if !changed {
		return nil
	}
	return writePiSettingsJSON(agentDir, settings)
}

func (s *Server) rememberPiChatPermission(p *piProcess) error {
	p.mu.Lock()
	project, session, mode := p.project, p.session, p.permissionMode
	p.mu.Unlock()
	if session == "" {
		return nil
	}
	_, dir, err := s.piFolder(project)
	if err != nil {
		return err
	}
	agentDir, err := s.piAgentDir()
	if err != nil {
		return err
	}
	return savePiPermissionMode(agentDir, filepath.Join(dir, session), mode, false)
}
