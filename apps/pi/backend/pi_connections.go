// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type piConnection struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Credential string `json:"credential"`
	KeyPreview string `json:"keyPreview,omitempty"`
}

func (s *Server) readPiConnections() ([]piConnection, error) {
	connections := []piConnection{}
	dir, err := s.piAgentDir()
	if err != nil {
		return nil, err
	}
	path := filepath.Join(dir, "auth.json")
	info, err := os.Stat(path)
	if errors.Is(err, os.ErrNotExist) {
		return connections, nil
	}
	if err != nil || !info.Mode().IsRegular() || info.Size() > 1<<20 {
		return nil, NewError(CodeUnavailable, "Could not read saved providers.")
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, NewError(CodeUnavailable, "Could not read saved providers.")
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, (1<<20)+1))
	var entries map[string]json.RawMessage
	if err != nil || len(data) > 1<<20 || json.Unmarshal(data, &entries) != nil || entries == nil {
		return nil, NewError(CodeUnavailable, "Could not read saved providers.")
	}
	names := map[string]string{"anthropic": "Anthropic", "openai": "OpenAI", "google": "Google", "google-gemini-cli": "Google Gemini CLI", "google-antigravity": "Google Antigravity", "github-copilot": "GitHub Copilot", "deepseek": "DeepSeek", "openrouter": "OpenRouter", "xai": "xAI", "mistral": "Mistral", "groq": "Groq", "cerebras": "Cerebras"}
	for id, raw := range entries {
		var entry struct {
			Type string          `json:"type"`
			Key  json.RawMessage `json:"key"`
		}
		if id == "" || json.Unmarshal(raw, &entry) != nil || (entry.Type != "api_key" && entry.Type != "oauth") {
			continue
		}
		name := names[id]
		if name == "" {
			name = id
		}
		item := piConnection{ID: id, Name: name, Credential: entry.Type}
		if entry.Type == "api_key" {
			if len(entry.Key) == 0 || string(entry.Key) == "null" {
				continue
			}
			var key string
			if json.Unmarshal(entry.Key, &key) == nil {
				if key == "" {
					continue
				}
				item.KeyPreview = "••••"
				chars := []rune(key)
				if len(chars) > 8 && !strings.ContainsAny(key, " \t\r\n") && !strings.HasPrefix(key, "!") && !strings.HasPrefix(key, "$") {
					item.KeyPreview += string(chars[len(chars)-4:])
				}
			}
		}
		connections = append(connections, item)
	}
	sort.Slice(connections, func(i, j int) bool {
		return strings.ToLower(connections[i].Name) < strings.ToLower(connections[j].Name)
	})
	return connections, nil
}

func (s *Server) handlePiConnections(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	connections, err := s.readPiConnections()
	if err != nil {
		WriteError(w, err)
		return
	}
	WriteData(w, struct {
		Providers []piConnection `json:"providers"`
	}{Providers: connections})
}
