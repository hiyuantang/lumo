// SPDX-License-Identifier: AGPL-3.0-only
package calendar

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const calendarScope = "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly"

type GoogleStatus struct {
	Configured  bool   `json:"configured"`
	Connected   bool   `json:"connected"`
	Name        string `json:"name"`
	RedirectURI string `json:"redirectUri"`
}
type GoogleConfig struct {
	ClientID     string `json:"clientId"`
	ClientSecret string `json:"clientSecret"`
	RedirectURI  string `json:"redirectUri"`
}
type googleState struct {
	GoogleConfig
	AccessToken  string    `json:"accessToken"`
	RefreshToken string    `json:"refreshToken"`
	Expires      time.Time `json:"expires"`
	State        string    `json:"state"`
	Verifier     string    `json:"verifier"`
	StateExpires time.Time `json:"stateExpires"`
	Name         string    `json:"name"`
}
type GoogleClient struct {
	http                        *http.Client
	tokenURL, apiURL, revokeURL string
}

func defaultGoogleClient() GoogleClient {
	return GoogleClient{&http.Client{Timeout: 20 * time.Second}, "https://oauth2.googleapis.com/token", "https://www.googleapis.com/calendar/v3", "https://oauth2.googleapis.com/revoke"}
}
func (s *Store) googleState(ctx context.Context) (googleState, error) {
	var raw []byte
	var value googleState
	err := s.db.QueryRowContext(ctx, `SELECT data FROM calendar_state WHERE id='google'`).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return value, nil
	}
	if err == nil {
		err = json.Unmarshal(raw, &value)
	}
	return value, err
}
func (s *Store) saveGoogle(ctx context.Context, value googleState) error {
	raw, err := json.Marshal(value)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO calendar_state VALUES ('google',?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`, raw)
	return err
}
func (s *Store) swapGoogle(ctx context.Context, previous, next googleState) error {
	old, _ := json.Marshal(previous)
	raw, err := json.Marshal(next)
	if err != nil {
		return err
	}
	result, err := s.db.ExecContext(ctx, `UPDATE calendar_state SET data=? WHERE id='google' AND data=?`, raw, old)
	if err != nil {
		return err
	}
	count, _ := result.RowsAffected()
	if count == 1 {
		return nil
	}
	if previous == (googleState{}) {
		result, err = s.db.ExecContext(ctx, `INSERT OR IGNORE INTO calendar_state VALUES ('google',?)`, raw)
		if err != nil {
			return err
		}
		count, _ = result.RowsAffected()
		if count == 1 {
			return nil
		}
	}
	return ErrConflict
}
func (s *Store) GoogleStatus(ctx context.Context) (GoogleStatus, error) {
	value, err := s.googleState(ctx)
	return GoogleStatus{value.ClientID != "" && value.ClientSecret != "", value.RefreshToken != "" || value.AccessToken != "", value.Name, value.RedirectURI}, err
}
func validRedirect(value string) bool {
	if len(value) > 1000 {
		return false
	}
	u, err := url.Parse(value)
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path != "/api/v1/calendar/google/callback" {
		return false
	}
	return u.Scheme == "https" || u.Scheme == "http" && (u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1" || u.Hostname() == "::1")
}
func (s *Store) ConfigureGoogle(ctx context.Context, config GoogleConfig) error {
	if len(config.ClientID) > 300 || !strings.HasSuffix(config.ClientID, ".apps.googleusercontent.com") || len(config.ClientSecret) < 8 || len(config.ClientSecret) > 500 || !validRedirect(config.RedirectURI) {
		return errors.New("Enter a Google web OAuth client and the exact Lumo callback URL (HTTPS, or localhost for development).")
	}
	previous, err := s.googleState(ctx)
	if err != nil {
		return err
	}
	if previous.RefreshToken != "" || previous.AccessToken != "" {
		return errors.New("Disconnect Google before changing its setup.")
	}
	return s.swapGoogle(ctx, previous, googleState{GoogleConfig: config})
}
func (s *Store) AuthorizeGoogle(ctx context.Context) (string, error) {
	value, err := s.googleState(ctx)
	if err != nil {
		return "", err
	}
	if value.ClientID == "" || value.ClientSecret == "" {
		return "", errors.New("Set up a Google OAuth client first.")
	}
	previous := value
	if value.AccessToken != "" || value.RefreshToken != "" {
		return "", errors.New("Disconnect Google before connecting another account.")
	}
	value.State = ID() + ID()
	value.Verifier = ID() + ID()
	value.StateExpires = time.Now().Add(10 * time.Minute)
	hash := sha256.Sum256([]byte(value.Verifier))
	if err = s.swapGoogle(ctx, previous, value); err != nil {
		return "", err
	}
	params := url.Values{"client_id": {value.ClientID}, "redirect_uri": {value.RedirectURI}, "response_type": {"code"}, "scope": {calendarScope}, "state": {value.State}, "code_challenge": {base64.RawURLEncoding.EncodeToString(hash[:])}, "code_challenge_method": {"S256"}, "access_type": {"offline"}, "prompt": {"consent"}, "include_granted_scopes": {"true"}}
	return "https://accounts.google.com/o/oauth2/v2/auth?" + params.Encode(), nil
}
func (s *Store) token(ctx context.Context, value googleState, params url.Values) (googleState, error) {
	params.Set("client_id", value.ClientID)
	params.Set("client_secret", value.ClientSecret)
	req, err := http.NewRequestWithContext(ctx, "POST", s.client.tokenURL, strings.NewReader(params.Encode()))
	if err != nil {
		return value, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	res, err := s.client.http.Do(req)
	if err != nil {
		return value, errors.New("Google authorization is unavailable.")
	}
	defer res.Body.Close()
	var result struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    int    `json:"expires_in"`
		Scope        string `json:"scope"`
	}
	if res.StatusCode != 200 || json.NewDecoder(io.LimitReader(res.Body, 2<<20)).Decode(&result) != nil || result.AccessToken == "" {
		return value, errors.New("Google authorization expired or was declined. Connect again.")
	}
	if params.Get("grant_type") == "authorization_code" {
		granted := " " + result.Scope + " "
		for _, scope := range strings.Fields(calendarScope) {
			if !strings.Contains(granted, " "+scope+" ") {
				return value, errors.New("Allow both requested Calendar permissions, then connect again.")
			}
		}
	}
	value.AccessToken = result.AccessToken
	if result.RefreshToken != "" {
		value.RefreshToken = result.RefreshToken
	}
	value.Expires = time.Now().Add(time.Duration(result.ExpiresIn) * time.Second)
	return value, nil
}
func (s *Store) FinishGoogle(ctx context.Context, state, code string) error {
	value, err := s.googleState(ctx)
	if err != nil {
		return err
	}
	if state == "" || value.State != state || time.Now().After(value.StateExpires) || len(code) == 0 || len(code) > 4096 {
		return errors.New("Google sign-in expired. Start connecting again.")
	}
	previous := value
	verifier := value.Verifier
	value.State = ""
	value.Verifier = ""
	if err = s.swapGoogle(ctx, previous, value); err != nil {
		return err
	}
	previous = value
	value, err = s.token(ctx, value, url.Values{"grant_type": {"authorization_code"}, "code": {code}, "code_verifier": {verifier}, "redirect_uri": {value.RedirectURI}})
	if err != nil {
		return err
	}
	value.Name = "Google Calendar"
	return s.swapGoogle(ctx, previous, value)
}
func (s *Store) DisconnectGoogle(ctx context.Context) error {
	value, err := s.googleState(ctx)
	if err != nil {
		return err
	}
	token := value.RefreshToken
	if token == "" {
		token = value.AccessToken
	}
	if token != "" {
		req, _ := http.NewRequestWithContext(ctx, "POST", s.client.revokeURL, strings.NewReader(url.Values{"token": {token}}.Encode()))
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		res, err := s.client.http.Do(req)
		if err != nil {
			return errors.New("Could not revoke Google access. Try again.")
		}
		res.Body.Close()
		if res.StatusCode != 200 && res.StatusCode != 400 {
			return errors.New("Could not revoke Google access. Try again.")
		}
	}
	return s.swapGoogle(ctx, value, googleState{GoogleConfig: value.GoogleConfig})
}
func (s *Store) googleRequest(ctx context.Context, method, path, revision string, body, out any) error {
	value, err := s.googleState(ctx)
	if err != nil {
		return err
	}
	if value.AccessToken == "" && value.RefreshToken == "" {
		return errors.New("Connect Google Calendar first.")
	}
	if time.Now().Add(time.Minute).After(value.Expires) {
		previous := value
		value, err = s.token(ctx, value, url.Values{"grant_type": {"refresh_token"}, "refresh_token": {value.RefreshToken}})
		if err != nil {
			return err
		}
		if err = s.swapGoogle(ctx, previous, value); err != nil {
			if !errors.Is(err, ErrConflict) {
				return err
			}
			value, err = s.googleState(ctx)
			if err != nil {
				return err
			}
			if value.AccessToken == "" || !value.Expires.After(time.Now()) {
				return ErrConflict
			}
		}
	}
	var data []byte
	if body != nil {
		data, err = json.Marshal(body)
		if err != nil {
			return err
		}
	}
	req, err := http.NewRequestWithContext(ctx, method, s.client.apiURL+path, bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+value.AccessToken)
	req.Header.Set("Content-Type", "application/json")
	if revision != "" {
		req.Header.Set("If-Match", revision)
	}
	res, err := s.client.http.Do(req)
	if err != nil {
		return errors.New("Google Calendar is unavailable.")
	}
	defer res.Body.Close()
	if res.StatusCode == 412 || res.StatusCode == 409 {
		return ErrConflict
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return fmt.Errorf("Google Calendar returned HTTP %d. Reload or reconnect your account.", res.StatusCode)
	}
	if out != nil && res.StatusCode != 204 {
		if err = json.NewDecoder(io.LimitReader(res.Body, 2<<20)).Decode(out); err != nil {
			return errors.New("Google Calendar returned an invalid response.")
		}
	}
	return nil
}

type googleDate struct {
	Date     string `json:"date,omitempty"`
	DateTime string `json:"dateTime,omitempty"`
	TimeZone string `json:"timeZone,omitempty"`
}
type googleEvent struct {
	ID          string     `json:"id,omitempty"`
	Summary     string     `json:"summary"`
	Description string     `json:"description"`
	Location    string     `json:"location"`
	ETag        string     `json:"etag,omitempty"`
	Status      string     `json:"status,omitempty"`
	Start       googleDate `json:"start"`
	End         googleDate `json:"end"`
	Recurrence  []string   `json:"recurrence,omitempty"`
	Reminders   struct {
		UseDefault bool `json:"useDefault"`
		Overrides  []struct {
			Method  string `json:"method"`
			Minutes int    `json:"minutes"`
		} `json:"overrides"`
	} `json:"reminders"`
}

func encodeGoogle(value string) string { return base64.RawURLEncoding.EncodeToString([]byte(value)) }
func decodeGoogle(value string) (string, error) {
	data, err := base64.RawURLEncoding.DecodeString(value)
	return string(data), err
}
func googleCollection(id string) string { return "g:" + encodeGoogle(id) }
func googleItem(calendarID string, e googleEvent) Item {
	zone := e.Start.TimeZone
	if zone == "" {
		zone = "UTC"
	}
	start, end := e.Start.DateTime, e.End.DateTime
	allDay := e.Start.Date != ""
	if allDay {
		start = e.Start.Date
		end = e.End.Date
	}
	item := Item{ID: googleCollection(calendarID) + ":" + encodeGoogle(e.ID), CollectionID: googleCollection(calendarID), Kind: "event", Title: e.Summary, Notes: e.Description, Location: e.Location, Start: start, End: end, AllDay: allDay, TimeZone: zone, Repeat: "none", Priority: "none", Revision: e.ETag, Recurrence: e.Recurrence}
	if item.Title == "" {
		item.Title = "Untitled event"
	}
	for _, alert := range e.Reminders.Overrides {
		if alert.Method == "popup" {
			minutes := alert.Minutes
			item.AlertMinutes = &minutes
			break
		}
	}
	return item
}
func (s *Store) googleSnapshot(ctx context.Context, from, to time.Time) ([]Collection, []Item, error) {
	collections := []Collection{}
	items := []Item{}
	pageToken := ""
	for page := 0; page < 20; page++ {
		var result struct {
			Items []struct {
				ID              string `json:"id"`
				Summary         string `json:"summary"`
				BackgroundColor string `json:"backgroundColor"`
				AccessRole      string `json:"accessRole"`
				TimeZone        string `json:"timeZone"`
			} `json:"items"`
			Next string `json:"nextPageToken"`
		}
		if err := s.googleRequest(ctx, "GET", "/users/me/calendarList?"+url.Values{"maxResults": {"100"}, "pageToken": {pageToken}}.Encode(), "", nil, &result); err != nil {
			return nil, nil, err
		}
		for _, c := range result.Items {
			if c.AccessRole == "freeBusyReader" {
				continue
			}
			color := c.BackgroundColor
			if !validColor(color) {
				color = "#487ccc"
			}
			collections = append(collections, Collection{googleCollection(c.ID), c.Summary, color, "event", "google", c.AccessRole != "owner" && c.AccessRole != "writer"})
			token := ""
			for n := 0; n < 20; n++ {
				var events struct {
					Items []googleEvent `json:"items"`
					Next  string        `json:"nextPageToken"`
				}
				params := url.Values{"timeMin": {from.Format(time.RFC3339)}, "timeMax": {to.Format(time.RFC3339)}, "singleEvents": {"true"}, "orderBy": {"startTime"}, "maxResults": {"2500"}, "pageToken": {token}}
				if err := s.googleRequest(ctx, "GET", "/calendars/"+url.PathEscape(c.ID)+"/events?"+params.Encode(), "", nil, &events); err != nil {
					return nil, nil, err
				}
				for _, e := range events.Items {
					if e.Status != "cancelled" {
						item := googleItem(c.ID, e)
						if e.Start.TimeZone == "" && c.TimeZone != "" {
							item.TimeZone = c.TimeZone
						}
						items = append(items, item)
					}
				}
				token = events.Next
				if token == "" {
					break
				}
				if n == 19 {
					return nil, nil, errors.New("Google returned too many events. Choose a smaller date range.")
				}
			}
		}
		pageToken = result.Next
		if pageToken == "" {
			return collections, items, nil
		}
	}
	return nil, nil, errors.New("Google returned too many calendars.")
}
func (s *Store) changeGoogle(ctx context.Context, change Change) (Item, error) {
	if change.Action == "complete" || change.Action == "restore" || change.Action == "collection" {
		return Item{}, ErrInvalid
	}
	if change.Action == "delete" {
		parts := strings.Split(change.ID, ":")
		if len(parts) != 3 || parts[0] != "g" || change.Revision == "" {
			return Item{}, ErrInvalid
		}
		calendarID, err := decodeGoogle(parts[1])
		if err != nil {
			return Item{}, ErrInvalid
		}
		eventID, err := decodeGoogle(parts[2])
		if err != nil {
			return Item{}, ErrInvalid
		}
		return Item{ID: change.ID, Deleted: true}, s.googleRequest(ctx, "DELETE", "/calendars/"+url.PathEscape(calendarID)+"/events/"+url.PathEscape(eventID)+"?sendUpdates=none", change.Revision, nil, nil)
	}
	if change.Action != "save" || change.Item == nil {
		return Item{}, ErrInvalid
	}
	item := *change.Item
	if item.Repeat == "" {
		item.Repeat = "none"
	}
	if item.Priority == "" {
		item.Priority = "none"
	}
	if item.Kind != "event" {
		return Item{}, errors.New("Google is available only for calendar events.")
	}
	if err := Validate(item); err != nil {
		return Item{}, err
	}
	parts := strings.Split(item.CollectionID, ":")
	if len(parts) != 2 || parts[0] != "g" {
		return Item{}, ErrInvalid
	}
	calendarID, err := decodeGoogle(parts[1])
	if err != nil {
		return Item{}, ErrInvalid
	}
	event := googleEvent{Summary: item.Title, Description: item.Notes, Location: item.Location}
	if item.AllDay {
		event.Start.Date = item.Start
		event.End.Date = item.End
	} else {
		event.Start = googleDate{DateTime: item.Start, TimeZone: item.TimeZone}
		event.End = googleDate{DateTime: item.End, TimeZone: item.TimeZone}
	}
	if item.Repeat != "none" {
		rule := "RRULE:FREQ=" + strings.ToUpper(item.Repeat)
		if item.RepeatUntil != "" {
			until, _ := ParseDate(item.RepeatUntil, item.TimeZone)
			if item.AllDay {
				rule += ";UNTIL=" + until.Format("20060102")
			} else {
				rule += ";UNTIL=" + until.AddDate(0, 0, 1).Add(-time.Second).UTC().Format("20060102T150405Z")
			}
		}
		event.Recurrence = []string{rule}
	}
	if item.AlertMinutes != nil {
		event.Reminders.Overrides = append(event.Reminders.Overrides, struct {
			Method  string `json:"method"`
			Minutes int    `json:"minutes"`
		}{"popup", *item.AlertMinutes})
	} else {
		event.Reminders.Overrides = []struct {
			Method  string `json:"method"`
			Minutes int    `json:"minutes"`
		}{}
	}
	method, path := "POST", "/calendars/"+url.PathEscape(calendarID)+"/events?sendUpdates=none"
	if item.ID != "" {
		ids := strings.Split(item.ID, ":")
		if len(ids) != 3 || ids[0] != "g" || item.CollectionID != strings.Join(ids[:2], ":") || item.Revision == "" {
			return Item{}, ErrInvalid
		}
		id, err := decodeGoogle(ids[2])
		if err != nil {
			return Item{}, ErrInvalid
		}
		method = "PATCH"
		path = "/calendars/" + url.PathEscape(calendarID) + "/events/" + url.PathEscape(id) + "?sendUpdates=none"
		event.Recurrence = item.Recurrence
	}
	var saved googleEvent
	if err = s.googleRequest(ctx, method, path, item.Revision, event, &saved); err != nil {
		return Item{}, err
	}
	result := googleItem(calendarID, saved)
	if saved.Start.TimeZone == "" {
		result.TimeZone = item.TimeZone
	}
	return result, nil
}
