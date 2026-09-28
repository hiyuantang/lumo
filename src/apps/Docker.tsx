// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from 'react';
import type { DockerResources, DockerResourceRequest, ContainerDetail } from '../api/server-apps';
import { getDataSource, isReauthRequired } from '../api/source';
import { useAppState } from '../shell/useAppState';
import { useShell } from '../shell/ShellContext';
import { useReauth } from '../shell/ReauthSheet';
import { useAppMenus } from '../shell/appMenus';
import { IconSearch, IconRefresh } from '../shell/icons';
import { Containers } from './Containers';
import { AppConfirmation, errorText } from './ServerAppUI';
import '../styles/docker.css';
import { dockerSize } from '../utils/docker-format';

const SECTIONS = ['Containers', 'Images', 'Volumes', 'Networks', 'Storage'] as const;
type Section = typeof SECTIONS[number];
type Review = { request: DockerResourceRequest; name: string; message: string };
const total = (values: (number | null)[]) => values.some((v) => v == null) ? null : values.reduce<number>((sum, v) => sum + (v ?? 0), 0);
const date = (value: string | number) => value ? new Date(typeof value === 'number' ? value * 1000 : value).toLocaleDateString() : 'Unavailable';

export function Docker() {
  const source = getDataSource();
  const { actions } = useShell();
  const reauth = useReauth();
  const [section, setSection] = useAppState<Section>('containers', 'section', 'Containers', [...SECTIONS]);
  const [query, setQuery] = useState('');
  const [resources, setResources] = useState<DockerResources | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [review, setReview] = useState<Review | null>(null);
  const [create, setCreate] = useState<'volume' | 'network' | null>(null);
  const [name, setName] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null);
    void source.getDockerResources().then((next) => { if (alive) setResources(next); }).catch((err) => { if (alive) setError(errorText(err)); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [source, refresh]);
  function reload() { setRefresh((n) => n + 1); }
  useAppMenus({ app: [{ id: 'check-updates', label: 'Check for Updates…', run: () => actions.openLibrary('docker', true) }], view: [{ id: 'refresh', label: 'Refresh', run: reload }] });
  async function run(request: DockerResourceRequest) {
    setBusy(true); setError(null); setNotice('');
    try {
      await source.runDockerResourceAction(request);
      setReview(null); setCreate(null); setName(''); setConfirmation('');
      setNotice(`${request.kind[0].toUpperCase() + request.kind.slice(1)} ${request.action === 'create' ? 'created' : 'removed'}.`);
      reload();
    } catch (err) { if (isReauthRequired(err)) reauth(() => { void run(request); }); else setError(errorText(err)); }
    finally { setBusy(false); }
  }
  function remove(kind: DockerResourceRequest['kind'], id: string, revision: string, label: string, message: string) {
    setConfirmation(''); setError(null); setReview({ request: { kind, id, revision, action: 'remove' }, name: label, message });
  }
  function removeContainer(item: ContainerDetail) { remove('container', item.id, item.revision, item.name, 'This permanently removes the stopped container and its writable layer. Named volumes, bind-mounted files and the image are kept.'); }
  const match = (value: string) => value.toLowerCase().includes(query.toLowerCase());
  const images = resources?.images.filter((item) => match(`${item.tags.join(' ')} ${item.id}`)) ?? [];
  const volumes = resources?.volumes.filter((item) => match(`${item.name} ${item.driver}`)) ?? [];
  const networks = resources?.networks.filter((item) => match(`${item.name} ${item.driver}`)) ?? [];
  const storageRows = resources ? [
    { label: 'Image layers', count: resources.images.length, size: resources.imageBytes, note: 'Shared layers counted once.' },
    { label: 'Container writable layers', count: resources.containers.length, size: total(resources.containers.map((v) => v.writableSize)), note: 'Changes stored inside containers; excludes mounted data.' },
    { label: 'Volumes', count: resources.volumes.length, size: total(resources.volumes.map((v) => v.size)), note: 'Persistent data, including volumes attached to stopped containers.' },
    { label: 'Build cache', count: null, size: resources.buildCacheBytes, note: 'Build cache can share layers with images; do not add these totals together.' },
  ] : [];
  const refreshButton = <button className="btn btn-icon docker-refresh" type="button" aria-label={`Refresh ${section.toLowerCase()}`} title={`Refresh ${section.toLowerCase()}`} onClick={reload} disabled={loading || busy}><IconRefresh size={16}/></button>;
  const listBar = <div className="docker-list-bar">{refreshButton}<label className="app-search"><IconSearch size={14}/><input aria-label={`Search ${section.toLowerCase()}`} placeholder={`Search ${section.toLowerCase()}`} value={query} onChange={(e) => setQuery(e.target.value)}/></label>{(section === 'Volumes' || section === 'Networks') && <button className="btn docker-create" type="button" disabled={!resources || busy || !!error} onClick={() => { setCreate(section === 'Volumes' ? 'volume' : 'network'); setName(''); }}>Create {section === 'Volumes' ? 'volume' : 'network'}</button>}</div>;
  return <div className="app server-app docker-app" data-testid="app-containers">
    <nav className="docker-navigation" aria-label="Docker sections">{SECTIONS.map((item) => <button type="button" key={item} aria-current={section === item ? 'page' : undefined} data-testid={`docker-section-${item.toLowerCase()}`} onClick={() => { setSection(item); setQuery(''); }}>{item}</button>)}</nav>
    {section === 'Containers' && error && !review && <p role="alert" className="server-app-error">Storage information unavailable: {error}</p>}
    {section === 'Containers' ? <Containers resources={resources} resourceRefresh={refresh} onRemove={removeContainer} onRefresh={reload}/> : <>
      <main className="docker-content">
        <header className="docker-heading"><div><div className="docker-heading-title">{section === 'Storage' && refreshButton}<h2>{section}</h2></div><p>{section === 'Images' ? 'Local images and the containers that use them.' : section === 'Volumes' ? 'Persistent data, separate from container writable layers.' : section === 'Networks' ? 'Connections between containers and your host.' : 'Disk usage reported by Docker Engine.'}</p></div><span>{resources && (section === 'Images' ? `${resources.images.length} images` : section === 'Volumes' ? `${resources.volumes.length} volumes` : section === 'Networks' ? `${resources.networks.length} networks` : '')}</span></header>
        {error && <p className="server-app-error" role="alert">{error} {resources && 'Showing the previous snapshot.'}</p>}
        {notice && <p role="status" className="server-app-notice">{notice}</p>}
        {!resources ? <div>{section !== 'Storage' && listBar}<p className="server-app-muted">{loading ? 'Reading Docker resources and disk usage…' : 'Resource information is unavailable. Refresh to try again.'}</p></div> : <>
          {section === 'Images' && <div className="docker-resource-card">{listBar}<div className="docker-table-wrap"><table className="docker-table"><thead><tr><th>Image</th><th>Size</th><th>Shared</th><th>Used by</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{images.map((item) => <tr key={item.id} data-testid={`docker-image-${item.id}`}><td><strong>{item.tags.join(', ') || 'Untagged image'}</strong><small>{item.id.slice(7,19)} · {date(item.created)}</small></td><td>{dockerSize(item.size)}</td><td>{dockerSize(item.sharedSize)}</td><td>{item.containers.join(', ') || 'Unused'}</td><td><button className="btn" type="button" disabled={busy || loading || !!error || item.containers.length > 0} aria-label={`Remove image ${item.tags[0] || item.id.slice(7,19)}`} title={item.containers.length ? 'Referenced by a container' : 'Remove local image'} onClick={() => remove('image', item.id, item.revision, item.tags[0] || item.id.slice(7,19), 'This removes the local image and its tags. Running and stopped containers must not reference it. The registry copy is unchanged.')}>Remove…</button></td></tr>)}</tbody></table>{!images.length && <p className="docker-empty">{query ? 'No matching images.' : 'No local images.'}</p>}</div></div>}
          {section === 'Volumes' && <div className="docker-resource-card">{listBar}<div className="docker-table-wrap"><table className="docker-table"><thead><tr><th>Volume</th><th>Size</th><th>Used by</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{volumes.map((item) => <tr key={item.name}><td><strong>{item.name}</strong><small>{item.driver} · {item.scope} · {date(item.created)}</small></td><td>{dockerSize(item.size)}</td><td>{item.containers.join(', ') || (item.removable ? 'Unused' : 'In use or protected')}</td><td><button className="btn" type="button" disabled={busy || loading || !!error || !item.removable} aria-label={`Remove volume ${item.name}`} onClick={() => remove('volume', item.name, item.revision, item.name, 'This permanently deletes the volume and all data inside it. This cannot be undone. Unused does not mean the data is unimportant.')}>Remove…</button></td></tr>)}</tbody></table>{!volumes.length && <p className="docker-empty">{query ? 'No matching volumes.' : 'No volumes.'}</p>}</div></div>}
          {section === 'Networks' && <div className="docker-resource-card">{listBar}<div className="docker-table-wrap"><table className="docker-table"><thead><tr><th>Network</th><th>Subnet</th><th>Connected containers</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{networks.map((item) => <tr key={item.id}><td><strong>{item.name}</strong><small>{item.driver} · {item.scope}{item.internal ? ' · Internal' : ''}</small></td><td>{item.subnets.join(', ') || '—'}</td><td>{item.containers.join(', ') || 'None'}</td><td><button className="btn" type="button" disabled={busy || loading || !!error || !item.removable} aria-label={`Remove network ${item.name}`} onClick={() => remove('network', item.id, item.revision, item.name, 'This removes the unused network. Built-in networks and networks with connected containers are protected.')}>Remove…</button></td></tr>)}</tbody></table>{!networks.length && <p className="docker-empty">{query ? 'No matching networks.' : 'No networks.'}</p>}</div></div>}
          {section === 'Storage' && <div className="docker-storage">{storageRows.map((item) => <section key={item.label}><div><h3>{item.label}</h3><p>{item.note}</p></div><strong>{dockerSize(item.size)}</strong>{item.count != null && <small>{item.count} items</small>}</section>)}<p className="server-app-muted">These figures exclude bind-mounted host folders and may exclude container logs. Unavailable means the engine did not report a size. Remove unused resources individually from Images, Volumes, or Containers after reviewing them.</p></div>}
          <footer className="docker-sampled">Measured {new Date(resources.sampledAt).toLocaleTimeString()}. Refresh to see changes made outside Lumo.</footer>
        </>}
      </main>
    </>}
    {review && <AppConfirmation title={`Remove ${review.name}?`} confirm="Remove permanently" busy={busy} confirmDisabled={confirmation !== review.name} onCancel={() => { setReview(null); setError(null); }} onConfirm={() => void run(review.request)}><p>{review.message}</p><label className="docker-confirm-field">Type <strong>{review.name}</strong> to confirm<input className="input" aria-label="Resource name to confirm" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} autoComplete="off" spellCheck={false}/></label>{error && <p role="alert" className="server-app-error">{error}</p>}</AppConfirmation>}
    {create && <AppConfirmation title={`Create ${create}`} confirm="Create" busy={busy} confirmDisabled={!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{1,127}$/.test(name)} onCancel={() => { setCreate(null); setError(null); }} onConfirm={() => void run({ kind: create, action: 'create', id: name, revision: 'absent' })}><p>{create === 'volume' ? 'Create an empty local volume for persistent container data.' : 'Create a local bridge network. Docker chooses an available subnet.'}</p><label className="docker-confirm-field">Name<input className="input" aria-label={`New ${create} name`} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" spellCheck={false}/><small>2–128 letters, numbers, dots, underscores or hyphens.</small></label>{error && <p role="alert" className="server-app-error">{error}</p>}</AppConfirmation>}
  </div>;
}
