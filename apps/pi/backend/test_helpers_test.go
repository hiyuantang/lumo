// SPDX-License-Identifier: AGPL-3.0-only
package main

import "encoding/json"

type testEnvelope struct {
	OK    bool            `json:"ok"`
	Data  json.RawMessage `json:"data"`
	Error *Error          `json:"error"`
}
