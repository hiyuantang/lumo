// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect } from 'react';
import { useShell } from '../../shell/ShellContext';
import { useCurrentWindow } from '../../shell/WindowContext';
export { useAppMenus } from '../../shell/appMenus';
export type { AppMenus, AppCommand } from '../../shell/appMenus';
export { useAppState, useAppPreference } from '../../shell/useAppState';
export { FilePicker } from '../../apps/FilePicker';
export { AppModal } from '../../shell/AppModal';
export { AppConfirmation } from '../../apps/ServerAppUI';
export { useContextMenu } from '../../shell/ContextMenu';
export { sendNotification } from './api/notifications';
export { requestPlugin } from './api/plugins';
export function useAppWindow(presentation: { title?: string; badge?: string } = {}) {
  const win = useCurrentWindow();
  const { actions, resolvedTheme, reducedMotion } = useShell();
  useEffect(() => {
    actions.setWindowPresentation(win.id, presentation);
  }, [actions, win.id, presentation.title, presentation.badge]);
  useEffect(() => () => actions.setWindowPresentation(win.id, {}), [actions, win.id]);
  return { id: win.id, appId: win.appId, theme: resolvedTheme, reducedMotion, close: () => actions.closeApp(win.id), newWindow: () => actions.newAppWindow(win.appId), registerCloseGuard: (guard: (proceed: () => void) => void) => actions.registerWindowGuard(win.id, guard) };
}
