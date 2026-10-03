// SPDX-License-Identifier: AGPL-3.0-only
import { useId, useLayoutEffect, useSyncExternalStore } from 'react';
import { useCurrentWindow } from './WindowContext';
import type { WindowId } from './ShellContext';

export interface AppCommand {
  id: string;
  label: string;
  disabled?: boolean;
  checked?: boolean;
  hint?: string;
  separatorAbove?: boolean;
  keywords?: string;
  palette?: boolean;
  run: () => void;
}
export const appMenuCategories = ['app', 'file', 'edit', 'view', 'tools', 'window', 'help', 'dock', 'commands'] as const;
export type AppMenuCategory = typeof appMenuCategories[number];
export type AppMenus = Partial<Record<AppMenuCategory, AppCommand[]>>;
const entries = new Map<string, { windowId: WindowId; menus: AppMenus }>();
const listeners = new Set<() => void>();
let snapshot = [...entries.values()];
function publish() { snapshot = [...entries.values()]; listeners.forEach((listener) => listener()); }
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function useAppMenus(menus: AppMenus) {
  const { id: windowId } = useCurrentWindow();
  const token = useId();
  useLayoutEffect(() => { entries.set(token, { windowId, menus }); publish(); });
  useLayoutEffect(() => () => { entries.delete(token); publish(); }, [token]);
}

export function useWindowMenus(windowId: WindowId | null): AppMenus {
  const all = useSyncExternalStore(subscribe, () => snapshot);
  const result: AppMenus = {};
  for (const entry of all) {
    if (entry.windowId !== windowId) continue;
    for (const category of appMenuCategories) {
      result[category] = [...(result[category] ?? []), ...(entry.menus[category] ?? [])];
    }
  }
  return result;
}

export function useRegisteredAppMenus() {
  const all = useSyncExternalStore(subscribe, () => snapshot);
  const windows = new Map<WindowId, AppMenus>();
  for (const entry of all) {
    const menus = windows.get(entry.windowId) ?? {};
    for (const category of appMenuCategories) menus[category] = [...(menus[category] ?? []), ...(entry.menus[category] ?? [])];
    windows.set(entry.windowId, menus);
  }
  return windows;
}
