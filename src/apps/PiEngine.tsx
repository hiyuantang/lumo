// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from 'react';
import { getDataSource, isReauthRequired, type UpdatePlan } from '../api/source';
import { useAppCatalog } from '../shell/AppCatalogContext';
import { useShell } from '../shell/ShellContext';
import { useReauth } from '../shell/ReauthSheet';
import { useAppUpdates } from './useAppUpdates';
import { errorText } from './ServerAppUI';

export function PiEngine({ disabled = false }: { disabled?: boolean }) {
  const source = getDataSource();
  const { catalog, refresh } = useAppCatalog();
  const { state } = useShell();
  const reauth = useReauth();
  const updates = useAppUpdates(state.user ?? '', ':engine');
  const [plan, setPlan] = useState<UpdatePlan>();
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string>();
  const [checked, setChecked] = useState(false);
  const entry = catalog?.apps.find((app) => app.id === 'pi');
  const item = updates.items.find((item) => item.app === 'pi');
  const running = updates.phase !== 'idle';
  useEffect(() => {
    if (item?.status !== 'done') return;
    setPlan(undefined);
    setChecked(false);
    void refresh().catch((err) => setError(errorText(err)));
  }, [item?.status, refresh]);
  useEffect(() => { if (updates.phase === 'auth') reauth(updates.queue.resume); }, [updates.phase, updates.queue, reauth]);
  async function check() {
    setChecking(true); setError(undefined);
    try {
      const next = await source.planAppInstall('pi', entry?.installed ? 'update' : 'install');
      setPlan(next); setChecked(true);
      if (!entry?.installed && next.packages.length) updates.queue.start([next]);
      else if (!next.packages.length) await refresh();
    } catch (err) { if (isReauthRequired(err)) reauth(() => { void check(); }); else setError(errorText(err)); }
    finally { setChecking(false); }
  }
  return <section className="pi-settings-scroll pi-instruction-sections" data-testid="pi-engine">
    <div className="pi-context-heading"><div><h2>Pi engine</h2><p>Lumo’s core assistant engine.</p></div></div>
    <div className="pi-install">
      <p>{!catalog ? 'Checking for Pi…' : !entry?.installed ? 'Set up Pi to start working with your projects.' : plan?.packages.length ? `${plan.packages[0].fromVersion} → ${plan.packages[0].toVersion}` : checked ? 'Pi is up to date.' : 'Pi is ready.'}</p>
      {running ? <div role="status" data-testid="pi-engine-progress"><p>{item?.progress?.message || 'Preparing Pi…'}</p><progress max={100} value={item?.progress?.percent}/>{updates.phase === 'disconnected' && <button className="btn" onClick={() => void updates.queue.reconnect()}>Reconnect</button>}</div> : <button className="btn btn-primary" data-testid="pi-engine-action" disabled={disabled || checking || !catalog || (entry?.installed ? !entry.canUpdate : !entry?.canInstall)} onClick={() => { if (plan?.packages.length && entry?.installed) updates.queue.start([plan]); else void check(); }}>{checking ? 'Checking…' : !entry?.installed ? 'Set up Pi' : plan?.packages.length ? 'Update' : 'Check for updates'}</button>}
      {disabled && <p>Finish running chats before updating the engine.</p>}
      {(error || item?.error) && <p className="server-app-error" role="alert">{error || item?.error}</p>}
    </div>
  </section>;
}
