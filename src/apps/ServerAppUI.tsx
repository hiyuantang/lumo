// SPDX-License-Identifier: AGPL-3.0-only
import { IconRefresh } from '../shell/icons';
import { type ReactNode } from 'react';
import { AppModal } from '../shell/AppModal';
import type { AppLogs } from '../api/server-apps';

export const errorText = (err: unknown) => err instanceof Error ? err.message : 'The request failed. Try again.';

export function AppConfirmation({ title, children, confirm, onConfirm, onCancel, busy = false, confirmDisabled = false }: { title: string; children: ReactNode; confirm: string; onConfirm: () => void; onCancel: () => void; busy?: boolean; confirmDisabled?: boolean }) {
  return <AppModal onCancel={() => { if (!busy) onCancel(); }}>
    <div className="file-confirm server-app-confirm" role="alertdialog" aria-label={title} data-testid="server-app-confirm">
      <h2>{title}</h2>{children}
      <div className="file-confirm-actions">
        <button className="btn" type="button" onClick={onCancel} disabled={busy}>Cancel</button>
        <button className="btn btn-primary" type="button" data-testid="server-app-confirm-ok" onClick={onConfirm} disabled={busy || confirmDisabled}>{busy ? 'Working…' : confirm}</button>
      </div>
    </div>
  </AppModal>;
}

export function AppLogView({ logs, loading, error, onRefresh }: { logs: AppLogs | null; loading: boolean; error: string | null; onRefresh: () => void }) {
  return <section className="server-app-log-section" aria-label="Logs">
    <div className="server-app-section-heading"><h3>Recent logs</h3><button aria-label="Refresh" title="Refresh" className="btn btn-icon" type="button" onClick={onRefresh} disabled={loading}><IconRefresh size={16}/></button></div>
    {error && <p role="alert" className="server-app-error">{error}</p>}
    <pre className="server-app-logs" data-testid="server-app-logs" tabIndex={0}>{loading && !logs ? 'Loading logs…' : logs?.text || 'No entries.'}</pre>
    {logs?.truncated && <p className="server-app-muted">Log truncated.</p>}
  </section>;
}
