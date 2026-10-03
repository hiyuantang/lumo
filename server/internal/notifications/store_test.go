// SPDX-License-Identifier: AGPL-3.0-only
package notifications

import (
	"errors"
	"fmt"
	"sync"
	"testing"
)

func TestPersistenceIsolationAndIdempotency(t *testing.T) {
	home := t.TempDir()
	store := Store{Home: home}
	message := Message{RequestID: "export-001", Title: "Export ready", Body: "Saved"}
	first, err := store.Send("plugin:export", "Export", message)
	if err != nil {
		t.Fatal(err)
	}
	again, err := (Store{Home: home}).Send("plugin:export", "Export", message)
	if err != nil || first.ID != again.ID {
		t.Fatal("duplicate delivery", err)
	}
	changed := message
	changed.Body = "Changed"
	if _, err = store.Send("plugin:export", "Export", changed); !errors.Is(err, ErrConflict) {
		t.Fatal(err)
	}
	other, err := (Store{Home: t.TempDir()}).List()
	if err != nil || len(other) != 0 {
		t.Fatal("account leak", err)
	}
	if err = store.Change("read", []string{first.ID}); err != nil {
		t.Fatal(err)
	}
	items, err := (Store{Home: home}).List()
	if err != nil || len(items) != 1 || !items[0].Read {
		t.Fatal(items, err)
	}
	if err = store.Change("dismiss", []string{first.ID}); err != nil {
		t.Fatal(err)
	}
	if _, err = store.Send("plugin:export", "Export", message); err != nil {
		t.Fatal(err)
	}
	items, err = store.List()
	if err != nil || len(items) != 0 {
		t.Fatal("dismissed replay resurfaced", items, err)
	}
}
func TestConcurrentWritersLimitsAndExactReadIDs(t *testing.T) {
	store := Store{Home: t.TempDir()}
	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			if _, err := store.Send("app:local.notes", "Notes", Message{RequestID: fmt.Sprintf("event-%03d", i), Title: "Saved"}); err != nil {
				t.Error(err)
			}
		}(i)
	}
	wg.Wait()
	items, err := store.List()
	if err != nil || len(items) != 10 {
		t.Fatal(items, err)
	}
	if _, err = store.Send("app:local.notes", "Notes", Message{RequestID: "event-011", Title: "Saved"}); !errors.Is(err, ErrBusy) {
		t.Fatal(err)
	}
	fresh, err := store.Send("plugin:other", "Other", Message{RequestID: "event-012", Title: "Other app"})
	if err != nil {
		t.Fatal(err)
	}
	if err = store.Change("read", []string{items[0].ID}); err != nil {
		t.Fatal(err)
	}
	items, err = store.List()
	for _, item := range items {
		if item.ID == fresh.ID && item.Read {
			t.Fatal("read message arriving after selection")
		}
	}
	if _, err = store.Send("plugin:other", "Other", Message{RequestID: "short", Title: ""}); !errors.Is(err, ErrInvalid) {
		t.Fatal(err)
	}
}
