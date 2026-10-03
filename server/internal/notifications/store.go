// SPDX-License-Identifier: AGPL-3.0-only
package notifications

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

type Message struct {
	RequestID string `json:"requestId"`
	Title     string `json:"title"`
	Body      string `json:"body"`
}
type Item struct {
	ID      string `json:"id"`
	AppID   string `json:"appId"`
	AppName string `json:"appName"`
	Message
	CreatedAt int64 `json:"createdAt"`
	Read      bool  `json:"read"`
	Dismissed bool  `json:"dismissed"`
}
type Store struct{ Home string }

var ErrInvalid = errors.New("Use a requestId of 8–128 characters, a title of 1–120 characters and a body up to 2000 characters")
var ErrBusy = errors.New("This app has sent too many notifications; wait a minute")
var ErrConflict = errors.New("This notification requestId already has different content")

func Validate(m Message) error {
	if len(m.RequestID) < 8 || len(m.RequestID) > 128 || strings.TrimSpace(m.Title) == "" || len([]rune(m.Title)) > 120 || len([]rune(m.Body)) > 2000 || strings.ContainsAny(m.Title+m.RequestID, "\x00\r\n") {
		return ErrInvalid
	}
	return nil
}
func (s Store) update(fn func(*[]Item) error) error {
	dir := filepath.Join(s.Home, ".local", "state", "lumo", "notifications")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	lock, err := os.OpenFile(filepath.Join(dir, "lock"), os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return err
	}
	defer lock.Close()
	if err = syscall.Flock(int(lock.Fd()), syscall.LOCK_EX); err != nil {
		return err
	}
	defer syscall.Flock(int(lock.Fd()), syscall.LOCK_UN)
	items := []Item{}
	path := filepath.Join(dir, "inbox.json")
	raw, err := os.ReadFile(path)
	if err == nil {
		if err = json.Unmarshal(raw, &items); err != nil {
			return err
		}
	} else if !os.IsNotExist(err) {
		return err
	}
	if err = fn(&items); err != nil {
		return err
	}
	previous := raw
	raw, err = json.Marshal(items)
	if err != nil {
		return err
	}
	if bytes.Equal(previous, raw) {
		return nil
	}
	f, err := os.CreateTemp(dir, "inbox-")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if _, err = f.Write(raw); err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(f.Name(), path)
}
func (s Store) Send(appID, appName string, m Message) (Item, error) {
	var result Item
	if err := Validate(m); err != nil {
		return result, err
	}
	err := s.update(func(items *[]Item) error {
		now := time.Now()
		recent := 0
		for _, item := range *items {
			if item.AppID == appID {
				if item.RequestID == m.RequestID {
					if item.Message != m {
						return ErrConflict
					}
					result = item
					return nil
				}
				if item.CreatedAt > now.Add(-time.Minute).UnixMilli() {
					recent++
				}
			}
		}
		if recent >= 10 {
			return ErrBusy
		}
		id := make([]byte, 16)
		if _, err := rand.Read(id); err != nil {
			return err
		}
		result = Item{ID: hex.EncodeToString(id), AppID: appID, AppName: appName, Message: m, CreatedAt: now.UnixMilli()}
		*items = append(*items, result)
		if len(*items) > 500 {
			*items = (*items)[len(*items)-500:]
		}
		return nil
	})
	return result, err
}
func (s Store) List() ([]Item, error) {
	result := []Item{}
	err := s.update(func(items *[]Item) error {
		for _, item := range *items {
			if !item.Dismissed {
				result = append(result, item)
			}
		}
		return nil
	})
	return result, err
}
func (s Store) Change(action string, ids []string) error {
	if action != "read" && action != "dismiss" {
		return errors.New("Use read or dismiss")
	}
	if len(ids) > 500 {
		return errors.New("Too many notification IDs")
	}
	selected := map[string]bool{}
	for _, id := range ids {
		selected[id] = true
	}
	return s.update(func(items *[]Item) error {
		for i := range *items {
			if selected[(*items)[i].ID] {
				if action == "read" {
					(*items)[i].Read = true
				} else {
					(*items)[i].Dismissed = true
				}
			}
		}
		return nil
	})
}
