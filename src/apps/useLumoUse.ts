// SPDX-License-Identifier: AGPL-3.0-only
import { registerDesktopBuild } from '../platform/catalog';
import { useEffect, useRef } from 'react';
import type { DesktopRequest } from '../api/lumo-use';
import { getDataSource } from '../api/source';
import { LumoUseDesktop, serializeDesktop } from '../shell/lumoUse';
import { useShell } from '../shell/ShellContext';
import { useCurrentWindow } from '../shell/WindowContext';
import type { WindowId } from '../shell/ShellContext';
import { APPS } from './registry';
import { COMPACT_WIDTH, workArea, type Rect } from '../shell/windowGeometry';

export function useLumoUse(connection: string | null, active: boolean, enabled: boolean, floatingId?: string) {
  const source = getDataSource(); const shell = useShell(); const win = useCurrentWindow();
  const info = useRef({ connection, active, enabled, shell, win, floatingId }); info.current = { connection, active, enabled, shell, win, floatingId };
  const abort = useRef(new AbortController());
  const seen = useRef(new Set<string>());
  const desktop = useRef<LumoUseDesktop>();
  if (!desktop.current) desktop.current = new LumoUseDesktop((node) => {
    const focusedId = info.current.shell.state.focused;
    const focused = focusedId ? info.current.shell.state.windows[focusedId] : undefined;
    return !(focused?.appId === 'pi' && node.closest('.menubar'));
  }, (id, rect: Rect) => {
    const { shell } = info.current; const window = shell.state.windows[id as WindowId];
    if (!window || window.maximized || window.snapped || shell.state.viewport.w <= COMPACT_WIDTH) throw new Error('This gesture requires a floating window on a desktop-sized screen.');
    shell.actions.updateRect(id as WindowId, rect);
  }, () => {
    const { state } = info.current.shell;
    return { viewport: state.viewport, workArea: workArea(state.viewport), windows: Object.fromEntries(Object.values(state.windows).flatMap((window) => window ? [[window.id, {
      minSize: APPS[window.appId].minSize, focused: state.focused === window.id,
      mode: state.viewport.w <= COMPACT_WIDTH ? 'compact' : window.maximized ? 'maximized' : window.snapped ? 'tiled' : 'floating',
    }]] : [])) };
  });
  useEffect(() => {
    abort.current.abort(); abort.current = new AbortController(); seen.current.clear();
    return () => { abort.current.abort(); };
  }, [connection]);
  useEffect(() => { if (!active || !enabled) abort.current.abort(); else if (abort.current.signal.aborted) abort.current = new AbortController(); }, [active, enabled]);
  function resume() { if (abort.current.signal.aborted && info.current.enabled && info.current.active) abort.current = new AbortController(); }
  function consume(requests: DesktopRequest[]) {
    if (!info.current.enabled || !info.current.connection) return;
    for (const request of requests) {
      if (seen.current.has(request.id)) continue;
      seen.current.add(request.id);
      const id = info.current.connection; const signal = abort.current.signal;
      void serializeDesktop(async () => {
        let claimed: DesktopRequest;
        try { claimed = await source.piDesktopClaim(id, request.id); } catch { return; }
        let text: string; let error = false;
        try {
          const current = info.current;
          const floatingHost = current.floatingId ? document.getElementById(current.floatingId) : null;
          const hidden = current.floatingId ? !floatingHost || floatingHost.hidden || !floatingHost.getClientRects().length : current.shell.state.windows[current.win.id]?.minimized;
          if (signal.aborted || current.connection !== id || !current.active || !current.enabled || hidden || document.visibilityState !== 'visible') throw new Error('Lumo Use needs its active chat in a visible, connected tab.');
          if (claimed.action === 'app_preview') {
            const catalog = await source.desktopApps();
            const build = catalog.builds.find((item) => item.digest === claimed.target);
            if (!build) throw new Error('Build unavailable. Build the app before previewing.');
            if (signal.aborted) throw new Error('Preview interrupted.');
            current.shell.actions.openApp(registerDesktopBuild(build, true));
            text = 'Preview window opened. Use lumo_app_status for runtime diagnostics; opening is not visual verification.';
          } else text = await desktop.current!.execute(claimed, signal);
        } catch (err) { error = true; text = err instanceof Error ? err.message : 'Lumo Use failed. Observe again.'; }
        await source.piDesktopResult(id, request.id, text, error).catch(() => {});
      });
    }
  }
  return { consume, resume, cancel: () => abort.current.abort() };
}
