// SPDX-License-Identifier: AGPL-3.0-only
package files

import (
	"encoding/base64"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

const MaxImageBytes = 32 << 20

func ReadImage(p string) (ReadResult, error) {
	clean, err := cleanPath(p)
	if err != nil {
		return ReadResult{}, err
	}
	switch strings.ToLower(filepath.Ext(clean)) {
	case ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".bmp", ".ico":
	default:
		return ReadResult{}, fmt.Errorf("%w: unsupported image format", ErrValidation)
	}
	real, err := resolve(clean)
	if err != nil {
		return ReadResult{}, err
	}
	info, err := os.Stat(real)
	if err != nil {
		return ReadResult{}, err
	}
	if !info.Mode().IsRegular() {
		return ReadResult{}, fmt.Errorf("%w: path is not a regular file", ErrValidation)
	}
	f, err := os.Open(real)
	if err != nil {
		return ReadResult{}, err
	}
	defer f.Close()
	info, err = f.Stat()
	if err != nil {
		return ReadResult{}, err
	}
	if !info.Mode().IsRegular() {
		return ReadResult{}, fmt.Errorf("%w: path is not a regular file", ErrValidation)
	}
	res := ReadResult{Path: clean, SizeBytes: info.Size(), Encoding: "binary"}
	if info.Size() > MaxImageBytes {
		res.Truncated = true
		return res, nil
	}
	data, err := io.ReadAll(io.LimitReader(f, MaxImageBytes+1))
	if err != nil {
		return ReadResult{}, err
	}
	if len(data) > MaxImageBytes {
		res.Truncated = true
		return res, nil
	}
	content := base64.StdEncoding.EncodeToString(data)
	res.Content = &content
	return res, nil
}
