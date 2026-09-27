// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from 'react';
import { useShell } from './ShellContext';
import { useCurrentWindow } from './WindowContext';
import { windowStatePrefix } from './appStateStorage';

type ViewValue = string | boolean | null | string[];

export function useAppState<T extends ViewValue>(app: string, name: string, initial: T | (() => T), choices?: readonly T[]) {
  const { state } = useShell();
  const win = useCurrentWindow();
  return useStoredState(`${windowStatePrefix(state.user, win.id)}${app}:${name}`, initial, choices);
}

export function useAppPreference<T extends ViewValue>(app: string, name: string, initial: T | (() => T), choices?: readonly T[]) {
  const { state } = useShell();
  const key = `lumo.view.v1:${encodeURIComponent(state.user ?? '')}:${app}:${name}`;
  return useStoredState(key, initial, choices);
}

function useStoredState<T extends ViewValue>(key: string, initial: T | (() => T), choices?: readonly T[]) {
  const [value, setValue] = useState<T>(() => {
    const fallback = typeof initial === 'function' ? initial() : initial;
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return fallback;
      const saved: unknown = JSON.parse(raw);
      const valid = Array.isArray(fallback) ? Array.isArray(saved) && saved.every((item) => typeof item === 'string') : fallback === null ? saved === null || typeof saved === 'string' : typeof saved === typeof fallback;
      return valid && (!choices || choices.includes(saved as T)) ? saved as T : fallback;
    } catch { return fallback; }
  });
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }, [key, value]);
  return [value, setValue] as const;
}
