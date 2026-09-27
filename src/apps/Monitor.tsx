// SPDX-License-Identifier: AGPL-3.0-only
import { useAppMenus } from '../shell/appMenus';
import { useEffect, useState } from 'react';
import { describeError, getDataSource, type ProcessInfo } from '../api/source';
import { useShell } from '../shell/ShellContext';
import { useAppState } from '../shell/useAppState';
import { IconMonitor, IconChip, IconList, IconGlobe, IconBoxes, IconGear } from '../shell/icons';
import { formatSize } from '../utils/file-format';
import { Home } from './Home';
import { Logs } from './Logs';
import { Services } from './Services';
import '../styles/monitor.css';

const sections = [
  { id: 'overview', label: 'Overview', icon: IconMonitor },
  { id: 'cpu', label: 'CPU', icon: IconChip },
  { id: 'memory', label: 'Memory', icon: IconBoxes },
  { id: 'network', label: 'Network', icon: IconGlobe },
  { id: 'activity', label: 'Activity', icon: IconMonitor },
  { id: 'services', label: 'Services', icon: IconGear },
  { id: 'logs', label: 'Logs', icon: IconList },
] as const;
type Section = typeof sections[number]['id'];

export function Monitor() {
  const { state } = useShell();
  const [section, setSection] = useAppState<Section>('home', 'section', () => state.navigation?.target === 'logs' ? 'logs' : 'overview', sections.map((item) => item.id));
  useEffect(() => { if (state.navigation?.target === 'logs' || state.navigation?.target === 'services') setSection(state.navigation.target); }, [state.navigation]);
  useAppMenus({ view: sections.map(({ id, label }) => ({ id: `section-${id}`, label, checked: section === id, run: () => setSection(id) })) });

  return <div className="app monitor" data-testid="app-monitor">
    <nav className="monitor-sidebar" aria-label="Monitor sections">{sections.map(({ id, label, icon: Icon }) => <button key={id} type="button" title={label} aria-label={label} aria-current={section === id ? 'page' : undefined} className={section === id ? 'active' : ''} data-testid={`monitor-section-${id}`} onClick={() => setSection(id)}><Icon size={19}/><span>{label}</span></button>)}</nav>
    <div className="monitor-content">{section === 'logs' ? <Logs/> : section === 'services' ? <Services/> : section === 'activity' ? <ProcessActivity/> : <Home section={section}/>}</div>
  </div>;
}

function ProcessActivity() {
  const [processes, setProcesses] = useState<ProcessInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useAppState<string>('home', 'process-search', '');
  const [sort, setSort] = useAppState<'cpuPercent' | 'memoryBytes' | 'pid' | 'name'>('home', 'process-sort', 'cpuPercent', ['cpuPercent', 'memoryBytes', 'pid', 'name']);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let alive = true;
    let timer: number;
    async function refresh() {
      try { const next = await getDataSource().listProcesses(); if (alive) { setProcesses(next); setError(null); setLoaded(true); } }
      catch (err) { if (alive) setError(describeError(err)); }
      finally { if (alive) timer = window.setTimeout(refresh, 2000); }
    }
    void refresh();
    return () => { alive = false; window.clearTimeout(timer); };
  }, [retry]);
  const query = search.trim().toLowerCase();
  const filtered = processes.filter((item) => `${item.pid} ${item.name} ${item.user}`.toLowerCase().includes(query)).sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name) : sort === 'pid' ? a.pid - b.pid : (b[sort] ?? -1) - (a[sort] ?? -1) || a.pid - b.pid);
  const states: Record<string, string> = { R: 'Running', S: 'Sleeping', D: 'Waiting', Z: 'Zombie', T: 'Stopped', t: 'Stopped', I: 'Idle' };
  return <div className="app monitor-activity" data-testid="monitor-activity">
    <div className="app-toolbar"><label className="app-search"><input aria-label="Filter processes" placeholder="Search name, PID or user" value={search} onChange={(event) => setSearch(event.target.value)}/></label><span className="home-muted">{filtered.length} processes</span></div>
    {error && <p className="monitor-error" role="alert">{error} <button className="btn" onClick={() => setRetry((value) => value + 1)}>Retry</button></p>}
    <div className="monitor-process-scroll"><table className="monitor-processes"><thead><tr>{([['name', 'Process'], ['pid', 'PID'], ['cpuPercent', 'CPU'], ['memoryBytes', 'Memory']] as const).map(([key, label]) => <th key={key} aria-sort={sort === key ? key === 'name' || key === 'pid' ? 'ascending' : 'descending' : 'none'}><button type="button" onClick={() => setSort(key)}>{label}{sort === key ? key === 'name' || key === 'pid' ? ' ↑' : ' ↓' : ''}</button></th>)}<th>User</th><th>Status</th></tr></thead><tbody>{filtered.map((item) => <tr key={item.pid} data-testid={`process-${item.pid}`}><td>{item.name}</td><td className="mono">{item.pid}</td><td className="mono">{item.cpuPercent === null ? '—' : `${item.cpuPercent.toFixed(1)}%`}</td><td className="mono">{formatSize(item.memoryBytes)}</td><td>{item.user}</td><td>{states[item.state] ?? item.state}</td></tr>)}</tbody></table>{!error && !filtered.length && <p className="logs-empty">{loaded ? 'No matching processes.' : 'Loading processes…'}</p>}</div>
    <footer className="monitor-note">CPU is measured per logical core; a process using multiple cores can exceed 100%. Memory is resident usage.</footer>
  </div>;
}
