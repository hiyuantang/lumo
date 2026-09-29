// SPDX-License-Identifier: AGPL-3.0-only
package httpapi

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"lumo/server/internal/strictjson"
)

type piCompaction struct {
	UsageBudget             *piContextBudget `json:"usageBudget,omitempty"`
	Model                   string           `json:"model"`
	Enabled                 bool             `json:"enabled"`
	ReserveTokens           int64            `json:"reserveTokens"`
	KeepRecentTokens        int64            `json:"keepRecentTokens"`
	DefaultReserveTokens    int64            `json:"defaultReserveTokens"`
	DefaultKeepRecentTokens int64            `json:"defaultKeepRecentTokens"`
	Customized              bool             `json:"customized"`
	Revision                string           `json:"revision"`
}

func readPiSettingsJSON(dir string) (map[string]json.RawMessage, string, error) {
	path := filepath.Join(dir, "settings.json")
	result := map[string]json.RawMessage{}
	var data []byte
	info, err := os.Lstat(path)
	if err == nil {
		if !info.Mode().IsRegular() {
			return nil, "", errors.New("Pi settings must be a regular file. Existing settings were preserved.")
		}
		f, err := os.Open(path)
		if err != nil {
			return nil, "", err
		}
		data, err = io.ReadAll(io.LimitReader(f, (1<<20)+1))
		f.Close()
		if err != nil {
			return nil, "", err
		}
		if len(data) > 1<<20 || json.Unmarshal(data, &result) != nil || result == nil {
			return nil, "", errors.New("Pi settings could not be read. Existing settings were preserved.")
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, "", err
	}
	hash := sha256.Sum256(append([]byte(path+"\x00"), data...))
	return result, "sha256:" + hex.EncodeToString(hash[:]), nil
}

func writePiSettingsJSON(dir string, settings map[string]json.RawMessage) error {
	data, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return err
	}
	if len(data)+1 > 1<<20 {
		return errors.New("Pi settings must be no larger than 1 MiB.")
	}
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	f, err := os.CreateTemp(dir, ".lumo-pi-settings-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if _, err = f.Write(append(data, '\n')); err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(f.Name(), filepath.Join(dir, "settings.json"))
}

func piSettingsObject(parent map[string]json.RawMessage, key string) (map[string]json.RawMessage, error) {
	result := map[string]json.RawMessage{}
	if raw, ok := parent[key]; ok && (json.Unmarshal(raw, &result) != nil || result == nil) {
		return nil, errors.New("Pi's compaction settings are invalid. Correct them in settings.json before saving.")
	}
	return result, nil
}

func piTokenSetting(object map[string]json.RawMessage, key string, fallback int64) (int64, error) {
	if raw, ok := object[key]; ok {
		var value *int64
		if json.Unmarshal(raw, &value) != nil || value == nil || *value < 0 || *value > 9007199254740991 {
			return 0, errors.New("Compaction token budgets must be non-negative safe integers.")
		}
		return *value, nil
	}
	return fallback, nil
}

func readPiCompaction(dir, model string) (piCompaction, error) {
	value := piCompaction{Model: model, Enabled: true}
	settings, revision, err := readPiSettingsJSON(dir)
	if err != nil {
		return value, err
	}
	value.UsageBudget, err = readPiContextBudget(settings)
	if err != nil {
		return value, err
	}
	value.Revision = revision
	compaction, err := piSettingsObject(settings, "compaction")
	if err != nil {
		return value, err
	}
	if raw, ok := compaction["enabled"]; ok {
		var enabled *bool
		if json.Unmarshal(raw, &enabled) != nil || enabled == nil {
			return value, errors.New("Pi's automatic compaction setting must be true or false.")
		}
		value.Enabled = *enabled
	}
	value.DefaultReserveTokens, err = piTokenSetting(compaction, "reserveTokens", 16384)
	if err != nil {
		return value, err
	}
	value.DefaultKeepRecentTokens, err = piTokenSetting(compaction, "keepRecentTokens", 20000)
	if err != nil {
		return value, err
	}
	value.ReserveTokens, value.KeepRecentTokens = value.DefaultReserveTokens, value.DefaultKeepRecentTokens
	if model != "" {
		overrides, err := piSettingsObject(compaction, "modelOverrides")
		if err != nil {
			return value, err
		}
		matching, err := piSettingsObject(overrides, model)
		if err != nil {
			return value, err
		}
		_, reserve := matching["reserveTokens"]
		_, keep := matching["keepRecentTokens"]
		value.Customized = reserve || keep
		value.ReserveTokens, err = piTokenSetting(matching, "reserveTokens", value.ReserveTokens)
		if err != nil {
			return value, err
		}
		value.KeepRecentTokens, err = piTokenSetting(matching, "keepRecentTokens", value.KeepRecentTokens)
		if err != nil {
			return value, err
		}
	}
	return value, nil
}

func validPiCompactionModel(model string) bool {
	return model == "" || (len(model) <= 512 && strings.Contains(model, "/") && !strings.HasPrefix(model, "/") && !strings.HasSuffix(model, "/") && !strings.ContainsAny(model, "\x00\r\n"))
}

func (s *Server) handlePiCompaction(w http.ResponseWriter, r *http.Request) {
	dir, err := s.piAgentDir()
	if err != nil {
		WriteError(w, err)
		return
	}
	if r.Method == http.MethodGet {
		model := r.URL.Query().Get("model")
		if !validPiCompactionModel(model) {
			WriteError(w, NewError(CodeValidationFailed, "Choose a valid provider/model ID."))
			return
		}
		value, err := readPiCompaction(dir, model)
		if err != nil {
			WriteError(w, NewError(CodeValidationFailed, err.Error()))
			return
		}
		WriteData(w, value)
		return
	}
	var req struct {
		UsageBudget      *piContextBudget `json:"usageBudget"`
		Model            string           `json:"model"`
		Enabled          *bool            `json:"enabled"`
		ReserveTokens    *int64           `json:"reserveTokens"`
		KeepRecentTokens *int64           `json:"keepRecentTokens"`
		Customized       *bool            `json:"customized"`
		Revision         string           `json:"revision"`
		RequestID        string           `json:"requestId"`
	}
	if strictjson.Decode(w, r, maxBodyBytes, &req) != nil || (req.UsageBudget != nil && (!req.UsageBudget.valid() || req.Model != "")) || !validRequestID(req.RequestID) || !validPiCompactionModel(req.Model) || req.Enabled == nil || req.Customized == nil || req.ReserveTokens == nil || req.KeepRecentTokens == nil || *req.ReserveTokens < 0 || *req.KeepRecentTokens < 0 || *req.ReserveTokens > 9007199254740991 || *req.KeepRecentTokens > 9007199254740991 {
		WriteError(w, NewError(CodeValidationFailed, "Choose automatic compaction and non-negative safe integer token budgets."))
		return
	}
	s.mutate(w, req.RequestID, func(w http.ResponseWriter) {
		s.pi.operation.Lock()
		defer s.pi.operation.Unlock()
		before, err := readPiCompaction(dir, req.Model)
		if err != nil {
			WriteError(w, NewError(CodeValidationFailed, err.Error()))
			return
		}
		if before.Revision != req.Revision {
			WriteError(w, NewError(CodeConflict, "Pi settings changed on the server. Reload before saving."))
			return
		}
		settings, revision, err := readPiSettingsJSON(dir)
		if err != nil {
			WriteError(w, err)
			return
		}
		if revision != before.Revision {
			WriteError(w, NewError(CodeConflict, "Pi settings changed on the server. Reload before saving."))
			return
		}
		compaction, _ := piSettingsObject(settings, "compaction")
		compaction["enabled"], _ = json.Marshal(*req.Enabled)
		target := compaction
		var overrides map[string]json.RawMessage
		if req.Model != "" {
			overrides, err = piSettingsObject(compaction, "modelOverrides")
			if err != nil {
				WriteError(w, err)
				return
			}
			target, err = piSettingsObject(overrides, req.Model)
			if err != nil {
				WriteError(w, err)
				return
			}
		}
		if req.Model == "" || *req.Customized {
			target["reserveTokens"], _ = json.Marshal(*req.ReserveTokens)
			target["keepRecentTokens"], _ = json.Marshal(*req.KeepRecentTokens)
		} else {
			delete(target, "reserveTokens")
			delete(target, "keepRecentTokens")
		}
		if req.Model != "" {
			if len(target) == 0 {
				delete(overrides, req.Model)
			} else {
				overrides[req.Model], _ = json.Marshal(target)
			}
			compaction["modelOverrides"], _ = json.Marshal(overrides)
		}
		if req.UsageBudget != nil {
			if err := clearPiCompactionOverrides(compaction); err != nil {
				WriteError(w, err)
				return
			}
			settings["lumoContextBudget"], _ = json.Marshal(req.UsageBudget)
		} else {
			delete(settings, "lumoContextBudget")
		}
		settings["compaction"], _ = json.Marshal(compaction)
		if err := writePiSettingsJSON(dir, settings); err != nil {
			WriteError(w, err)
			return
		}
		result, err := readPiCompaction(dir, req.Model)
		if err != nil {
			WriteError(w, err)
			return
		}
		WriteData(w, result)
	})
}
