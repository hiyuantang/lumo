// SPDX-License-Identifier: AGPL-3.0-only
package network

import (
	"context"
	"net/netip"
	"os"
	"slices"
	"strings"
	"time"

	"github.com/godbus/dbus/v5"
)

type resolverAddress struct {
	Index   int32
	Family  int32
	Address []byte
}

func readDNS(ctx context.Context) (map[int][]string, string) {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	conn, err := dbus.ConnectSystemBus()
	if err == nil {
		defer conn.Close()
		var value dbus.Variant
		err = conn.Object("org.freedesktop.resolve1", "/org/freedesktop/resolve1").CallWithContext(ctx, "org.freedesktop.DBus.Properties.Get", 0, "org.freedesktop.resolve1.Manager", "DNS").Store(&value)
		if err == nil {
			var entries []resolverAddress
			if dbus.Store([]any{value.Value()}, &entries) == nil {
				return resolverAddresses(entries), "resolved"
			}
		}
	}
	contents, err := os.ReadFile("/etc/resolv.conf")
	if err != nil {
		return nil, ""
	}
	return map[int][]string{0: parseResolvConf(string(contents))}, "resolv.conf"
}

func resolverAddresses(entries []resolverAddress) map[int][]string {
	result := map[int][]string{}
	for _, entry := range entries {
		if entry.Index < 0 || (entry.Family != 2 || len(entry.Address) != 4) && (entry.Family != 10 || len(entry.Address) != 16) {
			continue
		}
		address, ok := netip.AddrFromSlice(entry.Address)
		if ok {
			result[int(entry.Index)] = append(result[int(entry.Index)], address.String())
		}
	}
	return result
}

func parseResolvConf(contents string) []string {
	result := []string{}
	for _, line := range strings.Split(contents, "\n") {
		fields := strings.Fields(strings.SplitN(strings.SplitN(line, "#", 2)[0], ";", 2)[0])
		if len(fields) < 2 || fields[0] != "nameserver" {
			continue
		}
		if address, err := netip.ParseAddr(fields[1]); err == nil && !slices.Contains(result, address.String()) {
			result = append(result, address.String())
		}
	}
	return result
}

func scopedAddresses(values []string, name string) []string {
	result := []string{}
	for _, value := range values {
		address, err := netip.ParseAddr(value)
		if err == nil && address.Is6() && address.IsLinkLocalUnicast() && address.Zone() == "" && name != "" {
			value = address.WithZone(name).String()
		}
		if !slices.Contains(result, value) {
			result = append(result, value)
		}
	}
	return result
}
