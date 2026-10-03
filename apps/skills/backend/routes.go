// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"errors"
	. "lumo/plugin"
	"net/http"
	"os"

	"lumo/apps/skills/backend/skills"
)

func (s *Server) handleSkills(w http.ResponseWriter, r *http.Request) {
	home, err := os.UserHomeDir()
	if err != nil {
		WriteError(w, err)
		return
	}
	if r.URL.Path == "/api/v1/skills/detail" {
		result, err := skills.Read(home, r.URL.Query().Get("id"))
		if errors.Is(err, os.ErrInvalid) {
			err = NewError(CodeValidationFailed, "Choose a skill from the account skills folder.")
		}
		if err != nil {
			WriteError(w, err)
			return
		}
		WriteData(w, result)
		return
	}
	result, err := skills.List(home)
	if err != nil {
		WriteError(w, err)
		return
	}
	WriteData(w, result)
}
