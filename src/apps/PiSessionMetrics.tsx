// SPDX-License-Identifier: AGPL-3.0-only
import type { PiSessionMetrics as Metrics } from '../api/pi';

export function PiSessionMetrics({ metrics }: { metrics?: Metrics }) {
  const cache = metrics && metrics.inputTokens > 0 ? metrics.cachedTokens / metrics.inputTokens * 100 : undefined;
  const speed = metrics && metrics.timedResponses > 0 && metrics.responseMs > 0 ? metrics.outputTokens / (metrics.responseMs / 1000) : undefined;
  return <div className="pi-session-metrics" data-testid="pi-session-metrics" aria-label="Conversation statistics">
    <span title="Cached input tokens divided by all reported input tokens in this conversation branch. 0% means no cache hits were reported; unavailable usage is shown as —.">Cache {cache == null ? '—' : `${Number(cache.toFixed(1))}%`}</span>
    <span aria-hidden="true">·</span>
    <span title="Average output tokens per second across timed model responses in this conversation branch. Includes the wait for the first token; excludes tool execution and approval waits. Older responses without recorded timing are excluded.">{speed == null ? '—' : speed.toFixed(1)} tok/s</span>
  </div>;
}
