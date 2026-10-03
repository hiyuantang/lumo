// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from 'react';
import { describeError, getDataSource, type SystemOverview } from '@lumo/sdk/api/source';
import { formatSize } from '@lumo/sdk/utils/file-format';

import './home.css';

function formatUptime(totalSeconds: number): string {
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${days}d ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function Sparkline({ values }: { values: number[] }) {
  const w = 220;
  const h = 36;
  const max = Math.max(100, ...values);
  const points = values
    .map((v, i) => `${((i / Math.max(1, values.length - 1)) * w).toFixed(1)},${(h - (v / max) * (h - 3)).toFixed(1)}`)
    .join(' ');
  return (
    <svg className="home-sparkline" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <polyline points={points} fill="none" stroke="var(--accent)" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

export function Home({ section = 'overview' }: { section?: 'overview' | 'cpu' | 'memory' | 'network' }) {
  const source = getDataSource();
  const [overview, setOverview] = useState<SystemOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const next = await source.getOverview();
        if (!alive) return;
        setOverview(next);
        setError(null);
      } catch (err) {
        if (!alive) return;
        setError(describeError(err));
      }
    };
    void load();
    const id = window.setInterval(() => void load(), 2000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [source, retryNonce]);

  if (!overview) {
    return (
      <div className="app home" data-testid="app-home">
        <div className="home-grid">
          <section className="home-card home-identity" aria-label="System status">
            {error ? (
              <>
                <h2>Cannot reach the server</h2>
                <p className="home-muted">{error}</p>
                <button type="button" className="btn" data-testid="home-retry" onClick={() => setRetryNonce((n) => n + 1)}>
                  Retry
                </button>
              </>
            ) : (
              <h2>Connecting…</h2>
            )}
          </section>
        </div>
      </div>
    );
  }

  const memPct = overview.memoryTotalMb > 0 ? Math.round((overview.memoryUsedMb / overview.memoryTotalMb) * 100) : 0;
  const diskPct = overview.storageTotalGb > 0 ? Math.round((overview.storageUsedGb / overview.storageTotalGb) * 100) : 0;

  if (section !== 'overview') return <div className="app home monitor-detail" data-testid={`monitor-${section}`}>
    <h2>{section === 'cpu' ? 'CPU' : section === 'memory' ? 'Memory' : 'Network'}</h2>
    {error && <p role="alert" className="monitor-error">{error} Showing the last received sample.</p>}
    {section === 'cpu' ? <>
      <section className="home-card"><h3>Total CPU usage</h3><p className="home-big">{overview.cpuPercent}%</p><Sparkline values={overview.cpuHistory}/><p className="home-muted">{overview.cpuCores} logical cores · Load average {overview.cpuLoad.map((value) => value.toFixed(2)).join(' / ')} (1, 5, 15 min)</p></section>
      <div className="monitor-core-grid">{overview.cpuPerCore.map((core) => <section className="monitor-core" key={core.id} data-testid={`cpu-core-${core.id}`}><header><span>CPU {core.id}</span><strong>{core.usagePercent === null ? '—' : `${core.usagePercent.toFixed(1)}%`}</strong></header><div className="meter" role="meter" aria-label={`CPU ${core.id} usage`} aria-valuenow={core.usagePercent ?? undefined} aria-valuemin={0} aria-valuemax={100}><div className="meter-fill" style={{ width: `${core.usagePercent ?? 0}%` }}/></div></section>)}</div>
      {!overview.cpuPerCore.length && <p className="home-muted">Per-core metrics are unavailable from this server.</p>}
    </> : section === 'memory' ? <section className="home-card"><h3>Memory in use</h3><p className="home-big">{memPct}%</p><div className="meter" role="meter" aria-label="Memory usage" aria-valuenow={memPct} aria-valuemin={0} aria-valuemax={100}><div className="meter-fill" style={{ width: `${memPct}%` }}/></div><p className="home-muted">{formatSize(overview.memoryUsedMb * 1048576)} used · {formatSize(Math.max(0, overview.memoryTotalMb - overview.memoryUsedMb) * 1048576)} available · {formatSize(overview.memoryTotalMb * 1048576)} total</p></section> : <>
      {overview.network.map((item) => <section className="home-card" key={item.interface}><h3>{item.interface}</h3><div className="monitor-network"><div><p className="home-muted">Receiving</p><p className="home-big">{formatSize(item.rxBytesPerSec)}/s</p></div><div><p className="home-muted">Sending</p><p className="home-big">{formatSize(item.txBytesPerSec)}/s</p></div></div></section>)}
      {!overview.network.length && <p className="home-muted">Waiting for network activity metrics…</p>}
    </>}
  </div>;

  return (
    <div className="app home" data-testid="app-home">
      {error && <p role="alert" className="monitor-error">{error} Showing the last received sample.</p>}
      <div className="home-grid">
        <section className="home-card home-identity" aria-label="System">
          <h2>{overview.hostname}</h2>
          <dl>
            <div>
              <dt>OS</dt>
              <dd>{overview.os}</dd>
            </div>
            <div>
              <dt>Kernel</dt>
              <dd className="mono">{overview.kernel}</dd>
            </div>
            <div>
              <dt>Uptime</dt>
              <dd className="mono">{formatUptime(source.uptimeSeconds())}</dd>
            </div>
          </dl>
        </section>

        <section className="home-card" aria-label="CPU">
          <h3>CPU</h3>
          <p className="home-big">{overview.cpuPercent}%</p>
          <Sparkline values={overview.cpuHistory} />
        </section>

        <section className="home-card" aria-label="Memory">
          <h3>Memory</h3>
          <p className="home-big">{memPct}%</p>
          <div className="meter" role="meter" aria-valuenow={memPct} aria-valuemin={0} aria-valuemax={100} aria-label="Memory usage">
            <div className="meter-fill" style={{ width: `${memPct}%` }} />
          </div>
          <p className="home-muted">
            {(overview.memoryUsedMb / 1024).toFixed(1)} of {(overview.memoryTotalMb / 1024).toFixed(0)} GB
          </p>
        </section>

        <section className="home-card" aria-label="Storage">
          <h3>Storage</h3>
          <p className="home-big">{diskPct}%</p>
          <div className="meter" role="meter" aria-valuenow={diskPct} aria-valuemin={0} aria-valuemax={100} aria-label="Storage usage">
            <div className="meter-fill" style={{ width: `${diskPct}%` }} />
          </div>
          <p className="home-muted">
            {overview.storageUsedGb} of {overview.storageTotalGb} GB
          </p>
        </section>

        <section className="home-card" aria-label="Updates">
          <h3>Updates</h3>
          <p className="home-big">{overview.pendingUpdates}</p>
          <p className="home-muted">{overview.securityUpdates} security</p>
        </section>

        <section className="home-card home-alerts" aria-label="Alerts">
          <h3>Alerts</h3>
          <ul>
            {overview.alerts.map((alert) => (
              <li key={alert.id} className={`home-alert level-${alert.level}`}>
                <span className="home-alert-dot" aria-hidden="true" />
                {alert.text}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
