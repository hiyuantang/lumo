// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { Pi, type PiAssistantRequest } from '../apps/Pi';
import { WindowContext } from './WindowContext';
import { useShell, type WindowState } from './ShellContext';
import { dockSpace, MENUBAR_H, clampRect } from './windowGeometry';
import { IconX } from './icons';
import '../styles/pi-assistant.css';

export function PiAssistant({ open, onOpen, onHide, request }: { open: boolean; onOpen: () => void; onHide: () => void; request?: PiAssistantRequest }) {
  const { state } = useShell();
  const [position, setPosition] = useState<{ x: number; bottom: number } | null>(null);
  const [height, setHeight] = useState(0);
  const host = useRef<HTMLElement>(null);
  const attention = useRef(onOpen); attention.current = onOpen;
  const onAttention = useCallback(() => attention.current(), []);
  const w = Math.min(420, state.viewport.w - 24);
  const maxHeight = Math.min(470, state.viewport.h - MENUBAR_H - dockSpace(state.viewport) - 24);
  const h = Math.min(height, maxHeight);
  const bottom = position?.bottom ?? state.viewport.h - dockSpace(state.viewport) - 12;
  const rect = clampRect({ x: position?.x ?? state.viewport.w - w - 20, y: bottom - h, w, h }, state.viewport);
  const win: WindowState = { ...rect, id: 'pi:assistant', appId: 'pi', z: 3900, minimized: false, maximized: false, snapped: null, restore: null };
  useLayoutEffect(() => {
    const node = host.current;
    if (!node || !open) return;
    const measure = () => { const next = Math.ceil(node.getBoundingClientRect().height); if (next > 0) setHeight(next); };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    if (open) (host.current?.querySelector<HTMLElement>('textarea:not(:disabled)') ?? host.current)?.focus({ preventScroll: true });
    return () => observer.disconnect();
  }, [open]);
  useLayoutEffect(() => { if (open && request?.action === 'new') host.current?.focus({ preventScroll: true }); }, [open, request]);
  function hide() { onHide(); document.querySelector<HTMLButtonElement>('[data-testid="pi-tray-button"]')?.focus(); }
  function startDrag(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0 || !event.isPrimary || (event.target as HTMLElement).closest('button')) return;
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.dataset.dragX = String(event.clientX - rect.x);
    event.currentTarget.dataset.dragBottom = String(rect.y + rect.h - event.clientY);
  }
  return <section ref={host} id="pi-assistant" className="window focused pi-assistant" data-testid="pi-assistant" data-app-id="pi" role="dialog" aria-label="Pi assistant" tabIndex={-1} hidden={!open} style={{ left: rect.x, bottom: state.viewport.h - rect.y - rect.h, width: rect.w, maxHeight, '--pi-assistant-max-height': `${maxHeight}px`, '--pi-assistant-picker-left': `${rect.x}px`, '--pi-assistant-picker-top': `${Math.max(MENUBAR_H, rect.y + rect.h - maxHeight)}px` } as CSSProperties} onKeyDown={(event) => { if (event.key === 'Escape' && !(event.target as HTMLElement).closest('.pi-question')) { event.stopPropagation(); hide(); } }} onPointerDown={(event) => { if ((event.target as HTMLElement).closest('.pi-assistant-drag-handle')) startDrag(event); }} onPointerMove={(event) => { const node = event.currentTarget; if (node.hasPointerCapture(event.pointerId)) setPosition({ x: event.clientX - Number(node.dataset.dragX), bottom: event.clientY + Number(node.dataset.dragBottom) }); }} onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}>
    <div className="pi-assistant-close-region" data-testid="pi-assistant-close-region"><button className="pi-assistant-close" data-testid="pi-assistant-close" type="button" aria-label="Hide Pi assistant" title="Hide" onClick={hide}><IconX size={16} strokeWidth={2}/></button></div>
    <div className="window-body"><WindowContext.Provider value={win}><Pi compact onAttention={onAttention} assistantRequest={request}/></WindowContext.Provider></div>
  </section>;
}
