// SPDX-License-Identifier: AGPL-3.0-only
package httpapi

import (
	"context"
	_ "embed"
	"encoding/json"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"lumo/server/internal/strictjson"
)

//go:embed pi_model_images.mjs
var piModelImagesExtension string

const piImageCodecVersion = "0.35.4"

type piImageSettings struct {
	Mode     string `json:"mode"`
	Revision string `json:"revision"`
}

func validPiImageMode(mode string) bool {
	return mode == "original" || mode == "quality90"
}

func readPiImageSettings(dir string) (piImageSettings, error) {
	settings, _, err := readPiSettingsJSON(dir)
	value := piImageSettings{Mode: "original", Revision: piSettingsRevision(dir, settings, "lumoImageQuality")}
	if err != nil {
		return value, err
	}
	if raw, exists := settings["lumoImageQuality"]; exists {
		var mode *string
		if json.Unmarshal(raw, &mode) != nil || mode == nil || !validPiImageMode(*mode) {
			return value, NewError(CodeValidationFailed, "Choose Quality 90 or Original in Pi image settings.")
		}
		value.Mode = *mode
	}
	return value, nil
}

func (s *Server) preparePiImageCodec(ctx context.Context) error {
	anchor := filepath.Join(s.pi.home, ".local/share/lumo/pi/lib/package.json")
	check := `const {createRequire}=require('node:module'); const sharp=createRequire(process.argv[1])('sharp'); if(sharp.versions.sharp!==process.argv[2]||!sharp.format.webp.output.buffer) process.exit(1);`
	node, err := exec.LookPath("node")
	if err != nil {
		return NewError(CodeValidationFailed, "Install Node.js with npm on the server to use Quality 90.")
	}
	if _, err := s.pi.run(ctx, node, "-e", check, anchor, piImageCodecVersion); err == nil {
		return nil
	}
	npm, err := exec.LookPath("npm")
	if err != nil {
		return NewError(CodeValidationFailed, "Install npm on the server to use Quality 90.")
	}
	if _, err := s.pi.run(ctx, npm, "install", "--global", "--ignore-scripts", "--no-audit", "--no-fund", "--prefix", filepath.Join(s.pi.home, ".local/share/lumo/pi"), "sharp@"+piImageCodecVersion); err != nil {
		return NewError(CodeValidationFailed, "Could not prepare image compression. Your image setting was kept. Check the server's connection and try again.")
	}
	if _, err := s.pi.run(ctx, node, "-e", check, anchor, piImageCodecVersion); err != nil {
		return NewError(CodeValidationFailed, "Image compression is unavailable. Your image setting was kept.")
	}
	return nil
}

func (s *Server) handlePiImageSettings(w http.ResponseWriter, r *http.Request) {
	dir, err := s.piAgentDir()
	if err != nil {
		WriteError(w, err)
		return
	}
	if r.Method == http.MethodGet {
		value, err := readPiImageSettings(dir)
		if err != nil {
			WriteError(w, err)
			return
		}
		WriteData(w, value)
		return
	}
	var req struct {
		Mode      string `json:"mode"`
		Revision  string `json:"revision"`
		RequestID string `json:"requestId"`
	}
	if strictjson.Decode(w, r, maxBodyBytes, &req) != nil || !validRequestID(req.RequestID) || !validPiImageMode(req.Mode) {
		WriteError(w, NewError(CodeValidationFailed, "Choose Quality 90 or Original."))
		return
	}
	s.mutate(w, req.RequestID, func(w http.ResponseWriter) {
		s.pi.operation.Lock()
		defer s.pi.operation.Unlock()
		settings, _, err := readPiSettingsJSON(dir)
		if err != nil {
			WriteError(w, err)
			return
		}
		if piSettingsRevision(dir, settings, "lumoImageQuality") != req.Revision {
			WriteError(w, NewError(CodeConflict, "Pi settings changed on the server. Reload before saving."))
			return
		}
		if req.Mode == "quality90" {
			ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
			defer cancel()
			if err := s.preparePiImageCodec(ctx); err != nil {
				WriteError(w, err)
				return
			}
			settings, _, err = readPiSettingsJSON(dir)
			if err != nil {
				WriteError(w, err)
				return
			}
			if piSettingsRevision(dir, settings, "lumoImageQuality") != req.Revision {
				WriteError(w, NewError(CodeConflict, "Pi settings changed on the server. Reload before saving."))
				return
			}
		}
		settings["lumoImageQuality"], _ = json.Marshal(req.Mode)
		if err := writePiSettingsJSON(dir, settings); err != nil {
			WriteError(w, err)
			return
		}
		value, err := readPiImageSettings(dir)
		if err != nil {
			WriteError(w, err)
			return
		}
		WriteData(w, value)
	})
}

func writePiModelImagesExtension(dir, agentDir, home string) (string, error) {
	source := strings.Replace(piModelImagesExtension, "const settingsPath = '';", "const settingsPath = "+strconv.Quote(filepath.Join(agentDir, "settings.json"))+";", 1)
	source = strings.Replace(source, "const codecAnchor = '';", "const codecAnchor = "+strconv.Quote(filepath.Join(home, ".local/share/lumo/pi/lib/package.json"))+";", 1)
	file, err := os.CreateTemp(dir, ".lumo-model-images-*.mjs")
	if err != nil {
		return "", err
	}
	defer os.Remove(file.Name())
	_, err = file.WriteString(source)
	closeErr := file.Close()
	if err != nil {
		return "", err
	}
	if closeErr != nil {
		return "", closeErr
	}
	path := filepath.Join(dir, ".lumo-model-images.mjs")
	return path, os.Rename(file.Name(), path)
}
