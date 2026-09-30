// SPDX-License-Identifier: AGPL-3.0-only
import { piSettingsSaved } from './pi-settings-notifications';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { PiAuthMethod, PiAuthState, PiProvider } from '../api/pi';
import { getDataSource } from '../api/source';
import { Select } from '../shell/Select';
import { IconRefresh } from '../shell/icons';

function safeLink(value?: string) { try { const url = new URL(value ?? ''); return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined; } catch { return undefined; } }

export function PiProviders({ onDirty, onNotify, overview = false, visible = true, disabled = false, onConnect, children }: { onDirty: (value: boolean) => void; onNotify: (message: string) => void; overview?: boolean; visible?: boolean; disabled?: boolean; onConnect?: () => void; children?: ReactNode }) {
  const source = getDataSource();
  const [providers, setProviders] = useState<PiProvider[]>([]);
  const [providerId, setProviderId] = useState('');
  const [method, setMethod] = useState<PiAuthMethod>('oauth');
  const [flow, setFlow] = useState<PiAuthState | null>(null);
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [epoch, setEpoch] = useState(0);
  const alive = useRef(false);
  const current = useRef<string | null>(null);
  const lock = useRef(false);
  const provider = providers.find((item) => item.id === providerId);
  const active = flow?.status === 'working';
  const prompt = flow?.prompt;
  useEffect(() => { alive.current = true; return () => { alive.current = false; if (current.current) void source.piAuthCancel(current.current).catch(() => {}); }; }, [source]);
  useEffect(() => { onDirty(Boolean(active || working || value)); return () => onDirty(false); }, [active, working, value, onDirty]);
  useEffect(() => {
    if (!visible) return;
    let disposed = false;
    setLoading(true);
    const request = overview ? source.piConnections().then((data) => ({ providers: data.providers.map((item) => ({ ...item, methods: [] })) })) : source.piProviders();
    void request.then((data) => { if (!disposed) { setProviders(data.providers); setError(''); } }).catch((err) => { if (!disposed) { setProviders([]); setError(err instanceof Error ? err.message : 'Could not load providers.'); } }).finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, [source, epoch, overview, visible]);
  useEffect(() => { setValue(prompt?.type === 'select' ? prompt.options?.[0]?.id ?? '' : ''); }, [prompt?.id]);
  useEffect(() => {
    if (!flow || flow.status !== 'working') return;
    let disposed = false; let timer: ReturnType<typeof setTimeout>;
    const id = flow.id;
    async function poll() {
      try {
        const result = await source.piAuthState(id);
        if (disposed || current.current !== id) return;
        setFlow(result);
        if (result.status !== 'working') { current.current = null; setValue(''); setEpoch((value) => value + 1); if (result.status === 'done') onNotify(piSettingsSaved()); }
        else timer = setTimeout(() => void poll(), 500);
      } catch (err) {
        if (disposed) return;
        setError(err instanceof Error ? err.message : 'Could not check sign-in.');
        timer = setTimeout(() => void poll(), 2000);
      }
    }
    void poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, [flow?.id, flow?.status, source, onNotify]);
  async function start(operation: 'login' | 'logout', id = providerId) {
    if (lock.current || active) return;
    lock.current = true; setWorking(true); setError(''); setFlow(null); setValue('');
    try {
      const result = await source.piAuthStart(id, method, operation);
      if (!alive.current) { await source.piAuthCancel(result.id); return; }
      current.current = result.status === 'working' ? result.id : null;
      setProviderId(id); setFlow(result);
      if (result.status !== 'working') setEpoch((value) => value + 1);
      if (result.status === 'done') onNotify(piSettingsSaved());
    } catch (err) { if (alive.current) setError(err instanceof Error ? err.message : 'Could not start provider setup.'); }
    finally { lock.current = false; if (alive.current) setWorking(false); }
  }
  async function reply() {
    if (!flow || !prompt || lock.current) return;
    lock.current = true; setWorking(true); setError('');
    try { await source.piAuthReply(flow.id, prompt.id, value); if (alive.current) { setValue(''); setFlow((old) => old?.prompt?.id === prompt.id ? { ...old, prompt: undefined } : old); } }
    catch (err) { if (alive.current) setError(err instanceof Error ? err.message : 'Could not submit sign-in response.'); }
    finally { lock.current = false; if (alive.current) setWorking(false); }
  }
  async function cancel() {
    if (!flow || lock.current) return;
    lock.current = true; setWorking(true); setError('');
    try { await source.piAuthCancel(flow.id); current.current = null; setFlow(null); setValue(''); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not cancel sign-in.'); }
    finally { lock.current = false; setWorking(false); }
  }
  return <div className="pi-settings-scroll pi-providers" data-testid="pi-providers">
    <section>
      <div className="pi-provider-heading"><div><h2>Providers</h2>{!overview && <p>Connect a provider to choose its models in your chats.</p>}</div><div className="pi-toolbar-actions">{overview && <button className="btn" disabled={disabled || active || working} onClick={onConnect}>Connect provider</button>}<button className="btn btn-icon" title="Refresh providers" aria-label="Refresh providers" disabled={disabled || loading || active || working} onClick={() => setEpoch((value) => value + 1)}><IconRefresh size={16}/></button></div></div>
      <div data-testid="pi-connected-providers">{providers.filter((item) => item.credential).map((item) => <div className="pi-connected-provider" data-testid={`pi-connected-${item.id}`} key={item.id}><div><strong>{item.name}</strong><small>{item.credential === 'oauth' ? 'Signed in' : item.keyPreview ? <>API key <span className="mono">{item.keyPreview}</span></> : 'API key saved'}</small></div><button className="btn" aria-label={`Disconnect ${item.name}`} disabled={disabled || active || working} onClick={() => void start('logout', item.id)}>Disconnect</button></div>)}</div>
      {loading && !providers.length && <p role="status">Loading providers…</p>}
      {overview && !loading && !error && !providers.some((item) => item.credential) && <p className="pi-provider-empty">No connected providers.</p>}
      {!overview && !(loading && !providers.length) && <div className="pi-provider-choice">
        <label htmlFor="pi-provider-select">Provider</label>
        <Select id="pi-provider-select" aria-label="Provider" disabled={active || working || loading} value={providerId} options={[{ value: '', label: 'Choose a provider' }, ...providers.filter((item) => item.methods.length).map((item) => ({ value: item.id, label: item.name }))]} onChange={(id) => { setProviderId(id); setMethod(providers.find((item) => item.id === id)?.methods[0]?.type ?? 'api_key'); setFlow(null); setError(''); }}/>
        {provider && !active && <><label htmlFor="pi-auth-method">Sign-in method</label><Select id="pi-auth-method" aria-label="Sign-in method" value={method} disabled={working} options={provider.methods.map((item) => ({ value: item.type, label: item.label }))} onChange={(value) => setMethod(value as PiAuthMethod)}/><div className="pi-provider-actions"><button className="btn btn-primary" disabled={working || !provider.methods.length} onClick={() => void start('login')}>{working ? 'Starting…' : 'Connect'}</button></div></>}
      </div>}
      {active && <div className="pi-auth-flow" data-testid="pi-auth-flow">
        {flow.events.map((event, index) => <div className="pi-auth-event" key={index}>
          {event.message && <p>{event.message}</p>}
          {event.code && <div className="pi-device-code"><span>Device code</span><strong className="mono">{event.code}</strong></div>}
          {safeLink(event.url) && <a className="btn" href={safeLink(event.url)} target="_blank" rel="noopener noreferrer">Open sign-in page</a>}
          {event.links?.filter((link) => safeLink(link.url)).map((link) => <a key={link.url} href={safeLink(link.url)} target="_blank" rel="noopener noreferrer">{link.label || 'Provider help'}</a>)}
        </div>)}
        {prompt ? <form className="pi-auth-prompt" onSubmit={(event) => { event.preventDefault(); void reply(); }}>
          <label htmlFor="pi-auth-answer">{prompt.message}</label>
          {prompt.type === 'select' ? <Select id="pi-auth-answer" aria-label={prompt.message} disabled={working} value={value} onChange={setValue} options={(prompt.options ?? []).map((option) => ({ value: option.id, label: option.label }))}/> : <input id="pi-auth-answer" className="input" data-testid="pi-auth-answer" type={prompt.type === 'secret' || prompt.type === 'manual_code' ? 'password' : 'text'} autoComplete="off" spellCheck={false} autoFocus value={value} placeholder={prompt.placeholder} disabled={working} onChange={(event) => setValue(event.target.value)}/>}
          <div className="pi-provider-actions"><button className="btn" type="button" disabled={working} onClick={() => void cancel()}>Cancel</button><button className="btn btn-primary" type="submit" disabled={working}>{working ? 'Connecting…' : 'Continue'}</button></div>
        </form> : <div className="pi-provider-actions"><span role="status">Waiting for sign-in…</span><button className="btn" disabled={working} onClick={() => void cancel()}>Cancel</button></div>}
      </div>}
      {(error || flow?.error) && <p className="pi-settings-error" role="alert">{error || flow?.error}</p>}
    </section>
    {children}
  </div>;
}
