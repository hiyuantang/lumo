// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from 'react';
import { pluginPackages, type PluginId } from './plugins';
import { readPluginManifest } from './pluginManifest';

export interface PluginStatus { version?: string; error?: string }
export function usePluginCatalog(revision: number) {
  const [catalog, setCatalog] = useState<Partial<Record<PluginId, PluginStatus>>>({});
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 15000);
    let alive = true;
    setCatalog({});
    void Promise.all((Object.keys(pluginPackages) as PluginId[]).map(async (id) => {
      try {
        const manifest = await readPluginManifest(id, controller.signal);
        if (alive) setCatalog((items) => ({ ...items, [id]: { version: manifest.version } }));
      } catch {
        if (alive) setCatalog((items) => ({ ...items, [id]: { error: 'App version unavailable. Choose View → Refresh to try again.' } }));
      }
    })).finally(() => window.clearTimeout(timer));
    return () => { alive = false; window.clearTimeout(timer); controller.abort(); };
  }, [revision]);
  return catalog;
}
