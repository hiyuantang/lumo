// SPDX-License-Identifier: AGPL-3.0-only
package calendar

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"
)

type roundTrip func(*http.Request) (*http.Response, error)

func (f roundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func response(status int, value string) *http.Response {
	return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(value)), Header: http.Header{}}
}
func googleConfig() GoogleConfig {
	return GoogleConfig{ClientID: "test.apps.googleusercontent.com", ClientSecret: "private-secret", RedirectURI: "http://localhost:8080/api/v1/calendar/google/callback"}
}
func TestOfficialGoogleOAuthStateAndCalendarOnlyScopes(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	if err := s.ConfigureGoogle(ctx, googleConfig()); err != nil {
		t.Fatal(err)
	}
	target, err := s.AuthorizeGoogle(ctx)
	if err != nil {
		t.Fatal(err)
	}
	u, _ := url.Parse(target)
	q := u.Query()
	if u.Host != "accounts.google.com" || q.Get("code_challenge_method") != "S256" || strings.Contains(q.Get("scope"), "tasks") || strings.Contains(target, "private-secret") {
		t.Fatal("wrong authorization contract")
	}
	calls := 0
	s.client.http = &http.Client{Transport: roundTrip(func(r *http.Request) (*http.Response, error) {
		calls++
		if r.URL.String() != "https://oauth2.googleapis.com/token" {
			t.Fatal(r.URL)
		}
		r.ParseForm()
		if r.Form.Get("code_verifier") == "" || r.Form.Get("client_secret") != "private-secret" {
			t.Fatal("missing secure exchange")
		}
		return response(200, `{"access_token":"access-secret","refresh_token":"refresh-secret","expires_in":3600,"scope":"`+calendarScope+`"}`), nil
	})}
	if err = s.FinishGoogle(ctx, "invalid", "code"); err == nil || calls != 0 {
		t.Fatal("invalid state contacted Google")
	}
	if err = s.FinishGoogle(ctx, q.Get("state"), "code"); err != nil {
		t.Fatal(err)
	}
	if err = s.FinishGoogle(ctx, q.Get("state"), "code"); err == nil || calls != 1 {
		t.Fatal("state replay accepted")
	}
	status, err := s.GoogleStatus(ctx)
	raw, _ := json.Marshal(status)
	if err != nil || !status.Connected || strings.Contains(string(raw), "secret") {
		t.Fatal("public status leaks credentials")
	}
	s.client.http.Transport = roundTrip(func(r *http.Request) (*http.Response, error) {
		if r.URL.String() != "https://oauth2.googleapis.com/revoke" {
			t.Fatal(r.URL)
		}
		return response(200, `{}`), nil
	})
	if err = s.DisconnectGoogle(ctx); err != nil {
		t.Fatal(err)
	}
	status, _ = s.GoogleStatus(ctx)
	if status.Connected || !status.Configured {
		t.Fatal(status)
	}
}
func TestGooglePartialConsentAndConcurrentSetup(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	old := googleState{GoogleConfig: googleConfig()}
	if err := s.saveGoogle(ctx, old); err != nil {
		t.Fatal(err)
	}
	next := old
	next.State = "state"
	if err := s.swapGoogle(ctx, old, next); err != nil {
		t.Fatal(err)
	}
	if err := s.swapGoogle(ctx, old, old); !errors.Is(err, ErrConflict) {
		t.Fatal("stale oauth overwrite")
	}
	s.client.http = &http.Client{Transport: roundTrip(func(r *http.Request) (*http.Response, error) {
		return response(200, `{"access_token":"token","scope":"https://www.googleapis.com/auth/calendar.events"}`), nil
	})}
	if _, err := s.token(ctx, old, url.Values{"grant_type": {"authorization_code"}}); err == nil {
		t.Fatal("partial consent accepted")
	}
	for _, redirect := range []string{"http://example.com/api/v1/calendar/google/callback", "https://example.com/wrong", "https://user@example.com/api/v1/calendar/google/callback", "https://example.com/api/v1/calendar/google/callback?redirect=evil"} {
		if validRedirect(redirect) {
			t.Fatal(redirect)
		}
	}
}
func TestGoogleCRUDAndOptimisticRevision(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	if err := s.saveGoogle(ctx, googleState{GoogleConfig: googleConfig(), AccessToken: "token", Expires: time.Now().Add(time.Hour)}); err != nil {
		t.Fatal(err)
	}
	item := event()
	item.CollectionID = googleCollection("primary")
	item.AllDay = true
	item.Start = "2026-10-01"
	item.End = "2026-10-02"
	item.Repeat = "daily"
	item.RepeatUntil = "2026-10-03"
	methods := []string{}
	s.client.http = &http.Client{Transport: roundTrip(func(r *http.Request) (*http.Response, error) {
		methods = append(methods, r.Method)
		if r.Header.Get("Authorization") != "Bearer token" || r.URL.Query().Get("sendUpdates") != "none" {
			t.Fatal("wrong remote request")
		}
		if r.Method == "DELETE" {
			if r.Header.Get("If-Match") != "v2" {
				t.Fatal("missing delete revision")
			}
			return response(204, ""), nil
		}
		var wire googleEvent
		if err := json.NewDecoder(r.Body).Decode(&wire); err != nil {
			t.Fatal(err)
		}
		if r.Method == "POST" && (len(wire.Recurrence) != 1 || wire.Recurrence[0] != "RRULE:FREQ=DAILY;UNTIL=20261003") {
			t.Fatalf("all day recurrence %+v", wire)
		}
		if r.Method == "PATCH" && r.Header.Get("If-Match") == "stale" {
			return response(412, `{}`), nil
		}
		wire.ID = "event"
		wire.ETag = "v2"
		raw, _ := json.Marshal(wire)
		return response(200, string(raw)), nil
	})}
	saved, err := s.Change(ctx, Change{Action: "save", Item: &item})
	if err != nil || saved.ID == "" {
		t.Fatal(err)
	}
	saved.Title = "Edited"
	saved, err = s.Change(ctx, Change{Action: "save", Item: &saved})
	if err != nil {
		t.Fatal(err)
	}
	saved.Revision = "stale"
	if _, err = s.Change(ctx, Change{Action: "save", Item: &saved}); !errors.Is(err, ErrConflict) {
		t.Fatal("remote conflict lost")
	}
	saved.Revision = "v2"
	if _, err = s.Change(ctx, Change{Action: "delete", ID: saved.ID, Revision: saved.Revision}); err != nil {
		t.Fatal(err)
	}
	if strings.Join(methods, ",") != "POST,PATCH,PATCH,DELETE" {
		t.Fatal(methods)
	}
	item.Kind = "reminder"
	if _, err = s.Change(ctx, Change{Action: "save", Item: &item}); err == nil {
		t.Fatal("reminder sent to Google")
	}
}
func TestLocalReminderSnapshotDoesNotContactGoogle(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	if err := s.saveGoogle(ctx, googleState{GoogleConfig: googleConfig(), AccessToken: "token", Expires: time.Now().Add(time.Hour)}); err != nil {
		t.Fatal(err)
	}
	s.client.http = &http.Client{Transport: roundTrip(func(r *http.Request) (*http.Response, error) {
		t.Fatal("local reminder view contacted Google")
		return nil, errors.New("unexpected request")
	})}
	snap, err := s.Snapshot(ctx, stamp("2026-10-01T00:00:00Z"), stamp("2026-10-02T00:00:00Z"), false)
	if err != nil || !snap.Google.Connected || snap.GoogleError != "" {
		t.Fatal("local reminders depend on Google", err)
	}
}
