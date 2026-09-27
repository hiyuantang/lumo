// SPDX-License-Identifier: AGPL-3.0-only
package network

import (
	"context"
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"github.com/godbus/dbus/v5"
)

func TestResolverAddressesPreserveInterfaceScope(t *testing.T) {
	wire := [][]any{{int32(2), int32(2), []byte{192, 0, 2, 53}}, {int32(0), int32(2), []byte{1, 1, 1, 1}}, {int32(3), int32(10), []byte{0xfe, 0x80, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1}}}
	var entries []resolverAddress
	if err := dbus.Store([]any{wire}, &entries); err != nil {
		t.Fatal(err)
	}
	entries = append(entries, resolverAddress{Index: 2, Family: 10, Address: []byte{1, 2, 3, 4}})
	got := resolverAddresses(entries)
	want := map[int][]string{0: {"1.1.1.1"}, 2: {"192.0.2.53"}, 3: {"fe80::1"}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("DNS = %v, want %v", got, want)
	}
	if got := scopedAddresses(got[3], "eth1"); !reflect.DeepEqual(got, []string{"fe80::1%eth1"}) {
		t.Fatal(got)
	}
}

func TestResolvConfFallback(t *testing.T) {
	got := parseResolvConf("# generated\nnameserver 127.0.0.53\nsearch example.test\nnameserver 2001:db8::53 # IPv6\nnameserver 127.0.0.53\nnameserver invalid\nnameserver\n; nameserver 8.8.8.8\nnameserver fe80::1%eth0\n")
	want := []string{"127.0.0.53", "2001:db8::53", "fe80::1%eth0"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("DNS = %v", got)
	}
}

func TestReadOnlySnapshotWithoutNetplan(t *testing.T) {
	reader := NewReader()
	if !reader.Available() {
		t.Fatal("basic network reads must not require Netplan")
	}
	snapshot, err := reader.Snapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Interfaces) == 0 {
		t.Fatal("expected at least the loopback interface")
	}
	if snapshot.Revision != "" {
		t.Fatal("read-only snapshot must not acquire a Netplan configuration")
	}
	encoded, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), `"revision"`) {
		t.Fatal("unexpected mutation revision")
	}
	for _, item := range snapshot.Interfaces {
		if item.Addresses == nil {
			t.Fatalf("nil addresses: %s", item.Name)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := reader.Snapshot(ctx); err == nil {
		t.Fatal("expected cancellation")
	}
}
