// SPDX-License-Identifier: AGPL-3.0-only
import type { DesktopApp, DesktopBuild, DesktopCatalog, DesktopChange, DesktopLaunch } from '../api/desktop-apps';
const builds: DesktopBuild[] = ['0.1.0', '0.2.0'].map((version, index) => ({ digest: String(index + 1).repeat(64), manifest: { schemaVersion: 1, apiVersion: 1, id: 'local.server-pulse', name: 'Server Pulse', version, description: 'CPU and memory usage for this server.', license: 'AGPL-3.0-only', entry: 'src/main.js', styles: 'src/style.css', window: { width: 720, height: 480, minWidth: 390, minHeight: 320 }, capabilities: [{ name: 'system.metrics.read' }] } }));
const key = () => `lumo.desktop-apps.mock:${localStorage.getItem('lumo.session.v1') ?? ''}`;
const read = (): DesktopApp[] => { try { return JSON.parse(localStorage.getItem(key()) ?? '[]'); } catch { return []; } };
const launches = new Map<string, { digest: string; preview: boolean; revision: string }>();
const reports = new Map<string, { status: string; message: string }>();
export const mockDesktopApps = {
  async catalog(): Promise<DesktopCatalog> { return { apps: read(), builds }; },
  async change(change: DesktopChange): Promise<DesktopApp> {
    const apps = read(); const current = apps.find((a) => a.manifest.id === change.id);
    if ((current?.revision ?? '') !== change.revision) throw new Error('The app changed. Refresh before retrying.');
    const build = builds.find((b) => b.digest === (change.action === 'restore' ? current?.previous : change.digest)) ?? current;
    if (!build) throw new Error('Build unavailable.');
    const app: DesktopApp = { ...build, revision: crypto.randomUUID(), enabled: change.action !== 'disable', history: current?.history ?? [], previous: current?.previous };
    if (change.action === 'install' || change.action === 'restore') { app.previous = current?.digest; app.history = [...app.history, { from: current?.manifest.version ?? '', to: build.manifest.version, at: new Date().toISOString() }]; }
    localStorage.setItem(key(), JSON.stringify([...apps.filter((a) => a.manifest.id !== change.id), ...(change.action === 'uninstall' ? [] : [app])]));
    launches.clear(); return app;
  },
  async launch(digest: string, preview: boolean): Promise<DesktopLaunch> {
    const build = builds.find((b) => b.digest === digest); const current = read().find((a) => a.digest === digest && a.enabled);
    if (!build || (!preview && !current)) throw new Error('App unavailable.');
    const handshake = crypto.randomUUID(); const token = crypto.randomUUID(); launches.set(token, { digest, preview, revision: current?.revision ?? '' });
    const document = `<!doctype html><html><head><title>Server Pulse</title><style>body{margin:24px;font:14px system-ui;background:white;color:#222}html[data-theme=dark] body{background:#202020;color:#eee}section{display:flex;gap:16px}article{border:1px solid #8885;border-radius:12px;padding:20px;flex:1}strong{display:block;font-size:28px;margin-top:10px}button{margin-top:16px;padding:8px 16px}svg{width:100%;height:80px}</style></head><body><h1>Server Pulse</h1><p>CPU and memory usage</p><section><article>CPU<strong id="cpu">—</strong></article><article>Memory<strong id="memory">—</strong></article></section>${build.manifest.version === '0.2.0' ? '<h2>History</h2><svg viewBox="0 0 400 80"><path d="M0 60 60 40 120 50 180 20 240 30 300 10 400 24" stroke="#487ccc" stroke-width="3" fill="none"/></svg>' : ''}<button id="refresh">Refresh</button><p id="status">Connecting</p><script>let port;let serial=0;addEventListener('message',e=>{if(e.source!==parent||e.data?.type!=='lumo-connect'||port)return;port=e.ports[0];port.onmessage=({data})=>{if(data.type==='theme'){document.documentElement.dataset.theme=data.theme;return}if(data.error){document.getElementById('status').textContent=data.error;return}document.getElementById('cpu').textContent=data.value.cpuPercent.toFixed(1)+'%';document.getElementById('memory').textContent='3.0 / 8.0 GB';document.getElementById('status').textContent='Updated';port.postMessage({type:'report',status:'ready',message:''});};function refresh(){port.postMessage({type:'call',id:++serial,method:'system.metrics.read'});}document.getElementById('refresh').onclick=refresh;refresh();});parent.postMessage({type:'lumo-ready',handshake:'${handshake}'},'*');<\/script></body></html>`;
    return { token, handshake, document };
  },
  async call(token: string, method: string) { if (!launches.has(token) || method !== 'system.metrics.read') throw new Error('App access is unavailable.'); return { cpuPercent: 21.5, memoryUsedBytes: 3 * 1073741824, memoryTotalBytes: 8 * 1073741824, at: Date.now() }; },
  report(token: string, status: string, message: string) { if (launches.has(token)) reports.set(token, { status, message }); },
  close(token: string) { launches.delete(token); },
};
