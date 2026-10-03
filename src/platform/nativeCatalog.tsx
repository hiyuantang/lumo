// SPDX-License-Identifier: AGPL-3.0-only
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { getDataSource } from '../api/source';
import type { NativeApp } from '../api/app-plugins';
import { APPS, APP_ORDER, type AppId } from '../apps/registry';
import * as Icons from '../shell/icons';
import { pluginBases, pluginPackages, resetPluginSession } from './plugins';
import { useShell } from '../shell/ShellContext';

const Context = createContext<{ apps: NativeApp[]; ready: boolean; error: string; refresh(): Promise<NativeApp[]> }>({ apps: [], ready: false, error: '', refresh: async () => [] });
export function NativeAppsProvider({ children }: { children: ReactNode }) {
  const { state } = useShell();
  const [apps, setApps] = useState<NativeApp[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    try {
      const next = await getDataSource().nativeApps();
      if (generation.current !== request) return next;
      for (const app of next) {
        const manifest = app.current?.manifest ?? app.releases[0]?.manifest;
        if (!manifest) continue;
        const id = manifest.id as AppId;
        pluginPackages[id] = app.name;
        pluginBases[id] = getDataSource().kind === 'live' ? `/api/v1/app-plugins/assets/${app.name}/` : `/plugins/${app.name}/`;
        APPS[id] = { id, title: manifest.name, iconImage: manifest.iconImage, icon: Icons[manifest.icon as keyof typeof Icons] ?? Icons.IconGrid, defaultSize: { w: manifest.window.width, h: manifest.window.height }, minSize: { w: manifest.window.minWidth, h: manifest.window.minHeight }, requiredPackage: manifest.requiredPackage };
      }
      const active = next.filter((app) => app.installed && app.current).map((app) => app.current!.manifest.id as AppId);
      APP_ORDER.splice(0, APP_ORDER.length, ...APP_ORDER.filter((id) => (!(id in pluginPackages) && !id.startsWith('plugin:')) || active.includes(id)), ...active.filter((id) => !APP_ORDER.includes(id)));
      setApps(next); setReady(true); setError(''); return next;
    } catch (err) { if (generation.current === request) setError(err instanceof Error ? err.message : 'App packages unavailable.'); throw err; }
  }, []);
  useEffect(() => {
    resetPluginSession();
    const load = () => { if (!document.hidden) void refresh().catch(() => {}); };
    load(); const timer = window.setInterval(load, 30000);
    window.addEventListener('focus', load); document.addEventListener('visibilitychange', load);
    return () => { generation.current++; APP_ORDER.splice(0,APP_ORDER.length,...APP_ORDER.filter((id) => !id.startsWith('plugin:'))); clearInterval(timer); window.removeEventListener('focus', load); document.removeEventListener('visibilitychange', load); for (const id of Object.keys(pluginPackages)) { delete pluginBases[id]; if (id.startsWith('plugin:')) { delete APPS[id as AppId]; delete pluginPackages[id]; } } };
  }, [refresh, state.user]);
  return <Context.Provider value={{ apps, ready, error, refresh }}>{children}</Context.Provider>;
}
export const useNativeApps = () => useContext(Context);
