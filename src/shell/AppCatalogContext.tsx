// SPDX-License-Identifier: AGPL-3.0-only
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { getDataSource } from '../api/source';
import type { AppCatalog } from '../api/server-apps';

const AppCatalogContext = createContext<{
  catalog: AppCatalog | null;
  refresh: () => Promise<AppCatalog>;
} | null>(null);

export function AppCatalogProvider({ children }: { children: ReactNode }) {
  const [catalog, setCatalog] = useState<AppCatalog | null>(null);
  const active = useRef(true);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    const next = await getDataSource().getAppCatalog();
    if (active.current && request === generation.current) setCatalog(next);
    return next;
  }, []);

  useEffect(() => {
    active.current = true;
    const load = () => { if (!document.hidden) void refresh().catch(() => {}); };
    load();
    const timer = window.setInterval(load, 30_000);
    document.addEventListener('visibilitychange', load);
    window.addEventListener('focus', load);
    return () => {
      active.current = false;
      generation.current++;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', load);
      window.removeEventListener('focus', load);
    };
  }, [refresh]);

  const value = useMemo(() => ({ catalog, refresh }), [catalog, refresh]);
  return <AppCatalogContext.Provider value={value}>{children}</AppCatalogContext.Provider>;
}

export function useAppCatalog() {
  const value = useContext(AppCatalogContext);
  if (!value) throw new Error('useAppCatalog must be used inside AppCatalogProvider');
  return value;
}
