// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"encoding/json"
	"fmt"
	"io"
	"lumo/server/internal/notifications"
	"os"
)

func runAppNotify() {
	home, err := os.UserHomeDir()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	var message notifications.Message
	decoder := json.NewDecoder(io.LimitReader(os.Stdin, 16385))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(&message); err == nil {
		if decoder.Decode(new(any)) != io.EOF {
			err = fmt.Errorf("Send one JSON notification")
		}
	}
	if err == nil {
		var item notifications.Item
		item, err = notifications.SendNative(home, os.Getenv("LUMO_APP_NAME"), message)
		if err == nil {
			json.NewEncoder(os.Stdout).Encode(item)
			return
		}
	}
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}
