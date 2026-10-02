// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, useState } from 'react';
import { getDataSource } from '../api/source';
import type { DesktopLaunch } from '../api/desktop-apps';
import { useCurrentWindow } from '../shell/WindowContext';
import { useShell } from '../shell/ShellContext';
import { useDesktopApps } from './catalog';
import '../styles/desktop-apps.css';

export function DesktopAppWindow() {
  const win = useCurrentWindow(); const { resolvedTheme, reducedMotion } = useShell();
  const { catalog, refresh } = useDesktopApps(); const source = getDataSource();
  const preview = win.appId.startsWith('app:preview.');
  const app = catalog.apps.find((a) => `app:${a.manifest.id}` === win.appId);
  const digest = preview ? win.appId.slice('app:preview.'.length) : app?.enabled ? app.digest : undefined;
  const frame = useRef<HTMLIFrameElement>(null); const channel = useRef<MessagePort>();
  const [launch, setLaunch] = useState<DesktopLaunch>(); const [error, setError] = useState('');
  const [ready, setReady] = useState(false); const [retry, setRetry] = useState(0);
  const theme = resolvedTheme;
  const settings = useRef({ theme, motion: reducedMotion ? 'reduced' : 'full' }); settings.current = { theme, motion: reducedMotion ? 'reduced' : 'full' };
  useEffect(() => {
    setLaunch(undefined); setReady(false); setError('');
    if (!digest) return;
    let active = true; let token: string | undefined;
    void source.desktopAppLaunch(digest, preview).then((next) => { token = next.token; if (active) setLaunch(next); else void source.desktopAppClose(token).catch(() => {}); }).catch((e) => { if (active) setError(e.message); });
    return () => { active = false; channel.current?.close(); channel.current = undefined; if (token) void source.desktopAppClose(token).catch(() => {}); };
  }, [source, digest, preview, app?.revision, retry]);
  useEffect(() => {
    if (!launch) return;
    let active = true; let connected = false; let lastID = 0; let pending = 0; let calls = 0; let lastReport = 0;
    const timeout = window.setTimeout(() => { if (active) setError('The app has not reported a successful render. Retry or inspect its diagnostics in Pi.'); }, 15000);
    const stop = (message: string) => { if (!active) return; active = false; channel.current?.close(); setError(message); void source.desktopAppClose(launch.token).catch(() => {}); };
    const connect = (event: MessageEvent) => {
      if (!active || !event.source || event.source !== frame.current?.contentWindow || event.data?.type !== 'lumo-ready' || event.data.handshake !== launch.handshake || connected) return;
      connected = true; const ports = new MessageChannel(); channel.current = ports.port1;
      ports.port1.onmessage = async ({ data }) => {
        if (!active || !data || typeof data !== 'object') return;
        if (data.type === 'report') {
          if (!['ready', 'error'].includes(data.status) || typeof data.message !== 'string' || data.message.length > 2000 || Date.now() - lastReport < 250) return;
          lastReport = Date.now(); clearTimeout(timeout);
          if (data.status === 'ready') { setReady(true); setError(''); } else setError(data.message || 'The app encountered an error.');
          void source.desktopAppReport(launch.token, data.status, data.message).catch(() => {}); return;
        }
        if (data.type !== 'call' || !Number.isSafeInteger(data.id) || data.id <= lastID || typeof data.method !== 'string') return;
        lastID = data.id;
        if (++calls > 30 || pending >= 4) { stop('The app sent too many requests.'); return; }
        pending++;
        try {
          if (data.method !== 'system.metrics.read') throw new Error('This app capability is unavailable.');
          const value = await source.desktopAppCall(launch.token, data.method);
          if (active) ports.port1.postMessage({ id: data.id, value });
        } catch (e) { if (active) ports.port1.postMessage({ id: data.id, error: e instanceof Error ? e.message : 'App request failed.' }); }
        finally { pending--; }
      };
      ports.port1.start(); event.source.postMessage({ type: 'lumo-connect' }, { targetOrigin: '*', transfer: [ports.port2] });
      ports.port1.postMessage({ type: 'theme', ...settings.current });
    };
    const reset = window.setInterval(() => { calls = 0; }, 10000);
    let loads = 0;
    const navigation = () => { if (++loads > 1) stop('The app navigated away. Its access has been revoked.'); };
    const element = frame.current; element?.addEventListener('load', navigation);
    window.addEventListener('message', connect);
    return () => { active = false; clearTimeout(timeout); clearInterval(reset); element?.removeEventListener('load', navigation); window.removeEventListener('message', connect); channel.current?.close(); channel.current = undefined; };
  }, [launch, source]);
  useEffect(() => { channel.current?.postMessage({ type: 'theme', ...settings.current }); }, [theme, reducedMotion]);
  return <div className="desktop-app-host" data-testid="desktop-app-host">
    {preview && <div className="desktop-app-preview-label">Preview · Temporary read-only access</div>}
    {(!digest || error) && <div className="desktop-app-status" role="alert"><p>{error || 'This app is disabled, removed, or still loading.'}</p><button className="btn" onClick={() => { void refresh().catch(() => {}); setRetry((n) => n + 1); }}>Retry</button></div>}
    {digest && !ready && !error && <div className="desktop-app-loading" role="status">Opening app…</div>}
    {launch && <iframe key={launch.token} ref={frame} title={app?.manifest.name ?? 'App preview'} data-testid="desktop-app-frame" sandbox="allow-scripts" referrerPolicy="no-referrer" src={launch.url} srcDoc={launch.document} />}
  </div>;
}
