// SPDX-License-Identifier: AGPL-3.0-only
import { useAppMenus } from '../shell/appMenus';
import { useAppState } from '../shell/useAppState';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  describeError, getDataSource, isReauthRequired,
  type PowerAction, type SystemIdentity, type SystemOverview,
  type SystemSettings, type SystemSettingsChange,
} from '../api/source';
import { useReauth } from '../shell/ReauthSheet';
import { useNow, useShell, type ThemePref } from '../shell/ShellContext';
import { IconChip, IconGear, IconHome, IconNetwork, IconSearch } from '../shell/icons';
import { Updates } from './Updates';
import { AboutLegal } from './AboutLegal';
import { SettingsEditor } from './SettingsEditor';
import { SettingsMotion } from './SettingsMotion';
import { SettingsNetwork } from './SettingsNetwork';
import type { SettingsSection } from './registry';
import '../styles/apps.css';
import '../styles/settings.css';

const SECTIONS = [
  { id: 'system', label: 'System', icon: IconHome, terms: 'hostname server hardware memory storage restart power shutdown' },
  { id: 'time', label: 'Date & Time', icon: IconClock, terms: 'timezone clock ntp synchronization' },
  { id: 'network', label: 'Network', icon: IconNetwork, terms: 'ip dns gateway interfaces addresses ethernet' },
  { id: 'appearance', label: 'Appearance', icon: IconAppearance, terms: 'theme dark light motion animation' },
  { id: 'updates', label: 'Updates', icon: IconChip, terms: 'packages security install software updates' },
  { id: 'about', label: 'About', icon: IconGear, terms: 'legal license source' },
] as const;

const POWER_COPY: Record<PowerAction, { title: string; prompt: string; result: string }> = {
  reboot: { title: 'Restart', prompt: 'Restart the server? Active sessions will disconnect.', result: 'Restarting in a few seconds.' },
  poweroff: { title: 'Shut down', prompt: 'Shut down the server? Use your VPS console to turn it on again.', result: 'Shutting down in a few seconds.' },
};

function IconClock({ size = 18 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3 2" /></svg>;
}

function IconAppearance({ size = 18 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="3" /><path d="M12 4.5v15" /><path d="M15 8h3M15 11h3M15 14h3" /></svg>;
}

function ServerClock({ snapshot, receivedAt }: { snapshot: SystemSettings; receivedAt: number }) {
  const now = useNow(1000);
  const instant = new Date(Date.parse(snapshot.serverTime) + now - receivedAt);
  let time = '—';
  let date = snapshot.timezone;
  try {
    time = instant.toLocaleTimeString(undefined, { timeZone: snapshot.timezone, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    date = instant.toLocaleDateString(undefined, { timeZone: snapshot.timezone, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  } catch {
    time = snapshot.serverTime;
  }
  return <div className="settings-clock"><span>SERVER TIME</span><strong>{time}</strong><p>{date}</p><small>{snapshot.timezone.replaceAll('_', ' ')}</small></div>;
}

function Stat({ label, value, percent }: { label: string; value: string; percent?: number }) {
  return <div className="settings-stat"><span>{label}</span><strong>{value}</strong>{percent !== undefined ? <div className="meter" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}><div className="meter-fill" style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} /></div> : null}</div>;
}

export function Settings() {
  const source = getDataSource();
  const { state, actions } = useShell();
  const requireReauth = useReauth();
  const [section, setSection] = useAppState<SettingsSection>('settings', 'section', () => state.navigation?.target === 'settings' ? state.navigation.section : 'system', ['system', 'time', 'network', 'appearance', 'updates', 'about']);
  const [updatesOpened, setUpdatesOpened] = useState(section === 'updates');
  useEffect(() => { if (section === 'updates') setUpdatesOpened(true); }, [section]);
  const [networkOpened, setNetworkOpened] = useState(section === 'network');
  const [search, setSearch] = useAppState<string>('settings', 'search', '');
  const [identity, setIdentity] = useState<SystemIdentity | null>(null);
  const [overview, setOverview] = useState<SystemOverview | null>(null);
  const [snapshot, setSnapshot] = useState<SystemSettings | null>(null);
  const [receivedAt, setReceivedAt] = useState(Date.now());
  const [timezones, setTimezones] = useState<string[]>();
  const [zoneError, setZoneError] = useState<string | null>(null);
  const [zoneAttempt, setZoneAttempt] = useState(0);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState<PowerAction | null>(null);
  const [busy, setBusy] = useState<PowerAction | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  const savingRef = useRef(false);
  const contentRef = useRef<HTMLElement>(null);
  const navigationNonce = useRef<number>();
  const visible = !state.windows.settings?.minimized;
  const canPower = source.capabilities.canPowerControl;

  useEffect(() => { contentRef.current?.scrollTo(0, 0); }, [section]);

  useEffect(() => {
    if (state.navigation?.nonce === navigationNonce.current) return;
    navigationNonce.current = state.navigation?.nonce;
    if (state.navigation?.target === 'settings') {
      setSection(state.navigation.section);
      setSearch('');
    }
  }, [state.navigation]);

  useEffect(() => { if (section === 'network') setNetworkOpened(true); }, [section]);

  const refresh = useCallback(async () => {
    if (savingRef.current) return false;
    const current = ++generation.current;
    setLoading(true);
    const [settingsResult, identityResult, overviewResult] = await Promise.allSettled([
      source.getSystemSettings(), source.getIdentity(), source.getOverview(),
    ]);
    if (!mounted.current || generation.current !== current) return false;
    setLoading(false);
    if (settingsResult.status === 'fulfilled') {
      setSnapshot(settingsResult.value);
      setReceivedAt(Date.now());
      setSettingsError(null);
    } else {
      setSettingsError(settingsResult.reason instanceof Error ? settingsResult.reason.message : describeError(settingsResult.reason));
    }
    if (identityResult.status === 'fulfilled') setIdentity(identityResult.value);
    if (overviewResult.status === 'fulfilled') setOverview(overviewResult.value);
    setDetailsError(identityResult.status === 'rejected' || overviewResult.status === 'rejected' ? 'Some server details could not be refreshed.' : null);
    return settingsResult.status === 'fulfilled';
  }, [source]);

  useEffect(() => {
    mounted.current = true;
    if (visible) void refresh();
    const interval = window.setInterval(() => { if (visible && document.visibilityState === 'visible') void refresh(); }, 15_000);
    const onVisible = () => { if (visible && document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { mounted.current = false; window.clearInterval(interval); document.removeEventListener('visibilitychange', onVisible); };
  }, [refresh, visible]);

  useEffect(() => {
    if (section !== 'time' || timezones) return;
    let alive = true;
    setZoneError(null);
    source.getTimezones().then((zones) => { if (alive) setTimezones(zones); }).catch((err) => { if (alive) setZoneError(describeError(err)); });
    return () => { alive = false; };
  }, [section, source, timezones, zoneAttempt]);

  async function save(change: SystemSettingsChange, revision: string) {
    if (savingRef.current) throw new Error('A setting is still saving.');
    savingRef.current = true;
    generation.current++;
    setLoading(false);
    setSaving(true);
    try {
      const next = await source.updateSystemSettings(change, revision);
      if (mounted.current) {
        setSnapshot(next);
        setReceivedAt(Date.now());
        setSettingsError(null);
      }
    } finally {
      savingRef.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  function run(action: PowerAction) {
    setBusy(action);
    source.runPowerAction(action)
      .then(() => actions.notify(`${POWER_COPY[action].title} scheduled`, POWER_COPY[action].result))
      .catch((err) => { if (isReauthRequired(err)) requireReauth(() => run(action)); else actions.notify('Power action failed', describeError(err)); })
      .finally(() => setBusy(null));
  }

  const host = snapshot?.runtimeHostname ?? identity?.hostname ?? 'Server';
  const choices = SECTIONS.filter((item) => `${item.label} ${item.terms}`.toLowerCase().includes(search.toLowerCase().trim()));
  const blocked = saving || Boolean(settingsError);
  const uptime = overview ? Math.floor((Date.now() - overview.bootedAt) / 3_600_000) : 0;

  useAppMenus({ view: [
    ...(section === 'system' || section === 'time' ? [{ id: 'refresh', label: 'Refresh', disabled: loading || saving, run: () => { void refresh(); } }] : []),
    ...SECTIONS.map(({ id, label }) => ({ id: `section-${id}`, label, checked: section === id, run: () => setSection(id) })),
  ] });

  return (
    <div className="app settings" data-testid="app-settings">
      <aside className="settings-sidebar">
        <div className="settings-profile"><span className="settings-profile-icon"><IconChip size={22} /></span><div><strong title={host}>{host}</strong><small>{source.kind === 'mock' ? 'Demo' : 'Connected'}</small></div></div>
        <label className="settings-search"><IconSearch size={15} /><input aria-label="Search settings" placeholder="Search settings" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        <nav aria-label="Settings sections">
          {choices.map(({ id, label, icon: Icon }) => <button type="button" key={id} className={`settings-nav-item${section === id ? ' selected' : ''}`} aria-label={label} title={label} aria-current={section === id ? 'page' : undefined} data-testid={`settings-section-${id}`} onClick={() => setSection(id)}><span className={`settings-nav-icon settings-icon-${id}`}><Icon size={17} /></span><span className="settings-nav-label">{label}</span></button>)}
          {!choices.length ? <p className="settings-note">No matching settings.</p> : null}
        </nav>
        <div className="settings-sidebar-footer"><span className="settings-status-dot" /><span><strong>{state.user}</strong></span></div>
      </aside>
      <main className="settings-content" ref={contentRef}>
        {section !== 'about' && section !== 'network' && section !== 'updates' ? <header className="settings-heading"><div><h2>{SECTIONS.find((item) => item.id === section)?.label}</h2></div>{section !== 'appearance' ? <button className="btn" type="button" data-testid="settings-refresh" disabled={loading || saving} onClick={() => void refresh()}>{loading ? 'Refreshing…' : 'Refresh'}</button> : null}</header> : null}
        {(section === 'system' || section === 'time') && settingsError ? <div className="settings-notice" role="alert"><strong>Settings unavailable</strong><p>{settingsError}</p><button type="button" className="btn" disabled={loading} onClick={() => void refresh()}>Try again</button></div> : null}
        {section === 'system' && detailsError ? <p className="settings-field-error" role="alert">{detailsError}</p> : null}

        <div className="settings-page" hidden={section !== 'system'}>
          <section className="settings-server-card" aria-label="Server overview"><span className="settings-server-symbol"><IconChip size={42} /></span><div><h3>{host}</h3><p>{identity?.os ?? 'Loading…'}</p></div></section>
          {overview ? <div className="settings-stats"><Stat label="Memory" value={`${(overview.memoryUsedMb / 1024).toFixed(1)} / ${(overview.memoryTotalMb / 1024).toFixed(0)} GB`} percent={overview.memoryTotalMb ? overview.memoryUsedMb / overview.memoryTotalMb * 100 : 0} /><Stat label="Storage" value={`${overview.storageUsedGb} / ${overview.storageTotalGb} GB`} percent={overview.storageTotalGb ? overview.storageUsedGb / overview.storageTotalGb * 100 : 0} /><Stat label="Uptime" value={uptime >= 24 ? `${Math.floor(uptime / 24)}d ${uptime % 24}h` : `${uptime}h`} /></div> : null}
          <section className="settings-group" aria-label="System details"><dl className="settings-details"><div><dt>Hostname</dt><dd data-testid="settings-hostname">{host}</dd></div><div><dt>Operating system</dt><dd>{identity?.os ?? '—'}</dd></div><div><dt>Architecture</dt><dd>{identity?.architecture ?? '—'}</dd></div><div><dt>Kernel</dt><dd className="mono">{identity?.kernel ?? '—'}</dd></div></dl></section>
          <h3 className="settings-section-title">Account</h3>
          <section className="settings-group" aria-label="Account"><div className="settings-row"><div><h3>{state.user}</h3><p>Signed in to this server</p></div><button type="button" className="btn" data-testid="logout-button" onClick={actions.logout}>Log out</button></div></section>
          <h3 className="settings-section-title">Power</h3>
          <section className="settings-group" aria-label="Power">{(['reboot', 'poweroff'] as const).map((action) => <div className="settings-row" key={action}><div><h3>{POWER_COPY[action].title}</h3></div><button type="button" className={`btn${action === 'poweroff' ? ' settings-danger' : ''}`} data-testid={`settings-${action}`} disabled={!canPower || busy !== null || saving} onClick={() => setConfirm(action)}>{busy === action ? 'Scheduling…' : `${POWER_COPY[action].title}…`}</button></div>)}</section>
        </div>

        <div className="settings-page" hidden={section !== 'time'}>
          {snapshot ? <><ServerClock snapshot={snapshot} receivedAt={receivedAt} /><section className="settings-group" aria-label="Date and time settings"><SettingsEditor snapshot={snapshot} disabled={blocked} timezones={timezones} save={save} refresh={refresh} /><div className="settings-row"><div><h3>Clock synchronization</h3></div><span className={`settings-badge${snapshot.ntpSynchronized ? ' good' : ''}`}>{snapshot.ntpSynchronized ? 'Synchronized' : 'Not synchronized'}</span></div></section></> : !settingsError ? <p className="settings-note">Loading date and time…</p> : null}
          {zoneError ? <div className="settings-notice" role="alert"><p>{zoneError}</p><button className="btn" type="button" onClick={() => setZoneAttempt((n) => n + 1)}>Retry time zones</button></div> : null}
        </div>

        <div className="settings-page" hidden={section !== 'network'}>{networkOpened ? <SettingsNetwork active={section === 'network'} /> : null}</div>

        <div className="settings-page" hidden={section !== 'appearance'}>
          <h3 className="settings-section-title">Theme</h3>
          <div className="settings-themes" role="group" aria-label="Color theme">{([{ value: null, label: 'Automatic', style: 'auto' }, { value: 'light', label: 'Light', style: 'light' }, { value: 'dark', label: 'Dark', style: 'dark' }] as { value: ThemePref; label: string; style: string }[]).map(({ value, label, style }) => <button type="button" className={`settings-theme ${style}`} key={label} aria-pressed={state.theme === value} data-testid={`settings-theme-${style}`} onClick={() => actions.setTheme(value)}><span className="settings-theme-preview"><i /><i /><i /></span><span>{label}</span></button>)}</div>
          <section className="settings-group" aria-label="Motion"><div className="settings-row"><div><h3>Window animations</h3></div><SettingsMotion value={state.motion} onChange={actions.setMotion} active={section === 'appearance' && visible} /></div></section>
        </div>
        <div className="settings-page settings-updates" hidden={section !== 'updates'}>{updatesOpened ? <Updates active={section === 'updates'} /> : null}</div>
        <div className="settings-page" hidden={section !== 'about'}><AboutLegal /></div>
      </main>
      {confirm ? <div className="quicklook-overlay" onPointerDown={() => setConfirm(null)}><div className="file-confirm" role="alertdialog" aria-modal="true" aria-label={`${POWER_COPY[confirm].title} server`} data-testid="settings-power-confirm" onPointerDown={(event) => event.stopPropagation()}><p>{POWER_COPY[confirm].prompt}</p><div className="file-confirm-actions"><button type="button" className="btn" onClick={() => setConfirm(null)}>Cancel</button><button type="button" className="btn btn-danger" data-testid="settings-confirm-action" onClick={() => { const action = confirm; setConfirm(null); run(action); }}>{POWER_COPY[confirm].title}</button></div></div></div> : null}
    </div>
  );
}
