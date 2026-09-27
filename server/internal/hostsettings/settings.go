// SPDX-License-Identifier: AGPL-3.0-only
package hostsettings

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"slices"
	"sync"
)

type Values struct {
	Hostname string `json:"hostname"`
	Timezone string `json:"timezone"`
	NTP      bool   `json:"ntp"`
}

type Snapshot struct {
	Values
	RuntimeHostname string `json:"runtimeHostname"`
	CanNTP          bool   `json:"canNtp"`
	NTPSynchronized bool   `json:"ntpSynchronized"`
	ServerTime      string `json:"serverTime"`
	Revision        string `json:"revision"`
}

type Change struct {
	Timezone *string `json:"timezone,omitempty"`
	NTP      *bool   `json:"ntp,omitempty"`
}

type Reader interface {
	Snapshot(context.Context) (Snapshot, error)
	Timezones(context.Context) ([]string, error)
}

type backend interface {
	Reader
	Set(context.Context, Change) error
}

type Controller struct {
	backend backend
	mu      sync.Mutex
}

var ErrValidation = errors.New("invalid setting")
var ErrStale = errors.New("system settings changed; reload the current values before saving")
var ErrVerification = errors.New("the change may have been applied, but could not be verified; refresh the system settings")

var timezonePattern = regexp.MustCompile(`^[A-Za-z0-9_+-]+(?:/[A-Za-z0-9_+-]+)*$`)
var revisionPattern = regexp.MustCompile(`^sha256:[a-f0-9]{64}$`)

func ValidRevision(value string) bool { return revisionPattern.MatchString(value) }

func Revision(values Values) string {
	encoded, _ := json.Marshal(struct {
		Timezone string `json:"timezone"`
		NTP      bool   `json:"ntp"`
	}{Timezone: values.Timezone, NTP: values.NTP})
	hash := sha256.Sum256(encoded)
	return "sha256:" + hex.EncodeToString(hash[:])
}

func (change Change) Validate() error {
	count := 0
	if change.Timezone != nil {
		count++
		if len(*change.Timezone) > 128 || !timezonePattern.MatchString(*change.Timezone) {
			return fmt.Errorf("%w: choose an installed time zone", ErrValidation)
		}
	}
	if change.NTP != nil {
		count++
	}
	if count != 1 {
		return fmt.Errorf("%w: change exactly one setting per request", ErrValidation)
	}
	return nil
}

func (change Change) matches(values Values) bool {
	return (change.Timezone == nil || *change.Timezone == values.Timezone) &&
		(change.NTP == nil || *change.NTP == values.NTP)
}

func NewController() (*Controller, error) {
	client, err := NewClient()
	if err != nil {
		return nil, err
	}
	return &Controller{backend: client}, nil
}

func (c *Controller) Apply(ctx context.Context, change Change, expected string) (Snapshot, error) {
	if err := change.Validate(); err != nil {
		return Snapshot{}, err
	}
	if !ValidRevision(expected) {
		return Snapshot{}, fmt.Errorf("%w: expected revision is required", ErrValidation)
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if change.Timezone != nil {
		zones, err := c.backend.Timezones(ctx)
		if err != nil {
			return Snapshot{}, err
		}
		if !slices.Contains(zones, *change.Timezone) {
			return Snapshot{}, fmt.Errorf("%w: time zone is not installed on this server", ErrValidation)
		}
	}
	before, err := c.backend.Snapshot(ctx)
	if err != nil {
		return Snapshot{}, err
	}
	if before.Revision != expected {
		return Snapshot{}, ErrStale
	}
	if change.NTP != nil && !before.CanNTP {
		return Snapshot{}, fmt.Errorf("%w: no network time service is available", ErrValidation)
	}
	if change.matches(before.Values) {
		return before, nil
	}
	if err := c.backend.Set(ctx, change); err != nil {
		return Snapshot{}, fmt.Errorf("could not apply the setting; refresh to check the current value: %w", err)
	}
	after, err := c.backend.Snapshot(ctx)
	if err != nil || !change.matches(after.Values) {
		return Snapshot{}, ErrVerification
	}
	return after, nil
}
