// SPDX-License-Identifier: AGPL-3.0-only
import { NativeAppsProvider } from './nativeCatalog';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { getDataSource } from '../api/source';
import type { DesktopBuild, DesktopCatalog } from '../api/desktop-apps';
import { APPS, APP_ORDER, type AppId } from '../apps/registry';
import * as Icons from '../shell/icons';
import { useShell } from '../shell/ShellContext';

export function registerDesktopBuild(build: DesktopBuild, preview = false): AppId {
  const id: AppId = preview ? `app:preview.${build.digest}` : `app:${build.manifest.id}`;
  const { manifest } = build;
  APPS[id] = { id, title: `${manifest.name}${preview ? ' Preview' : ''}`, icon: Icons[manifest.icon as keyof typeof Icons] ?? Icons.IconGrid, iconImage: manifest.iconImage, defaultSize: { w: manifest.window.width, h: manifest.window.height }, minSize: { w: manifest.window.minWidth, h: manifest.window.minHeight } };
  return id;
}
const Context = createContext<{ catalog: DesktopCatalog; error: string; refresh(): Promise<DesktopCatalog>; preview(build: DesktopBuild): void }>({ catalog: { apps: [], builds: [] }, error: '', refresh: async () => ({ apps: [], builds: [] }), preview: () => {} });
export function DesktopAppsProvider({ children }: { children: ReactNode }) {
  const { actions, state } = useShell();
  const [catalog, setCatalog] = useState<DesktopCatalog>({ apps: [], builds: [] });
  const [error, setError] = useState('');
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    try {
      const next = await getDataSource().desktopApps();
      if (request !== generation.current) return next;
      if (!Array.isArray(next.apps) || !Array.isArray(next.builds)) throw new Error('Desktop apps are unavailable on this server.');
      for (const build of [...next.builds].sort((a, b) => a.manifest.version.localeCompare(b.manifest.version, undefined, { numeric: true }))) registerDesktopBuild(build);
      for (const app of next.apps) registerDesktopBuild(app);
      APP_ORDER.splice(0, APP_ORDER.length, ...APP_ORDER.filter((id) => !id.startsWith('app:')), ...next.apps.filter((a) => a.enabled).map((a) => registerDesktopBuild(a)));
      setCatalog(next); setError(''); return next;
    } catch (error) { if (request === generation.current) setError(error instanceof Error ? error.message : 'Apps unavailable.'); throw error; }
  }, []);
  const preview = useCallback((build: DesktopBuild) => actions.openApp(registerDesktopBuild(build, true)), [actions]);
  useEffect(() => {
    const load = () => { if (!document.hidden) void refresh().catch(() => {}); };
    load(); const timer = window.setInterval(load, 30000);
    window.addEventListener('focus', load); document.addEventListener('visibilitychange', load);
    return () => { generation.current++; clearInterval(timer); window.removeEventListener('focus', load); document.removeEventListener('visibilitychange', load); APP_ORDER.splice(0, APP_ORDER.length, ...APP_ORDER.filter((id) => !id.startsWith('app:'))); for (const id of Object.keys(APPS)) if (id.startsWith('app:')) delete APPS[id as AppId]; };
  }, [refresh, state.user]);
  return <Context.Provider value={{ catalog, error, refresh, preview }}><NativeAppsProvider>{children}</NativeAppsProvider></Context.Provider>;
}
export const useDesktopApps = () => useContext(Context);
