// SPDX-License-Identifier: AGPL-3.0-only
import { useId, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PiModel, PiStats } from '../api/pi';

export function PiContextMeter({ stats, model }: { stats: PiStats; model?: PiModel }) {
  const id = useId();
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const usage = stats.contextUsage;
  const capacity = usage?.contextWindow || model?.contextWindow;
  const tokens = usage?.tokens;
  const compactAt = stats.compaction?.enabled ? stats.compaction.threshold : undefined;
  const limit = compactAt ?? capacity;
  const percent = tokens != null && limit ? tokens / limit * 100 : compactAt == null ? usage?.percent : null;
  const known = percent != null && Number.isFinite(percent);
  const fraction = known ? Math.max(0, Math.min(100, percent)) : 0;
  const description = known ? `${Number(percent.toFixed(1))}% ${compactAt != null ? 'of compaction budget used' : 'context used'}` : 'Context usage not yet reported';
  return <span className="pi-context-meter" tabIndex={0} role="img" aria-label={description} aria-describedby={id} data-testid="pi-context-meter" onMouseEnter={(event) => setAnchor(event.currentTarget.getBoundingClientRect())} onMouseLeave={() => setAnchor(null)} onFocus={(event) => setAnchor(event.currentTarget.getBoundingClientRect())} onBlur={() => setAnchor(null)}>
    <svg width="19" height="19" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><circle className="pi-context-progress" cx="12" cy="12" r="8" pathLength="100" strokeDasharray={`${fraction} 100`} transform="rotate(-90 12 12)"/></svg>
    {anchor && createPortal(<span className="pi-context-tooltip" role="tooltip" id={id} style={{ left: Math.max(8, Math.min(anchor.left - 110, window.innerWidth - 248)), top: Math.max(8, anchor.top - 124) }}><strong>{description}</strong><span>{tokens != null ? `${tokens.toLocaleString()} tokens used` : 'Token usage updates after Pi reports it'}</span>{stats.compaction && <span>{stats.compaction.enabled ? `Compact at: ${stats.compaction.threshold.toLocaleString()} tokens` : 'Automatic compaction off'}</span>}{stats.cost != null && <span>Conversation cost: ${stats.cost.toFixed(3)}</span>}</span>, document.body)}
  </span>;
}
