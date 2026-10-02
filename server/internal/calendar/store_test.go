// SPDX-License-Identifier: AGPL-3.0-only
package calendar

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func testStore(t *testing.T) *Store {
	t.Helper()
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}
func event() Item {
	return Item{CollectionID: "personal", Kind: "event", Title: "Design review", Start: "2026-10-01T09:00:00-04:00", End: "2026-10-01T10:00:00-04:00", TimeZone: "America/New_York", Repeat: "none", Priority: "none"}
}
func stamp(value string) time.Time { t, _ := time.Parse(time.RFC3339, value); return t }
func TestLocalChangesAndPrivateStorage(t *testing.T) {
	home := t.TempDir()
	s, err := Open(home)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	info, err := os.Stat(filepath.Join(home, ".local/share/lumo/calendar/calendar.db"))
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatalf("private storage: %v %v", info, err)
	}
	ctx := context.Background()
	item, err := s.Change(ctx, Change{Action: "save", Item: ptr(event())})
	if err != nil || item.ID == "" {
		t.Fatalf("create: %v", err)
	}
	stale := item
	item.Title = "Updated"
	item, err = s.Change(ctx, Change{Action: "save", Item: &item})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Change(ctx, Change{Action: "save", Item: &stale}); !errors.Is(err, ErrConflict) {
		t.Fatalf("lost edit: %v", err)
	}
	removed, err := s.Change(ctx, Change{Action: "delete", ID: item.ID, Revision: item.Revision})
	if err != nil || !removed.Deleted {
		t.Fatal(err)
	}
	snap, err := s.Snapshot(ctx, stamp("2026-10-01T00:00:00Z"), stamp("2026-10-02T00:00:00Z"))
	if err != nil || len(snap.Items) != 0 {
		t.Fatalf("delete: %v", snap)
	}
	if _, err = s.Change(ctx, Change{Action: "restore", ID: removed.ID, Revision: removed.Revision}); err != nil {
		t.Fatal(err)
	}
	other := testStore(t)
	snap, _ = other.Snapshot(ctx, stamp("2026-10-01T00:00:00Z"), stamp("2026-10-02T00:00:00Z"))
	if len(snap.Items) != 0 {
		t.Fatal("user data leaked")
	}
}
func ptr(item Item) *Item { return &item }
func TestConcurrentAppAndPiWrites(t *testing.T) {
	home := t.TempDir()
	a, err := Open(home)
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	b, err := Open(home)
	if err != nil {
		t.Fatal(err)
	}
	defer b.Close()
	var wg sync.WaitGroup
	for n := 0; n < 24; n++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			s := a
			if n%2 == 1 {
				s = b
			}
			if _, err := s.Change(context.Background(), Change{Action: "save", Item: ptr(event())}); err != nil {
				t.Error(err)
			}
		}(n)
	}
	wg.Wait()
	snap, err := a.Snapshot(context.Background(), stamp("2026-10-01T00:00:00Z"), stamp("2026-10-02T00:00:00Z"))
	if err != nil || len(snap.Items) != 24 {
		t.Fatalf("writes lost: %d %v", len(snap.Items), err)
	}
}
func TestRepeatsKeepWallTimeAndSkipInvalidDates(t *testing.T) {
	item := event()
	item.Start = "2026-03-01T09:00:00-05:00"
	item.End = "2026-03-01T10:00:00-05:00"
	item.Repeat = "weekly"
	item.RepeatUntil = "2026-03-15"
	got := Expand([]Item{item}, stamp("2026-03-01T00:00:00Z"), stamp("2026-04-01T00:00:00Z"))
	if len(got) != 3 || got[1].Start != "2026-03-08T09:00:00-04:00" || got[2].End != "2026-03-15T10:00:00-04:00" {
		t.Fatalf("DST repeat: %+v", got)
	}
	item.Start = "2026-01-31"
	item.End = "2026-02-01"
	item.AllDay = true
	item.Repeat = "monthly"
	item.RepeatUntil = "2026-05-31"
	got = Expand([]Item{item}, stamp("2026-01-01T00:00:00Z"), stamp("2026-06-01T00:00:00Z"))
	if len(got) != 3 || got[1].Start != "2026-03-31" || got[2].End != "2026-06-01" {
		t.Fatalf("month repeat: %+v", got)
	}
}
func TestReminderSuccessorAndNoticeDeduplication(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	item := Item{CollectionID: "reminders", Kind: "reminder", Title: "Take a walk", Due: "2026-10-01T09:00:00-04:00", TimeZone: "America/New_York", Repeat: "daily", RepeatUntil: "2026-10-02", Priority: "high"}
	item, err := s.Change(ctx, Change{Action: "save", Item: &item})
	if err != nil {
		t.Fatal(err)
	}
	now := stamp("2026-10-01T13:01:00Z")
	notices, err := s.Notices(ctx, now)
	if err != nil || len(notices) != 1 {
		t.Fatalf("notice: %+v %v", notices, err)
	}
	notices, _ = s.Notices(ctx, now)
	if len(notices) != 0 {
		t.Fatal("duplicate notice")
	}
	item.Notes = "Edited after reminder"
	item, err = s.Change(ctx, Change{Action: "save", Item: &item})
	if err != nil {
		t.Fatal(err)
	}
	notices, _ = s.Notices(ctx, now)
	if len(notices) != 0 {
		t.Fatal("edit replayed reminder")
	}
	for n := 0; n < 3; n++ {
		item, err = s.Change(ctx, Change{Action: "complete", ID: item.ID, Revision: item.Revision})
		if err != nil {
			t.Fatal(err)
		}
	}
	snap, _ := s.Snapshot(ctx, now, now.Add(72*time.Hour))
	if len(snap.Items) != 2 {
		t.Fatalf("duplicate successor: %d", len(snap.Items))
	}
	for _, next := range snap.Items {
		if !next.Completed {
			if next.Due != "2026-10-02T09:00:00-04:00" {
				t.Fatal(next.Due)
			}
			if _, err = s.Change(ctx, Change{Action: "complete", ID: next.ID, Revision: next.Revision}); err != nil {
				t.Fatal(err)
			}
		}
	}
	snap, _ = s.Snapshot(ctx, now, now.Add(72*time.Hour))
	if len(snap.Items) != 2 {
		t.Fatal("ignored repeat end")
	}
}
func TestInvalidDatesAndRanges(t *testing.T) {
	item := event()
	item.End = item.Start
	if Validate(item) == nil {
		t.Fatal("accepted zero duration")
	}
	item = event()
	item.TimeZone = "not-a-zone"
	if Validate(item) == nil {
		t.Fatal("accepted invalid zone")
	}
	s := testStore(t)
	if _, err := s.Snapshot(context.Background(), time.Now(), time.Now().Add(371*24*time.Hour)); err == nil {
		t.Fatal("unbounded range")
	}
}
func TestDateOnlyReminderUsesNineLocalAfterDST(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	item := Item{CollectionID: "reminders", Kind: "reminder", Title: "Morning reminder", Due: "2026-11-01", TimeZone: "America/New_York", Repeat: "none", Priority: "none"}
	if _, err := s.Change(ctx, Change{Action: "save", Item: &item}); err != nil {
		t.Fatal(err)
	}
	notices, err := s.Notices(ctx, stamp("2026-11-01T13:30:00Z"))
	if err != nil || len(notices) != 0 {
		t.Fatal("date-only reminder fired before 09:00 local", err)
	}
	notices, err = s.Notices(ctx, stamp("2026-11-01T14:01:00Z"))
	if err != nil || len(notices) != 1 {
		t.Fatal("date-only reminder missed 09:00 local", err)
	}
}
