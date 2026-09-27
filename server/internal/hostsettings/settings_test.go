// SPDX-License-Identifier: AGPL-3.0-only
package hostsettings

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func ptr[T any](value T) *T { return &value }

type fakeBackend struct {
	values    Values
	canNTP    bool
	calls     int
	failRead  bool
	failSet   bool
	failAfter bool
	ignoreSet bool
}

func (f *fakeBackend) Snapshot(context.Context) (Snapshot, error) {
	if f.failRead || (f.failAfter && f.calls > 0) {
		return Snapshot{}, errors.New("read failed")
	}
	return Snapshot{Values: f.values, CanNTP: f.canNTP, Revision: Revision(f.values)}, nil
}

func (f *fakeBackend) Timezones(context.Context) ([]string, error) {
	return []string{"Etc/UTC", "America/New_York"}, nil
}

func (f *fakeBackend) Set(_ context.Context, change Change) error {
	f.calls++
	if f.failSet {
		return errors.New("write failed")
	}
	if f.ignoreSet {
		return nil
	}
	if change.Timezone != nil {
		f.values.Timezone = *change.Timezone
	}
	if change.NTP != nil {
		f.values.NTP = *change.NTP
	}
	return nil
}

func TestValidateChange(t *testing.T) {
	valid := []Change{{Timezone: ptr("America/New_York")}, {Timezone: ptr("Etc/GMT+5")}, {NTP: ptr(false)}}
	for _, change := range valid {
		if err := change.Validate(); err != nil {
			t.Fatalf("valid change rejected: %v", err)
		}
	}
	invalid := []Change{{}, {Timezone: ptr("")}, {Timezone: ptr("Etc/UTC; reboot")}, {Timezone: ptr(strings.Repeat("a", 129))}, {Timezone: ptr("../etc/passwd")}, {Timezone: ptr("America//New_York")}, {NTP: ptr(false), Timezone: ptr("Etc/UTC")}}
	for _, change := range invalid {
		if !errors.Is(change.Validate(), ErrValidation) {
			t.Fatalf("invalid change accepted: %+v", change)
		}
	}
}

func TestApplyReadsAndVerifiesEachSetting(t *testing.T) {
	for _, change := range []Change{{Timezone: ptr("America/New_York")}, {NTP: ptr(false)}} {
		backend := &fakeBackend{values: Values{Hostname: "old-host", Timezone: "Etc/UTC", NTP: true}, canNTP: true}
		controller := &Controller{backend: backend}
		before := Revision(backend.values)
		after, err := controller.Apply(context.Background(), change, before)
		if err != nil || backend.calls != 1 || after.Revision == before || !change.matches(after.Values) {
			t.Fatalf("change=%+v result=%+v calls=%d err=%v", change, after, backend.calls, err)
		}
		if _, err := controller.Apply(context.Background(), change, after.Revision); err != nil || backend.calls != 1 {
			t.Fatal("unchanged settings must be a no-op")
		}
	}
}

func TestApplyRejectsStaleAndUnsupportedChangesWithoutWriting(t *testing.T) {
	backend := &fakeBackend{values: Values{Hostname: "host", Timezone: "Etc/UTC"}}
	controller := &Controller{backend: backend}
	revision := Revision(backend.values)
	backend.values.Timezone = "America/New_York"
	if _, err := controller.Apply(context.Background(), Change{Timezone: ptr("Etc/UTC")}, revision); !errors.Is(err, ErrStale) {
		t.Fatalf("stale: %v", err)
	}
	for _, change := range []Change{{NTP: ptr(true)}, {Timezone: ptr("Missing/Zone")}} {
		if _, err := controller.Apply(context.Background(), change, Revision(backend.values)); !errors.Is(err, ErrValidation) {
			t.Fatalf("unsupported: %v", err)
		}
	}
	if backend.calls != 0 {
		t.Fatal("invalid requests wrote system state")
	}
}

func TestApplyFailsClosedAndDoesNotClaimUnverifiedSuccess(t *testing.T) {
	for _, failure := range []string{"read", "set", "readback", "mismatch"} {
		t.Run(failure, func(t *testing.T) {
			backend := &fakeBackend{values: Values{Timezone: "Etc/UTC"}, failRead: failure == "read", failSet: failure == "set", failAfter: failure == "readback", ignoreSet: failure == "mismatch"}
			controller := &Controller{backend: backend}
			_, err := controller.Apply(context.Background(), Change{Timezone: ptr("America/New_York")}, Revision(backend.values))
			if err == nil {
				t.Fatal("failure reported success")
			}
			if failure == "read" && backend.calls != 0 {
				t.Fatal("failed preflight wrote settings")
			}
			if (failure == "readback" || failure == "mismatch") && !errors.Is(err, ErrVerification) {
				t.Fatal(err)
			}
		})
	}
}

func TestExternalHostnameChangeDoesNotConflictWithTimeEdit(t *testing.T) {
	backend := &fakeBackend{values: Values{Hostname: "old-host", Timezone: "Etc/UTC"}}
	revision := Revision(backend.values)
	backend.values.Hostname = "changed-over-ssh"
	controller := &Controller{backend: backend}
	after, err := controller.Apply(context.Background(), Change{Timezone: ptr("America/New_York")}, revision)
	if err != nil || backend.calls != 1 || after.Hostname != "changed-over-ssh" || after.Timezone != "America/New_York" {
		t.Fatalf("result=%+v calls=%d err=%v", after, backend.calls, err)
	}
}
