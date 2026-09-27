// SPDX-License-Identifier: AGPL-3.0-only
import { useAppMenus } from '../shell/appMenus';
import { useAppState } from '../shell/useAppState';
import { useEffect, useRef, useState } from 'react';
import { getDataSource, isReauthRequired } from '../api/source';
import type { AppLogs, WebsiteDefinition, WebsiteSnapshot } from '../api/server-apps';
import { useReauth } from '../shell/ReauthSheet';
import { useShell } from '../shell/ShellContext';
import { IconGlobe, IconSearch } from '../shell/icons';
import { errorText, AppConfirmation, AppLogView } from './ServerAppUI';
import '../styles/apps.css';
import '../styles/server-apps.css';

type Draft = { definition: WebsiteDefinition; revision: string };
type Save = Draft & { id: string; draftKey: string };
const EMPTY: WebsiteDefinition = { domain: '', kind: 'proxy', port: 3000, root: '', enabled: true };

export function Websites() {
  const formRef = useRef<HTMLFormElement>(null);
  const source = getDataSource();
  const { actions } = useShell();
  const reauth = useReauth();
  const [snapshot, setSnapshot] = useState<WebsiteSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [query, setQuery] = useAppState<string>('websites', 'query', '');
  const [selectedID, setSelectedID] = useAppState<string | null>('websites', 'selection', null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [tab, setTab] = useAppState<'settings' | 'source' | 'access' | 'error'>('websites', 'tab', 'settings', ['settings', 'source', 'access', 'error']);
  const [pending, setPending] = useState<Save | null>(null);
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState<AppLogs | null>(null);
  const [logError, setLogError] = useState<string | null>(null);
  const [logLoading, setLogLoading] = useState(false);
  const [logRefresh, setLogRefresh] = useState(0);

  useEffect(() => {
    let alive = true;
    void source.getWebsites().then((next) => { if (alive) { setSnapshot(next); setError(null); } }).catch((err) => { if (alive) setError(errorText(err)); });
    return () => { alive = false; };
  }, [source, refresh]);

  useEffect(() => {
    let alive = true;
    if (tab !== 'access' && tab !== 'error') return;
    setLogLoading(true); setLogError(null); setLogs(null);
    void source.getWebsiteLogs(tab).then((next) => { if (alive) setLogs(next); }).catch((err) => { if (alive) setLogError(errorText(err)); }).finally(() => { if (alive) setLogLoading(false); });
    return () => { alive = false; };
  }, [source, tab, logRefresh]);

  const filtered = (snapshot?.sites ?? []).filter((site) => `${site.name} ${site.path}`.toLowerCase().includes(query.toLowerCase()));
  const isNew = selectedID === 'new';
  const selected = isNew ? null : filtered.find((site) => site.id === selectedID) ?? filtered[0];
  const key = isNew ? 'new' : selected?.id ?? '';
  const draft = drafts[key];
  const definition = draft?.definition ?? selected?.definition ?? EMPTY;
  const dirty = isNew || (draft && JSON.stringify(draft.definition) !== JSON.stringify(selected?.definition));
  const custom = Boolean(!isNew && selected && !selected.managed);
  const conflicted = selected && draft && selected.revision !== draft.revision;

  function change(patch: Partial<WebsiteDefinition>) {
    setDrafts((current) => ({ ...current, [key]: { revision: current[key]?.revision ?? selected?.revision ?? 'absent', definition: { ...definition, ...patch } } }));
  }

  async function save(value: Save) {
    setPending(null); setBusy(true); setError(null);
    try {
      const result = await source.saveWebsite(value.id, value.definition, value.revision);
      setSnapshot((current) => current ? { ...current, sites: [...current.sites.filter((site) => site.id !== result.site.id), result.site] } : current);
      setDrafts((current) => {
        const next = { ...current };
        const latest = next[value.draftKey];
        delete next[value.draftKey];
        if (latest && JSON.stringify(latest.definition) !== JSON.stringify(value.definition)) {
          next[result.site.id] = { definition: latest.definition, revision: result.site.revision };
        }
        return next;
      });
      setSelectedID(result.site.id);
      actions.notify('Website saved', result.reloaded ? `${result.site.name} · reload requested` : result.site.name);
    } catch (err) {
      if (isReauthRequired(err)) reauth(() => { void save(value); });
      else setError(errorText(err));
    } finally { setBusy(false); }
  }

  function review() {
    const id = isNew ? definition.domain.replaceAll('.', '-').slice(0, 63).replace(/-+$/, '') : selected!.id;
    setPending({ id, draftKey: key, definition: { ...definition }, revision: draft?.revision ?? selected?.revision ?? 'absent' });
  }

  useAppMenus({
    file: [{ id: 'save', label: 'Save…', disabled: busy || !dirty || Boolean(conflicted) || custom || tab !== 'settings', run: () => formRef.current?.requestSubmit() }],
    view: [{ id: 'refresh', label: 'Refresh', run: () => setRefresh((value) => value + 1) }],
  });

  return <div className="app server-app" data-testid="app-websites">
    <div className="app-toolbar"><label className="app-search"><IconSearch size={14}/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search websites" aria-label="Search websites"/></label><span className="server-app-toolbar-note">Nginx{source.kind === 'mock' ? ' · Demo' : ''}</span><div className="app-toolbar-actions"><button type="button" className="btn" data-testid="websites-refresh" onClick={() => setRefresh((n) => n + 1)}>Refresh</button><button type="button" className="btn btn-primary" data-testid="website-add" disabled={!snapshot?.installed || busy} onClick={() => { setSelectedID('new'); setTab('settings'); }}>Add website</button></div></div>
    {error && <p className="server-app-error" role="alert">{error}</p>}
    {!snapshot ? <div className="server-app-empty">{error ? 'Websites unavailable.' : 'Loading…'}</div> : !snapshot.installed ? <div className="server-app-empty"><IconGlobe size={44}/><h2>Nginx not installed</h2><button type="button" className="btn btn-primary" onClick={() => actions.openLibrary('nginx')}>Open App Library</button></div> : <div className="server-app-body">
      <aside className="server-app-sidebar" aria-label="Websites"><div className="server-app-section-heading"><h2>Websites</h2><span className="pill">{snapshot.sites.filter((site) => site.managed).length}</span></div><div className="server-app-resource-list">{isNew && <button type="button" className="server-app-resource selected" onClick={() => setSelectedID('new')}><IconGlobe size={17}/><span><strong>New website</strong><small>Unsaved</small></span></button>}{filtered.map((site) => <button type="button" key={site.id} className={`server-app-resource${selected?.id === site.id ? ' selected' : ''}`} aria-pressed={selected?.id === site.id} data-testid={`website-row-${site.name}`} onClick={() => { setSelectedID(site.id); if (tab === 'source' && site.managed) setTab('settings'); }}><span className={`server-app-state-dot${site.definition?.enabled ? ' on' : ''}`}/><span><strong>{site.name}{drafts[site.id] ? ' •' : ''}</strong><small>{site.managed ? site.definition?.kind === 'proxy' ? 'Application proxy' : 'Static website' : 'Existing configuration'}</small></span></button>)}</div>{!filtered.length && <p className="server-app-muted">{query ? 'No matching websites.' : 'No websites.'}</p>}<button className="btn server-app-service-link" type="button" onClick={() => actions.openService('nginx.service')}>Nginx service</button></aside>
      <main className="server-app-detail">
        {snapshot.warnings.map((warning) => <p className="server-app-error" key={warning}>{warning}</p>)}
        {selected || isNew ? <><header className="server-app-detail-heading"><span className="server-app-large-icon"><IconGlobe size={28}/></span><div><h2>{isNew ? 'New website' : selected?.name}</h2></div>{!custom && !isNew && <span className={`pill pill-${selected?.definition?.enabled ? 'active' : 'inactive'}`}>{selected?.definition?.enabled ? 'Enabled' : 'Disabled'}</span>}</header>
        <div className="server-app-tabs" role="tablist" aria-label="Website details">{(!custom ? ['settings', ...(isNew ? [] : ['source']), 'access', 'error'] : ['source', 'access', 'error']).map((value) => <button type="button" role="tab" key={value} aria-selected={tab === value || (custom && tab === 'settings' && value === 'source')} onClick={() => setTab(value as typeof tab)}>{value === 'settings' ? 'Settings' : value === 'source' ? 'Configuration' : value === 'access' ? 'Access log' : 'Error log'}</button>)}</div>
        {tab === 'access' || tab === 'error' ? <><p className="server-app-muted">Shared Nginx {tab} log</p><AppLogView logs={logs} error={logError} loading={logLoading} onRefresh={() => setLogRefresh((n) => n + 1)}/></> : custom || tab === 'source' ? <><p className="server-app-muted">{selected?.path}</p>{custom && <p className="server-app-notice">Custom configuration · read-only</p>}<pre className="server-app-source" tabIndex={0} data-testid="website-source">{selected?.source}</pre></> : <form ref={formRef} className="website-form" data-testid="website-form" onSubmit={(e) => { e.preventDefault(); review(); }}>
          {conflicted && <p className="server-app-error" role="alert">Changed on the server. Discard your draft to load the latest version.</p>}
          <section className="server-app-card website-fields"><label>Domain<input aria-label="Website domain" required pattern="[a-z0-9][a-z0-9.\-]*\.[a-z0-9.\-]+" maxLength={253} placeholder="app.example.com" value={definition.domain} onChange={(e) => change({ domain: e.target.value.toLowerCase() })}/></label><p className="server-app-muted">DNS must point to this VPS.</p><fieldset><legend>Website type</legend><div className="website-kind-options">{(['proxy', 'static'] as const).map((kind) => <label key={kind} className={definition.kind === kind ? 'selected' : ''}><input type="radio" name="website-kind" value={kind} checked={definition.kind === kind} onChange={() => change({ kind, port: kind === 'proxy' ? 3000 : 0, root: kind === 'static' ? '/var/www/html' : '' })}/><strong>{kind === 'proxy' ? 'Local application' : 'Static files'}</strong></label>)}</div></fieldset>{definition.kind === 'proxy' ? <label>Application port<input aria-label="Application port" type="number" min={1} max={65535} required value={definition.port || ''} onChange={(e) => change({ port: Number(e.target.value) })}/><small>http://127.0.0.1:{definition.port || 'port'}</small></label> : <label>Website folder<input aria-label="Website folder" required placeholder="/var/www/html" value={definition.root} onChange={(e) => change({ root: e.target.value })}/><small>Existing folder under /var/www or /srv</small></label>}<label className="website-enabled"><input type="checkbox" checked={definition.enabled} onChange={(e) => change({ enabled: e.target.checked })}/>Enabled</label></section>
          <p className="server-app-muted">HTTP · port 80</p><div className="server-app-savebar"><span className="server-app-muted">{dirty ? 'Unsaved changes' : 'Saved'}</span>{draft && <button type="button" className="btn" disabled={busy} onClick={() => setDrafts((current) => { const next = { ...current }; delete next[key]; return next; })}>Discard draft</button>}<button type="submit" className="btn btn-primary" data-testid="website-save" disabled={busy || !dirty || Boolean(conflicted)}>{busy ? 'Saving…' : 'Save…'}</button></div>
        </form>}</> : <div className="server-app-empty"><IconGlobe size={42}/><h2>No websites</h2></div>}
      </main>
    </div>}
    {pending && <AppConfirmation title="Save website?" confirm="Save and reload" onCancel={() => setPending(null)} onConfirm={() => void save(pending)}><p><strong>{pending.definition.domain}</strong> will {pending.definition.enabled ? pending.definition.kind === 'proxy' ? `forward HTTP traffic to local port ${pending.definition.port}` : `serve ${pending.definition.root}` : 'be disabled'}.</p><p>Nginx will reload after validation. A backup is kept.</p></AppConfirmation>}
  </div>;
}
