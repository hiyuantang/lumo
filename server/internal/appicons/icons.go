// SPDX-License-Identifier: AGPL-3.0-only
package appicons

import (
	"bytes"
	"encoding/base64"
	"errors"
	"image/png"
	"strings"
)

const MaxBytes = 32768
const Prefix = "data:image/png;base64,"

func Validate(value string) error {
	if value == "" {
		return nil
	}
	if !strings.HasPrefix(value, Prefix) || len(value) > len(Prefix)+base64.StdEncoding.EncodedLen(MaxBytes) {
		return errors.New("iconImage must be an embedded PNG up to 32 KiB")
	}
	raw, err := base64.StdEncoding.Strict().DecodeString(strings.TrimPrefix(value, Prefix))
	if err != nil {
		return err
	}
	if len(raw) > MaxBytes {
		return errors.New("Keep the PNG icon under 32 KiB")
	}
	config, err := png.DecodeConfig(bytes.NewReader(raw))
	if err != nil {
		return err
	}
	if config.Width < 16 || config.Height < 16 || config.Width > 256 || config.Height > 256 {
		return errors.New("Use a PNG icon between 16 and 256 pixels on each side")
	}
	_, err = png.Decode(bytes.NewReader(raw))
	return err
}
func Resolve(value string, read func(string, int64) ([]byte, error)) (string, error) {
	if value != "" && !strings.HasPrefix(value, "data:") {
		if !strings.HasPrefix(value, "assets/") || !strings.HasSuffix(value, ".png") {
			return "", errors.New("Put the icon in assets/icon.png")
		}
		raw, err := read(value, MaxBytes)
		if err != nil {
			return "", err
		}
		value = Prefix + base64.StdEncoding.EncodeToString(raw)
	}
	return value, Validate(value)
}
