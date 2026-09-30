// SPDX-License-Identifier: AGPL-3.0-only
package httpapi

import "encoding/json"

type piSessionMetrics struct {
	InputTokens    int64   `json:"inputTokens"`
	CachedTokens   int64   `json:"cachedTokens"`
	OutputTokens   int64   `json:"outputTokens"`
	ResponseMs     float64 `json:"responseMs"`
	TimedResponses int64   `json:"timedResponses"`
}

func (p *piProcess) trackMetrics(text string) {
	var metrics piSessionMetrics
	if json.Unmarshal([]byte(text), &metrics) != nil || metrics.InputTokens < 0 || metrics.CachedTokens < 0 || metrics.CachedTokens > metrics.InputTokens || metrics.OutputTokens < 0 || metrics.ResponseMs < 0 || metrics.TimedResponses < 0 {
		return
	}
	p.metrics = &metrics
}

func (p *piProcess) metricsStats(raw json.RawMessage) json.RawMessage {
	p.mu.Lock()
	metrics := p.metrics
	p.mu.Unlock()
	if metrics == nil {
		return raw
	}
	var reply map[string]json.RawMessage
	var data map[string]json.RawMessage
	if json.Unmarshal(raw, &reply) != nil || string(reply["success"]) != "true" || json.Unmarshal(reply["data"], &data) != nil || data == nil {
		return raw
	}
	data["metrics"], _ = json.Marshal(metrics)
	reply["data"], _ = json.Marshal(data)
	result, err := json.Marshal(reply)
	if err != nil {
		return raw
	}
	return result
}
