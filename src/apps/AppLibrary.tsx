// SPDX-License-Identifier: AGPL-3.0-only
import { useAppMenus } from '../shell/appMenus';
import { useAppState } from '../shell/useAppState';
import { useAppUpdates } from './useAppUpdates';
import { useEffect, useRef, useState } from 'react';
import { getDataSource, isReauthRequired, type UpdatePlan, type UpdateProgress, type AppUpdateHistoryEntry } from '../api/source';
import type { AppOperation, LibraryAppID, ServerAppID } from '../api/server-apps';
import { useAppCatalog } from '../shell/AppCatalogContext';
import { useShell } from '../shell/ShellContext';
import { useReauth } from '../shell/ReauthSheet';
import { IconGrid, IconDownload, IconChevronRight } from '../shell/icons';
import { AppIcon } from '../shell/AppIcon';
import { APPS } from './registry';
import { errorText, AppConfirmation } from './ServerAppUI';
import '../styles/apps.css';
import '../styles/server-apps.css';
import '../styles/app-library.css';

const CATALOG = [
  { id: 'docker' as const, name: APPS.containers.title, appId: 'containers' as const, description: 'Run apps in isolated containers.', overview: 'Docker runs applications in isolated containers. Manage containers, view logs and connect persistent storage.', packages: 'Docker Engine · Compose', removal: 'Running containers will stop. Container data, images and configuration are kept.' },
  { id: 'nginx' as const, name: APPS.websites.title, appId: 'websites' as const, description: 'Serve websites and route web traffic.', overview: 'Nginx serves websites and directs web traffic to your apps. Manage domains, static sites and reverse proxies.', packages: 'Nginx', removal: 'Websites served by Nginx will go offline. Site files and configuration are kept.' },
  { id: 'opencode' as const, name: APPS.opencode.title, appId: 'opencode' as const, description: 'An AI coding assistant for your terminal.', overview: 'OpenCode is an AI coding assistant that runs in your terminal. Ask questions about your project, edit code and run commands with your chosen model.', packages: 'OpenCode CLI', removal: 'The executable moves to Trash. Projects, saved conversations and settings are kept. Close active OpenCode sessions first.' },
];
const JOB_KEY = 'lumo-app-install';
type LibraryPage = 'Discovery' | 'Updates' | LibraryAppID;
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
  const updates = useAppUpdates(state.user ?? '');
  const updating = updates.phase !== 'idle';
  const { catalog, refresh: refreshCatalog } = useAppCatalog();
  const [selected, setSelected] = useAppState<LibraryAppID>('library', 'selection', () => state.navigation?.target === 'library' ? state.navigation.appId : readJob()?.app ?? 'docker', ['docker', 'nginx', 'opencode']);
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
  const [checks, setChecks] = useState<Partial<Record<ServerAppID, { plan?: UpdatePlan; error?: string }>>>({});
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [history, setHistory] = useState<AppUpdateHistoryEntry[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const checking = useRef(false);
  const reviewPanel = useRef<HTMLElement | null>(null);
  const checkedNavigation = useRef<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'plan' | 'apply' | 'refresh' | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [job, setJob] = useState<Job | null>(readJob);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [retry, setRetry] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [confirm, setConfirm] = useState<Review | 'opencode' | null>(null);
  const app = CATALOG.find((item) => item.id === selected)!;
  const entry = catalog?.apps.find((item) => item.id === selected);
  const installed = entry?.installed;
  const canManage = app.id === 'opencode' ? entry?.canUninstall : catalog?.canInstall;

  useEffect(() => { if (state.navigation?.target === 'library') { setSelected(state.navigation.appId); navigate(state.navigation.checkUpdates ? 'Updates' : state.navigation.appId); } }, [state.navigation]);

  useEffect(() => {
    let alive = true;
    void refreshCatalog().catch((err) => { if (alive) setError(errorText(err)); });
    return () => { alive = false; };
  }, [refreshCatalog, refresh]);

  useEffect(() => { if (review) reviewPanel.current?.scrollIntoView({ block: 'nearest' }); }, [review]);

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
        setBusy(null); setJob(null);
        try { localStorage.removeItem(JOB_KEY); } catch {}
        setRefresh((n) => n + 1);
        if (next.success) {
          setReview(null);
          if (job.operation === 'update') setChecks((current) => { const plan = current[job.app]?.plan; return plan ? { ...current, [job.app]: { plan: { ...plan, packages: [], downloadBytes: 0 } } } : current; });
          actions.notify(`${CATALOG.find((item) => item.id === job.app)!.name} ${job.operation === 'uninstall' ? 'uninstalled' : job.operation === 'update' ? 'updated' : 'installed'}`, '');
        } else setError(next.error || 'Package changes failed. Check the package manager output.');
      }
    }, (err) => { setError(`${errorText(err)} Package changes may still be running on the server.`); setBusy(null); });
  }, [source, actions, job, retry]);

  const failedUpdates = updates.items.filter((item) => item.status === 'failed').map((item) => item.app).join(',');
  useEffect(() => { if (failedUpdates) setRefresh((n) => n + 1); }, [failedUpdates]);
  const completedUpdates = updates.items.filter((item) => item.status === 'done').map((item) => item.app).join(',');
  useEffect(() => {
    if (!completedUpdates) return;
    setRefresh((n) => n + 1);
    setChecks((current) => {
      const next = { ...current };
      for (const id of completedUpdates.split(',') as ServerAppID[]) {
        const plan = next[id]?.plan;
        if (plan) next[id] = { plan: { ...plan, packages: [], downloadBytes: 0 } };
      }
      return next;
    });
  }, [completedUpdates]);
  useEffect(() => { if (updates.phase === 'auth') reauth(updates.queue.resume); }, [updates.phase, updates.queue, reauth]);

  async function prepare(id: ServerAppID, operation: 'install' | 'uninstall') {
    setBusy('plan'); setError(null); setReview(null); setProgress(null);
    try { const plan = await source.planAppInstall(id, operation); setReview({ app: id, operation, plan }); if (!plan.packages.length) setRefresh((n) => n + 1); }
    catch (err) { if (isReauthRequired(err)) reauth(() => { void prepare(id, operation); }); else setError(errorText(err)); }
    finally { setBusy(null); }
  }

  useEffect(() => {
    const intent = state.navigation;
    if (intent?.target !== 'library' || !intent.checkUpdates || checkedNavigation.current === intent.nonce || !catalog || busy !== null || job || updating) return;
    checkedNavigation.current = intent.nonce;
    if (!catalog.canInstall) { setError('Package management unavailable. Check the package manager and Lumo service.'); return; }
    void checkUpdates();
  }, [state.navigation, catalog, busy, job, updating]);

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

  async function checkUpdates() {
    if (checking.current || busy !== null || job || updates.queue.getSnapshot().phase !== 'idle') return;
    checking.current = true;
    updates.queue.clear();
    navigate('Updates'); setBusy('refresh'); setError(null); setReview(null); setChecks({}); setCheckedAt(null);
    try {
      const refreshed = await source.refreshUpdates();
      const current = await refreshCatalog();
      const next: typeof checks = {};
      for (const item of current.apps) {
        if (!item.installed || item.id === 'opencode') continue;
        try { next[item.id] = { plan: await source.planAppInstall(item.id, 'update') }; }
        catch (err) { if (isReauthRequired(err)) throw err; next[item.id] = { error: errorText(err) }; }
      }
      setChecks(next); setCheckedAt(refreshed);
    } catch (err) { if (isReauthRequired(err)) reauth(() => { void checkUpdates(); }); else setError(errorText(err)); }
    finally { checking.current = false; setBusy(null); }
  }

  function checkInstalledApps() {
    setJob(null); setBusy(null); setReview(null); setProgress(null);
    try { localStorage.removeItem(JOB_KEY); } catch {}
    setRefresh((n) => n + 1);
    setError('Status unavailable. Check installed apps before trying again.');
  }

  const confirmedApp = confirm ? CATALOG.find((item) => item.id === (confirm === 'opencode' ? confirm : confirm.app))! : null;
  const removing = confirm === 'opencode' || confirm?.operation === 'uninstall';

  const updateCount = Object.values(checks).filter((item) => item.plan?.packages.length).length;
  const locked = busy !== null || Boolean(job) || updating;
  function startUpdates(plans: UpdatePlan[]) { setError(null); setProgress(null); setReview(null); updates.queue.start(plans); }
  function refreshApps() { setError(null); setRefresh((value) => value + 1); }
  useAppMenus({ app: [{ id: 'check-updates', label: 'Check for Updates…', disabled: locked || !catalog?.canInstall, run: () => { void checkUpdates(); } }], view: [{ id: 'back', label: 'Back', disabled: !canBack, run: () => travel(-1) }, { id: 'forward', label: 'Forward', disabled: !canForward, run: () => travel(1) }, { id: 'refresh', label: 'Refresh', disabled: locked, run: refreshApps }] });

  return <div className="app app-library" data-testid="app-library">
    <div className="app-library-body">
      <aside className="app-library-sidebar" aria-label="App Library sections">
        <div className="library-sidebar-heading"><strong>Apps</strong></div>
        <nav className="library-navigation" aria-label="App Library"><button type="button" data-testid="library-discovery" aria-current={section === 'Discovery' ? 'page' : undefined} onClick={() => navigate('Discovery')}><IconGrid size={18}/>Discovery</button><button type="button" data-testid="library-updates" aria-current={section === 'Updates' ? 'page' : undefined} onClick={() => { navigate('Updates'); if (!checkedAt && catalog?.canInstall) void checkUpdates(); }}><IconDownload size={18}/>Updates{updateCount > 0 && <span className="library-count">{updateCount}</span>}</button></nav>
        <div className="library-sidebar-footer"><button className="library-check" type="button" data-testid="library-check-updates" disabled={locked || !catalog?.canInstall} onClick={() => void checkUpdates()}>{busy === 'refresh' ? 'Checking…' : 'Check for updates'}</button><small>{checkedAt ? `Last checked ${new Date(checkedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Not checked yet'}</small></div>
      </aside>
      <main ref={content} className="app-library-detail">
        <header className="library-page-heading"><nav className="library-page-history" aria-label="Page history"><button type="button" className="library-page-back" aria-label="Back" title="Back" data-testid="library-back" disabled={!canBack} onClick={() => travel(-1)}><IconChevronRight size={18}/></button><button type="button" aria-label="Forward" title="Forward" data-testid="library-forward" disabled={!canForward} onClick={() => travel(1)}><IconChevronRight size={18}/></button></nav>{!isDetail && <div><h1>{section}</h1><p>{section === 'Discovery' ? 'Find apps for your server.' : 'Keep your installed apps current.'}</p></div>}</header>
        {page === 'Discovery' && <>
          <div className="library-discovery-grid">{CATALOG.map((item) => {
            const ready = catalog?.apps.find((entry) => entry.id === item.id)?.installed;
            return <button type="button" key={item.id} data-testid={`library-${item.id}`} className="library-item" onClick={() => { navigate(item.id); setError(null); }}><span className="library-icon"><AppIcon appId={item.appId}/></span><span className="library-card-name"><strong>{item.name}</strong><small>{ready ? 'Installed' : catalog ? 'Available' : 'Checking…'}</small></span><span className="library-card-description">{item.description}</span></button>;
          })}</div>
        </>}
        {isDetail && <section className="library-app-overview" aria-label={`${app.name} details`}>
            <header className="library-hero"><span className="library-icon library-hero-icon"><AppIcon appId={app.appId}/></span><div><h1>{app.name}</h1><p>{app.description}</p></div>
              {app.id === 'opencode' && !installed ? <a className="btn btn-primary" data-testid="library-primary" href="https://opencode.ai/docs/" target="_blank" rel="noreferrer">Installation guide</a> : <button className={`btn ${installed ? 'btn-danger' : 'btn-primary'}`} type="button" data-testid="library-primary" disabled={!catalog || locked || !canManage} onClick={() => { if (app.id === 'opencode') setConfirm('opencode'); else void prepare(app.id, installed ? 'uninstall' : 'install'); }}>{job?.app === selected ? job.operation === 'uninstall' ? 'Uninstalling…' : job.operation === 'update' ? 'Updating…' : 'Installing…' : busy === 'plan' ? 'Preparing…' : installed ? 'Uninstall…' : 'Install…'}</button>}
            </header>
            <p className="library-description" data-testid="library-description">{app.overview}</p>
            <div className="library-information"><span>Includes</span><strong>{app.packages}</strong></div>
            {app.id === 'opencode' && (!installed || !canManage) && <p className="server-app-muted">{installed ? 'This installation is managed outside Lumo. Use the package manager that installed it to uninstall.' : 'Install the CLI for your Linux account, then choose View → Refresh.'}</p>}
          </section>}
        {page === 'Updates' && <section className="library-update-section" aria-label="Available updates">
          <div className="library-update-heading"><h2>Available updates</h2><button type="button" className="btn" data-testid="library-update-all" disabled={locked || !updateCount || !catalog?.canInstall} onClick={() => startUpdates(Object.values(checks).flatMap((check) => check.plan?.packages.length ? [check.plan] : []))}>{updating ? 'Updating…' : 'Update all'}</button></div>
          {(updateCount > 0 || updating) && <p className="library-update-notice">Updates may briefly restart apps and services.</p>}
          {busy === 'refresh' ? <p className="server-app-muted" role="status">Checking installed apps and package versions…</p> : !checkedAt && !updates.items.length ? <p className="server-app-muted">Check for updates to see available versions.</p> : <>
            {!updateCount && !updating && (checkedAt || completedUpdates) && !Object.values(checks).some((item) => item.error) && !updates.items.some((item) => item.status === 'failed') && <p className="library-up-to-date" role="status">{Object.keys(checks).length || completedUpdates ? 'Your managed apps are up to date.' : 'No apps managed by APT are installed.'}</p>}
            <div className="library-update-list">{CATALOG.filter((item) => {
              if (item.id === 'opencode') return false;
              const update = updates.items.find((update) => update.app === item.id);
              if (update?.status === 'done') return false;
              return Boolean(checks[item.id]?.plan?.packages.length || checks[item.id]?.error || update);
            }).map((item) => {
              const update = updates.items.find((update) => update.app === item.id);
              const check = checks[item.id as ServerAppID];
              const plan = check?.plan ?? update?.plan;
              const pkg = plan?.packages[0];
              const active = update?.status === 'updating';
              const pending = update?.status === 'pending';
              const needsAuth = active && updates.phase === 'auth';
              const disconnected = active && updates.phase === 'disconnected';
              return <article className="library-update-row" key={item.id} data-testid={`library-update-${item.id}`}><span className="library-icon"><AppIcon appId={item.appId}/></span><div className="library-update-copy"><h3>{item.name}</h3><p>{check?.error ? 'Could not check for updates' : pkg ? `${pkg.fromVersion || 'Not installed'} → ${pkg.toVersion}` : 'Update status unavailable'}</p>{check?.error ? <p className="server-app-error">{check.error}</p> : pkg && <small>{size(plan!.downloadBytes)} · {plan!.packages.length} {plan!.packages.length === 1 ? 'package' : 'packages'}</small>}{(active || pending) && <div className="library-update-progress" role="status"><small>{pending ? 'Waiting…' : needsAuth ? 'Confirm your password to continue.' : disconnected ? 'Connection interrupted' : update?.progress?.message || 'Preparing update…'}</small>{active && <div className="meter" role="progressbar" aria-label={`${item.name} update`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={update?.progress?.percent ?? 0}><div className="meter-fill" style={{ width: `${update?.progress?.percent ?? 0}%` }}/></div>}</div>}{update?.error && <p className="server-app-error" role="alert">{update.error}</p>}</div>{(pkg || check?.error || active) && <button type="button" className="btn" disabled={needsAuth || disconnected ? false : locked || !catalog?.canInstall} onClick={() => { if (needsAuth) reauth(updates.queue.resume); else if (disconnected) void updates.queue.reconnect(); else if (check?.error) void checkUpdates(); else if (plan) startUpdates([plan]); }}>{needsAuth ? 'Continue' : disconnected ? 'Reconnect' : active ? 'Updating…' : pending ? 'Waiting…' : check?.error ? 'Try again' : 'Update'}</button>}{disconnected && <button type="button" className="btn" onClick={() => { updates.queue.forget(); void checkUpdates(); }}>Check status</button>}</article>;
            })}</div>
          </>}
          {catalog?.apps.some((item) => item.id === 'opencode' && item.installed) && <p className="server-app-muted">OpenCode is managed outside APT. Update it using its installer.</p>}
        </section>}
        {!catalog?.canInstall && catalog && <p className="server-app-error">Package management unavailable. Check the package manager and Lumo service.</p>}
        {error && <div className="server-app-error" role="alert">{error}{job && <><button type="button" className="btn" onClick={() => { setError(null); setRetry((n) => n + 1); }}>Reconnect</button><button type="button" className="btn" onClick={checkInstalledApps}>Check installed apps</button></>}</div>}
        {progress && <section className="library-progress" aria-live="polite" data-testid="library-progress"><strong>{progress.done ? progress.success ? 'Package changes complete' : 'Package changes failed' : progress.message}</strong><div className="meter"><div className="meter-fill" style={{ width: `${progress.percent}%` }}/></div>{!progress.done && <p className="server-app-muted">Continues in the background.</p>}</section>}
        {review?.app === selected && !job && isDetail && review.operation !== 'update' && <section ref={reviewPanel} className="library-plan" data-testid="library-plan"><div className="server-app-section-heading"><h2>{review.operation === 'uninstall' ? 'Packages to remove' : 'Packages'}</h2><span className="server-app-muted">{review.operation !== 'uninstall' ? size(review.plan.downloadBytes) : `${review.plan.packages.length} packages`}</span></div>{review.plan.packages.length === 0 && <p className="server-app-muted">{'No package changes needed.'}</p>}<div className="library-packages">{review.plan.packages.map((pkg) => <div key={pkg.name}><strong>{pkg.name}</strong><span className="mono">{review.operation === 'uninstall' ? pkg.fromVersion : `${pkg.fromVersion || 'Not installed'} → ${pkg.toVersion}`}</span></div>)}</div><div className="server-app-savebar"><button type="button" className="btn" onClick={() => setReview(null)}>Cancel</button><button type="button" className={`btn ${review.operation === 'uninstall' ? 'btn-danger' : 'btn-primary'}`} data-testid="library-install-confirm" disabled={busy !== null || review.plan.packages.length === 0} onClick={() => setConfirm(review)}>{review.operation === 'uninstall' ? 'Uninstall' : 'Install'} {app.name}</button></div></section>}
        {section === 'Updates' && <section className="library-update-section library-history" data-testid="library-history"><h2>Update history</h2><p className="library-history-note">Recent app updates made through Lumo by your account.</p>{historyError ? <p className="server-app-error" role="alert">{historyError}</p> : historyLoading ? <p className="server-app-muted">Loading history…</p> : !history.length ? <p className="server-app-muted">No updates recorded yet.</p> : history.map((item) => {
          const app = CATALOG.find((app) => app.id === item.appId)!;
          const names = item.appId === 'docker' ? ['docker.io', 'docker-ce'] : ['nginx'];
          const pkg = item.packages.find((pkg) => names.includes(pkg.name)) ?? item.packages[0];
          return <article key={item.requestId} className="library-history-entry"><span className="library-icon"><AppIcon appId={app.appId}/></span><div><strong>{app.name} {item.success ? 'updated' : 'update failed'}</strong><small>{new Date(item.completedAt).toLocaleString()}</small></div><span className="library-history-version">{pkg ? `${pkg.fromVersion || 'Not installed'} → ${pkg.toVersion}` : 'Version unavailable'}</span>{item.error && <p className="server-app-error">{item.error}</p>}</article>;
        })}</section>}

      </main>
    </div>
    {confirm && confirmedApp && <AppConfirmation title={`${removing ? 'Uninstall' : 'Install'} ${confirmedApp.name}?`} confirm={removing ? 'Uninstall' : 'Install packages'} onCancel={() => setConfirm(null)} onConfirm={() => { if (confirm === 'opencode') void uninstallOpenCode(); else void apply(confirm); }}><p>{removing ? confirmedApp.removal : `${confirm.plan.packages.length} packages. Services may start. This cannot be undone automatically.`}</p>{!removing && confirmedApp.id === 'docker' && <p>Docker access must be granted separately.</p>}</AppConfirmation>}
  </div>;
}
