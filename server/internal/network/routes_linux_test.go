// SPDX-License-Identifier: AGPL-3.0-only
package network

import (
	"encoding/binary"
	"net/netip"
	"reflect"
	"syscall"
	"testing"
)

func routeAttribute(kind uint16, value []byte) []byte {
	length := 4 + len(value)
	data := make([]byte, (length+3)&^3)
	binary.NativeEndian.PutUint16(data, uint16(length))
	binary.NativeEndian.PutUint16(data[2:], kind)
	copy(data[4:], value)
	return data
}

func routeIndex(index uint32) []byte {
	data := make([]byte, 4)
	binary.NativeEndian.PutUint32(data, index)
	return data
}

func routeMessage(family, prefix, table byte, attributes ...[]byte) syscall.NetlinkMessage {
	data := make([]byte, syscall.SizeofRtMsg)
	data[0], data[1], data[4], data[7] = family, prefix, table, syscall.RTN_UNICAST
	for _, attr := range attributes {
		data = append(data, attr...)
	}
	return syscall.NetlinkMessage{Header: syscall.NlMsghdr{Type: syscall.RTM_NEWROUTE}, Data: data}
}

func TestDefaultGatewaysExcludeOtherRoutes(t *testing.T) {
	gateway := routeAttribute(syscall.RTA_GATEWAY, netip.MustParseAddr("192.0.2.1").AsSlice())
	index := routeAttribute(syscall.RTA_OIF, routeIndex(2))
	messages := []syscall.NetlinkMessage{
		routeMessage(syscall.AF_INET, 0, syscall.RT_TABLE_MAIN, index, gateway),
		routeMessage(syscall.AF_INET, 24, syscall.RT_TABLE_MAIN, index, routeAttribute(syscall.RTA_GATEWAY, []byte{192, 0, 2, 9})),
		routeMessage(syscall.AF_INET, 0, 100, index, gateway),
		routeMessage(syscall.AF_INET6, 0, 0, routeAttribute(syscall.RTA_TABLE, routeIndex(syscall.RT_TABLE_MAIN)), routeAttribute(syscall.RTA_OIF, routeIndex(3)), routeAttribute(syscall.RTA_GATEWAY, netip.MustParseAddr("fe80::1").AsSlice())),
	}
	got, err := routeGateways(messages)
	if err != nil {
		t.Fatal(err)
	}
	if want := map[int][]string{2: {"192.0.2.1"}, 3: {"fe80::1"}}; !reflect.DeepEqual(got, want) {
		t.Fatalf("gateways = %v", got)
	}
}

func TestMultipathGatewaysAndMalformedMessages(t *testing.T) {
	var hops []byte
	for _, index := range []uint32{2, 3} {
		hop := make([]byte, 8)
		binary.NativeEndian.PutUint32(hop[4:], index)
		hop = append(hop, routeAttribute(syscall.RTA_GATEWAY, []byte{192, 0, 2, byte(index)})...)
		binary.NativeEndian.PutUint16(hop, uint16(len(hop)))
		hops = append(hops, hop...)
	}
	message := routeMessage(syscall.AF_INET, 0, syscall.RT_TABLE_MAIN, routeAttribute(syscall.RTA_MULTIPATH, hops))
	got, err := routeGateways([]syscall.NetlinkMessage{message})
	if err != nil || !reflect.DeepEqual(got, map[int][]string{2: {"192.0.2.2"}, 3: {"192.0.2.3"}}) {
		t.Fatalf("gateways = %v, err = %v", got, err)
	}
	for _, message := range []syscall.NetlinkMessage{
		{Header: syscall.NlMsghdr{Type: syscall.RTM_NEWROUTE}, Data: []byte{2}},
		routeMessage(syscall.AF_INET, 0, syscall.RT_TABLE_MAIN, routeAttribute(syscall.RTA_MULTIPATH, []byte{1})),
	} {
		if _, err := routeGateways([]syscall.NetlinkMessage{message}); err == nil {
			t.Fatal("malformed route accepted")
		}
	}
}

func TestLiveGatewayRead(t *testing.T) {
	if _, err := defaultGateways(); err != nil {
		t.Fatal(err)
	}
}
