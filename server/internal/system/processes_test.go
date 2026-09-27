// SPDX-License-Identifier: AGPL-3.0-only
package system

import (
	"os"
	"testing"
)

func TestParseProcessStatWithParenthesesAndSpaces(t *testing.T) {
	item, err := parseProcessStat("42 (worker (pool) 2) R 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21")
	if err != nil {
		t.Fatal(err)
	}
	if item.PID != 42 || item.Name != "worker (pool) 2" || item.State != "R" || item.ticks != 23 || item.start != 19 || item.MemoryBytes != 21*uint64(os.Getpagesize()) {
		t.Fatalf("unexpected process: %+v", item)
	}
	for _, raw := range []string{"", "12 worker R", "12 (worker) R 1", "invalid (worker) R 1"} {
		if _, err := parseProcessStat(raw); err == nil {
			t.Fatalf("accepted malformed stat %q", raw)
		}
	}
}
