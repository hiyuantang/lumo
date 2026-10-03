// SPDX-License-Identifier: AGPL-3.0-only
package httpapi

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"lumo/server/internal/strictjson"
)

//go:embed pi_questions.mjs
var piQuestionsExtension string

func validPiPermissionMode(mode string) bool {
	return mode == "read-only" || mode == "ask" || mode == "auto"
}

func piToolsForMode(mode string, desktop, appBuilder bool) string {
	tools := "read,grep,find,ls,ask_user"
	if appBuilder {
		tools += ",lumo_app_api,lumo_app_list,lumo_app_status,lumo_plugin_api,lumo_plugin_list,lumo_plugin_validate"
	}
	if mode != "read-only" {
		tools += ",bash,edit,write"
		if appBuilder {
			tools += ",lumo_app_create,lumo_app_build,lumo_app_install,lumo_app_restore,lumo_plugin_create,lumo_plugin_build,lumo_plugin_install,lumo_plugin_restore"
		}
	}
	if desktop {
		tools += ",lumo_observe"
		if mode != "read-only" {
			tools += ",lumo_act"
			if appBuilder {
				tools += ",lumo_app_preview"
			}
		}
	}
	return tools
}

func startManagedPiProcess(ctx context.Context, binary string, args []string, project, home, mode string, desktop ...bool) (*piProcess, error) {
	p, err := startPiProcess(binary, args, project, home)
	if err != nil {
		return nil, err
	}
	timeout := time.NewTimer(15 * time.Second)
	defer timeout.Stop()
	for {
		p.mu.Lock()
		reported := p.permissionMode
		imagesReady := p.modelImagesReady
		desktopReady := p.desktopReady || len(desktop) == 0 || !desktop[0]
		p.mu.Unlock()
		if reported == mode && imagesReady && desktopReady {
			return p, nil
		}
		if reported != "" && reported != mode {
			p.cancel()
			return nil, errors.New("Pi permission mode did not match. Reopen this chat.")
		}
		select {
		case <-p.wake:
		case <-p.done:
			return nil, errors.New("Pi stopped before permission controls were ready.")
		case <-ctx.Done():
			p.cancel()
			return nil, ctx.Err()
		case <-timeout.C:
			p.cancel()
			if reported == mode && imagesReady && !desktopReady {
				return nil, errors.New("Lumo Use could not start. Update Lumo or disable it in Pi settings.")
			}
			if reported == mode {
				return nil, errors.New("Pi image controls could not start. Update Pi and try again.")
			}
			return nil, errors.New("Pi permission controls could not start. Update Pi and try again.")
		}
	}
}

type piQuestion struct {
	ID          string   `json:"id"`
	Method      string   `json:"method"`
	Title       string   `json:"title"`
	Message     string   `json:"message,omitempty"`
	Options     []string `json:"options,omitempty"`
	Placeholder string   `json:"placeholder,omitempty"`
	Prefill     string   `json:"prefill,omitempty"`
	Timeout     int64    `json:"timeout,omitempty"`
	ExpiresAt   int64    `json:"expiresAt,omitempty"`
}

func writePiQuestionsExtension(dir, mode string, questions ...bool) (string, error) {
	return writePiQuestionsWithPlugins(dir, mode, len(questions) == 0 || questions[0], nil)
}
func writePiQuestionsWithPlugins(dir, mode string, questions bool, readTools []string) (string, error) {
	raw, _ := json.Marshal(readTools)
	if readTools == nil {
		raw = []byte("[]")
	}
	file, err := os.CreateTemp(dir, ".lumo-questions-*.mjs")
	if err != nil {
		return "", err
	}
	defer os.Remove(file.Name())
	code := strings.Replace(piQuestionsExtension, "const permissionMode = 'ask';", "const permissionMode = "+strconv.Quote(mode)+";", 1)
	code = strings.Replace(code, "const pluginReadTools = [];", "const pluginReadTools = "+string(raw)+";", 1)
	if !questions {
		code = strings.Replace(code, "const questionsEnabled = true;", "const questionsEnabled = false;", 1)
	}
	_, err = file.WriteString(code)
	closeErr := file.Close()
	if err != nil {
		return "", err
	}
	if closeErr != nil {
		return "", closeErr
	}
	path := filepath.Join(dir, ".lumo-questions-"+mode+".mjs")
	return path, os.Rename(file.Name(), path)
}

func (p *piProcess) activeQuestions() []piQuestion {
	active := make([]piQuestion, 0, len(p.questions))
	for _, question := range p.questions {
		if !p.closed && (question.ExpiresAt == 0 || question.ExpiresAt > time.Now().UnixMilli()) {
			active = append(active, question)
		}
	}
	p.questions = active
	return active
}

func (p *piProcess) trackQuestion(kind string, raw json.RawMessage) {
	if kind == "agent_settled" {
		p.questions = nil
	}
	if kind != "extension_ui_request" {
		return
	}
	var question piQuestion
	if json.Unmarshal(raw, &question) != nil || question.ID == "" || strings.HasPrefix(question.Title, desktopPrefix) {
		return
	}
	switch question.Method {
	case "select", "input", "editor", "confirm":
	default:
		return
	}
	for _, existing := range p.questions {
		if existing.ID == question.ID {
			return
		}
	}
	if question.Timeout > 0 {
		question.ExpiresAt = time.Now().UnixMilli() + question.Timeout
	}
	p.questions = append(p.questions, question)
}

func (s *Server) handlePiAnswer(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RequestID  string  `json:"requestId"`
		ID         string  `json:"id"`
		QuestionID string  `json:"questionId"`
		Value      *string `json:"value,omitempty"`
		Confirmed  *bool   `json:"confirmed,omitempty"`
		Cancelled  bool    `json:"cancelled,omitempty"`
	}
	if err := strictjson.Decode(w, r, maxBodyBytes, &req); err != nil || !validRequestID(req.RequestID) || req.QuestionID == "" {
		WriteError(w, NewError(CodeValidationFailed, "Invalid question response."))
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
		index := -1
		for i, question := range p.activeQuestions() {
			if question.ID == req.QuestionID {
				index = i
				break
			}
		}
		if index < 0 {
			WriteError(w, NewError(CodeConflict, "This question is no longer waiting for an answer."))
			return
		}
		question := p.questions[index]
		response := map[string]any{"type": "extension_ui_response", "id": req.QuestionID}
		valid := false
		if req.Cancelled {
			valid = req.Value == nil && req.Confirmed == nil
			response["cancelled"] = true
		} else if question.Method == "confirm" {
			valid = req.Confirmed != nil && req.Value == nil
			response["confirmed"] = req.Confirmed
		} else {
			valid = req.Value != nil && req.Confirmed == nil && len(*req.Value) <= 10000 && strings.TrimSpace(*req.Value) != ""
			response["value"] = req.Value
		}
		if !valid {
			WriteError(w, NewError(CodeValidationFailed, "Choose an answer or write a response."))
			return
		}
		raw, _ := json.Marshal(response)
		if _, err := p.input.Write(append(raw, '\n')); err != nil {
			WriteError(w, NewError(CodeUnavailable, "Could not send your answer. Try again."))
			return
		}
		p.questions = append(p.questions[:index], p.questions[index+1:]...)
		p.touched = time.Now()
		select {
		case p.wake <- struct{}{}:
		default:
		}
		WriteData(w, map[string]bool{"accepted": true})
	})
}
