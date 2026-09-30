// SPDX-License-Identifier: AGPL-3.0-only
package httpapi

import (
	"encoding/json"
	"time"
)

type piRetry struct {
	Attempt      int    `json:"attempt"`
	MaxAttempts  int    `json:"maxAttempts"`
	RetryAt      int64  `json:"retryAt"`
	ErrorMessage string `json:"errorMessage"`
	Source       string `json:"source"`
}

func (p *piProcess) trackRetry(kind string, raw json.RawMessage) {
	switch kind {
	case "auto_retry_start", "summarization_retry_scheduled":
		var event struct {
			Attempt      int    `json:"attempt"`
			MaxAttempts  int    `json:"maxAttempts"`
			DelayMs      int64  `json:"delayMs"`
			ErrorMessage string `json:"errorMessage"`
		}
		if json.Unmarshal(raw, &event) != nil {
			return
		}
		source := "response"
		if kind == "summarization_retry_scheduled" {
			source = "summary"
		}
		delay := max(int64(0), min(event.DelayMs, int64(86400000)))
		p.retry = &piRetry{event.Attempt, event.MaxAttempts, time.Now().UnixMilli() + delay, event.ErrorMessage, source}
	case "auto_retry_end", "summarization_retry_finished", "agent_settled":
		p.retry = nil
	}
}
