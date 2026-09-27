// SPDX-License-Identifier: AGPL-3.0-only
package httpapi

import (
	"errors"
	"net/http"
	"os"

	"lumo/server/internal/skills"
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
