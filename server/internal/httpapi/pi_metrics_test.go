// SPDX-License-Identifier: AGPL-3.0-only
package httpapi

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestPiMetricsStatsArePerProcessAndPreserveNativeUsage(t *testing.T) {
	first, second := &piProcess{}, &piProcess{}
	first.trackMetrics(`{"inputTokens":1000,"cachedTokens":800,"outputTokens":90,"responseMs":3000,"timedResponses":2}`)
	second.trackMetrics(`{"inputTokens":100,"cachedTokens":0,"outputTokens":20,"responseMs":2000,"timedResponses":1}`)
	raw := json.RawMessage(`{"success":true,"data":{"tokens":{"total":2345},"compaction":{"enabled":true,"threshold":150000}}}`)
	for _, p := range []*piProcess{first, second} {
		var reply struct {
			Data struct {
				Metrics piSessionMetrics `json:"metrics"`
			} `json:"data"`
		}
		result := p.metricsStats(raw)
		if json.Unmarshal(result, &reply) != nil || reply.Data.Metrics != *p.metrics || !strings.Contains(string(result), `"total":2345`) || !strings.Contains(string(result), `"threshold":150000`) {
			t.Fatalf("unexpected stats: %s", result)
		}
	}
	if string((&piProcess{}).metricsStats(raw)) != string(raw) {
		t.Fatal("missing measurements must stay unavailable")
	}
	failed := json.RawMessage(`{"success":false,"error":"unavailable"}`)
	if string(first.metricsStats(failed)) != string(failed) {
		t.Fatal("must preserve native errors")
	}
}

func TestPiMetricsRejectInvalidMeasurements(t *testing.T) {
	for _, input := range []string{`broken`, `{"inputTokens":-1}`, `{"inputTokens":10,"cachedTokens":11}`, `{"outputTokens":-1}`, `{"responseMs":-1}`, `{"timedResponses":-1}`} {
		p := &piProcess{}
		p.trackMetrics(input)
		if p.metrics != nil {
			t.Fatalf("accepted invalid measurements: %s", input)
		}
	}
}
