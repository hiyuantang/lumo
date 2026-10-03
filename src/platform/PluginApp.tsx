// SPDX-License-Identifier: AGPL-3.0-only
import { Component, useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { useCurrentWindow } from '../shell/WindowContext';
import { APPS } from '../apps/registry';
import { pluginPackages, pluginManifests } from './plugins';
import './host';

interface PluginManifest { schemaVersion: number; hostApiVersion: number; id: string; entry: string; styles?: string; background?: string }
const asset = /^[a-f0-9]{64}\.(js|css)$/;
const loading = new Map<string, Promise<ComponentType>>();
const styleLoads = new Map<string, Promise<void>>();

function loadStyle(href: string, name: string) {
  let pending = styleLoads.get(href);
  if (!pending) {
    pending = new Promise<void>((resolve, reject) => {
      const link = document.createElement('link');
      const timer = window.setTimeout(() => { link.remove(); reject(new Error('App styles took too long to load.')); }, 15000);
      link.onload = () => { window.clearTimeout(timer); resolve(); };
      link.onerror = () => { window.clearTimeout(timer); link.remove(); reject(new Error('App styles could not load.')); };
      link.rel = 'stylesheet'; link.href = href; link.dataset.lumoPluginStyle = name; document.head.append(link);
    });
    styleLoads.set(href, pending);
    void pending.catch(() => styleLoads.delete(href));
  }
  return pending;
}

async function loadPlugin(name: string, id: string, background = false): Promise<ComponentType> {
  const base = `/plugins/${name}/`;
  const response = await fetch(base + 'manifest.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('App package is unavailable.');
  const manifest: PluginManifest = await response.json();
  if (manifest.schemaVersion !== 1 || manifest.hostApiVersion !== 1 || manifest.id !== id || !asset.test(manifest.entry) || !manifest.entry.endsWith('.js') || (manifest.styles !== undefined && (!asset.test(manifest.styles) || !manifest.styles.endsWith('.css')))) throw new Error('This app package is incompatible with Lumo.');
  if (background && (!manifest.background || !asset.test(manifest.background) || !manifest.background.endsWith('.js'))) throw new Error('App background service is missing.');
  const key = base + (background ? manifest.background : manifest.entry);
  let pending = loading.get(key);
  if (!pending) {
    pending = (async () => {
      const module = await import(/* @vite-ignore */ key);
      if (typeof module.default !== 'function') throw new Error('App entry is missing.');
      return module.default as ComponentType;
    })();
    loading.set(key, pending);
    void pending.catch(() => loading.delete(key));
  }
  const Body = await pending;
  if (!background && manifest.styles) await loadStyle(base + manifest.styles, name);
  if (!background) for (const link of document.querySelectorAll<HTMLLinkElement>('link[data-lumo-plugin-style]')) {
    if (link.dataset.lumoPluginStyle === name && link.getAttribute('href') !== base + manifest.styles) {
      styleLoads.delete(link.getAttribute('href')!);
      link.remove();
    }
  }
  return Body;
}

export class AppBoundary extends Component<{ children: ReactNode; name: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <div className="app"><p role="alert">{this.props.name} could not continue. Close and reopen this window to try again.</p></div> : this.props.children;
  }
}

export function PluginApp() {
  const { appId } = useCurrentWindow();
  const name = pluginPackages[appId as keyof typeof pluginPackages];
  const [Body, setBody] = useState<ComponentType | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    setError('');
    void loadPlugin(name, appId).then((component) => { if (alive) setBody(() => component); }, (err: unknown) => { if (alive) setError(err instanceof Error ? err.message : 'App could not load.'); });
    return () => { alive = false; };
  }, [name, appId, attempt]);
  if (error) return <div className="app" data-testid="plugin-load-error"><p role="alert">{error}</p><button type="button" className="btn" onClick={() => setAttempt((value) => value + 1)}>Try again</button></div>;
  if (!Body) return <div className="app" role="status">Opening {APPS[appId].title}…</div>;
  return <Body />;
}

function PluginService({ name, id }: { name: string; id: string }) {
  const [Service, setService] = useState<ComponentType | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    void loadPlugin(name, id, true).then((value) => { if (alive) setService(() => value); }, (err: unknown) => { if (alive) setError(err instanceof Error ? err.message : 'App background service unavailable.'); });
    return () => { alive = false; };
  }, [name, id]);
  if (error) return <span role="status" className="sr-only">{name}: {error}</span>;
  return Service ? <AppBoundary name={name}><Service /></AppBoundary> : null;
}

export function PluginServices() {
  return <>{pluginManifests.filter((manifest) => 'background' in manifest && manifest.background).map((manifest) => <PluginService key={manifest.id} name={pluginPackages[manifest.id as keyof typeof pluginPackages]} id={manifest.id} />)}</>;
}
