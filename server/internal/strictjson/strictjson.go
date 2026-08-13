// SPDX-License-Identifier: AGPL-3.0-only
package strictjson

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
)

var errTrailingValue = errors.New("JSON body must contain exactly one value")

func Decode(w http.ResponseWriter, r *http.Request, maxBytes int64, dst any) error {
	return decode(http.MaxBytesReader(w, r.Body, maxBytes), dst)
}

func Unmarshal(data []byte, dst any) error {
	return decode(bytes.NewReader(data), dst)
}

func decode(reader io.Reader, dst any) error {
	decoder := json.NewDecoder(reader)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dst); err != nil {
		return err
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		if err == nil {
			return errTrailingValue
		}
		return err
	}
	return nil
}
