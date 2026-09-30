// SPDX-License-Identifier: AGPL-3.0-only
package httpapi

import (
	"encoding/base64"
	"lumo/server/internal/strictjson"
	"net/http"
	"os"
	"path/filepath"
)

func (s *Server) handlePiImage(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Content   string `json:"content"`
		RequestID string `json:"requestId"`
	}
	if strictjson.Decode(w, r, maxWriteBodyBytes, &req) != nil || !validRequestID(req.RequestID) {
		WriteError(w, NewError(CodeValidationFailed, "Choose an image up to 8 MiB."))
		return
	}
	data, err := base64.StdEncoding.DecodeString(req.Content)
	if err != nil || len(data) == 0 || len(data) > 8<<20 {
		WriteError(w, NewError(CodeValidationFailed, "Choose an image up to 8 MiB."))
		return
	}
	suffix := map[string]string{"image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp"}[http.DetectContentType(data)]
	if suffix == "" {
		WriteError(w, NewError(CodeValidationFailed, "Use a PNG, JPEG, GIF or WebP image."))
		return
	}
	s.mutate(w, req.RequestID, func(w http.ResponseWriter) {
		dir := filepath.Join(s.pi.home, ".local/state/lumo/pi-attachments")
		if err := os.MkdirAll(dir, 0700); err != nil {
			WriteError(w, err)
			return
		}
		f, err := os.CreateTemp(dir, "image-*"+suffix)
		if err != nil {
			WriteError(w, err)
			return
		}
		_, err = f.Write(data)
		closeErr := f.Close()
		if err == nil {
			err = closeErr
		}
		if err != nil {
			os.Remove(f.Name())
			WriteError(w, err)
			return
		}
		WriteData(w, map[string]string{"path": f.Name()})
	})
}
