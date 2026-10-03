// SPDX-License-Identifier: AGPL-3.0-only
package strictjson

import (
	"lumo/plugin/strictjson"
	"net/http"
)

func Decode(w http.ResponseWriter, r *http.Request, maxBytes int64, dst any) error {
	return strictjson.Decode(w, r, maxBytes, dst)
}
func Unmarshal(data []byte, dst any) error { return strictjson.Unmarshal(data, dst) }
