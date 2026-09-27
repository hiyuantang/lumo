// SPDX-License-Identifier: AGPL-3.0-only
package network

import (
	"encoding/binary"
	"errors"
	"net/netip"
	"syscall"
)

func defaultGateways() (map[int][]string, error) {
	data, err := syscall.NetlinkRIB(syscall.RTM_GETROUTE, syscall.AF_UNSPEC)
	if err != nil {
		return nil, err
	}
	messages, err := syscall.ParseNetlinkMessage(data)
	if err != nil {
		return nil, err
	}
	return routeGateways(messages)
}

func routeGateways(messages []syscall.NetlinkMessage) (map[int][]string, error) {
	result := map[int][]string{}
	for _, message := range messages {
		if message.Header.Type != syscall.RTM_NEWROUTE {
			continue
		}
		if len(message.Data) < syscall.SizeofRtMsg {
			return nil, errors.New("short route message")
		}
		header := message.Data[:syscall.SizeofRtMsg]
		if header[1] != 0 || header[2] != 0 || header[7] != syscall.RTN_UNICAST {
			continue
		}
		if header[0] != syscall.AF_INET && header[0] != syscall.AF_INET6 {
			continue
		}
		attrs, err := syscall.ParseNetlinkRouteAttr(&message)
		if err != nil {
			return nil, err
		}
		table := uint32(header[4])
		index := 0
		gateway := ""
		var multipath []byte
		for _, attr := range attrs {
			switch attr.Attr.Type {
			case syscall.RTA_TABLE:
				if len(attr.Value) >= 4 {
					table = binary.NativeEndian.Uint32(attr.Value)
				}
			case syscall.RTA_OIF:
				if len(attr.Value) >= 4 {
					index = int(binary.NativeEndian.Uint32(attr.Value))
				}
			case syscall.RTA_GATEWAY:
				if address, ok := netip.AddrFromSlice(attr.Value); ok {
					gateway = address.String()
				}
			case syscall.RTA_MULTIPATH:
				multipath = attr.Value
			}
		}
		if table != syscall.RT_TABLE_MAIN {
			continue
		}
		if index > 0 && gateway != "" {
			result[index] = append(result[index], gateway)
		}
		for len(multipath) > 0 {
			if len(multipath) < 8 {
				return nil, errors.New("short route nexthop")
			}
			length := int(binary.NativeEndian.Uint16(multipath[:2]))
			if length < 8 || length > len(multipath) {
				return nil, errors.New("invalid route nexthop")
			}
			next := syscall.NetlinkMessage{Header: syscall.NlMsghdr{Type: syscall.RTM_NEWROUTE}, Data: append(make([]byte, syscall.SizeofRtMsg), multipath[8:length]...)}
			nextAttrs, err := syscall.ParseNetlinkRouteAttr(&next)
			if err != nil {
				return nil, err
			}
			nextIndex := int(binary.NativeEndian.Uint32(multipath[4:8]))
			for _, attr := range nextAttrs {
				if attr.Attr.Type == syscall.RTA_GATEWAY && nextIndex > 0 {
					if address, ok := netip.AddrFromSlice(attr.Value); ok {
						result[nextIndex] = append(result[nextIndex], address.String())
					}
				}
			}
			aligned := (length + 3) & ^3
			if aligned > len(multipath) {
				return nil, errors.New("invalid route nexthop padding")
			}
			multipath = multipath[aligned:]
		}
	}
	return result, nil
}
