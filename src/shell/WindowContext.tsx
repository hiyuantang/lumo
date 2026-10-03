// SPDX-License-Identifier: AGPL-3.0-only
import { createContext, useContext } from 'react';
import { APPS } from '../apps/registry';
import type { WindowState } from './ShellContext';

export const WindowContext = createContext<WindowState | null>(null);
export function useCurrentWindow() {
  const win = useContext(WindowContext);
  if (!win) throw new Error('App must be inside a window');
  return win;
}
export function windowTitle(win: WindowState) {
  if (win.title) return `${win.title} — ${APPS[win.appId].title}`;
  return win.appId === 'preview' && win.filePath ? `${win.filePath.at(-1)} — Preview` : win.appId === 'pi' && win.projectPath ? `${win.projectPath.split('/').filter(Boolean).at(-1) ?? '/'} — Pi` : APPS[win.appId].title;
}
