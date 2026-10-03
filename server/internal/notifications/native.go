// SPDX-License-Identifier: AGPL-3.0-only
package notifications

import (
	"errors"
	"lumo/server/internal/appplugins"
)

func SendNative(home, name string, m Message) (Item, error) {
	p, err := appplugins.LoadFor(home, name)
	if err != nil {
		return Item{}, err
	}
	for _, permission := range p.Manifest.Permissions {
		if permission == "notifications.send" {
			return (Store{Home: home}).Send(p.Manifest.ID, p.Manifest.Name, m)
		}
	}
	return Item{}, errors.New("Declare notifications.send in the app manifest permissions")
}
