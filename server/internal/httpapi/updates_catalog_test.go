// SPDX-License-Identifier: AGPL-3.0-only
package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"lumo/server/internal/updates"
)

type fakePackageCatalog struct {
	err   error
	calls int
}

func (f *fakePackageCatalog) Catalog(ctx context.Context) (updates.Catalog, error) {
	f.calls++
	if _, ok := ctx.Deadline(); !ok {
		return updates.Catalog{}, errors.New("missing read deadline")
	}
	return updates.Catalog{Packages: []updates.InstalledPackage{{Name: "openssl", Version: "1.0", Group: "system", Origin: "Ubuntu", UpdateVersion: "1.1", UpdateGroup: "system", Security: true}}}, f.err
}

func TestInstalledPackageCatalog(t *testing.T) {
	reader := &fakePackageCatalog{}
	handler := NewServer(Deps{Packages: reader}).Handler()
	for _, unavailable := range []bool{false, true} {
		if unavailable {
			reader.err = updates.ErrUnavailable
		}
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/v1/updates/packages", nil))
		var envelope testEnvelope
		if err := json.Unmarshal(recorder.Body.Bytes(), &envelope); err != nil {
			t.Fatal(err)
		}
		if unavailable {
			if recorder.Code != http.StatusServiceUnavailable || envelope.Error == nil || envelope.Error.Code != CodeUnavailable {
				t.Fatalf("unavailable: %d %+v", recorder.Code, envelope)
			}
			continue
		}
		var catalog updates.Catalog
		if err := json.Unmarshal(envelope.Data, &catalog); err != nil {
			t.Fatal(err)
		}
		if recorder.Code != http.StatusOK || !envelope.OK || len(catalog.Packages) != 1 || !catalog.Packages[0].Security || catalog.Packages[0].UpdateVersion != "1.1" {
			t.Fatalf("catalog: %d %+v", recorder.Code, catalog)
		}
	}
	if reader.calls != 2 {
		t.Fatalf("reads=%d", reader.calls)
	}
}
