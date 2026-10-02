// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { APP_COMPONENTS } from '../apps';
import { WindowContext, windowTitle } from './WindowContext';
import { DesktopAppWindow } from '../platform/DesktopAppWindow';
import { APPS, type BuiltinAppId } from '../apps/registry';
import { IconMinus, IconX, IconZoom } from './icons';
import { useShell, type WindowState } from './ShellContext';
import { useWindowPlacement } from './useWindowPlacement';
import { useWindowMinimize } from './useWindowMinimize';
import { reachableRect, COMPACT_WIDTH, resizeRect, snapRect, snapTargetAt, type ResizeDirection, type SnapTarget } from './windowGeometry';
import '../styles/window.css';

const RESIZE_DIRS = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const;
const SNAP_LABELS: Record<SnapTarget, string> = { left: 'Tile left', right: 'Tile right', maximize: 'Maximize' };

export function Window({ win }: { win: WindowState }) {
  const { state, actions, reducedMotion } = useShell();
  const meta = APPS[win.appId];
  const Body = win.appId.startsWith('app:') ? DesktopAppWindow : APP_COMPONENTS[win.appId as BuiltinAppId];
  const focused = state.focused === win.id;
  const minimize = useWindowMinimize(win, state.viewport, reducedMotion);
  const [interacting, setInteracting] = useState<'drag' | 'resize' | null>(null);
  useWindowPlacement(minimize.ref, win, interacting !== null, reducedMotion);
  const [snapTarget, setSnapTarget] = useState<SnapTarget | null>(null);
  const gestureCleanup = useRef<(() => void) | null>(null);

  useEffect(() => () => {
    gestureCleanup.current?.();
  }, []);

  function trackPointer(e: ReactPointerEvent<HTMLElement>, handlers: {
    move: (event: PointerEvent) => void;
    finish?: () => void;
    cancel: () => void;
  }) {
    gestureCleanup.current?.();
    e.preventDefault();
    const el = e.currentTarget;
    const pointerId = e.pointerId;
    let frame: number | null = null;
    let pending: PointerEvent | null = null;
    const flush = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      if (!pending) return;
      const event = pending;
      pending = null;
      handlers.move(event);
    };
    const move = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      pending = event;
      if (frame === null) frame = requestAnimationFrame(flush);
    };
    const cleanup = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', pointerCancel);
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('resize', cancel);
      el.removeEventListener('lostpointercapture', pointerCancel);
      gestureCleanup.current = null;
      if (el.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId);
    };
    const cancel = () => {
      cleanup();
      setInteracting(null);
      setSnapTarget(null);
      handlers.cancel();
    };
    const pointerCancel = (event: PointerEvent) => {
      if (event.pointerId === pointerId) cancel();
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      cancel();
    };
    const up = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      pending = event;
      flush();
      cleanup();
      setInteracting(null);
      setSnapTarget(null);
      handlers.finish?.();
    };
    gestureCleanup.current = cleanup;
    el.setPointerCapture(pointerId);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', pointerCancel);
    window.addEventListener('keydown', keydown);
    window.addEventListener('blur', cancel);
    window.addEventListener('resize', cancel);
    el.addEventListener('lostpointercapture', pointerCancel);
  }

  function onTitlePointerDown(e: ReactPointerEvent<HTMLElement>) {
    if (e.button !== 0 || !e.isPrimary || state.viewport.w <= COMPACT_WIDTH) return;
    if ((e.target as HTMLElement).closest('.window-controls')) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const placed = win.maximized || Boolean(win.snapped);
    const floating = reachableRect(placed ? (win.restore ?? { ...win, ...meta.defaultSize }) : win, state.viewport);
    const offsetX = placed ? ((startX - win.x) / win.w) * floating.w : startX - win.x;
    const offsetY = Math.min(startY - win.y, e.currentTarget.clientHeight - 1);
    let moved = false;
    let target: SnapTarget | null = null;
    trackPointer(e, {
      move: (event) => {
        if (!moved && Math.hypot(event.clientX - startX, event.clientY - startY) < 6) return;
        if (!moved) {
          moved = true;
          setInteracting('drag');
        }
        actions.updateRect(win.id, { ...floating, x: event.clientX - offsetX, y: event.clientY - offsetY });
        target = snapTargetAt(event.clientX, event.clientY, state.viewport, meta.minSize);
        setSnapTarget(target);
      },
      finish: () => {
        if (moved && target) actions.snapWindow(win.id, target, floating);
      },
      cancel: () => {
        if (moved) actions.cancelWindowGesture(win.id, win);
      },
    });
  }

  function onResizePointerDown(e: ReactPointerEvent<HTMLDivElement>, direction: ResizeDirection) {
    if (e.button !== 0 || !e.isPrimary || win.maximized || state.viewport.w <= COMPACT_WIDTH) return;
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;
    trackPointer(e, {
      move: (event) => {
        const dx = event.clientX - startX;
        const dy = event.clientY - startY;
        if (!moved && Math.hypot(dx, dy) < 2) return;
        if (!moved) {
          moved = true;
          setInteracting('resize');
        }
        actions.updateRect(win.id, resizeRect(win, direction, dx, dy, meta.minSize, state.viewport));
      },
      cancel: () => {
        if (moved) actions.cancelWindowGesture(win.id, win);
      },
    });
  }

  const Icon = meta.icon;
  const preview = snapTarget ? snapRect(snapTarget, state.viewport) : null;
  const className = [
    'window',
    focused ? 'focused' : '',
    win.maximized ? 'maximized' : '',
    win.snapped ? 'snapped' : '',
    interacting === 'drag' ? 'dragging' : '',
    minimize.phase,
    minimize.hasMinimized ? 'has-minimized' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <>
      {snapTarget && preview && (
        <div
          className="window-snap-preview"
          data-testid="window-snap-preview"
          data-snap-target={snapTarget}
          aria-hidden="true"
          style={{ left: preview.x, top: preview.y, width: preview.w, height: preview.h, zIndex: win.z }}
        >
          <span>{SNAP_LABELS[snapTarget]}</span>
        </div>
      )}
      <section
        ref={minimize.ref}
        className={className}
        role="dialog"
        tabIndex={-1}
        aria-label={windowTitle(win)}
        data-testid={`window-${win.id}`} data-window-id={win.id} data-app-id={win.appId}
        data-window-placement={win.maximized ? 'maximized' : (win.snapped ?? 'floating')}
        data-window-visibility={minimize.phase}
        hidden={minimize.hidden}
        style={{ left: win.x, top: win.y, width: win.w, height: win.h, zIndex: win.z }}
        onFocusCapture={minimize.rememberFocus}
        onPointerDownCapture={() => {
          if (!focused) actions.focusApp(win.id);
        }}
      >
        <header
          className="window-titlebar"
          data-testid={`window-titlebar-${win.id}`}
          onPointerDown={onTitlePointerDown}
          onDoubleClick={(e) => {
            if (state.viewport.w > COMPACT_WIDTH && !(e.target as HTMLElement).closest('.window-controls')) actions.toggleMaximize(win.id);
          }}
        >
          <div className="window-controls">
            <button
              type="button"
              className="wc wc-close"
              data-testid={`window-close-${win.id}`}
              aria-label={`Close ${meta.title}`}
              title="Close"
              onClick={() => actions.closeApp(win.id)}
            >
              <IconX size={10} />
            </button>
            <button type="button" className="wc wc-min" data-testid={`window-minimize-${win.id}`} aria-label={`Minimize ${meta.title}`} title="Minimize to Dock" onClick={() => actions.minimizeApp(win.id)}>
              <IconMinus size={10} />
            </button>
            <button
              type="button"
              className="wc wc-zoom"
              data-testid={`window-maximize-${win.id}`}
              aria-label={win.maximized ? `Restore ${meta.title}` : `Maximize ${meta.title}`}
              title={win.maximized ? 'Restore' : 'Maximize'}
              disabled={state.viewport.w <= COMPACT_WIDTH}
              onClick={() => actions.toggleMaximize(win.id)}
            >
              <IconZoom size={10} />
            </button>
          </div>
          <span className="window-title">
            <Icon size={13} />
            {windowTitle(win)}
          </span>
        </header>
        <div className="window-body">
          <WindowContext.Provider value={win}><Body /></WindowContext.Provider>
        </div>
        {!win.maximized &&
          RESIZE_DIRS.map((dir) => (
            <div key={dir} className={`resize-handle rh-${dir}`} data-testid={`window-resize-${win.id}-${dir}`} aria-hidden="true" onPointerDown={(e) => onResizePointerDown(e, dir)} />
          ))}
      </section>
    </>
  );
}
