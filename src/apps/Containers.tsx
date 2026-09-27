// SPDX-License-Identifier: AGPL-3.0-only
import { useAppState } from '../shell/useAppState';
import { useEffect, useState } from 'react';
import { getDataSource, isReauthRequired } from '../api/source';
import type { DockerResources, AppLogs, ContainerAction, ContainerDetail, ContainerSnapshot } from '../api/server-apps';
import { useReauth } from '../shell/ReauthSheet';
import { useShell } from '../shell/ShellContext';
import { IconBoxes, IconSearch, IconRefresh } from '../shell/icons';
import { errorText, AppConfirmation, AppLogView } from './ServerAppUI';
import { dockerSize } from '../utils/docker-format';
import '../styles/apps.css';
import '../styles/server-apps.css';

const LABELS: Record<ContainerAction, string> = { start: 'Start', stop: 'Stop', restart: 'Restart' };

export function Containers({ resources, resourceRefresh, onRemove, onRefresh }: { resources: DockerResources | null; resourceRefresh: number; onRemove: (item: ContainerDetail) => void; onRefresh: () => void }) {
  const source = getDataSource();
  const { actions, state } = useShell();
  const reauth = useReauth();
  const [snapshot, setSnapshot] = useState<ContainerSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [query, setQuery] = useAppState<string>('containers', 'query', '');
  const [filter, setFilter] = useAppState<string>('containers', 'filter', 'all');
  const [selectedID, setSelectedID] = useAppState<string | null>('containers', 'selection', null);
  const [detail, setDetail] = useState<ContainerDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [tab, setTab] = useAppState<'overview' | 'logs'>('containers', 'tab', 'overview', ['overview', 'logs']);
  const [logRefresh, setLogRefresh] = useState(0);
  const [logs, setLogs] = useState<AppLogs | null>(null);
  const [logError, setLogError] = useState<string | null>(null);
  const [logLoading, setLogLoading] = useState(false);
  const [pending, setPending] = useState<{ detail: ContainerDetail; action: ContainerAction } | null>(null);
  const [busy, setBusy] = useState(false);
  const visible = !state.windows.containers?.minimized;

  useEffect(() => {
    let alive = true;
    let loading = false;
    const load = async () => {
      if (loading) return;
      loading = true;
      try { const next = await source.getContainers(); if (alive) { setSnapshot(next); setError(null); } }
      catch (err) { if (alive) setError(errorText(err)); }
      finally { loading = false; }
    };
    void load();
    const timer = window.setInterval(() => { if (visible && !document.hidden) void load(); }, 15_000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [source, refresh, visible, resourceRefresh]);

  const containers = snapshot?.containers ?? [];
  const filtered = containers.filter((item) => (filter === 'all' || (filter === 'running' ? item.state === 'running' : item.state !== 'running')) && `${item.name} ${item.image} ${item.project}`.toLowerCase().includes(query.toLowerCase()));
  const selected = filtered.find((item) => item.id === selectedID) ?? filtered[0];

  useEffect(() => {
    let alive = true;
    setDetail(null); setDetailError(null); setLogs(null);
    if (selected) void source.getContainer(selected.id).then((next) => { if (alive) setDetail(next); }).catch((err) => { if (alive) setDetailError(errorText(err)); });
    return () => { alive = false; };
  }, [source, selected?.id, selected?.state, selected?.status, refresh, resourceRefresh]);

  useEffect(() => {
    let alive = true;
    if (tab !== 'logs' || !selected) return;
    setLogLoading(true); setLogError(null);
    void source.getContainerLogs(selected.id).then((next) => { if (alive) setLogs(next); }).catch((err) => { if (alive) setLogError(errorText(err)); }).finally(() => { if (alive) setLogLoading(false); });
    return () => { alive = false; };
  }, [source, selected?.id, tab, logRefresh]);

  async function run(item: ContainerDetail, action: ContainerAction) {
    setBusy(true); setDetailError(null); setPending(null);
    try {
      const next = await source.runContainerAction(item.id, action, item.revision);
      setDetail((current) => current?.id === next.id ? next : current); setRefresh((n) => n + 1);
      actions.notify('Container updated', `${next.name} is ${next.state}.`);
    } catch (err) {
      if (isReauthRequired(err)) { reauth(() => { void run(item, action); }); }
      else { setDetailError(errorText(err)); }
    } finally { setBusy(false); }
  }

  const refreshButton = <button className="btn docker-refresh" type="button" aria-label="Refresh containers" title="Refresh containers" onClick={onRefresh} data-testid="containers-refresh"><IconRefresh size={15}/></button>;

  return <div className="docker-container-view">
    {error && <p className="server-app-error" role="alert">{error}</p>}
    {!snapshot ? <div className="server-app-empty">{error ? 'Containers unavailable.' : 'Connecting to Docker…'}{error && refreshButton}</div> : snapshot.status !== 'ready' ? <div className="server-app-empty"><IconBoxes size={44}/><h2>{snapshot.status === 'not-installed' ? 'Docker not installed' : snapshot.status === 'permission-denied' ? 'Docker access required' : 'Docker unavailable'}</h2><p>{snapshot.message}</p>{snapshot.status === 'permission-denied' ? <p>An administrator must grant Docker access. Sign in again afterward.</p> : null}<div className="server-app-actions">{refreshButton}{snapshot.status === 'stopped' && <button type="button" className="btn btn-primary" onClick={() => actions.openService('docker.service')}>Docker service</button>}<button type="button" className="btn" onClick={() => actions.openLibrary('docker')}>Open App Library</button></div></div> : <div className="server-app-body">
      <aside className="server-app-sidebar" aria-label="Containers"><div className="server-app-section-heading"><h2>Containers</h2><span className="pill">{containers.length}</span>{refreshButton}</div><label className="app-search"><IconSearch size={14}/><input aria-label="Search containers" placeholder="Search containers" value={query} onChange={(e) => setQuery(e.target.value)}/></label><div className="server-app-filters" aria-label="Filter containers">{['all', 'running', 'stopped'].map((value) => <button type="button" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{value === 'all' ? 'All' : value === 'running' ? 'Running' : 'Stopped'}</button>)}</div><div className="server-app-resource-list">{filtered.map((item) => <button type="button" key={item.id} className={`server-app-resource${selected?.id === item.id ? ' selected' : ''}`} data-testid={`container-row-${item.name}`} aria-pressed={selected?.id === item.id} onClick={() => setSelectedID(item.id)}><span className={`server-app-state-dot${item.state === 'running' ? ' on' : ''}`}/><span><strong>{item.name}</strong><small>{item.project || item.image}</small></span><span className="server-app-resource-state">{item.state}</span></button>)}</div>{filtered.length === 0 && <p className="server-app-muted">{containers.length ? 'No matching containers.' : 'No containers.'}</p>}</aside>
      <main className="server-app-detail">
        {selected ? <><header className="server-app-detail-heading"><span className="server-app-large-icon"><IconBoxes size={28}/></span><div><h2>{selected.name}</h2><p>{selected.image}</p></div><span className={`pill pill-${selected.state === 'running' ? 'active' : 'inactive'}`}>{selected.state}</span></header><div className="server-app-actions">{(['start', 'restart', 'stop'] as const).map((action) => <button className={`btn${action === 'start' ? ' btn-primary' : ''}`} type="button" key={action} data-testid={`container-${action}`} disabled={!detail || busy || (action === 'start' ? selected.state === 'running' : selected.state !== 'running')} onClick={() => { if (!detail) return; if (action === 'start') void run(detail, action); else setPending({ detail, action }); }}>{busy ? 'Working…' : LABELS[action]}</button>)}<button className="btn" type="button" disabled={!detail || busy || !['exited', 'created', 'dead'].includes(selected.state)} onClick={() => detail && onRemove(detail)}>Remove…</button></div>{detailError && <div className="server-app-error" role="alert">{detailError}<button type="button" className="btn" onClick={() => setRefresh((n) => n + 1)}>Refresh</button></div>}<div className="server-app-tabs" role="tablist" aria-label="Container details">{(['overview', 'logs'] as const).map((value) => <button role="tab" type="button" key={value} aria-selected={tab === value} onClick={() => setTab(value)}>{value === 'overview' ? 'Overview' : 'Logs'}</button>)}</div>
        {tab === 'logs' ? <AppLogView logs={logs} error={logError} loading={logLoading} onRefresh={() => setLogRefresh((n) => n + 1)}/> : detail ? <><dl className="server-app-facts"><div><dt>Container ID</dt><dd className="mono">{detail.id.slice(0, 12)}</dd></div><div><dt>Compose project</dt><dd>{detail.project || 'Standalone'}</dd></div><div><dt>Started</dt><dd>{detail.startedAt && !detail.startedAt.startsWith('0001') ? new Date(detail.startedAt).toLocaleString() : 'Not started'}</dd></div><div><dt>Exit code</dt><dd>{detail.state === 'running' ? '—' : detail.exitCode}</dd></div></dl><dl className="server-app-facts"><div><dt>Writable layer</dt><dd>{dockerSize(resources?.containers.find((item) => item.id === detail.id)?.writableSize)}</dd></div><div><dt>Root filesystem, including image</dt><dd>{dockerSize(resources?.containers.find((item) => item.id === detail.id)?.rootSize)}</dd></div><div><dt>Created</dt><dd>{detail.created ? new Date(detail.created).toLocaleString() : 'Unavailable'}</dd></div></dl><section><h3>Ports</h3><div className="server-app-card">{detail.ports.length ? detail.ports.map((port, i) => <div className="server-app-pair" key={i}><code>{port.container}</code><span>{port.host ? `${port.address || '0.0.0.0'}:${port.host}` : 'Internal only'}</span></div>) : <p>No exposed ports.</p>}</div></section><section><h3>Storage</h3><div className="server-app-card">{detail.mounts.length ? detail.mounts.map((mount, i) => <div className="server-app-mount" key={i}><strong className="mono">{mount.destination}</strong><span className="mono">{mount.source}</span><small>{mount.type} · {mount.writable ? 'Read and write' : 'Read only'}</small></div>) : <p>No mounted storage.</p>}</div></section></> : !detailError ? <p className="server-app-muted">Loading…</p> : null}</> : <div className="server-app-empty"><IconBoxes size={42}/><p>Select a container.</p></div>}
      </main>
    </div>}
    {pending && <AppConfirmation title={`${LABELS[pending.action]} ${pending.detail.name}?`} confirm={LABELS[pending.action]} onCancel={() => setPending(null)} onConfirm={() => void run(pending.detail, pending.action)}><p>{pending.action === 'stop' ? 'The application will stop.' : 'The application will briefly disconnect.'} Data is kept.</p></AppConfirmation>}
  </div>;
}
