// SPDX-License-Identifier: AGPL-3.0-only
package httpapi

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"lumo/server/internal/desktopapps"
	"lumo/server/internal/strictjson"
)

//go:embed lumo_use.mjs
var lumoUseExtension string

const desktopPrefix = "Lumo Use: "

type piDesktopRequest struct {
	ID        string `json:"id"`
	Action    string `json:"action"`
	Target    string `json:"target,omitempty"`
	Label     string `json:"label,omitempty"`
	Text      string `json:"text,omitempty"`
	Key       string `json:"key,omitempty"`
	DeltaX    int    `json:"deltaX,omitempty"`
	DeltaY    int    `json:"deltaY,omitempty"`
	Width     *int   `json:"width,omitempty"`
	Height    *int   `json:"height,omitempty"`
	ExpiresAt int64  `json:"expiresAt"`
	claimed   bool
}

func validDesktopRequest(req piDesktopRequest) bool {
	if len(req.Label) > 600 || len(req.Target) > 80 || len(req.Text) > 16000 || len(req.Key) > 20 || req.DeltaX < -2000 || req.DeltaX > 2000 || req.DeltaY < -2000 || req.DeltaY > 2000 {
		return false
	}
	if req.Action == "resize" {
		return req.Target != "" && req.Label != "" && req.Width != nil && req.Height != nil && *req.Width >= 1 && *req.Width <= 8192 && *req.Height >= 1 && *req.Height <= 8192 && req.DeltaX == 0 && req.DeltaY == 0 && req.Text == "" && req.Key == ""
	}
	if req.Width != nil || req.Height != nil {
		return false
	}
	switch req.Action {
	case "app_preview":
		return desktopapps.ValidDigest(req.Target) && req.Label != "" && req.Text == "" && req.Key == "" && req.DeltaX == 0 && req.DeltaY == 0
	case "observe":
		return req.Target == "" && req.Label == "" && req.Text == "" && req.Key == "" && req.DeltaX == 0 && req.DeltaY == 0
	case "click", "double_click", "fill", "press", "scroll", "drag":
		return req.Target != "" && req.Label != ""
	}
	return false
}

func writeLumoUseExtension(dir string) (string, error) {
	file, err := os.CreateTemp(dir, ".lumo-use-*.mjs")
	if err != nil {
		return "", err
	}
	defer os.Remove(file.Name())
	_, err = file.WriteString(lumoUseExtension)
	closeErr := file.Close()
	if err != nil {
		return "", err
	}
	if closeErr != nil {
		return "", closeErr
	}
	path := filepath.Join(dir, ".lumo-use.mjs")
	return path, os.Rename(file.Name(), path)
}

func (p *piProcess) trackDesktop(kind string, raw json.RawMessage) {
	if kind == "agent_settled" {
		p.desktop = nil
		return
	}
	if kind != "extension_ui_request" {
		return
	}
	var dialog struct {
		ID     string `json:"id"`
		Method string `json:"method"`
		Title  string `json:"title"`
	}
	if json.Unmarshal(raw, &dialog) != nil || dialog.Method != "input" || !strings.HasPrefix(dialog.Title, desktopPrefix) {
		return
	}
	req := piDesktopRequest{}
	decoder := json.NewDecoder(bytes.NewBufferString(strings.TrimPrefix(dialog.Title, desktopPrefix)))
	decoder.DisallowUnknownFields()
	if len(dialog.Title) > 20000 || decoder.Decode(&req) != nil || !validDesktopRequest(req) || dialog.ID == "" || !p.desktopEnabled || p.desktopClient == "" {
		if p.input != nil {
			go p.cancelDesktopDialog(dialog.ID)
		}
		return
	}
	if p.permissionMode == "read-only" && req.Action != "observe" {
		if p.input != nil {
			go p.cancelDesktopDialog(dialog.ID)
		}
		return
	}
	if len(p.desktop) >= 4 {
		if p.input != nil {
			go p.cancelDesktopDialog(dialog.ID)
		}
		return
	}
	for _, existing := range p.desktop {
		if existing.ID == dialog.ID {
			return
		}
	}
	req.ID = dialog.ID
	req.ExpiresAt = time.Now().Add(30 * time.Second).UnixMilli()
	p.desktop = append(p.desktop, req)
}

func (p *piProcess) cancelDesktopDialog(id string) {
	p.write.Lock()
	defer p.write.Unlock()
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.closed || p.input == nil {
		return
	}
	raw, _ := json.Marshal(map[string]any{"type": "extension_ui_response", "id": id, "cancelled": true})
	_, _ = p.input.Write(append(raw, '\n'))
}

func (p *piProcess) activeDesktop(client string) []piDesktopRequest {
	result := []piDesktopRequest{}
	if p.closed || !p.desktopEnabled || client == "" || client != p.desktopClient {
		return result
	}
	for _, req := range p.desktop {
		if !req.claimed && req.ExpiresAt > time.Now().UnixMilli() {
			result = append(result, req)
		}
	}
	return result
}

func (p *piProcess) disableDesktop() {
	p.write.Lock()
	defer p.write.Unlock()
	p.mu.Lock()
	defer p.mu.Unlock()
	p.desktopEnabled = false
	for _, req := range p.desktop {
		raw, _ := json.Marshal(map[string]any{"type": "extension_ui_response", "id": req.ID, "cancelled": true})
		if p.input != nil {
			_, _ = p.input.Write(append(raw, '\n'))
		}
	}
	p.desktop = nil
	select {
	case p.wake <- struct{}{}:
	default:
	}
}

func (s *Server) handlePiDesktop(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RequestID string  `json:"requestId"`
		ID        string  `json:"id"`
		ClientID  string  `json:"clientId"`
		DesktopID string  `json:"desktopId"`
		Text      *string `json:"text,omitempty"`
		Error     bool    `json:"error,omitempty"`
	}
	if strictjson.Decode(w, r, maxBodyBytes, &req) != nil || !validRequestID(req.RequestID) || !validRequestID(req.ClientID) || req.DesktopID == "" || len(req.DesktopID) > 128 {
		WriteError(w, NewError(CodeValidationFailed, "Invalid Lumo Use response."))
		return
	}
	claim := strings.HasSuffix(r.URL.Path, "/claim")
	if claim && (req.Text != nil || req.Error) || !claim && (req.Text == nil || len(*req.Text) > 96000) {
		WriteError(w, NewError(CodeValidationFailed, "Invalid Lumo Use result."))
		return
	}
	p := s.piProcess(req.ID)
	if p == nil {
		WriteError(w, NewError(CodeNotFound, "This Pi chat has stopped."))
		return
	}
	s.mutate(w, req.RequestID, func(w http.ResponseWriter) {
		p.write.Lock()
		defer p.write.Unlock()
		p.mu.Lock()
		defer p.mu.Unlock()
		if p.closed || !p.desktopEnabled || p.desktopClient != req.ClientID {
			WriteError(w, NewError(CodeConflict, "Lumo Use is unavailable in this tab."))
			return
		}
		index := -1
		for i, pending := range p.desktop {
			if pending.ID == req.DesktopID && pending.ExpiresAt > time.Now().UnixMilli() {
				index = i
				break
			}
		}
		if index < 0 {
			WriteError(w, NewError(CodeConflict, "This Lumo Use request is no longer active."))
			return
		}
		pending := &p.desktop[index]
		if p.permissionMode == "read-only" && pending.Action != "observe" {
			WriteError(w, NewError(CodeConflict, "Read only mode allows observation."))
			return
		}
		if claim {
			if pending.claimed {
				WriteError(w, NewError(CodeConflict, "This Lumo Use request was already claimed. Observe again before retrying."))
				return
			}
			pending.claimed = true
			WriteData(w, pending)
			return
		}
		if !pending.claimed {
			WriteError(w, NewError(CodeConflict, "Claim this Lumo Use request first."))
			return
		}
		value, _ := json.Marshal(map[string]any{"text": *req.Text, "error": req.Error})
		if len(value) > 96000 {
			WriteError(w, NewError(CodeValidationFailed, "Lumo Use result is too large."))
			return
		}
		raw, _ := json.Marshal(map[string]any{"type": "extension_ui_response", "id": req.DesktopID, "value": string(value)})
		if p.input == nil {
			WriteError(w, errors.New("Pi is unavailable."))
			return
		}
		if _, err := p.input.Write(append(raw, '\n')); err != nil {
			WriteError(w, err)
			return
		}
		p.desktop = append(p.desktop[:index], p.desktop[index+1:]...)
		p.touched = time.Now()
		select {
		case p.wake <- struct{}{}:
		default:
		}
		WriteData(w, map[string]bool{"accepted": true})
	})
}
