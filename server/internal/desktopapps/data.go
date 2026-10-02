// SPDX-License-Identifier: AGPL-3.0-only
package desktopapps

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
)

const MaxDataBytes = 64 << 10

var ErrDataConflict = errors.New("App data changed in another window. Reload it before saving again.")
var ErrCapability = errors.New("This app does not have that capability.")

type DataSnapshot struct {
	Revision string          `json:"revision"`
	Value    json.RawMessage `json:"value"`
}

func EmptyData() DataSnapshot { return DataSnapshot{Value: json.RawMessage("null")} }
func HasCapability(m Manifest, name string) bool {
	for _, c := range m.Capabilities {
		if c.Name == name {
			return true
		}
	}
	return false
}
func UpdateData(current DataSnapshot, params json.RawMessage) (DataSnapshot, error) {
	var req DataSnapshot
	if strict(params, &req) != nil || len(req.Value) == 0 || len(req.Value) > MaxDataBytes || !json.Valid(req.Value) || (req.Revision != "" && !ValidDigest(req.Revision)) {
		return DataSnapshot{}, ErrInvalid
	}
	if req.Revision != current.Revision {
		return DataSnapshot{}, ErrDataConflict
	}
	req.Revision = Token()
	return req, nil
}
func (s *Store) Data(digest, activation, method string, params json.RawMessage) (DataSnapshot, error) {
	result := EmptyData()
	err := s.locked(func(st *state) error {
		b, e := s.bundle(digest)
		if e != nil {
			return e
		}
		app, ok := st.Apps[b.Manifest.ID]
		if !ok || !app.Enabled || app.Digest != digest || app.Revision != activation || st.Removed[digest] {
			return ErrMissing
		}
		if !HasCapability(b.Manifest, "app.storage") {
			return ErrCapability
		}
		if method != "app.storage.get" && method != "app.storage.set" {
			return ErrInvalid
		}
		if method == "app.storage.get" && len(params) != 0 {
			return ErrInvalid
		}
		dir := filepath.Join(s.Dir, "data", b.Manifest.ID)
		for _, p := range []string{filepath.Join(s.Dir, "data"), dir} {
			if e = os.Mkdir(p, 0700); e != nil && !os.IsExist(e) {
				return e
			}
			info, e := os.Lstat(p)
			if e != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
				return ErrInvalid
			}
		}
		root, e := os.OpenRoot(dir)
		if e != nil {
			return e
		}
		defer root.Close()
		if info, e := root.Lstat("storage.json"); e == nil {
			if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
				return ErrInvalid
			}
			f, e := root.Open("storage.json")
			if e != nil {
				return e
			}
			data, e := io.ReadAll(io.LimitReader(f, MaxDataBytes*6+1024))
			f.Close()
			if e != nil {
				return e
			}
			if strict(data, &result) != nil || !ValidDigest(result.Revision) || len(result.Value) > MaxDataBytes || !json.Valid(result.Value) {
				return ErrInvalid
			}
		} else if !os.IsNotExist(e) {
			return e
		}
		if method == "app.storage.get" {
			return nil
		}
		result, e = UpdateData(result, params)
		if e != nil {
			return e
		}
		var data bytes.Buffer
		encoder := json.NewEncoder(&data)
		encoder.SetEscapeHTML(false)
		if e := encoder.Encode(result); e != nil {
			return e
		}
		return atomicWrite(filepath.Join(dir, "storage.json"), data.Bytes())
	})
	return result, err
}
