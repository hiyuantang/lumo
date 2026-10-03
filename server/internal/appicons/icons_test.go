// SPDX-License-Identifier: AGPL-3.0-only
package appicons

import (
	"bytes"
	"encoding/base64"
	"image"
	"image/png"
	"testing"
)

func TestValidateAndResolve(t *testing.T) {
	var imageBytes bytes.Buffer
	png.Encode(&imageBytes, image.NewNRGBA(image.Rect(0, 0, 32, 32)))
	good := Prefix + base64.StdEncoding.EncodeToString(imageBytes.Bytes())
	if err := Validate(good); err != nil {
		t.Fatal(err)
	}
	resolved, err := Resolve("assets/icon.png", func(path string, limit int64) ([]byte, error) {
		if path != "assets/icon.png" || limit != MaxBytes {
			t.Fatal(path, limit)
		}
		return imageBytes.Bytes(), nil
	})
	if err != nil || resolved != good {
		t.Fatal(err)
	}
	var large bytes.Buffer
	png.Encode(&large, image.NewNRGBA(image.Rect(0, 0, 257, 32)))
	for _, bad := range []string{"https://example.test/icon.png", "data:image/svg+xml,<svg/>", Prefix + "AAAA", good[:len(good)-12], Prefix + base64.StdEncoding.EncodeToString(large.Bytes())} {
		if Validate(bad) == nil {
			t.Fatal("invalid image accepted", bad[:20])
		}
	}
}
