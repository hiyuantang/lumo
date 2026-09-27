// SPDX-License-Identifier: AGPL-3.0-only
package hostsettings

import (
	"context"
	"fmt"
	"time"

	"github.com/godbus/dbus/v5"
)

const hostnameBus = "org.freedesktop.hostname1"
const timedateBus = "org.freedesktop.timedate1"

type Client struct {
	conn *dbus.Conn
}

func NewClient() (*Client, error) {
	conn, err := dbus.ConnectSystemBus()
	if err != nil {
		return nil, err
	}
	return &Client{conn: conn}, nil
}

func (c *Client) object(name string) dbus.BusObject {
	if name == hostnameBus {
		return c.conn.Object(name, "/org/freedesktop/hostname1")
	}
	return c.conn.Object(name, "/org/freedesktop/timedate1")
}

func (c *Client) properties(ctx context.Context, name string) (map[string]dbus.Variant, error) {
	var properties map[string]dbus.Variant
	err := c.object(name).CallWithContext(ctx, "org.freedesktop.DBus.Properties.GetAll", 0, name).Store(&properties)
	return properties, err
}

func property[T any](properties map[string]dbus.Variant, name string) (T, error) {
	value, ok := properties[name].Value().(T)
	if !ok {
		return value, fmt.Errorf("system property %s is unavailable", name)
	}
	return value, nil
}

func (c *Client) Snapshot(ctx context.Context) (Snapshot, error) {
	host, err := c.properties(ctx, hostnameBus)
	if err != nil {
		return Snapshot{}, err
	}
	clock, err := c.properties(ctx, timedateBus)
	if err != nil {
		return Snapshot{}, err
	}
	var result Snapshot
	if result.Hostname, err = property[string](host, "StaticHostname"); err != nil {
		return Snapshot{}, err
	}
	if result.RuntimeHostname, err = property[string](host, "Hostname"); err != nil {
		return Snapshot{}, err
	}
	if result.Timezone, err = property[string](clock, "Timezone"); err != nil {
		return Snapshot{}, err
	}
	if result.NTP, err = property[bool](clock, "NTP"); err != nil {
		return Snapshot{}, err
	}
	if result.CanNTP, err = property[bool](clock, "CanNTP"); err != nil {
		return Snapshot{}, err
	}
	if result.NTPSynchronized, err = property[bool](clock, "NTPSynchronized"); err != nil {
		return Snapshot{}, err
	}
	result.ServerTime = time.Now().UTC().Format(time.RFC3339Nano)
	result.Revision = Revision(result.Values)
	return result, nil
}

func (c *Client) Timezones(ctx context.Context) ([]string, error) {
	var zones []string
	err := c.object(timedateBus).CallWithContext(ctx, timedateBus+".ListTimezones", 0).Store(&zones)
	return zones, err
}

func (c *Client) Set(ctx context.Context, change Change) error {
	if err := change.Validate(); err != nil {
		return err
	}
	switch {
	case change.Timezone != nil:
		return c.object(timedateBus).CallWithContext(ctx, timedateBus+".SetTimezone", 0, *change.Timezone, false).Err
	default:
		return c.object(timedateBus).CallWithContext(ctx, timedateBus+".SetNTP", 0, *change.NTP, false).Err
	}
}
