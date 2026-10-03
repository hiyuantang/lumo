// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import type { DesktopBuild, DesktopChange } from '../api/desktop-apps';
import { getDataSource } from '../api/source';
import { useShell } from '../shell/ShellContext';
import { AppIcon } from '../shell/AppIcon';
import { LibraryCard } from '../apps/LibraryCard';
import { AppConfirmation } from '../apps/ServerAppUI';
import { useDesktopApps } from './catalog';
import '../styles/desktop-apps.css';

function compareVersion(a: string, b: string) { const aa = a.split('.').map(Number); const bb = b.split('.').map(Number); return aa[0] - bb[0] || aa[1] - bb[1] || aa[2] - bb[2]; }
export function DesktopAppLibrary({ updates = false, selected, onSelect }: { updates?: boolean; selected?: string; onSelect(id: string): void }) {
  const { catalog, error: catalogError, refresh, preview } = useDesktopApps(); const { state, actions } = useShell();
  const [busy, setBusy] = useState(''); const [error, setError] = useState('');
  const [remove, setRemove] = useState<string>(); const [clean, setClean] = useState(false);
  const [selectedBuild, setSelectedBuild] = useState<Record<string, string>>({});
  const groups = [...new Set([...catalog.apps.map((a) => a.manifest.id), ...catalog.builds.map((b) => b.manifest.id)])];
  function change(id: string, action: DesktopChange['action'], digest?: string, onComplete?: () => void) {
    if (busy) return;
    const app = catalog.apps.find((a) => a.manifest.id === id);
    const windows = Object.values(state.windows).filter((w) => w?.appId === `app:${id}`);
    setRemove(undefined);
    actions.closeWindows(windows.flatMap((win) => win ? [win.id] : []), () => { void performChange(); });
    async function performChange() {
      setBusy(id); setError('');
      let complete = false;
      try {
        await getDataSource().desktopAppChange({ requestId: crypto.randomUUID(), action, id, digest, revision: app?.revision ?? '', clean: action === 'uninstall' && clean });
        await refresh(); setRemove(undefined);
        complete = true;
      } catch (e) { setError(e instanceof Error ? e.message : 'App action failed.'); }
      finally { setBusy(''); }
      if (complete) onComplete?.();
    }
  }
  const candidates = groups.map((id) => {
    const app = catalog.apps.find((a) => a.manifest.id === id);
    const versions = catalog.builds.filter((b) => b.manifest.id === id).sort((a, b) => compareVersion(b.manifest.version, a.manifest.version));
    const build: DesktopBuild | undefined = (!updates ? versions.find((b) => b.digest === selectedBuild[id]) : undefined) ?? versions[0] ?? app;
    return { id, app, versions, build };
  }).filter(({ app, build }) => build && (!updates || (app && compareVersion(build.manifest.version, app.manifest.version) > 0)));
  const hasHistory = updates && catalog.apps.some((app) => app.history.length > 0);
  const alerts = <>{catalogError && <p role="alert">{catalogError}</p>}{error && <p role="alert">{error}</p>}</>;
  const confirmation = remove && <AppConfirmation title="Uninstall custom app?" confirm={clean ? 'Clean uninstall' : 'Uninstall'} busy={!!busy} onCancel={() => setRemove(undefined)} onConfirm={() => void change(remove, 'uninstall')}><p>Remove the app and keep its project files. Settings and app data are kept by default.</p><div className="desktop-app-clean"><span>Also move settings and app data to Trash</span><input type="checkbox" aria-label="Clean uninstall" checked={clean} onChange={(e) => setClean(e.target.checked)}/></div></AppConfirmation>;
  if (selected !== undefined) {
    const candidate = candidates.find((item) => item.id === selected);
    if (!candidate?.build) return <>{alerts}<p role="status">This app is no longer available. Go back to All Apps or choose View → Refresh.</p></>;
    const { id, app, versions, build } = candidate;
    return <section className="library-app-overview" aria-label={`${build.manifest.name} details`} data-testid={`desktop-detail-${id}`}>
      <header className="library-hero"><span className="library-icon library-hero-icon"><AppIcon appId={`app:${id}`}/></span><div><h1>{build.manifest.name}</h1><p>{build.manifest.description}</p></div><div className="library-action library-managed-actions">
        {app?.enabled && <button className="btn" disabled={!!busy} onClick={() => actions.openApp(`app:${id}`)}>Open</button>}
        {(!app || app.digest !== build.digest) && <button className="btn btn-primary" data-testid={`desktop-install-${id}`} disabled={!!busy} onClick={() => void change(id, 'install', build.digest)}>{busy === id ? 'Installing…' : app ? 'Update' : 'Install'}</button>}
      </div></header>
      {alerts}
      <div className="library-information"><span>Status</span><strong>{app ? `${app.manifest.version} · ${app.enabled ? 'Installed' : 'Disabled'}` : 'Ready to install'}</strong></div>
      <div className="library-information"><span>App version</span>{versions.length > 1 ? <select className="input desktop-app-version" aria-label={`${build.manifest.name} build`} value={build.digest} onChange={(e) => setSelectedBuild((v) => ({ ...v, [id]: e.target.value }))}>{versions.map((b) => <option key={b.digest} value={b.digest}>{b.manifest.version}</option>)}</select> : <strong>{build.manifest.version}</strong>}</div>
      <p className="library-description">{build.manifest.capabilities.length ? 'Access: ' + build.manifest.capabilities.map((capability) => capability.name === 'app.storage' ? 'save this app’s data' : capability.name === 'notifications.send' ? 'send Lumo notifications' : 'read CPU and memory usage').join('; ') + '.' : 'No system access.'}</p>
      <div className="desktop-app-actions">
        <button className="btn" disabled={!!busy} onClick={() => preview(build)}>Preview</button>
        {app && <><button className="btn" disabled={!!busy} onClick={() => void change(id, app.enabled ? 'disable' : 'enable')}>{app.enabled ? 'Disable' : 'Enable'}</button>{app.previous && <button className="btn" disabled={!!busy} onClick={() => void change(id, 'restore')}>Restore previous version</button>}<button className="btn btn-danger" disabled={!!busy} onClick={() => { setRemove(id); setClean(false); }}>Uninstall</button></>}
      </div>
      {confirmation}
    </section>;
  }
  if (!candidates.length && !hasHistory) return catalogError || error ? alerts : null;
  return <section className="desktop-app-library library-app-group" aria-label={updates ? 'Custom App Updates' : 'Custom Apps'} data-testid={updates ? 'desktop-app-updates' : 'desktop-app-library'}>
    <div className="library-section-heading"><h2>{updates ? 'Custom App Updates' : 'Custom Apps'}</h2>{updates && candidates.length > 1 && <button className="btn" disabled={!!busy} onClick={() => { const queue = [...candidates]; const next = () => { const item = queue.shift(); if (item?.build) change(item.id, 'install', item.build.digest, next); }; next(); }}>Update all custom apps</button>}</div>
    {alerts}
    {!candidates.length && <p className="desktop-app-hint">Custom apps are up to date.</p>}
    {updates ? <div className="library-update-list">{candidates.map(({ id, app, build }) => build && <article key={id} className="library-update-row" data-testid={`desktop-update-${id}`}><span className="library-icon"><AppIcon appId={`app:${id}`}/></span><div className="library-update-copy"><h3>{build.manifest.name}</h3><p>{app?.manifest.version} → {build.manifest.version}</p></div><button className="btn" onClick={() => { setSelectedBuild((value) => ({ ...value, [id]: build.digest })); onSelect(id); }}>Details</button><button className="btn btn-primary" data-testid={`desktop-install-${id}`} disabled={!!busy} onClick={() => void change(id, 'install', build.digest)}>{busy === id ? 'Updating…' : 'Update'}</button></article>)}</div> : <div className="library-discovery-grid">{candidates.map(({ id, app, build }) => build && <LibraryCard key={id} appId={`app:${id}`} name={build.manifest.name} description={build.manifest.description} status={app ? `${app.enabled ? 'Installed' : 'Disabled'} · ${app.manifest.version}` : 'Ready to install'} testId={`desktop-card-${id}`} onClick={() => onSelect(id)} />)}</div>}
    {hasHistory && <div className="desktop-app-history"><h3>Installed history</h3>{catalog.apps.flatMap((app) => app.history.map((h, i) => <p key={`${app.manifest.id}-${i}`}>{app.manifest.name} · {h.from || 'Not installed'} → {h.to}</p>))}</div>}
  </section>;
}
