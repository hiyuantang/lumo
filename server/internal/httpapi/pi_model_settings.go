// SPDX-License-Identifier: AGPL-3.0-only
package httpapi

import (
	"context"
	"encoding/json"
	"errors"
)

func (s *Server) rememberPiSelection(ctx context.Context, p *piProcess) error {
	raw, err := p.command(ctx, map[string]any{"type": "get_state"})
	if err != nil {
		return err
	}
	var reply struct {
		Success bool `json:"success"`
		Data    struct {
			Model struct {
				Provider string `json:"provider"`
				ID       string `json:"id"`
			} `json:"model"`
			ThinkingLevel string `json:"thinkingLevel"`
		} `json:"data"`
	}
	if json.Unmarshal(raw, &reply) != nil || !reply.Success || reply.Data.Model.Provider == "" || reply.Data.Model.ID == "" || reply.Data.ThinkingLevel == "" {
		return errors.New("Pi did not confirm the model and effort.")
	}
	dir, err := s.piAgentDir()
	if err != nil {
		return err
	}
	return savePiModelDefaults(dir, reply.Data.Model.Provider, reply.Data.Model.ID, reply.Data.ThinkingLevel)
}

func savePiModelDefaults(dir, provider, model, level string) error {
	settings, _, err := readPiSettingsJSON(dir)
	if err != nil {
		return err
	}
	levels := map[string]json.RawMessage{}
	if raw, ok := settings["modelThinkingLevels"]; ok && (json.Unmarshal(raw, &levels) != nil || levels == nil) {
		return errors.New("Pi's saved effort settings are invalid; existing settings were preserved.")
	}
	levels[provider+"/"+model], _ = json.Marshal(level)
	settings["defaultProvider"], _ = json.Marshal(provider)
	settings["defaultModel"], _ = json.Marshal(model)
	settings["defaultThinkingLevel"], _ = json.Marshal(level)
	settings["modelThinkingLevels"], _ = json.Marshal(levels)
	return writePiSettingsJSON(dir, settings)
}
