// SPDX-License-Identifier: AGPL-3.0-only
package network

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"

	"github.com/godbus/dbus/v5"
)

type fakeBackend struct {
	mu       sync.Mutex
	base     string
	merged   string
	applied  string
	path     dbus.ObjectPath
	deltas   []string
	tried    []uint32
	applyCnt int
	canceled int
}

func (f *fakeBackend) create(context.Context) (dbus.ObjectPath, string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	merged := f.merged
	if merged == "" {
		merged = f.base
	}
	return f.path, merged, nil
}

func (f *fakeBackend) set(_ context.Context, _ dbus.ObjectPath, delta, originHint string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.deltas = append(f.deltas, originHint+":"+delta)
	return nil
}

func (f *fakeBackend) try(_ context.Context, _ dbus.ObjectPath, timeoutSec uint32) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.tried = append(f.tried, timeoutSec)
	if f.applied != "" {
		f.merged = f.applied
	}
	return nil
}

func (f *fakeBackend) apply(context.Context, dbus.ObjectPath) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.applyCnt++
	return nil
}

func (f *fakeBackend) cancel(context.Context, dbus.ObjectPath) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.canceled++
	if f.applied != "" {
		f.merged = f.base
	}
	return nil
}

func validConfig() Config {
	return Config{
		Version: 2,
		Ethernets: map[string]EthernetConfig{
			"eth0": {
				DHCP4:     false,
				DHCP6:     false,
				Addresses: []string{"192.0.2.10/24"},
				Nameservers: &Nameservers{
					Addresses: []string{"1.1.1.1"},
					Search:    []string{"example.test"},
				},
				Routes: []Route{{To: "default", Via: "192.0.2.1", Metric: 100}},
			},
		},
	}
}

func TestValidateConfigRejectsUntypedOrInjectionShapedValues(t *testing.T) {
	for name, mutate := range map[string]func(*Config){
		"version": func(config *Config) { config.Version = 1 },
		"interface": func(config *Config) {
			config.Ethernets = map[string]EthernetConfig{"eth0.dhcp4=false": {DHCP4: true}}
		},
		"address": func(config *Config) { config.Ethernets["eth0"] = EthernetConfig{Addresses: []string{"not-an-address"}} },
		"dns": func(config *Config) {
			value := config.Ethernets["eth0"]
			value.Nameservers = &Nameservers{Addresses: []string{"1.1.1.1; reboot"}}
			config.Ethernets["eth0"] = value
		},
		"route": func(config *Config) {
			value := config.Ethernets["eth0"]
			value.Routes = []Route{{To: "default", Via: "192.0.2.1; reboot"}}
			config.Ethernets["eth0"] = value
		},
	} {
		t.Run(name, func(t *testing.T) {
			config := validConfig()
			mutate(&config)
			if err := ValidateConfig(config); !errors.Is(err, ErrValidation) {
				t.Fatalf("error = %v", err)
			}
		})
	}
}

const testBaseYAML = "network:\n  version: 2\n"
const testAppliedYAML = "network:\n  version: 2\n  ethernets: {}\n"

func TestControllerApplyAndConfirm(t *testing.T) {
	backend := &fakeBackend{base: testBaseYAML, applied: testAppliedYAML, path: "/io/netplan/Netplan/config/TEST"}
	controller := newController(backend)
	revision := Revision(backend.base)
	pending, err := controller.Apply(context.Background(), validConfig(), revision, 30)
	if err != nil {
		t.Fatal(err)
	}
	if len(pending.Token) != 64 || pending.PreviousRevision != revision || pending.ConfirmTimeout != 30 {
		t.Fatalf("pending = %+v", pending)
	}
	if len(backend.deltas) != 1 || !strings.HasPrefix(backend.deltas[0], "90-lumo:ethernets.eth0=") {
		t.Fatalf("deltas = %v", backend.deltas)
	}
	if strings.Contains(backend.deltas[0], "network:") || len(backend.tried) != 1 || backend.tried[0] != 30 {
		t.Fatalf("deltas=%v tried=%v", backend.deltas, backend.tried)
	}
	if _, err := controller.Confirm(context.Background(), pending.Token); err != nil {
		t.Fatal(err)
	}
	if backend.applyCnt != 1 || backend.canceled != 1 {
		t.Fatalf("applyCnt=%d canceled=%d", backend.applyCnt, backend.canceled)
	}
}

func TestControllerRejectsStaleBusyAndWrongToken(t *testing.T) {
	backend := &fakeBackend{base: testBaseYAML, applied: testAppliedYAML, path: "/io/netplan/Netplan/config/TEST"}
	controller := newController(backend)
	_, err := controller.Apply(context.Background(), validConfig(), Revision("different"), 30)
	var stale *StaleError
	if !errors.As(err, &stale) {
		t.Fatalf("error = %v", err)
	}
	pending, err := controller.Apply(context.Background(), validConfig(), Revision(backend.base), 30)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := controller.Apply(context.Background(), validConfig(), Revision(backend.base), 30); !errors.Is(err, ErrBusy) {
		t.Fatalf("busy error = %v", err)
	}
	if _, err := controller.Confirm(context.Background(), strings.Repeat("0", 64)); !errors.Is(err, ErrToken) {
		t.Fatalf("token error = %v", err)
	}
	if _, err := controller.Confirm(context.Background(), pending.Token); err != nil {
		t.Fatal(err)
	}
}

func TestControllerExpiryCancelsAndVerifiesRollback(t *testing.T) {
	backend := &fakeBackend{base: testBaseYAML, applied: testAppliedYAML, path: "/io/netplan/Netplan/config/TEST"}
	controller := newController(backend)
	pending, err := controller.Apply(context.Background(), validConfig(), Revision(backend.base), 30)
	if err != nil {
		t.Fatal(err)
	}
	controller.expire(pending.Token, backend.path)
	if backend.canceled < 2 {
		t.Fatalf("cancel calls = %d", backend.canceled)
	}
	if _, err := controller.Confirm(context.Background(), pending.Token); !errors.Is(err, ErrExpired) {
		t.Fatalf("confirm error = %v", err)
	}
}

func TestControllerConfirmAfterRevertReturnsExpired(t *testing.T) {
	backend := &fakeBackend{base: testBaseYAML, applied: testAppliedYAML, path: "/io/netplan/Netplan/config/TEST"}
	controller := newController(backend)
	pending, err := controller.Apply(context.Background(), validConfig(), Revision(backend.base), 30)
	if err != nil {
		t.Fatal(err)
	}
	_ = backend.cancel(context.Background(), backend.path)
	if _, err := controller.Confirm(context.Background(), pending.Token); !errors.Is(err, ErrExpired) {
		t.Fatalf("confirm error = %v", err)
	}
	if backend.applyCnt != 0 {
		t.Fatalf("reverted configuration was applied: %d", backend.applyCnt)
	}
	if _, err := controller.Apply(context.Background(), validConfig(), Revision(backend.base), 30); err != nil {
		t.Fatalf("controller must recover after a reverted confirmation: %v", err)
	}
}
