// SPDX-License-Identifier: AGPL-3.0-only
import { useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import { useShell } from './ShellContext';
import { dockSpace, MENUBAR_H, clampRect, type Rect } from './windowGeometry';
import { IconX } from './icons';
import '../styles/pi-assistant.css';

export function PiAssistantFrame({ open, onHide, children, id = 'pi-assistant', testId = 'pi-assistant', label = 'Pi assistant', closeLabel = 'Hide Pi assistant', focusKey }: {
  open: boolean; onHide: () => void; children: ReactNode | ((rect: Rect) => ReactNode); id?: string; testId?: string; label?: string; closeLabel?: string; focusKey?: string;
}) {
  const { state } = useShell();
  const [position, setPosition] = useState<{ x: number; bottom: number } | null>(null);
  const [height, setHeight] = useState(0);
  const host = useRef<HTMLElement>(null);
  const w = Math.min(420, state.viewport.w - 24);
  const maxHeight = Math.min(470, state.viewport.h - MENUBAR_H - dockSpace(state.viewport) - 24);
  const h = Math.min(height, maxHeight);
  const bottom = position?.bottom ?? state.viewport.h - dockSpace(state.viewport) - 12;
  const rect = clampRect({ x: position?.x ?? state.viewport.w - w - 20, y: bottom - h, w, h }, state.viewport);
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
  useLayoutEffect(() => { if (open && focusKey) host.current?.focus({ preventScroll: true }); }, [open, focusKey]);
  function hide() { onHide(); }
  function startDrag(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0 || !event.isPrimary || (event.target as HTMLElement).closest('button')) return;
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.dataset.dragX = String(event.clientX - rect.x);
    event.currentTarget.dataset.dragBottom = String(rect.y + rect.h - event.clientY);
  }
  return <section ref={host} id={id} className="window focused pi-assistant" data-testid={testId} data-app-id="pi" role="dialog" aria-label={label} tabIndex={-1} hidden={!open} style={{ left: rect.x, bottom: state.viewport.h - rect.y - rect.h, width: rect.w, maxHeight, '--pi-assistant-max-height': `${maxHeight}px`, '--pi-assistant-picker-left': `${rect.x}px`, '--pi-assistant-picker-top': `${Math.max(MENUBAR_H, rect.y + rect.h - maxHeight)}px` } as CSSProperties} onKeyDown={(event) => { if (event.key === 'Escape' && !(event.target as HTMLElement).closest('.pi-question')) { event.stopPropagation(); hide(); } }} onPointerDown={(event) => { if ((event.target as HTMLElement).closest('.pi-assistant-drag-handle')) startDrag(event); }} onPointerMove={(event) => { const node = event.currentTarget; if (node.hasPointerCapture(event.pointerId)) setPosition({ x: event.clientX - Number(node.dataset.dragX), bottom: event.clientY + Number(node.dataset.dragBottom) }); }} onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}>
    <div className="pi-assistant-close-region" data-testid="pi-assistant-close-region"><button className="pi-assistant-close" data-testid="pi-assistant-close" type="button" aria-label={closeLabel} title={closeLabel} onClick={hide}><IconX size={16} strokeWidth={2}/></button></div>
    <div className="window-body">{typeof children === 'function' ? children(rect) : children}</div>
  </section>;
}
