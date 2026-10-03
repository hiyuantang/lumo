// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"time"
)

type piContextBudget struct {
	Mode  string `json:"mode"`
	Value int64  `json:"value"`
}

type piContextModel struct {
	Provider      string `json:"provider"`
	ID            string `json:"id"`
	ContextWindow int64  `json:"contextWindow"`
}

func (b piContextBudget) valid() bool {
	return (b.Mode == "percent" && b.Value >= 1 && b.Value <= 99) || (b.Mode == "tokens" && b.Value >= 1 && b.Value <= 9007199254740991)
}

func (b piContextBudget) threshold(capacity int64) int64 {
	if b.Mode == "percent" {
		return max(1, capacity/100*b.Value+capacity%100*b.Value/100)
	}
	return min(b.Value, capacity-min(16384, max(1, capacity/4)))
}

func readPiContextBudget(settings map[string]json.RawMessage) (*piContextBudget, error) {
	raw, ok := settings["lumoContextBudget"]
	if !ok {
		return nil, nil
	}
	var budget *piContextBudget
	if json.Unmarshal(raw, &budget) != nil || budget == nil || !budget.valid() {
		return nil, errors.New("Pi's shared context budget is invalid. Correct lumoContextBudget in settings.json before saving.")
	}
	return budget, nil
}

func clearPiCompactionOverrides(compaction map[string]json.RawMessage) error {
	overrides, err := piSettingsObject(compaction, "modelOverrides")
	if err != nil {
		return err
	}
	for key := range overrides {
		entry, err := piSettingsObject(overrides, key)
		if err != nil {
			return err
		}
		delete(entry, "reserveTokens")
		delete(entry, "keepRecentTokens")
		if len(entry) == 0 {
			delete(overrides, key)
		} else {
			overrides[key], _ = json.Marshal(entry)
		}
	}
	compaction["modelOverrides"], _ = json.Marshal(overrides)
	return nil
}

func applyPiContextBudget(dir string, models []piContextModel) (bool, error) {
	settings, _, err := readPiSettingsJSON(dir)
	if err != nil {
		return false, err
	}
	budget, err := readPiContextBudget(settings)
	if err != nil || budget == nil {
		return false, err
	}
	compaction, err := piSettingsObject(settings, "compaction")
	if err != nil {
		return false, err
	}
	overrides, err := piSettingsObject(compaction, "modelOverrides")
	if err != nil {
		return false, err
	}
	keep, err := piTokenSetting(compaction, "keepRecentTokens", 20000)
	if err != nil {
		return false, err
	}
	changed := false
	for _, model := range models {
		key := model.Provider + "/" + model.ID
		if !validPiCompactionModel(key) || model.ContextWindow < 2 || model.ContextWindow > 9007199254740991 {
			continue
		}
		entry, err := piSettingsObject(overrides, key)
		if err != nil {
			return false, err
		}
		threshold := budget.threshold(model.ContextWindow)
		reserve, recent := model.ContextWindow-threshold, min(keep, threshold)
		oldReserve, e1 := piTokenSetting(entry, "reserveTokens", -1)
		oldRecent, e2 := piTokenSetting(entry, "keepRecentTokens", -1)
		if e1 != nil || e2 != nil {
			return false, errors.New("Pi's model compaction budget is invalid.")
		}
		if oldReserve == reserve && oldRecent == recent {
			continue
		}
		entry["reserveTokens"], _ = json.Marshal(reserve)
		entry["keepRecentTokens"], _ = json.Marshal(recent)
		overrides[key], _ = json.Marshal(entry)
		changed = true
	}
	if !changed {
		return false, nil
	}
	compaction["modelOverrides"], _ = json.Marshal(overrides)
	settings["compaction"], _ = json.Marshal(compaction)
	return true, writePiSettingsJSON(dir, settings)
}

func preparePiContextBudget(ctx context.Context, p *piProcess, dir string) (bool, error) {
	settings, _, err := readPiSettingsJSON(dir)
	if err != nil {
		return false, err
	}
	budget, err := readPiContextBudget(settings)
	if err != nil || budget == nil {
		return false, err
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	raw, err := p.command(ctx, map[string]any{"type": "get_available_models"})
	if err != nil {
		return false, err
	}
	var available struct {
		Success bool `json:"success"`
		Data    struct {
			Models []piContextModel `json:"models"`
		} `json:"data"`
	}
	if json.Unmarshal(raw, &available) != nil || !available.Success {
		return false, errors.New("Pi could not report model context windows.")
	}
	raw, err = p.command(ctx, map[string]any{"type": "get_state"})
	if err != nil {
		return false, err
	}
	var state struct {
		Success bool `json:"success"`
		Data    struct {
			Model piContextModel `json:"model"`
		} `json:"data"`
	}
	if json.Unmarshal(raw, &state) != nil || !state.Success {
		return false, errors.New("Pi could not report the current model.")
	}
	return applyPiContextBudget(dir, append(available.Data.Models, state.Data.Model))
}

func piCompactionSnapshot(agentDir, project string) (map[string]json.RawMessage, error) {
	account, _, err := readPiSettingsJSON(agentDir)
	if err != nil {
		return nil, err
	}
	local, _, err := readPiSettingsJSON(filepath.Join(project, ".pi"))
	if err != nil {
		return nil, err
	}
	a, err := piSettingsObject(account, "compaction")
	if err != nil {
		return nil, err
	}
	b, err := piSettingsObject(local, "compaction")
	if err != nil {
		return nil, err
	}
	return mergePiSettings(a, b), nil
}

func mergePiSettings(base, overlay map[string]json.RawMessage) map[string]json.RawMessage {
	for key, raw := range overlay {
		var left, right map[string]json.RawMessage
		if json.Unmarshal(base[key], &left) == nil && left != nil && json.Unmarshal(raw, &right) == nil && right != nil {
			base[key], _ = json.Marshal(mergePiSettings(left, right))
		} else {
			base[key] = raw
		}
	}
	return base
}

func (p *piProcess) contextBudgetStats(ctx context.Context, result json.RawMessage) json.RawMessage {
	if p.compactionSettings == nil {
		return result
	}
	raw, err := p.command(ctx, map[string]any{"type": "get_state"})
	if err != nil {
		return result
	}
	var state struct {
		Success bool `json:"success"`
		Data    struct {
			Model piContextModel `json:"model"`
		} `json:"data"`
	}
	var reply map[string]json.RawMessage
	var data map[string]json.RawMessage
	var usage struct {
		ContextWindow int64 `json:"contextWindow"`
	}
	if json.Unmarshal(raw, &state) != nil || !state.Success || json.Unmarshal(result, &reply) != nil || json.Unmarshal(reply["data"], &data) != nil || data == nil || json.Unmarshal(data["contextUsage"], &usage) != nil || usage.ContextWindow < 2 {
		return result
	}
	value, err := piCompactionPoint(p.compactionSettings, state.Data.Model.Provider+"/"+state.Data.Model.ID, usage.ContextWindow)
	if err != nil {
		return result
	}
	data["compaction"], _ = json.Marshal(value)
	reply["data"], _ = json.Marshal(data)
	updated, err := json.Marshal(reply)
	if err != nil {
		return result
	}
	return updated
}

type piCompactionStatus struct {
	Enabled   bool  `json:"enabled"`
	Threshold int64 `json:"threshold"`
}

func piCompactionPoint(settings map[string]json.RawMessage, model string, capacity int64) (piCompactionStatus, error) {
	value := piCompactionStatus{Enabled: true}
	if raw, ok := settings["enabled"]; ok {
		if err := json.Unmarshal(raw, &value.Enabled); err != nil {
			return value, err
		}
	}
	reserve, err := piTokenSetting(settings, "reserveTokens", 16384)
	if err != nil {
		return value, err
	}
	overrides, err := piSettingsObject(settings, "modelOverrides")
	if err != nil {
		return value, err
	}
	matching, err := piSettingsObject(overrides, model)
	if err != nil {
		return value, err
	}
	reserve, err = piTokenSetting(matching, "reserveTokens", reserve)
	value.Threshold = max(0, capacity-reserve)
	return value, err
}
