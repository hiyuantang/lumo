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
  run: () => void;
}
export type AppMenus = Partial<Record<'app' | 'file' | 'view', AppCommand[]>>;
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
    for (const category of ['app', 'file', 'view'] as const) {
      result[category] = [...(result[category] ?? []), ...(entry.menus[category] ?? [])];
    }
  }
  return result;
}
