// SPDX-License-Identifier: AGPL-3.0-only
package calendar

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

var ErrConflict = errors.New("This item changed. Reload before saving.")
var ErrInvalid = errors.New("Invalid calendar request.")

type Collection struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Color    string `json:"color"`
	Kind     string `json:"kind"`
	Provider string `json:"provider"`
	ReadOnly bool   `json:"readOnly"`
}
type Item struct {
	ID           string   `json:"id"`
	CollectionID string   `json:"collectionId"`
	Kind         string   `json:"kind"`
	Title        string   `json:"title"`
	Notes        string   `json:"notes"`
	Location     string   `json:"location"`
	Start        string   `json:"start"`
	End          string   `json:"end"`
	Due          string   `json:"due"`
	AllDay       bool     `json:"allDay"`
	TimeZone     string   `json:"timeZone"`
	Repeat       string   `json:"repeat"`
	RepeatUntil  string   `json:"repeatUntil"`
	AlertMinutes *int     `json:"alertMinutes"`
	Flagged      bool     `json:"flagged"`
	Priority     string   `json:"priority"`
	Completed    bool     `json:"completed"`
	Revision     string   `json:"revision"`
	Deleted      bool     `json:"deleted"`
	Recurrence   []string `json:"recurrence,omitempty"`
}
type Occurrence struct {
	Item
	OccurrenceID string `json:"occurrenceId"`
}
type Notice struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Body  string `json:"body"`
}
type Snapshot struct {
	Collections []Collection `json:"collections"`
	Items       []Item       `json:"items"`
	Occurrences []Occurrence `json:"occurrences"`
	Google      GoogleStatus `json:"google"`
	GoogleError string       `json:"googleError,omitempty"`
}
type Change struct {
	Action     string      `json:"action"`
	Item       *Item       `json:"item,omitempty"`
	Collection *Collection `json:"collection,omitempty"`
	ID         string      `json:"id,omitempty"`
	Revision   string      `json:"revision,omitempty"`
}
type state struct {
	Collections []Collection      `json:"collections"`
	Items       []Item            `json:"items"`
	Notices     map[string]int64  `json:"notices"`
	Successors  map[string]string `json:"successors"`
}
type Store struct {
	db     *sql.DB
	client GoogleClient
}

func ID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}
func Open(home string) (*Store, error) {
	if !filepath.IsAbs(home) {
		return nil, ErrInvalid
	}
	dir := filepath.Join(home, ".local/share/lumo/calendar")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	path := filepath.Join(dir, "calendar.db")
	file, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	file.Close()
	if err = os.Chmod(path, 0600); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", path+"?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if _, err = db.Exec(`CREATE TABLE IF NOT EXISTS calendar_state (id TEXT PRIMARY KEY, data BLOB NOT NULL)`); err != nil {
		db.Close()
		return nil, err
	}
	initial := state{Collections: []Collection{{"personal", "Personal", "#487ccc", "event", "local", false}, {"work", "Work", "#b183c8", "event", "local", false}, {"reminders", "Reminders", "#c28245", "reminder", "local", false}}, Items: []Item{}, Notices: map[string]int64{}, Successors: map[string]string{}}
	data, _ := json.Marshal(initial)
	if _, err = db.Exec(`INSERT OR IGNORE INTO calendar_state VALUES ('items',?)`, data); err != nil {
		db.Close()
		return nil, err
	}
	return &Store{db: db, client: defaultGoogleClient()}, nil
}
func (s *Store) Close() error { return s.db.Close() }
func (s *Store) read(ctx context.Context) (state, error) {
	var data []byte
	var value state
	err := s.db.QueryRowContext(ctx, `SELECT data FROM calendar_state WHERE id='items'`).Scan(&data)
	if err == nil {
		err = json.Unmarshal(data, &value)
	}
	return value, err
}
func (s *Store) update(ctx context.Context, change func(*state) error) error {
	conn, err := s.db.Conn(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()
	if _, err = conn.ExecContext(ctx, "BEGIN IMMEDIATE"); err != nil {
		return err
	}
	defer conn.ExecContext(context.Background(), "ROLLBACK")
	var data []byte
	if err = conn.QueryRowContext(ctx, `SELECT data FROM calendar_state WHERE id='items'`).Scan(&data); err != nil {
		return err
	}
	var value state
	if err = json.Unmarshal(data, &value); err != nil {
		return err
	}
	if err = change(&value); err != nil {
		return err
	}
	data, err = json.Marshal(value)
	if err != nil {
		return err
	}
	if _, err = conn.ExecContext(ctx, `UPDATE calendar_state SET data=? WHERE id='items'`, data); err != nil {
		return err
	}
	_, err = conn.ExecContext(ctx, "COMMIT")
	return err
}
func ParseDate(value, zone string) (time.Time, error) {
	loc, err := time.LoadLocation(zone)
	if err != nil {
		return time.Time{}, ErrInvalid
	}
	if len(value) == 10 {
		return time.ParseInLocation("2006-01-02", value, loc)
	}
	return time.Parse(time.RFC3339, value)
}
func Validate(item Item) error {
	if len(strings.TrimSpace(item.Title)) == 0 || len(item.Title) > 500 || len(item.Notes) > 16000 || len(item.Location) > 2000 || len(item.CollectionID) > 1000 {
		return ErrInvalid
	}
	if _, err := time.LoadLocation(item.TimeZone); err != nil {
		return errors.New("Choose a valid time zone.")
	}
	if item.Repeat != "none" && item.Repeat != "daily" && item.Repeat != "weekly" && item.Repeat != "monthly" && item.Repeat != "yearly" {
		return ErrInvalid
	}
	if item.Priority != "none" && item.Priority != "low" && item.Priority != "medium" && item.Priority != "high" {
		return ErrInvalid
	}
	if item.AlertMinutes != nil && (*item.AlertMinutes < 0 || *item.AlertMinutes > 40320) {
		return ErrInvalid
	}
	if item.Kind == "event" {
		start, err := ParseDate(item.Start, item.TimeZone)
		if err != nil {
			return errors.New("Choose a valid start.")
		}
		end, err := ParseDate(item.End, item.TimeZone)
		if err != nil || !end.After(start) {
			return errors.New("End must be after start.")
		}
		if item.AllDay != (len(item.Start) == 10) || item.AllDay != (len(item.End) == 10) {
			return ErrInvalid
		}
	} else if item.Kind == "reminder" {
		if item.Due != "" {
			if _, err := ParseDate(item.Due, item.TimeZone); err != nil {
				return errors.New("Choose a valid due date.")
			}
		}
		if item.Repeat != "none" && item.Due == "" {
			return errors.New("Repeating reminders need a due date.")
		}
	} else {
		return ErrInvalid
	}
	if item.RepeatUntil != "" {
		until, err := ParseDate(item.RepeatUntil, item.TimeZone)
		if err != nil || len(item.RepeatUntil) != 10 {
			return ErrInvalid
		}
		base := item.Start
		if item.Kind == "reminder" {
			base = item.Due
		}
		start, _ := ParseDate(base, item.TimeZone)
		if until.Format("2006-01-02") < start.In(until.Location()).Format("2006-01-02") {
			return errors.New("Repeat end must be on or after the first date.")
		}
	}
	return nil
}
func (s *Store) Change(ctx context.Context, req Change) (Item, error) {
	if (req.Item != nil && strings.HasPrefix(req.Item.CollectionID, "g:")) || strings.HasPrefix(req.ID, "g:") {
		return s.changeGoogle(ctx, req)
	}
	var result Item
	err := s.update(ctx, func(value *state) error {
		if req.Action == "collection" {
			if req.Collection == nil {
				return ErrInvalid
			}
			c := *req.Collection
			if c.Kind != "event" && c.Kind != "reminder" || len(strings.TrimSpace(c.Name)) == 0 || len(c.Name) > 100 || !validColor(c.Color) {
				return ErrInvalid
			}
			if len(value.Collections) >= 200 {
				return errors.New("Too many calendars or lists.")
			}
			c.ID = ID()
			c.Provider = "local"
			c.ReadOnly = false
			value.Collections = append(value.Collections, c)
			return nil
		}
		if req.Action == "save" && req.Item != nil {
			item := *req.Item
			if item.Repeat == "" {
				item.Repeat = "none"
			}
			if item.Priority == "" {
				item.Priority = "none"
			}
			if err := Validate(item); err != nil {
				return err
			}
			found := false
			for _, c := range value.Collections {
				if c.ID == item.CollectionID && c.Kind == item.Kind && !c.ReadOnly {
					found = true
				}
			}
			if !found {
				return errors.New("Choose an available calendar or list.")
			}
			item.Title = strings.TrimSpace(item.Title)
			item.Deleted = false
			item.Recurrence = nil
			if item.ID == "" {
				if len(value.Items) >= 10000 {
					return errors.New("Calendar storage is full.")
				}
				item.ID = ID()
				item.Revision = ID()
				value.Items = append(value.Items, item)
				result = item
				return nil
			}
			for i, old := range value.Items {
				if old.ID == item.ID && !old.Deleted {
					if old.Revision != item.Revision {
						return ErrConflict
					}
					item.Revision = ID()
					value.Items[i] = item
					result = item
					return nil
				}
			}
			return errors.New("Item is unavailable.")
		}
		if req.Action != "delete" && req.Action != "restore" && req.Action != "complete" {
			return ErrInvalid
		}
		for i, item := range value.Items {
			if item.ID != req.ID {
				continue
			}
			if item.Revision != req.Revision {
				return ErrConflict
			}
			if req.Action == "complete" {
				if item.Kind != "reminder" || item.Deleted {
					return ErrInvalid
				}
				item.Completed = !item.Completed
				if value.Successors == nil {
					value.Successors = map[string]string{}
				}
				if item.Completed && item.Repeat != "none" && value.Successors[item.ID] == "" {
					next := item
					next.ID = ID()
					next.Revision = ID()
					next.Completed = false
					t, _ := ParseDate(item.Due, item.TimeZone)
					loc, _ := time.LoadLocation(item.TimeZone)
					at := nextTime(t.In(loc), item.Repeat)
					next.Due = formatLike(item.Due, at)
					if item.RepeatUntil == "" || at.Format("2006-01-02") <= item.RepeatUntil {
						if len(value.Items) >= 10000 {
							return errors.New("Calendar storage is full.")
						}
						value.Items = append(value.Items, next)
						value.Successors[item.ID] = next.ID
					}
				}
			} else {
				item.Deleted = req.Action == "delete"
			}
			item.Revision = ID()
			value.Items[i] = item
			result = item
			return nil
		}
		return errors.New("Item is unavailable.")
	})
	return result, err
}
func validColor(value string) bool {
	if len(value) != 7 || value[0] != '#' {
		return false
	}
	_, err := hex.DecodeString(value[1:])
	return err == nil
}
func recurrenceTime(t time.Time, repeat string, n int) (time.Time, bool) {
	switch repeat {
	case "daily":
		next := t.AddDate(0, 0, n)
		return next, next.Hour() == t.Hour() && next.Minute() == t.Minute()
	case "weekly":
		next := t.AddDate(0, 0, n*7)
		return next, next.Hour() == t.Hour() && next.Minute() == t.Minute()
	case "monthly":
		next := time.Date(t.Year(), t.Month()+time.Month(n), t.Day(), t.Hour(), t.Minute(), t.Second(), 0, t.Location())
		return next, next.Day() == t.Day()
	case "yearly":
		next := time.Date(t.Year()+n, t.Month(), t.Day(), t.Hour(), t.Minute(), t.Second(), 0, t.Location())
		return next, next.Month() == t.Month() && next.Day() == t.Day()
	}
	return t, true
}
func nextTime(t time.Time, repeat string) time.Time {
	for n := 1; n <= 12; n++ {
		if next, valid := recurrenceTime(t, repeat, n); valid {
			return next
		}
	}
	return t
}
func formatLike(original string, t time.Time) string {
	if len(original) == 10 {
		return t.Format("2006-01-02")
	}
	return t.Format(time.RFC3339)
}
func Expand(items []Item, from, to time.Time) []Occurrence {
	out := []Occurrence{}
	for _, item := range items {
		if item.Deleted || item.Completed {
			continue
		}
		base := item.Start
		if item.Kind == "reminder" {
			base = item.Due
		}
		if base == "" {
			continue
		}
		start, err := ParseDate(base, item.TimeZone)
		if err != nil {
			continue
		}
		loc, _ := time.LoadLocation(item.TimeZone)
		start = start.In(loc)
		end := start
		if item.Kind == "event" {
			end, _ = ParseDate(item.End, item.TimeZone)
			end = end.In(loc)
		}
		originalStart, originalEnd := start, end
		for n := 0; n < 50000; n++ {
			var valid bool
			start, valid = recurrenceTime(originalStart, item.Repeat, n)
			if start.After(to) {
				break
			}
			if !valid {
				continue
			}
			dayShift := int(time.Date(start.Year(), start.Month(), start.Day(), 12, 0, 0, 0, time.UTC).Sub(time.Date(originalStart.Year(), originalStart.Month(), originalStart.Day(), 12, 0, 0, 0, time.UTC)).Hours() / 24)
			end = originalEnd.AddDate(0, 0, dayShift)
			if item.Kind == "event" && (end.Hour() != originalEnd.Hour() || end.Minute() != originalEnd.Minute() || !end.After(start)) {
				continue
			}
			if item.RepeatUntil != "" && start.Format("2006-01-02") > item.RepeatUntil {
				break
			}
			if (end.After(from) || !start.Before(from)) && start.Before(to) {
				copy := item
				if item.Kind == "event" {
					copy.Start = formatLike(item.Start, start)
					copy.End = formatLike(item.End, end)
				} else {
					copy.Due = formatLike(item.Due, start)
				}
				out = append(out, Occurrence{copy, item.ID + ":" + start.Format(time.RFC3339)})
			}
			if item.Repeat == "none" || item.Kind == "reminder" {
				break
			}
		}
	}
	return out
}
func (s *Store) Snapshot(ctx context.Context, from, to time.Time, includeGoogle ...bool) (Snapshot, error) {
	if !to.After(from) || to.Sub(from) > 370*24*time.Hour {
		return Snapshot{}, errors.New("Choose a range of at most one year.")
	}
	value, err := s.read(ctx)
	if err != nil {
		return Snapshot{}, err
	}
	snap := Snapshot{Collections: value.Collections, Items: []Item{}, Occurrences: []Occurrence{}}
	for _, item := range value.Items {
		if !item.Deleted {
			snap.Items = append(snap.Items, item)
		}
	}
	snap.Occurrences = Expand(snap.Items, from, to)
	snap.Google, err = s.GoogleStatus(ctx)
	if err != nil {
		return Snapshot{}, err
	}
	if snap.Google.Connected && (len(includeGoogle) == 0 || includeGoogle[0]) {
		collections, items, err := s.googleSnapshot(ctx, from, to)
		if err != nil {
			snap.GoogleError = err.Error()
		} else {
			snap.Collections = append(snap.Collections, collections...)
			snap.Items = append(snap.Items, items...)
			snap.Occurrences = append(snap.Occurrences, Expand(items, from, to)...)
		}
	}
	return snap, nil
}
func (s *Store) Notices(ctx context.Context, now time.Time) ([]Notice, error) {
	result := []Notice{}
	err := s.update(ctx, func(value *state) error {
		if value.Notices == nil {
			value.Notices = map[string]int64{}
		}
		for _, occ := range Expand(value.Items, now.Add(-24*time.Hour), now.Add(29*24*time.Hour)) {
			item := occ.Item
			when := item.Start
			if item.Kind == "reminder" {
				when = item.Due
			}
			if when == "" || item.Completed {
				continue
			}
			t, err := ParseDate(when, item.TimeZone)
			if err != nil {
				continue
			}
			if len(when) == 10 {
				t = time.Date(t.Year(), t.Month(), t.Day(), 9, 0, 0, 0, t.Location())
			}
			if item.Kind == "event" {
				if item.AlertMinutes == nil {
					continue
				}
				t = t.Add(-time.Duration(*item.AlertMinutes) * time.Minute)
			}
			key := occ.OccurrenceID + ":" + t.Format(time.RFC3339)
			if t.After(now) || t.Before(now.Add(-24*time.Hour)) || value.Notices[key] != 0 {
				continue
			}
			value.Notices[key] = now.Unix()
			body := "Reminder due"
			if item.Kind == "event" {
				body = fmt.Sprintf("Starts %s", item.Start)
			}
			result = append(result, Notice{key, item.Title, body})
		}
		for key, delivered := range value.Notices {
			if delivered < now.Add(-48*time.Hour).Unix() {
				delete(value.Notices, key)
			}
		}

		return nil
	})
	return result, err
}
