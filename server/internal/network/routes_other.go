// SPDX-License-Identifier: AGPL-3.0-only
//go:build !linux

package network

import "errors"

func defaultGateways() (map[int][]string, error) {
	return nil, errors.New("route information requires Linux")
}
