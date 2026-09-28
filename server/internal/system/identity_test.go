// SPDX-License-Identifier: AGPL-3.0-only
package system

import "testing"

func TestParseOSRelease(t *testing.T) {
	content := "NAME=\"Ubuntu\"\nVERSION_ID=\"24.04\"\nPRETTY_NAME=\"Ubuntu 24.04.1 LTS\"\nID=ubuntu\n# comment\nBADLINE\n"
	kv := parseOSRelease(content)
	if kv["ID"] != "ubuntu" {
		t.Errorf("ID = %q", kv["ID"])
	}
	if kv["VERSION_ID"] != "24.04" {
		t.Errorf("VERSION_ID = %q", kv["VERSION_ID"])
	}
	if kv["PRETTY_NAME"] != "Ubuntu 24.04.1 LTS" {
		t.Errorf("PRETTY_NAME = %q", kv["PRETTY_NAME"])
	}
	if _, ok := kv["BADLINE"]; ok {
		t.Error("bad line should be skipped")
	}
}

func TestMachineArch(t *testing.T) {
	if machineArch() == "" {
		t.Error("empty architecture")
	}
}

func TestParseCPUModel(t *testing.T) {
	for _, tc := range []struct{ name, input, want string }{
		{"repeated cores", "processor : 0\nmodel name : AMD EPYC 7763\nprocessor : 1\nmodel name : AMD EPYC 7763\n", "AMD EPYC 7763"},
		{"mixed models", "model name : Cortex-A76\nmodel name : Cortex-A55\nmodel name : Cortex-A76", "Cortex-A76; Cortex-A55"},
		{"missing model", "processor : 0\nCPU architecture : 8\nHardware : Board name", ""},
		{"empty and malformed", "model name\nmodel name :   \n", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := parseCPUModel(tc.input); got != tc.want {
				t.Fatalf("parseCPUModel() = %q, want %q", got, tc.want)
			}
		})
	}
}
