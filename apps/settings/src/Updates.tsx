// SPDX-License-Identifier: AGPL-3.0-only
import { IconRefresh, IconSearch } from '@lumo/sdk/shell/icons';
import { useAppMenus } from '@lumo/sdk/shell/appMenus';
import { useCallback, useEffect, useRef, useState } from 'react';
import { describeError, getDataSource, type InstalledPackage, type PackageCatalog, type PackageGroup, type UpdatePlan, type UpdateProgress } from '@lumo/sdk/api/source';
import { useShell } from '@lumo/sdk/shell/ShellContext';
import { formatSize } from '@lumo/sdk/utils/file-format';
import { ApiError } from '@lumo/sdk/api/transport';
import { AppModal } from '@lumo/sdk/shell/AppModal';
import { Select } from '@lumo/sdk/shell/Select';

import './updates.css';

type Operation = 'refresh' | 'check' | 'plan' | 'apply' | null;
const groups: { id: PackageGroup; label: string }[] = [{ id: 'system', label: 'System' }, { id: 'third-party', label: 'Third-party' }, { id: 'unknown', label: 'Other / unknown' }];

export function Updates({ active = true }: { active?: boolean }) {
  const source = getDataSource();
  const { actions } = useShell();
  const [catalog, setCatalog] = useState<PackageCatalog | null>(null);
  const [operation, setOperation] = useState<Operation>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);
  const [plan, setPlan] = useState<UpdatePlan | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<PackageGroup | 'all'>('all');
  const readSequence = useRef(0);

  const readCatalog = useCallback(async () => {
    const sequence = ++readSequence.current;
    setLoading(true);
    try { const value = await source.getPackageCatalog(); if (sequence === readSequence.current) setCatalog(value); }
    catch (err) { if (err instanceof ApiError && err.status !== null && err.code === 'unavailable') throw new Error(err.message); throw err; }
    finally { if (sequence === readSequence.current) setLoading(false); }
  }, [source]);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    void readCatalog().catch((err) => { if (alive) setError(describeError(err)); });
    return () => { alive = false; };
  }, [active, readCatalog]);

  useEffect(() => {
    if (!requestId) return;
    return source.subscribeUpdateProgress(requestId, (next) => {
      setProgress(next);
      if (!next.done) return;
      setOperation(null);
      if (next.success) {
        setPlan(null);
        actions.notify('Updates installed', '');
        void readCatalog().catch((err) => setError(describeError(err)));
      } else setError(next.error || 'The update installation failed.');
    }, (err) => { setOperation(null); setError(describeError(err)); });
  }, [actions, requestId, source, readCatalog]);

  async function refresh(check = false) {
    setOperation(check ? 'check' : 'refresh'); setError(null); setPlan(null);
    try {
      if (check) setRefreshedAt(await source.refreshUpdates());
      await readCatalog();
      if (check) actions.notify('Update check complete', 'Package information refreshed.');
    }
    catch (err) { setError(describeError(err)); }
    finally { setOperation(null); }
  }

  async function prepareInstall() {
    setOperation('plan'); setError(null);
    try {
      const value = await source.calculateUpdatePlan();
      setPlan(value);
      if (value.packages.length) setConfirming(true);
      else await readCatalog();
    } catch (err) { setError(describeError(err)); }
    finally { setOperation(null); }
  }

  async function applyPlan() {
    if (!plan) return;
    setConfirming(false); setOperation('apply'); setError(null); setProgress(null);
    try { setRequestId(await source.applyUpdatePlan(plan.id)); }
    catch (err) { setOperation(null); setError(describeError(err)); }
  }

  useAppMenus({ view: active ? [{ id: 'refresh', label: 'Refresh', disabled: operation !== null || loading, run: () => { void refresh(); } }] : [] });
  const busy = operation !== null || loading;
  const pending = catalog?.packages.filter((pkg) => pkg.updateVersion) ?? [];
  const security = pending.filter((pkg) => pkg.security);
  const search = query.trim().toLowerCase();
  const current = catalog?.packages.filter((pkg) => !pkg.updateVersion) ?? [];
  const installed = current.filter((pkg) => (filter === 'all' || pkg.group === filter) && `${pkg.name} ${pkg.summary} ${pkg.origin}`.toLowerCase().includes(search)).sort((a, b) => a.name.localeCompare(b.name));

  return <div className="updates" data-testid="app-updates">
    <div className="updates-body">
      <header className="settings-heading updates-header">
        <h2>Software Updates</h2>
        <div className="app-toolbar-actions">
          <button aria-label="Refresh packages" title="Refresh packages" type="button" className="btn btn-icon" data-testid="updates-refresh" disabled={busy} onClick={() => void refresh()}><IconRefresh size={16}/></button>
          <button type="button" className="btn" data-testid="updates-plan" disabled={busy} onClick={() => void refresh(true)}>{operation === 'check' ? 'Checking…' : 'Check for updates'}</button>
        </div>
      </header>
      {(refreshedAt || catalog?.rebootRequired) && <div className="updates-metadata">{refreshedAt && <span>Refreshed {new Date(refreshedAt).toLocaleString()}</span>}{catalog?.rebootRequired && <span className="updates-reboot" data-testid="updates-reboot-required">Reboot required</span>}</div>}
      {(error || catalog?.updateError) && <p className="updates-error" role="alert">{error || catalog?.updateError}</p>}
      {progress && <section className="updates-progress" data-testid="updates-progress" aria-live="polite"><div><strong>{progress.message}</strong><span>{progress.percent}%</span></div><div className="meter"><div className="meter-fill" style={{ width: `${progress.percent}%` }}/></div></section>}
      <section className="updates-section" data-testid="updates-needed" aria-labelledby="updates-needed-heading">
        <header className="updates-section-heading"><h3 id="updates-needed-heading">Needs updates <span>{catalog ? pending.length : ''}</span></h3>{pending.length > 0 && <button type="button" className="btn" data-testid="updates-apply" disabled={busy} onClick={() => void prepareInstall()}>{operation === 'plan' ? 'Preparing…' : 'Install updates'}</button>}</header>
        {!catalog ? <p className="updates-empty">{loading ? 'Loading packages…' : 'Package information unavailable.'}</p> : pending.length === 0 ? <p className="updates-empty">{catalog.updateError ? 'Available updates could not be checked.' : 'No updates in the saved package information.'}</p> : <div data-testid="updates-plan-summary">
          {security.length > 0 && <PackageList title="Security" items={security} updating/>}
          {groups.map((group) => { const items = pending.filter((pkg) => !pkg.security && (pkg.updateGroup ?? 'unknown') === group.id); return items.length ? <PackageList key={group.id} title={group.label} items={items} updating/> : null; })}
        </div>}
      </section>
      <section className="updates-section" data-testid="updates-installed" aria-labelledby="updates-installed-heading">
        <header className="updates-section-heading"><h3 id="updates-installed-heading">{pending.length ? 'Other installed packages' : 'Installed packages'} <span>{catalog ? installed.length : ''}</span></h3></header>
        <div className="updates-list-controls">
          <label className="app-search updates-search"><IconSearch size={16}/><input type="search" aria-label="Search installed packages" placeholder="Search installed packages" value={query} onChange={(event) => setQuery(event.target.value)}/></label>
          <Select aria-label="Filter installed packages" data-testid="updates-installed-filter" value={filter} options={[{ value: 'all', label: 'All packages' }, ...groups.map((group) => ({ value: group.id, label: group.label }))]} onChange={(value) => setFilter(value as PackageGroup | 'all')}/>
        </div>
        {catalog && installed.length === 0 && <p className="updates-empty">{query || filter !== 'all' ? 'No matching packages.' : pending.length ? 'All installed packages are listed above.' : 'No installed packages.'}</p>}
        {installed.length > 0 && <PackageList key={`${filter}:${query}`} items={installed}/>}
      </section>
    </div>
    {confirming && plan && <AppModal onCancel={() => setConfirming(false)}><div role="dialog" className="updates-confirm-dialog" aria-labelledby="updates-confirm-title" data-testid="updates-confirm">
      <h3 id="updates-confirm-title">Install {plan.packages.length} package updates?</h3>
      <p>{formatSize(plan.downloadBytes)} to download. This cannot be undone automatically.</p>
      <div className="updates-confirm-packages">{plan.packages.map((pkg) => <div key={pkg.name}><strong>{pkg.name}</strong><span>{pkg.fromVersion || 'Not installed'} → {pkg.toVersion}</span></div>)}</div>
      <div className="app-toolbar-actions"><button type="button" className="btn" autoFocus onClick={() => setConfirming(false)}>Cancel</button><button type="button" className="btn" data-testid="updates-confirm-apply" onClick={() => void applyPlan()}>Install</button></div>
    </div></AppModal>}
  </div>;
}

function PackageList({ title, items, updating = false }: { title?: string; items: InstalledPackage[]; updating?: boolean }) {
  const [limit, setLimit] = useState(50);
  return <section className="updates-package-group" aria-label={title ? `${title}${updating ? ' available updates' : ' installed packages'}` : 'Installed package list'}>
    {title && <h4 className="settings-section-title">{title}</h4>}
    <ul className="settings-group">{items.slice(0, limit).map((pkg) => {
      const group = updating ? pkg.updateGroup : pkg.group;
      const origin = updating ? pkg.updateOrigin : pkg.origin;
      const provider = group === 'system' ? 'Sys' : group === 'third-party' ? origin || 'Third-party' : 'Unknown';
      const providerTitle = [groups.find((item) => item.id === group)?.label || 'Other / unknown', origin].filter(Boolean).join(' · ');
      return <li className="updates-package-row" key={pkg.name} data-testid={`${updating ? 'update' : 'installed'}-package-${pkg.name}`}>
        <span className="updates-package-provider" title={providerTitle}>{provider}</span>
        <div className="updates-package-name"><strong title={pkg.summary}>{pkg.name}</strong>{pkg.held && <small className="updates-package-held" title="Held packages are excluded from automatic upgrades">Held</small>}</div>
        <span className="updates-package-version mono">{updating ? `${pkg.version} → ${pkg.updateVersion}` : pkg.version}</span>
      </li>;
    })}</ul>
    {items.length > limit && <button type="button" className="btn updates-more" onClick={() => setLimit((value) => value + 50)}>Show more ({items.length - limit})</button>}
  </section>;
}
