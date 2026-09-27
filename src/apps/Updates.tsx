// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from 'react';
import { describeError, getDataSource, type UpdatePlan, type UpdateProgress } from '../api/source';
import { useShell } from '../shell/ShellContext';
import '../styles/apps.css';
import '../styles/updates.css';

type Operation = 'refresh' | 'plan' | 'apply' | null;

export function Updates() {
  const source = getDataSource();
  const { actions } = useShell();
  const [plan, setPlan] = useState<UpdatePlan | null>(null);
  const [operation, setOperation] = useState<Operation>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [rebootRequired, setRebootRequired] = useState(false);

  useEffect(() => {
    let alive = true;
    source
      .getOverview()
      .then((overview) => {
        if (alive) setRebootRequired(overview.alerts.some((alert) => alert.id === 'reboot-required'));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [source]);

  useEffect(() => {
    if (!requestId) return;
    return source.subscribeUpdateProgress(
      requestId,
      (next) => {
        setProgress(next);
        if (next.done) {
          setOperation(null);
          if (next.success) {
            setPlan(null);
            actions.notify('Updates installed', '');
            source
              .getOverview()
              .then((overview) => setRebootRequired(overview.alerts.some((alert) => alert.id === 'reboot-required')))
              .catch(() => {});
          } else {
            setError(next.error || 'The update installation failed.');
          }
        }
      },
      (err) => {
        setOperation(null);
        setError(describeError(err));
      },
    );
  }, [actions, requestId, source]);

  async function refresh() {
    setOperation('refresh');
    setError(null);
    setPlan(null);
    try {
      setRefreshedAt(await source.refreshUpdates());
      actions.notify('Package list refreshed', '');
    } catch (err) {
      setError(describeError(err));
    } finally {
      setOperation(null);
    }
  }

  async function calculatePlan() {
    setOperation('plan');
    setError(null);
    try {
      setPlan(await source.calculateUpdatePlan());
      setProgress(null);
      setRequestId(null);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setOperation(null);
    }
  }

  async function applyPlan() {
    if (!plan) return;
    setConfirming(false);
    setOperation('apply');
    setError(null);
    setProgress(null);
    try {
      setRequestId(await source.applyUpdatePlan(plan.id));
    } catch (err) {
      setOperation(null);
      setError(describeError(err));
    }
  }

  return (
    <div className="app updates" data-testid="app-updates">
      <div className="app-toolbar updates-toolbar">
        <button type="button" className="btn" data-testid="updates-refresh" disabled={operation !== null} onClick={() => void refresh()}>
          {operation === 'refresh' ? 'Refreshing…' : 'Refresh package list'}
        </button>
        <button type="button" className="btn btn-primary" data-testid="updates-plan" disabled={operation !== null} onClick={() => void calculatePlan()}>
          {operation === 'plan' ? 'Checking…' : 'Check for updates'}
        </button>
        {refreshedAt && <span className="updates-refreshed">Refreshed {formatDate(refreshedAt)}</span>}
      </div>

      <div className="updates-body">
        <header className="updates-header">
          <div>
            <h2>Software Updates</h2>
          </div>
          {rebootRequired && <span className="updates-reboot" data-testid="updates-reboot-required">Reboot required</span>}
        </header>

        {error && <p className="updates-error" role="alert">{error}</p>}

        {progress && (
          <section className="updates-progress" data-testid="updates-progress" aria-live="polite">
            <div>
              <strong>{progress.message}</strong>
              <span>{progress.percent}%</span>
            </div>
            <div className="meter"><div className="meter-fill" style={{ width: `${progress.percent}%` }} /></div>
            {!progress.done && <p>Installation continues if you disconnect.</p>}
          </section>
        )}

        {!plan && !progress && (
          <div className="updates-empty">
            <p>Check for available updates.</p>
          </div>
        )}

        {plan && (
          <>
            <section className="updates-summary" data-testid="updates-plan-summary">
              <div><strong>{plan.packages.length}</strong><span>packages</span></div>
              <div><strong>{plan.securityCount}</strong><span>security</span></div>
              <div><strong>{formatBytes(plan.downloadBytes)}</strong><span>download</span></div>
              <div><strong>{formatDelta(plan.installedDeltaBytes)}</strong><span>disk change</span></div>
            </section>

            {plan.packages.length === 0 ? (
              <div className="updates-empty"><p>Up to date.</p></div>
            ) : (
              <div className="updates-table" role="table" aria-label="Update plan">
                <div className="updates-row updates-row-head" role="row">
                  <span>Package</span><span>Version</span><span>Download</span>
                </div>
                {plan.packages.map((pkg) => (
                  <div className="updates-row" role="row" key={pkg.name} data-testid={`update-package-${pkg.name}`}>
                    <span className="updates-package">
                      <strong>{pkg.name}</strong>
                      {pkg.security && <span className="updates-security">Security</span>}
                    </span>
                    <span className="mono updates-version"><s>{pkg.fromVersion || 'new'}</s><b>{pkg.toVersion}</b></span>
                    <span className="mono">{formatBytes(pkg.downloadBytes)}</span>
                  </div>
                ))}
              </div>
            )}

            <footer className="updates-plan-footer">
              <p>Review expires {formatDate(plan.expiresAt)}.</p>
              <button
                type="button"
                className="btn btn-primary"
                data-testid="updates-apply"
                disabled={operation !== null || plan.packages.length === 0}
                onClick={() => setConfirming(true)}
              >
                Install updates
              </button>
            </footer>
          </>
        )}
      </div>

      {confirming && plan && (
        <div className="quicklook-overlay" onPointerDown={() => setConfirming(false)}>
          <div className="file-confirm" role="alertdialog" aria-modal="true" aria-label="Install update plan" data-testid="updates-confirm" onPointerDown={(event) => event.stopPropagation()}>
            <p>Install {plan.packages.length} package update{plan.packages.length === 1 ? '' : 's'}?</p>
            <span className="updates-confirm-note">This cannot be undone automatically.</span>
            <div className="file-confirm-actions">
              <button type="button" className="btn" onClick={() => setConfirming(false)}>Cancel</button>
              <button type="button" className="btn btn-primary" data-testid="updates-confirm-apply" onClick={() => void applyPlan()}>Install</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
}

function formatDelta(bytes: number): string {
  if (bytes === 0) return 'No change';
  return `${bytes > 0 ? '+' : '−'}${formatBytes(Math.abs(bytes))}`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}
