// SPDX-License-Identifier: AGPL-3.0-only
import { useAppState } from '../shell/useAppState';
import { useEffect, useState } from 'react';
import { getDataSource, isReauthRequired, type UpdatePlan, type UpdateProgress } from '../api/source';
import type { AppOperation, LibraryAppID, ServerAppID } from '../api/server-apps';
import { useAppCatalog } from '../shell/AppCatalogContext';
import { useShell } from '../shell/ShellContext';
import { useReauth } from '../shell/ReauthSheet';
import { IconBoxes, IconGlobe, IconCode, IconRefresh } from '../shell/icons';
import { errorText, AppConfirmation } from './ServerAppUI';
import '../styles/apps.css';
import '../styles/server-apps.css';
import '../styles/app-library.css';

const CATALOG = [
  { id: 'docker' as const, name: 'Docker', gui: 'Containers', icon: IconBoxes, description: 'Run apps in isolated containers.', overview: 'Docker runs applications in isolated containers. Manage containers, view logs and connect persistent storage.', packages: 'Docker Engine · Compose', removal: 'Running containers will stop. Container data, images and configuration are kept.' },
  { id: 'nginx' as const, name: 'Nginx', gui: 'Websites', icon: IconGlobe, description: 'Serve websites and route web traffic.', overview: 'Nginx serves websites and directs web traffic to your apps. Manage domains, static sites and reverse proxies.', packages: 'Nginx', removal: 'Websites served by Nginx will go offline. Site files and configuration are kept.' },
  { id: 'opencode' as const, name: 'OpenCode', gui: 'OpenCode', icon: IconCode, description: 'An AI coding assistant for your terminal.', overview: 'OpenCode is an AI coding assistant that runs in your terminal. Ask questions about your project, edit code and run commands with your chosen model.', packages: 'OpenCode CLI', removal: 'The executable moves to Trash. Projects, saved conversations and settings are kept. Close active OpenCode sessions first.' },
];
const JOB_KEY = 'lumo-app-install';
type Job = { app: ServerAppID; requestId: string; operation?: AppOperation };
type Review = { app: ServerAppID; operation: AppOperation; plan: UpdatePlan };
function readJob(): Job | null {
  try { const value = JSON.parse(localStorage.getItem(JOB_KEY) || 'null'); return value && (value.app === 'docker' || value.app === 'nginx') && typeof value.requestId === 'string' ? value : null; } catch { return null; }
}
const size = (bytes: number) => bytes > 0 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : '0 MB';

export function AppLibrary() {
  const source = getDataSource();
  const { actions, state } = useShell();
  const reauth = useReauth();
  const { catalog, refresh: refreshCatalog } = useAppCatalog();
  const [selected, setSelected] = useAppState<LibraryAppID>('library', 'selection', () => state.navigation?.target === 'library' ? state.navigation.appId : readJob()?.app ?? 'docker', ['docker', 'nginx', 'opencode']);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'plan' | 'apply' | 'refresh' | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [job, setJob] = useState<Job | null>(readJob);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [retry, setRetry] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [confirm, setConfirm] = useState<Review | 'opencode' | null>(null);
  const app = CATALOG.find((item) => item.id === selected)!;
  const Icon = app.icon;
  const entry = catalog?.apps.find((item) => item.id === selected);
  const installed = entry?.installed;
  const canManage = app.id === 'opencode' ? entry?.canUninstall : catalog?.canInstall;

  useEffect(() => { if (state.navigation?.target === 'library') setSelected(state.navigation.appId); }, [state.navigation]);

  useEffect(() => {
    let alive = true;
    void refreshCatalog().catch((err) => { if (alive) setError(errorText(err)); });
    return () => { alive = false; };
  }, [refreshCatalog, refresh]);

  useEffect(() => {
    if (!job) return;
    try { localStorage.setItem(JOB_KEY, JSON.stringify(job)); } catch {}
    return source.subscribeUpdateProgress(job.requestId, (next) => {
      setProgress(next);
      if (next.done) {
        setBusy(null); setJob(null);
        try { localStorage.removeItem(JOB_KEY); } catch {}
        setRefresh((n) => n + 1);
        if (next.success) {
          setReview(null);
          actions.notify(`${CATALOG.find((item) => item.id === job.app)!.name} ${job.operation === 'uninstall' ? 'uninstalled' : 'installed'}`, '');
        } else setError(next.error || 'Package changes failed. Check the package manager output.');
      }
    }, (err) => { setError(`${errorText(err)} Package changes may still be running on the server.`); setBusy(null); });
  }, [source, actions, job, retry]);

  async function prepare(id: ServerAppID, operation: AppOperation) {
    setBusy('plan'); setError(null); setReview(null); setProgress(null);
    try { const plan = await source.planAppInstall(id, operation); setReview({ app: id, operation, plan }); if (!plan.packages.length) setRefresh((n) => n + 1); }
    catch (err) { if (isReauthRequired(err)) reauth(() => { void prepare(id, operation); }); else setError(errorText(err)); }
    finally { setBusy(null); }
  }

  async function apply(value: Review) {
    setConfirm(null); setBusy('apply'); setError(null); setProgress(null);
    try {
      const requestId = await source.applyUpdatePlan(value.plan.id);
      const next = { app: value.app, operation: value.operation, requestId };
      try { localStorage.setItem(JOB_KEY, JSON.stringify(next)); } catch {}
      setJob(next);
    }
    catch (err) { setBusy(null); if (isReauthRequired(err)) reauth(() => { void apply(value); }); else setError(errorText(err)); }
  }

  async function uninstallOpenCode() {
    setConfirm(null); setBusy('apply'); setError(null);
    try {
      await source.uninstallOpenCode();
      const next = await refreshCatalog();
      if (next.apps.some((item) => item.id === 'opencode' && item.installed)) setError('This copy was removed. Another OpenCode installation is still available on this server.');
      else actions.notify('OpenCode uninstalled', 'Projects, conversations and settings were kept.');
    } catch (err) { setError(errorText(err)); }
    finally { setBusy(null); }
  }

  async function refreshPackages() {
    setBusy('refresh'); setError(null);
    try { await source.refreshUpdates(); setRefresh((n) => n + 1); }
    catch (err) { if (isReauthRequired(err)) reauth(() => { void refreshPackages(); }); else setError(errorText(err)); }
    finally { setBusy(null); }
  }

  function checkInstalledApps() {
    setJob(null); setBusy(null); setReview(null); setProgress(null);
    try { localStorage.removeItem(JOB_KEY); } catch {}
    setRefresh((n) => n + 1);
    setError('Status unavailable. Check installed apps before trying again.');
  }

  const confirmedApp = confirm ? CATALOG.find((item) => item.id === (confirm === 'opencode' ? confirm : confirm.app))! : null;
  const removing = confirm === 'opencode' || confirm?.operation === 'uninstall';

  return <div className="app app-library" data-testid="app-library">
    <div className="app-library-body">
      <aside className="app-library-sidebar" aria-label="Available apps"><div className="library-sidebar-heading"><strong>Apps</strong><button type="button" className="btn library-refresh" aria-label="Refresh" title="Refresh apps" data-testid="library-refresh" onClick={() => { setError(null); setRefresh((n) => n + 1); }}><IconRefresh size={15}/></button></div>{CATALOG.map((item) => {
        const ItemIcon = item.icon;
        const ready = catalog?.apps.find((entry) => entry.id === item.id)?.installed;
        return <button type="button" key={item.id} data-testid={`library-${item.id}`} className={`library-item${selected === item.id ? ' selected' : ''}`} aria-pressed={selected === item.id} onClick={() => { setSelected(item.id); setConfirm(null); setError(null); }}><span className={`library-icon ${item.id}`}><ItemIcon size={24}/></span><span><strong>{item.name}</strong><small>{ready ? 'Installed' : catalog ? 'Available' : 'Checking…'}</small></span></button>;
      })}</aside>
      <main className="app-library-detail">
        <header className="library-hero"><span className={`library-icon library-hero-icon ${app.id}`}><Icon size={42}/></span><div><h1>{app.name}</h1><p>{app.description}</p></div>
          {app.id === 'opencode' && !installed ? <a className="btn btn-primary" data-testid="library-primary" href="https://opencode.ai/docs/" target="_blank" rel="noreferrer">Installation guide</a> : <button className={`btn ${installed ? 'btn-danger' : 'btn-primary'}`} type="button" data-testid="library-primary" disabled={!catalog || busy !== null || Boolean(job) || !canManage} onClick={() => { if (app.id === 'opencode') setConfirm('opencode'); else void prepare(app.id, installed ? 'uninstall' : 'install'); }}>{job?.app === selected ? job.operation === 'uninstall' ? 'Uninstalling…' : 'Installing…' : busy === 'plan' ? 'Preparing…' : installed ? 'Uninstall…' : 'Install…'}</button>}
        </header>
        <section className="library-information"><div><span>Includes</span><strong>{app.packages}</strong></div><div><span>Managed with</span><strong>{app.gui}</strong></div></section>
        <p className="library-description" data-testid="library-description">{app.overview}</p>
        {app.id === 'opencode' ? (!installed || !canManage) && <p className="server-app-muted">{installed ? 'This installation is managed outside Lumo. Use the package manager that installed it to uninstall.' : 'Install the CLI for your Linux account, then refresh this page.'}</p> : !catalog?.canInstall && catalog && <p className="server-app-error">Package management unavailable. Check the package manager and Lumo service.</p>}
        {error && <div className="server-app-error" role="alert">{error}{job && <><button type="button" className="btn" onClick={() => { setError(null); setRetry((n) => n + 1); }}>Reconnect</button><button type="button" className="btn" onClick={checkInstalledApps}>Check installed apps</button></>}</div>}
        {progress && <section className="library-progress" aria-live="polite" data-testid="library-progress"><strong>{progress.done ? progress.success ? 'Package changes complete' : 'Package changes failed' : progress.message}</strong><div className="meter"><div className="meter-fill" style={{ width: `${progress.percent}%` }}/></div>{!progress.done && <p className="server-app-muted">Continues in the background.</p>}</section>}
        {review?.app === selected && !job && <section className="library-plan" data-testid="library-plan"><div className="server-app-section-heading"><h2>{review.operation === 'uninstall' ? 'Packages to remove' : 'Packages'}</h2><span className="server-app-muted">{review.operation === 'install' ? size(review.plan.downloadBytes) : `${review.plan.packages.length} packages`}</span></div>{review.plan.packages.length === 0 && <p className="server-app-muted">No package changes needed.</p>}<div className="library-packages">{review.plan.packages.map((pkg) => <div key={pkg.name}><strong>{pkg.name}</strong><span className="mono">{review.operation === 'uninstall' ? pkg.fromVersion : pkg.toVersion}</span></div>)}</div><div className="server-app-savebar"><button type="button" className="btn" onClick={() => setReview(null)}>Cancel</button><button type="button" className={`btn ${review.operation === 'uninstall' ? 'btn-danger' : 'btn-primary'}`} data-testid="library-install-confirm" disabled={busy !== null || review.plan.packages.length === 0} onClick={() => setConfirm(review)}>{review.operation === 'uninstall' ? 'Uninstall' : 'Install'} {app.name}</button></div></section>}
        {app.id !== 'opencode' && <footer className="library-footer"><button type="button" className="btn" disabled={busy !== null || Boolean(job) || !catalog?.canInstall} onClick={() => void refreshPackages()}>{busy === 'refresh' ? 'Refreshing…' : 'Refresh package list'}</button></footer>}
      </main>
    </div>
    {confirm && confirmedApp && <AppConfirmation title={`${removing ? 'Uninstall' : 'Install'} ${confirmedApp.name}?`} confirm={removing ? 'Uninstall' : 'Install packages'} onCancel={() => setConfirm(null)} onConfirm={() => { if (confirm === 'opencode') void uninstallOpenCode(); else void apply(confirm); }}><p>{removing ? confirmedApp.removal : `${confirm.plan.packages.length} packages. Services may start. This cannot be undone automatically.`}</p>{!removing && confirmedApp.id === 'docker' && <p>Docker access must be granted separately.</p>}</AppConfirmation>}
  </div>;
}
