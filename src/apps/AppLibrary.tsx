// SPDX-License-Identifier: AGPL-3.0-only
import { useAppMenus } from '../shell/appMenus';
import { useAppPreference, useAppState } from '../shell/useAppState';
import { useAppUpdates } from './useAppUpdates';
import { useEffect, useRef, useState } from 'react';
import { getDataSource, isReauthRequired, type UpdatePlan, type UpdateProgress, type AppUpdateHistoryEntry } from '../api/source';
import type { AppOperation, LibraryAppID } from '../api/server-apps';
import { useAppCatalog } from '../shell/AppCatalogContext';
import { useShell } from '../shell/ShellContext';
import { useReauth } from '../shell/ReauthSheet';
import { IconGrid, IconDownload, IconChevronRight, IconSidebar, IconRefresh } from '../shell/icons';
import { AppIcon } from '../shell/AppIcon';
import { APPS } from './registry';
import { errorText, AppConfirmation } from './ServerAppUI';
import '../styles/apps.css';
import '../styles/server-apps.css';
import '../styles/app-library.css';

const CATALOG = [
  { id: 'git' as const, name: APPS.git.title, appId: 'git' as const, description: 'Review changes and manage repositories.', overview: 'Browse changes and commit history, stage files, create branches and sync repositories using your Linux account’s Git configuration.', packages: 'Git' },
  { id: 'docker' as const, name: APPS.containers.title, appId: 'containers' as const, description: 'Run apps in isolated containers.', overview: 'Docker runs applications in isolated containers. Manage containers, view logs and connect persistent storage.', packages: 'Docker Engine · Compose' },
  { id: 'nginx' as const, name: APPS.websites.title, appId: 'websites' as const, description: 'Serve websites and route web traffic.', overview: 'Nginx serves websites and directs web traffic to your apps. Manage domains, static sites and reverse proxies.', packages: 'Nginx' },
  { id: 'pi' as const, name: APPS.pi.title, appId: 'pi' as const, description: 'A coding agent with a native workspace.', overview: 'Work with Pi in a native conversation. Follow file edits and commands, choose a model, and return to saved project sessions.', packages: 'Pi · Requires Node.js 22.19+ and npm' },
];
const JOB_KEY = 'lumo-app-install';
type LibraryPage = 'Discovery' | 'Updates' | LibraryAppID;
type Job = { app: LibraryAppID; requestId: string; operation?: AppOperation };
type Review = { app: LibraryAppID; operation: AppOperation; plan: UpdatePlan };
function readJob(): Job | null {
  try { const value = JSON.parse(localStorage.getItem(JOB_KEY) || 'null'); return value && (value.app === 'git' || value.app === 'docker' || value.app === 'nginx' || value.app === 'pi') && typeof value.requestId === 'string' ? value : null; } catch { return null; }
}
const size = (bytes: number) => bytes > 0 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : '0 MB';

export function AppLibrary() {
  const source = getDataSource();
  const [sidebarCollapsed, setSidebarCollapsed] = useAppPreference<boolean>('library', 'sidebar-collapsed', false);
  const { actions, state } = useShell();
  const reauth = useReauth();
  const updates = useAppUpdates(state.user ?? '');
  const updating = updates.phase !== 'idle';
  const { catalog, refresh: refreshCatalog } = useAppCatalog();
  const [selected, setSelected] = useAppState<LibraryAppID>('library', 'selection', () => state.navigation?.target === 'library' ? state.navigation.appId : readJob()?.app ?? 'docker', ['docker', 'nginx', 'pi', 'git']);
  const [navigation, setNavigation] = useState<{ pages: LibraryPage[]; index: number }>(() => {
    const job = readJob();
    const page: LibraryPage = updating ? 'Updates' : job ? job.operation === 'update' ? 'Updates' : job.app : 'Discovery';
    return { pages: page === 'Discovery' ? [page] : ['Discovery', page], index: page === 'Discovery' ? 0 : 1 };
  });
  const page = navigation.pages[navigation.index];
  const isDetail = page !== 'Discovery' && page !== 'Updates';
  const section = page === 'Updates' ? 'Updates' : 'Discovery';
  const canBack = navigation.index > 0;
  const canForward = navigation.index < navigation.pages.length - 1;
  const content = useRef<HTMLElement | null>(null);
  function navigate(next: LibraryPage) {
    if (next !== 'Discovery' && next !== 'Updates') setSelected(next);
    setConfirm(null);
    setNavigation((current) => current.pages[current.index] === next ? current : { pages: [...current.pages.slice(0, current.index + 1), next], index: current.index + 1 });
  }
  function travel(direction: -1 | 1) {
    const index = navigation.index + direction;
    if (index < 0 || index >= navigation.pages.length) return;
    const next = navigation.pages[index];
    if (next !== 'Discovery' && next !== 'Updates') setSelected(next);
    setConfirm(null);
    setNavigation((current) => ({ ...current, index }));
  }
  useEffect(() => { content.current?.scrollTo({ top: 0 }); }, [page]);
  const [checks, setChecks] = useState<Partial<Record<LibraryAppID, { plan?: UpdatePlan; error?: string }>>>({});
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [history, setHistory] = useState<AppUpdateHistoryEntry[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const checking = useRef(false);
  const checkedNavigation = useRef<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'plan' | 'apply' | 'refresh' | null>(null);
  const [pending, setPending] = useState<{ app: LibraryAppID; operation: AppOperation } | null>(null);
  const [job, setJob] = useState<Job | null>(readJob);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [retry, setRetry] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [confirm, setConfirm] = useState<Review | 'pi' | null>(null);
  const [cleanUninstall, setCleanUninstall] = useState(false);
  useEffect(() => { setCleanUninstall(false); }, [confirm]);
  const app = CATALOG.find((item) => item.id === selected)!;
  const entry = catalog?.apps.find((item) => item.id === selected);
  const installed = entry?.installed;
  const canManage = app.id === 'pi' ? (installed ? entry?.canUninstall : entry?.canInstall) : catalog?.canInstall;

  const canCheckUpdates = Boolean(catalog?.canInstall || catalog?.apps.some((item) => item.id === 'pi' && item.installed && item.canUpdate));

  useEffect(() => { if (state.navigation?.target === 'library') { setSelected(state.navigation.appId); navigate(state.navigation.checkUpdates ? 'Updates' : state.navigation.appId); } }, [state.navigation]);

  useEffect(() => {
    let alive = true;
    void refreshCatalog().catch((err) => { if (alive) setError(errorText(err)); });
    return () => { alive = false; };
  }, [refreshCatalog, refresh]);

  useEffect(() => {
    if (section !== 'Updates') return;
    let alive = true;
    setHistoryLoading(true); setHistoryError(null);
    void source.getAppUpdateHistory().then((items) => { if (alive) setHistory(items); }).catch((err) => { if (alive) setHistoryError(errorText(err)); }).finally(() => { if (alive) setHistoryLoading(false); });
    return () => { alive = false; };
  }, [source, section, refresh]);

  useEffect(() => {
    if (!job) return;
    try { localStorage.setItem(JOB_KEY, JSON.stringify(job)); } catch {}
    return source.subscribeUpdateProgress(job.requestId, (next) => {
      setProgress(next);
      if (next.done) {
        setPending({ app: job.app, operation: job.operation ?? 'install' }); setJob(null);
        void refreshCatalog().catch((err) => setError(errorText(err))).finally(() => { setPending(null); setBusy(null); setProgress(null); setRefresh((n) => n + 1); });
        try { localStorage.removeItem(JOB_KEY); } catch {}
        if (next.success) {
          actions.filesChanged();
          if (job.operation === 'update') setChecks((current) => { const plan = current[job.app]?.plan; return plan ? { ...current, [job.app]: { plan: { ...plan, packages: [], downloadBytes: 0 } } } : current; });
          actions.notify(`${CATALOG.find((item) => item.id === job.app)!.name} ${job.operation === 'uninstall' ? 'uninstalled' : job.operation === 'update' ? 'updated' : 'installed'}`, '');
        } else setError(next.error || 'Package changes failed. Check the package manager output.');
      }
    }, (err) => { setError(`${errorText(err)} Package changes may still be running on the server.`); setBusy(null); });
  }, [source, actions, job, retry, refreshCatalog]);

  const failedUpdates = updates.items.filter((item) => item.status === 'failed').map((item) => item.app).join(',');
  useEffect(() => { if (failedUpdates) setRefresh((n) => n + 1); }, [failedUpdates]);
  const completedUpdates = updates.items.filter((item) => item.status === 'done').map((item) => item.app).join(',');
  useEffect(() => {
    if (!completedUpdates) return;
    setRefresh((n) => n + 1);
    setChecks((current) => {
      const next = { ...current };
      for (const id of completedUpdates.split(',') as LibraryAppID[]) {
        const plan = next[id]?.plan;
        if (plan) next[id] = { plan: { ...plan, packages: [], downloadBytes: 0 } };
      }
      return next;
    });
  }, [completedUpdates]);
  useEffect(() => { if (updates.phase === 'auth') reauth(updates.queue.resume); }, [updates.phase, updates.queue, reauth]);

  async function prepare(id: LibraryAppID, operation: 'install' | 'uninstall') {
    setBusy('plan'); setPending({ app: id, operation }); setError(null); setProgress(null);
    try {
      const plan = await source.planAppInstall(id, operation);
      const next = { app: id, operation, plan };
      if (!plan.packages.length) { await refreshCatalog(); setPending(null); setBusy(null); }
      else if (operation === 'uninstall') { setConfirm(next); setPending(null); setBusy(null); }
      else await apply(next);
    } catch (err) {
      setPending(null); setBusy(null);
      if (isReauthRequired(err)) reauth(() => { void prepare(id, operation); }); else setError(errorText(err));
    }
  }

  useEffect(() => {
    const intent = state.navigation;
    if (intent?.target !== 'library' || !intent.checkUpdates || checkedNavigation.current === intent.nonce || !catalog || busy !== null || job || updating) return;
    checkedNavigation.current = intent.nonce;
    if (!canCheckUpdates) { setError('Package management unavailable. Check the package manager and Lumo service.'); return; }
    void checkUpdates();
  }, [state.navigation, catalog, busy, job, updating]);

  async function apply(value: Review, clean = false) {
    setConfirm(null); setBusy('apply'); setPending(value); setError(null); setProgress(null);
    try {
      const requestId = await source.applyUpdatePlan(value.plan.id, clean);
      const next = { app: value.app, operation: value.operation, requestId };
      try { localStorage.setItem(JOB_KEY, JSON.stringify(next)); } catch {}
      setJob(next); setPending(null);
    }
    catch (err) { setPending(null); setBusy(null); if (isReauthRequired(err)) reauth(() => { void apply(value, clean); }); else setError(errorText(err)); }
  }

  async function uninstallPi(clean = false) {
    setConfirm(null); setBusy('apply'); setPending({ app: 'pi', operation: 'uninstall' }); setProgress(null); setError(null);
    try {
      await source.uninstallPi(clean);
      actions.filesChanged();
      const next = await refreshCatalog();
      if (next.apps.some((item) => item.id === 'pi' && item.installed)) setError('This copy was removed. Another Pi installation is still available on this server.');
      else actions.notify('Pi uninstalled', clean ? 'Settings, caches and stored data moved to Trash. Projects were kept.' : 'Projects, conversations and settings were kept.');
    } catch (err) { setError(errorText(err)); }
    finally { setPending(null); setBusy(null); }
  }

  async function checkUpdates() {
    if (checking.current || busy !== null || job || updates.queue.getSnapshot().phase !== 'idle') return;
    checking.current = true;
    updates.queue.clear();
    navigate('Updates'); setBusy('refresh'); setError(null); setChecks({}); setCheckedAt(null);
    try {
      const refreshed = catalog?.canInstall ? await source.refreshUpdates() : new Date().toISOString();
      const current = await refreshCatalog();
      const next: typeof checks = {};
      for (const item of current.apps) {
        if (!item.installed || (item.id === 'pi' ? !item.canUpdate : !current.canInstall)) continue;
        try { next[item.id] = { plan: await source.planAppInstall(item.id, 'update') }; }
        catch (err) { if (isReauthRequired(err)) throw err; next[item.id] = { error: errorText(err) }; }
      }
      setChecks(next); setCheckedAt(refreshed);
    } catch (err) { if (isReauthRequired(err)) reauth(() => { void checkUpdates(); }); else setError(errorText(err)); }
    finally { checking.current = false; setBusy(null); }
  }

  function checkInstalledApps() {
    setJob(null); setBusy(null); setProgress(null);
    try { localStorage.removeItem(JOB_KEY); } catch {}
    setRefresh((n) => n + 1);
    setError('Status unavailable. Check installed apps before trying again.');
  }

  const confirmedApp = confirm ? CATALOG.find((item) => item.id === (confirm === 'pi' ? confirm : confirm.app))! : null;

  const updateCount = Object.values(checks).filter((item) => item.plan?.packages.length).length;
  const active = job ?? pending;
  const activeHere = active?.app === selected;
  const operationLabel = active?.operation === 'uninstall' ? 'Uninstalling' : active?.operation === 'update' ? 'Updating' : 'Installing';
  const percent = progress ? Math.min(100, Math.max(0, progress.percent)) : undefined;
  const locked = busy !== null || Boolean(job || pending) || updating;
  function startUpdates(plans: UpdatePlan[]) { setError(null); setProgress(null); updates.queue.start(plans); }
  function refreshApps() { setError(null); setRefresh((value) => value + 1); }
  useAppMenus({ app: [{ id: 'check-updates', label: 'Check for Updates…', disabled: locked || !canCheckUpdates, run: () => { void checkUpdates(); } }], view: [{ id: 'back', label: 'Back', disabled: !canBack, run: () => travel(-1) }, { id: 'forward', label: 'Forward', disabled: !canForward, run: () => travel(1) }, { id: 'refresh', label: 'Refresh', disabled: locked, run: refreshApps }, { id: 'sidebar', label: 'Show Sidebar', checked: !sidebarCollapsed, run: () => setSidebarCollapsed(!sidebarCollapsed) }] });

  return <div className="app app-library" data-testid="app-library">
    <div className={`app-library-body${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
      <aside className="app-library-sidebar" aria-label="App Library sections" data-testid="library-sidebar">
        <div className="library-sidebar-heading"><strong>Apps</strong><button type="button" className="btn library-sidebar-toggle" data-testid="library-sidebar-toggle" aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!sidebarCollapsed} onClick={() => setSidebarCollapsed(!sidebarCollapsed)}><IconSidebar size={18}/></button></div>
        <nav className="library-navigation" aria-label="App Library"><button type="button" data-testid="library-discovery" aria-label="Discovery" title="Discovery" aria-current={section === 'Discovery' ? 'page' : undefined} onClick={() => navigate('Discovery')}><IconGrid size={18}/><span className="library-sidebar-label">Discovery</span></button><button type="button" data-testid="library-updates" aria-label="Updates" title="Updates" aria-current={section === 'Updates' ? 'page' : undefined} onClick={() => { navigate('Updates'); if (!checkedAt && canCheckUpdates) void checkUpdates(); }}><IconDownload size={18}/><span className="library-sidebar-label">Updates</span>{updateCount > 0 && <span className="library-count">{updateCount}</span>}</button></nav>
        <div className="library-sidebar-footer"><button className="library-check" type="button" data-testid="library-check-updates" aria-label={busy === 'refresh' ? 'Checking for updates' : 'Check for updates'} title="Check for updates" disabled={locked || !canCheckUpdates} onClick={() => void checkUpdates()}>{sidebarCollapsed ? <IconRefresh size={18}/> : busy === 'refresh' ? 'Checking…' : 'Check for updates'}</button><small>{checkedAt ? `Last checked ${new Date(checkedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Not checked yet'}</small></div>
      </aside>
      <main ref={content} className="app-library-detail">
        <header className="library-page-heading"><nav className="app-history" aria-label="Page history"><button type="button" className="app-history-back" aria-label="Back" title="Back" data-testid="library-back" disabled={!canBack} onClick={() => travel(-1)}><IconChevronRight size={18}/></button><button type="button" aria-label="Forward" title="Forward" data-testid="library-forward" disabled={!canForward} onClick={() => travel(1)}><IconChevronRight size={18}/></button></nav>{!isDetail && <div><h1>{section}</h1><p>{section === 'Discovery' ? 'Find apps for your server.' : 'Keep your installed apps current.'}</p></div>}</header>
        {page === 'Discovery' && <>
          <div className="library-discovery-grid">{CATALOG.map((item) => {
            const ready = catalog?.apps.find((entry) => entry.id === item.id)?.installed;
            return <button type="button" key={item.id} data-testid={`library-${item.id}`} className="library-item" onClick={() => { navigate(item.id); setError(null); }}><span className="library-icon"><AppIcon appId={item.appId}/></span><span className="library-card-name"><strong>{item.name}</strong><small>{ready ? 'Installed' : catalog ? 'Available' : 'Checking…'}</small></span><span className="library-card-description">{item.description}</span></button>;
          })}</div>
        </>}
        {isDetail && <section className="library-app-overview" aria-label={`${app.name} details`}>
            <header className="library-hero"><span className="library-icon library-hero-icon"><AppIcon appId={app.appId}/></span><div><h1>{app.name}</h1><p>{app.description}</p></div>
              <div className="library-action">
                {activeHere ? <div className="library-action-progress" data-testid="library-progress" role="progressbar" aria-label={`${operationLabel} ${app.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={error ? 'Connection interrupted' : progress?.message || `${operationLabel}…`} title={progress?.message}>
                  <span aria-hidden="true">{error ? 'Interrupted' : progress?.done ? 'Finishing…' : `${operationLabel}…`}{percent !== undefined && !error && <small>{Math.round(percent)}%</small>}</span>
                  <progress max={100} value={percent}/>
                </div> : <button className={`btn ${installed ? 'btn-danger' : 'btn-primary'}`} type="button" data-testid="library-primary" disabled={!catalog || locked || !canManage} onClick={() => { if (app.id === 'pi' && installed) setConfirm('pi'); else void prepare(app.id, installed ? 'uninstall' : 'install'); }}>{installed ? 'Uninstall' : 'Install'}</button>}
              </div>
            </header>
            <p className="library-description" data-testid="library-description">{app.overview}</p>
            <div className="library-information"><span>Includes</span><strong>{app.packages}</strong></div>
            {app.id === 'pi' && (!installed || !canManage) && <p className="server-app-muted">{installed ? 'This installation is managed outside Lumo. Use the package manager that installed it to uninstall.' : 'Installs Pi for your Linux account using npm. Node.js 22.19 or newer is required.'}</p>}
          </section>}
        {page === 'Updates' && <section className="library-update-section" aria-label="Available updates">
          <div className="library-update-heading"><h2>Available updates</h2><button type="button" className="btn" data-testid="library-update-all" disabled={locked || !updateCount || !canCheckUpdates} onClick={() => startUpdates(Object.values(checks).flatMap((check) => check.plan?.packages.length ? [check.plan] : []))}>{updating ? 'Updating…' : 'Update all'}</button></div>
          {(updateCount > 0 || updating) && <p className="library-update-notice">Updates may briefly restart apps and services.</p>}
          {busy === 'refresh' ? <p className="server-app-muted" role="status">Checking installed apps and package versions…</p> : !checkedAt && !updates.items.length ? <p className="server-app-muted">Check for updates to see available versions.</p> : <>
            {!updateCount && !updating && (checkedAt || completedUpdates) && !Object.values(checks).some((item) => item.error) && !updates.items.some((item) => item.status === 'failed') && <p className="library-up-to-date" role="status">{Object.keys(checks).length || completedUpdates ? 'Your managed apps are up to date.' : 'No managed apps are installed.'}</p>}
            <div className="library-update-list">{CATALOG.filter((item) => {
              const update = updates.items.find((update) => update.app === item.id);
              if (update?.status === 'done') return false;
              return Boolean(checks[item.id]?.plan?.packages.length || checks[item.id]?.error || update);
            }).map((item) => {
              const update = updates.items.find((update) => update.app === item.id);
              const check = checks[item.id as LibraryAppID];
              const plan = check?.plan ?? update?.plan;
              const pkg = plan?.packages[0];
              const active = update?.status === 'updating';
              const pending = update?.status === 'pending';
              const needsAuth = active && updates.phase === 'auth';
              const disconnected = active && updates.phase === 'disconnected';
              return <article className="library-update-row" key={item.id} data-testid={`library-update-${item.id}`}><span className="library-icon"><AppIcon appId={item.appId}/></span><div className="library-update-copy"><h3>{item.name}</h3><p>{check?.error ? 'Could not check for updates' : pkg ? `${pkg.fromVersion || 'Not installed'} → ${pkg.toVersion}` : 'Update status unavailable'}</p>{check?.error ? <p className="server-app-error">{check.error}</p> : pkg && item.id !== 'pi' && <small>{size(plan!.downloadBytes)} · {plan!.packages.length} {plan!.packages.length === 1 ? 'package' : 'packages'}</small>}{(active || pending) && <div className="library-update-progress" role="status"><small>{pending ? 'Waiting…' : needsAuth ? 'Confirm your password to continue.' : disconnected ? 'Connection interrupted' : update?.progress?.message || 'Preparing update…'}</small>{active && <div className="meter" role="progressbar" aria-label={`${item.name} update`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={update?.progress?.percent ?? 0}><div className="meter-fill" style={{ width: `${update?.progress?.percent ?? 0}%` }}/></div>}</div>}{update?.error && <p className="server-app-error" role="alert">{update.error}</p>}</div>{(pkg || check?.error || active) && <button type="button" className="btn" disabled={needsAuth || disconnected ? false : locked || !canCheckUpdates} onClick={() => { if (needsAuth) reauth(updates.queue.resume); else if (disconnected) void updates.queue.reconnect(); else if (check?.error) void checkUpdates(); else if (plan) startUpdates([plan]); }}>{needsAuth ? 'Continue' : disconnected ? 'Reconnect' : active ? 'Updating…' : pending ? 'Waiting…' : check?.error ? 'Try again' : 'Update'}</button>}{disconnected && <button type="button" className="btn" onClick={() => { updates.queue.forget(); void checkUpdates(); }}>Check status</button>}</article>;
            })}</div>
          </>}
        </section>}
        {isDetail && !catalog?.canInstall && catalog && selected !== 'pi' && <p className="server-app-error">Package management unavailable. Check the package manager and Lumo service.</p>}
        {error && <div className="server-app-error" role="alert">{error}{job && <><button type="button" className="btn" onClick={() => { setError(null); setRetry((n) => n + 1); }}>Reconnect</button><button type="button" className="btn" onClick={checkInstalledApps}>Check installed apps</button></>}</div>}
        {section === 'Updates' && <section className="library-update-section library-history" data-testid="library-history"><h2>Update history</h2><p className="library-history-note">Recent app updates made through Lumo by your account.</p>{historyError ? <p className="server-app-error" role="alert">{historyError}</p> : historyLoading ? <p className="server-app-muted">Loading history…</p> : !history.length ? <p className="server-app-muted">No updates recorded yet.</p> : history.map((item) => {
          const app = CATALOG.find((app) => app.id === item.appId)!;
          const names = item.appId === 'docker' ? ['docker.io', 'docker-ce'] : [item.appId];
          const pkg = item.packages.find((pkg) => names.includes(pkg.name)) ?? item.packages[0];
          return <article key={item.requestId} className="library-history-entry"><span className="library-icon"><AppIcon appId={app.appId}/></span><div><strong>{app.name} {item.success ? 'updated' : 'update failed'}</strong><small>{new Date(item.completedAt).toLocaleString()}</small></div><span className="library-history-version">{pkg ? `${pkg.fromVersion || 'Not installed'} → ${pkg.toVersion}` : 'Version unavailable'}</span>{item.error && <p className="server-app-error">{item.error}</p>}</article>;
        })}</section>}

      </main>
    </div>
    {confirm && confirmedApp && <AppConfirmation title={`Uninstall ${confirmedApp.name}?`} confirm={cleanUninstall ? 'Clean uninstall' : 'Uninstall'} onCancel={() => setConfirm(null)} onConfirm={() => { if (confirm === 'pi') void uninstallPi(cleanUninstall); else void apply(confirm, cleanUninstall); }}>
        <div className="library-uninstall-options" role="radiogroup" aria-label="Uninstall options">
          <label className={!cleanUninstall ? 'selected' : ''}><input type="radio" name="uninstall-mode" checked={!cleanUninstall} onChange={() => setCleanUninstall(false)} data-testid="uninstall-normal"/><span><strong>Uninstall</strong><small>Remove the app. Keep settings and stored data.</small></span></label>
          <label className={cleanUninstall ? 'selected' : ''}><input type="radio" name="uninstall-mode" checked={cleanUninstall} onChange={() => setCleanUninstall(true)} data-testid="uninstall-clean"/><span><strong>Clean uninstall</strong><small>Also move settings, caches and stored app data to Trash.</small></span></label>
        </div>
        {confirmedApp.id === 'git' && <p>Repositories, SSH keys and account Git settings are preserved. Clean uninstall moves system Git settings to Trash.</p>}
        {confirm !== 'pi' && confirm.plan.packages.length > 1 && <p className="library-uninstall-note">Packages to remove: {confirm.plan.packages.map((pkg) => pkg.name).join(', ')}.</p>}

    </AppConfirmation>}
  </div>;
}
