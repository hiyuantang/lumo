// SPDX-License-Identifier: AGPL-3.0-only
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useShell, type WindowId, type WindowState } from './ShellContext';
import { WindowThumbnail } from './WindowThumbnail';
import { windowTitle } from './WindowContext';
import { IconX } from './icons';
import { AppIcon } from './AppIcon';
import { overviewLayout } from './overviewLayout';
import { MENUBAR_H, dockSpace, type Rect } from './windowGeometry';
import '../styles/window-overview.css';

type Placement = { win: WindowState; source: Rect; origin: Rect; target: Rect };
const duration = 420;
const easing = 'cubic-bezier(.22, 1, .36, 1)';
const rectOf = (element: Element): Rect => {
  const rect = element.getBoundingClientRect();
  return { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
};
const transform = (from: Rect, to: Rect) => `translate(${from.x - to.x}px, ${from.y - to.y}px) scale(${from.w / to.w}, ${from.h / to.h})`;

export function WindowOverview({ onClose }: { onClose: () => void }) {
  const { state, actions, reducedMotion } = useShell();
  const dialog = useRef<HTMLDialogElement>(null);
  const closing = useRef(false);
  const measured = useRef('');
  const focusAfterClose = useRef<number | null>(null);
  const animations = useRef<Animation[]>([]);
  const previous = useRef(new Map<WindowId, Rect>());
  const [placements, setPlacements] = useState<Placement[]>([]);
  const windowIds = Object.values(state.windows).filter((win) => win && !win.minimized).map((win) => win!.id).join('|');
  const windowsRef = useRef(state.windows);
  windowsRef.current = state.windows;

  useLayoutEffect(() => {
    dialog.current?.showModal();
    return () => { animations.current.forEach((animation) => animation.cancel()); };
  }, []);

  useLayoutEffect(() => {
    if (closing.current) return;
    const signature = `${windowIds}:${state.viewport.w}:${state.viewport.h}`;
    if (measured.current === signature) return;
    measured.current = signature;
    const windows = Object.values(windowsRef.current).filter((win): win is WindowState => !!win && !win.minimized).sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id));
    const sources = windows.map((win) => {
      const element = document.querySelector<HTMLElement>(`[data-testid="window-${win.id}"]`);
      if (!element) return { x: win.x, y: win.y, w: win.w, h: win.h };
      const display = element.style.getPropertyValue('display');
      const priority = element.style.getPropertyPriority('display');
      element.style.setProperty('display', 'flex', 'important');
      const rect = { x: element.offsetLeft, y: element.offsetTop, w: element.offsetWidth, h: element.offsetHeight };
      if (display) element.style.setProperty('display', display, priority);
      else element.style.removeProperty('display');
      return rect;
    });
    const padding = state.viewport.w < 600 ? 16 : 24;
    const targets = overviewLayout(sources, { x: padding, y: MENUBAR_H + 16, w: state.viewport.w - padding * 2, h: Math.max(60, state.viewport.h - MENUBAR_H - 32 - dockSpace(state.viewport)) });
    setPlacements(windows.map((win, index) => ({ win, source: sources[index], origin: sources[index], target: targets[index] })));
  }, [state.viewport.w, state.viewport.h, windowIds]);

  useLayoutEffect(() => {
    if (closing.current) return;
    animations.current.forEach((animation) => animation.cancel());
    animations.current = [];
    placements.forEach(({ win, origin, target }) => {
      const button = dialog.current?.querySelector<HTMLElement>(`[data-overview-window="${win.id}"]`);
      if (!button) return;
      if (!reducedMotion) animations.current.push(button.animate([
        { transform: transform(previous.current.get(win.id) ?? origin, target) },
        { transform: 'none' },
      ], { duration, easing }));
    });
    const initial = previous.current.size === 0;
    previous.current = new Map(placements.map(({ win, target }) => [win.id, target]));
    if (focusAfterClose.current !== null) {
      const buttons = dialog.current?.querySelectorAll<HTMLButtonElement>('[data-overview-select]');
      const next = buttons?.[Math.min(focusAfterClose.current, buttons.length - 1)] ?? dialog.current?.querySelector<HTMLButtonElement>('.overview-done');
      next?.focus({ preventScroll: true });
      focusAfterClose.current = null;
    } else if (initial) dialog.current?.focus({ preventScroll: true });
  }, [placements, reducedMotion]);

  function close(selected?: WindowId) {
    if (closing.current) return;
    closing.current = true;
    dialog.current?.setAttribute('data-closing', 'true');
    const pending: Promise<unknown>[] = [];
    placements.forEach(({ win, source, target }) => {
      const button = dialog.current?.querySelector<HTMLElement>(`[data-overview-window="${win.id}"]`);
      if (!button || reducedMotion) return;
      const current = rectOf(button);
      button.style.zIndex = String(win.id === selected ? 10000 : win.z);
      const animation = button.animate([
        { transform: transform(current, target) },
        { transform: transform(source, target) },
      ], { duration, easing, fill: 'forwards' });
      animations.current.push(animation);
      pending.push(animation.finished.catch(() => {}));
    });
    if (selected) actions.focusApp(selected);
    const finish = () => {
      onClose();
      if (selected) requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-testid="window-${selected}"]`)?.focus({ preventScroll: true }));
    };
    if (!pending.length) finish();
    else void Promise.all(pending).then(finish);
  }

  function keyboard(event: KeyboardEvent) {
    if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const buttons = [...dialog.current!.querySelectorAll<HTMLButtonElement>('[data-overview-select]')];
    const active = document.activeElement?.closest('[data-overview-window]')?.querySelector<HTMLButtonElement>('[data-overview-select]');
    const index = active ? buttons.indexOf(active) : -1;
    event.preventDefault();
    if (event.key === 'Home' || event.key === 'End') { buttons[event.key === 'Home' ? 0 : buttons.length - 1]?.focus(); return; }
    if (index < 0) { buttons[0]?.focus(); return; }
    const origin = placements[index].target;
    const vertical = event.key === 'ArrowDown' || event.key === 'ArrowUp';
    const direction = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1;
    const nearest = placements.map(({ target }, candidate) => {
      const dx = target.x + target.w / 2 - origin.x - origin.w / 2;
      const dy = target.y + target.h / 2 - origin.y - origin.h / 2;
      const along = vertical ? dy : dx;
      const across = vertical ? dx : dy;
      return { candidate, score: along * direction > 1 ? Math.abs(along) + Math.abs(across) * 2 : Infinity };
    }).sort((a, b) => a.score - b.score)[0];
    if (nearest && Number.isFinite(nearest.score)) buttons[nearest.candidate]?.focus();
  }

  return <dialog ref={dialog} className="window-overview" data-testid="window-overview" aria-labelledby="overview-title" onCancel={(event) => { event.preventDefault(); close(); }} onKeyDown={keyboard} onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
    <h1 id="overview-title" className="overview-title">Overview</h1>
    {!windowIds && <button type="button" className="btn overview-done" onClick={() => close()} aria-label="Close overview">Done</button>}
    {!windowIds && <p className="overview-empty">Your desktop windows will appear here.</p>}
    {placements.map(({ win, target }, index) => <div key={win.id} className="overview-window" role="group" style={{ left: target.x, top: target.y, width: target.w, height: target.h, zIndex: win.z }} data-overview-window={win.id} data-testid={`overview-window-${win.id}`} aria-label={windowTitle(win)}>
      <button type="button" className="overview-select" data-overview-select={win.id} aria-label={`Show ${windowTitle(win)}`} onClick={() => close(win.id)}>
        <span className="overview-preview"><WindowThumbnail win={win} overview/></span>
        <span className="overview-caption"><span className="overview-icon"><AppIcon appId={win.appId}/></span><strong>{windowTitle(win)}</strong></span>
      </button>
      <button type="button" className="overview-close" data-testid={`overview-close-${win.id}`} aria-label={`Close ${windowTitle(win)}`} title={`Close ${windowTitle(win)}`} onClick={() => {
        if (closing.current) return;
        focusAfterClose.current = index;
        if (!actions.closeApp(win.id)) { focusAfterClose.current = null; close(win.id); }
      }}><IconX size={14}/></button>
    </div>)}
  </dialog>;
}
