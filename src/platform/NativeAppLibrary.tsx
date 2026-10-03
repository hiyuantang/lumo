// SPDX-License-Identifier: AGPL-3.0-only
import { useRef, useState } from 'react';
import type { NativeApp, NativeBundle, NativeChange } from '../api/app-plugins';
import { getDataSource } from '../api/source';
import type { PluginStatus } from './usePluginCatalog';
import { useNativeApps } from './nativeCatalog';
import { useShell } from '../shell/ShellContext';
import { AppIcon } from '../shell/AppIcon';
import { AppConfirmation } from '../apps/ServerAppUI';
import type { AppId } from '../apps/registry';
import '../styles/native-plugins.css';

export function NativeImport({ onSelect }: { onSelect(name: string): void }) {
  const input = useRef<HTMLInputElement>(null);
  const native = useNativeApps();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return <div className="native-import"><button className="btn" disabled={busy} onClick={() => input.current?.click()} data-testid="plugin-import">{busy ? 'Importing…' : 'Import app'}</button><input ref={input} type="file" accept=".lumoplugin,application/json" hidden data-testid="plugin-import-file" onChange={async (event) => {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
    setBusy(true); setError('');
    try { if (file.size > 90 * 1024 * 1024) throw new Error('App packages must be smaller than 90 MB.'); const bundle = JSON.parse(await file.text()) as NativeBundle; await getDataSource().importNativeApp(bundle); await native.refresh(); onSelect(bundle.name); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not import this app.'); } finally { setBusy(false); }
  }}/>{error && <p className="server-app-error" role="alert">{error}</p>}</div>;
}
const permissionLabels: Record<string,string> = { 'notifications.send': 'Send notifications to your Lumo inbox, including from background work.', account: 'Use your files, network connections and Lumo account.', 'broker.containers.start': 'Start containers.', 'broker.containers.stop': 'Stop containers.', 'broker.containers.restart': 'Restart containers.', 'broker.docker.resource': 'Manage Docker resources.', 'broker.websites.save': 'Change website settings.' };
export function NativeAppDetails({ app, description, status }: { app: NativeApp; description?: string; status?: PluginStatus }) {
  const native = useNativeApps();
  const { actions, state } = useShell();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [uninstall, setUninstall] = useState(false);
  const [clean, setClean] = useState(false);
  const latest = app.releases[0] ?? app.current;
  if (!latest) return <p role="alert">This app package is unavailable.</p>;
  const manifest = app.current?.manifest ?? latest.manifest;
  const id = manifest.id as AppId;
  const update = app.installed && app.current?.digest !== latest.digest;
  const open = Object.values(state.windows).some((window) => window?.appId === id);
  async function change(action: NativeChange['action']) {
    setBusy(true); setError('');
    try { await getDataSource().changeNativeApp({ requestId: crypto.randomUUID(), name: app.name, action, digest: latest!.digest, revision: app.revision, trust: true, clean }); setUninstall(false); await native.refresh(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not change this app.'); } finally { setBusy(false); }
  }
  return <section className="library-app-overview" aria-label={`${manifest.name} details`}>
    <header className="library-hero"><span className="library-icon library-hero-icon"><AppIcon appId={id}/></span><div><h1>{manifest.name}</h1><p>{manifest.description || description}</p></div><div className="library-action native-actions">
      {app.installed && <button className="btn" data-testid="library-open" disabled={!!status?.error} onClick={() => actions.openApp(id)}>Open</button>}
      {busy ? <span role="status">Applying…</span> : <button className={`btn ${app.installed ? 'btn-danger' : 'btn-primary'}`} data-testid="plugin-install" disabled={open} onClick={() => app.installed ? setUninstall(true) : void change('install')}>{app.installed ? 'Uninstall' : 'Install'}</button>}
    </div></header>
    <div className="library-information"><span>App version</span><strong>{status?.version ?? manifest.version}</strong></div>
    <p className="library-description">Installed for your account. Only install apps from a source you trust.</p>
    <div className="native-permissions"><strong>App access</strong><ul>{[...new Set(['account', ...(latest.manifest.permissions ?? [])])].map((permission) => <li key={permission}>{permissionLabels[permission] ?? permission}</li>)}</ul>{latest.manifest.permissions?.some((permission) => permission.startsWith('broker.')) && <p>System changes still require server authorization.</p>}</div>
    <div className="native-actions">{update && <button className="btn btn-primary" data-testid="plugin-update" disabled={busy || open} onClick={() => void change('update')}>Update to {latest.manifest.version}</button>}{app.installed && app.previous && <button className="btn" data-testid="plugin-rollback" disabled={busy || open} onClick={() => void change('rollback')}>Restore previous version</button>}</div>
    {open && <p className="server-app-muted">Close this app’s windows before changing its package.</p>}
    {(error || app.error || status?.error) && <p className="server-app-error" role="alert">{error || app.error || status?.error}</p>}
    {uninstall && <AppConfirmation title={`Uninstall ${manifest.name}?`} confirm={clean ? 'Clean uninstall' : 'Uninstall'} onCancel={() => setUninstall(false)} onConfirm={() => void change('uninstall')}>
      <p>Remove this app from your account. Other accounts are unchanged.</p>
      <div className="native-clean"><span>Move app-owned data to Trash</span><input type="checkbox" aria-label="Move app-owned data to Trash" checked={clean} onChange={(event) => setClean(event.target.checked)}/></div>
      <p>Project files, server software and existing shared settings are kept.</p>
    </AppConfirmation>}
  </section>;
}
export function NativeAppUpdates({ onSelect }: { onSelect(name: string): void }) {
  const native = useNativeApps();
  const { state } = useShell();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const updates = native.apps.filter((app) => !app.current?.manifest.required && app.installed && app.current && app.releases[0] && app.current.digest !== app.releases[0].digest);
  const open = (app: NativeApp) => Object.values(state.windows).some((window) => window?.appId === app.current?.manifest.id);
  async function apply(apps: NativeApp[]) {
    setBusy(true); setError('');
    try { for (const app of apps) { await getDataSource().changeNativeApp({ requestId: crypto.randomUUID(), name: app.name, action: 'update', digest: app.releases[0].digest, revision: app.revision, trust: true }); } }
    catch (err) { setError(err instanceof Error ? err.message : 'App update failed.'); }
    finally { await native.refresh().catch(() => {}); setBusy(false); }
  }
  const history = native.apps.filter(app=>!app.current?.manifest.required).flatMap((app) => (app.history ?? []).filter((item) => item.from).map((item) => ({...item,name:app.name,title:app.current?.manifest.name ?? app.name})));
  if (!updates.length && !history.length) return null;
  return <section className="library-update-section" aria-label="App package updates"><div className="library-update-heading"><h2>App packages</h2>{updates.length > 0 && <button className="btn" data-testid="plugin-update-all" disabled={busy || updates.some(open)} onClick={() => void apply(updates)}>Update all packages</button>}</div>
    {updates.map((app) => <article className="library-update-row" key={app.name}><div className="library-update-copy"><h3>{app.current!.manifest.name}</h3><p>{app.current!.manifest.version} → {app.releases[0].manifest.version}</p>{open(app) && <p>Close this app’s windows to update.</p>}</div><button className="btn" disabled={busy || open(app)} onClick={() => void apply([app])}>Update</button><button className="btn" onClick={() => onSelect(app.name)}>Details</button></article>)}
    {busy && <p role="status">Updating app packages…</p>}{error && <p role="alert" className="server-app-error">{error}</p>}
    {history.map((item,index) => <article className="library-history-entry" key={item.name+item.at+index}><strong>{item.title}</strong><span>{item.from} → {item.to}</span><small>{new Date(item.at).toLocaleString()}</small></article>)}
  </section>;
}
