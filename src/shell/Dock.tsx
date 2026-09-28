// SPDX-License-Identifier: AGPL-3.0-only
import { useFileDrop } from './fileDrag';
import { useEffect, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import overviewIcon from '../assets/lumo-overview.png';
import { AppIcon } from './AppIcon';
import { useContextMenu } from './ContextMenu';
import { APPS, CORE_APP_COUNT, type AppId } from '../apps/registry';
import { useAppCatalog } from './AppCatalogContext';
import { DOCK_ORDER_KEY, loadDockOrder, moveDockApp } from './dockOrder';
import { useShell, type WindowId, type WindowState } from './ShellContext';
import { WindowThumbnail } from './WindowThumbnail';
import { windowTitle } from './WindowContext';
import { useReorder } from './useReorder';
import { useDockLayout } from './useDockLayout';
import '../styles/dock.css';

export function Dock({ onOverview }: { onOverview: () => void }) {
  const drop = useFileDrop();
  const openContextMenu = useContextMenu();
  const { state, actions, reducedMotion } = useShell();
  const minimized = Object.values(state.windows).filter((win): win is WindowState => !!win?.minimized);
  const [slots, setSlots] = useState<WindowId[]>(() => minimized.map((win) => win.id));
  const dockWindows = [...new Set([...slots, ...minimized.map((win) => win.id)])].map((id) => state.windows[id]).filter((win): win is WindowState => !!win);
  useEffect(() => {
    setSlots((previous) => [...new Set([...previous.filter((id) => state.windows[id]), ...Object.values(state.windows).filter((win) => win?.minimized).map((win) => win!.id)])]);
    const timer = window.setTimeout(() => setSlots((previous) => previous.filter((id) => state.windows[id]?.minimized)), reducedMotion ? 0 : 460);
    return () => window.clearTimeout(timer);
  }, [state.windows, reducedMotion]);
  const { catalog } = useAppCatalog();
  const [order, setOrder] = useState(loadDockOrder);
  const reorder = useReorder(order, setOrder, (id) => id, 'horizontal');
  const installed = new Set(catalog?.apps?.filter((app) => app.installed).map((app) => app.id));
  const visible = order.filter((id) => id !== 'trash' && (!APPS[id].requiredPackage || installed.has(APPS[id].requiredPackage!)));
  const tray = useDockLayout(`${visible.join(',')}|${dockWindows.map((win) => win.id).join(',')}`, reducedMotion, `${state.viewport.w}x${state.viewport.h}`, reorder.dragging);

  useEffect(() => {
    try { localStorage.setItem(DOCK_ORDER_KEY, JSON.stringify(order)); } catch {}
  }, [order]);

  function onAppClick(appId: AppId) {
    actions.openApp(appId);
  }

  function onKeyDown(e: ReactKeyboardEvent) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    e.stopPropagation();
    const current = (e.target as HTMLElement).closest('button');
    if (e.altKey && current?.dataset.app && current.dataset.app !== 'trash') {
      const app = current?.dataset.app as AppId;
      const target = visible[visible.indexOf(app) + (e.key === 'ArrowRight' ? 1 : -1)];
      if (target) setOrder((previous) => moveDockApp(previous, app, target));
      return;
    }
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not([data-restoring="true"])'));
    const index = items.indexOf(current as HTMLButtonElement);
    items[(index + (e.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length]?.focus();
  }

  return (
    <nav className="dock" data-testid="dock" aria-label="Dock" onKeyDown={onKeyDown}>
      <div ref={tray} className="dock-tray" style={{ '--dock-app-count': CORE_APP_COUNT + 1, '--dock-count': visible.length + 2 + Math.min(dockWindows.length, 3) } as CSSProperties}>
        <div className="dock-surface" data-testid="dock-surface" aria-hidden="true" />
        <div className="dock-apps" aria-label="Applications"><button type="button" className="dock-app" data-testid="dock-overview" aria-label="Overview" aria-haspopup="dialog" title="Overview" onClick={onOverview}><span className="dock-icon"><svg className="app-icon" viewBox="75 78 1105 1105" aria-hidden="true"><image href={overviewIcon} width="1254" height="1254"/></svg></span><span className="dock-label" aria-hidden="true">Overview</span><span className="dock-dot" aria-hidden="true"/></button>{visible.map((appId) => {
          const meta = APPS[appId];
          const appWindows = Object.values(state.windows).filter((item): item is WindowState => item?.appId === appId).sort((a, b) => b.z - a.z);
          const win = appWindows[0];
          const running = Boolean(win);
          const minimized = Boolean(win?.minimized);
          const active = running && !minimized && state.focused === win?.id;
          return (
            <button
              key={appId}
              type="button"
              className={`dock-app${active ? ' active' : ''}`}
              data-testid={`dock-app-${appId}`}
              data-app={appId}
              aria-label={`${meta.title}${running ? ', running' : ''}`}
              title={meta.title}
              aria-description="Drag to reorder, or use Alt and the left or right arrow key."
              {...reorder.bind(appId)}
              onContextMenu={(event) => openContextMenu(event, !running && appId !== 'pi' && appId !== 'preview' ? [] : [
                { label: minimized ? 'Restore' : running ? 'Show Window' : 'Open', run: () => onAppClick(appId) },
                ...(appId === 'pi' ? [{ label: 'New Window', run: actions.newPiWindow }, ...appWindows.map((item) => ({ label: windowTitle(item), run: () => actions.focusApp(item.id) }))] : []),
                ...(appId === 'preview' ? [{ label: 'New Window', run: actions.newPreviewWindow }, ...appWindows.map((item, index) => ({ label: `${windowTitle(item)}${item.filePath ? '' : ` ${index + 1}`}`, run: () => actions.focusApp(item.id) }))] : []),
                ...(running ? [
                  { label: 'Close Window', run: () => actions.closeApp(win.id) },
                ] : []),
              ])}
              onClick={() => onAppClick(appId)}
            >
              <span className="dock-icon">
                <AppIcon appId={appId} />
              </span>

              <span className="dock-label" aria-hidden="true">{meta.title}</span>
              <span className={`dock-dot${running ? ' on' : ''}`} aria-hidden="true" />
            </button>
          );
        })}</div>
        <div className="dock-divider" role="separator" aria-orientation="vertical" data-testid="dock-divider" />
        {dockWindows.length > 0 && <>
          <div className="dock-windows" aria-label="Minimized windows" data-testid="dock-windows">
            {dockWindows.map((win) => {
              const title = windowTitle(win);
              return <button key={win.id} type="button" className="dock-app dock-window" data-restoring={!win.minimized} tabIndex={win.minimized ? 0 : -1} data-app={win.appId} data-window-id={win.id} data-testid={`dock-minimized-${win.id}`} aria-label={`Restore ${title}`} title={`Restore ${title}`} onClick={() => actions.focusApp(win.id)} onContextMenu={(event) => openContextMenu(event, [
                { label: 'Restore', run: () => actions.focusApp(win.id) },
                { label: 'Close Window', run: () => actions.closeApp(win.id) },
              ])}>
                <span className="dock-icon dock-window-preview"><span className="dock-window-canvas"><WindowThumbnail win={win} /></span><span className="dock-window-badge"><AppIcon appId={win.appId} /></span></span>
                <span className="dock-label" aria-hidden="true">{title}</span><span className="dock-dot" aria-hidden="true" />
              </button>;
            })}
          </div>
        </>}
        <button type="button" className={`dock-app${state.focused === 'trash' ? ' active' : ''}`} {...drop('trash')} data-app="trash" data-testid="dock-app-trash" aria-label="Trash" title="Trash" onClick={() => onAppClick('trash')} onContextMenu={(event) => openContextMenu(event, [{ label: 'Open Trash', run: () => onAppClick('trash') }, { label: 'Empty Trash…', separator: true, danger: true, run: actions.emptyTrash }])}>
          <span className="dock-icon"><AppIcon appId="trash" /></span><span className="dock-label" aria-hidden="true">Trash</span><span className={`dock-dot${state.windows.trash ? ' on' : ''}`} aria-hidden="true"/>
        </button>
      </div>
    </nav>
  );
}
