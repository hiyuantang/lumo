// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

export function PreviewTools({ title, children, holdOpen = false }: { title: ReactNode; children: ReactNode; holdOpen?: boolean }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const host = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const timer = useRef<number>();
  const focusFrame = useRef<number>();
  const hovered = useRef(false);
  const held = useRef(holdOpen); held.current = holdOpen;
  const wasHeld = useRef(holdOpen);
  function cancelHide() { window.clearTimeout(timer.current); timer.current = undefined; }
  function reveal() { cancelHide(); setOpen(true); }
  function hideLater() {
    cancelHide();
    timer.current = window.setTimeout(() => {
      timer.current = undefined;
      const active = document.activeElement as HTMLElement | null;
      if (hovered.current || held.current || panel.current?.querySelector('[aria-expanded="true"]') || host.current?.contains(active) && active?.matches(':focus-visible')) return;
      if (host.current?.contains(active)) active?.blur();
      cancelHide(); setOpen(false);
    }, 1000);
  }
  useEffect(() => () => { cancelHide(); if (focusFrame.current !== undefined) cancelAnimationFrame(focusFrame.current); }, []);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!host.current?.contains(event.target as Node)) hideLater(); };
    const observer = new MutationObserver(hideLater);
    if (panel.current) observer.observe(panel.current, { subtree: true, attributes: true, attributeFilter: ['aria-expanded'] });
    document.addEventListener('pointerdown', outside);
    if (holdOpen) cancelHide(); else if (wasHeld.current && !hovered.current) hideLater();
    wasHeld.current = holdOpen;
    return () => { document.removeEventListener('pointerdown', outside); observer.disconnect(); cancelHide(); };
  }, [open, holdOpen]);
  return <div ref={host} className="preview-tools" data-testid="preview-tools" data-open={open} onPointerEnter={(event) => {
    if (event.pointerType === 'touch') return;
    hovered.current = true; reveal();
  }} onPointerLeave={() => { hovered.current = false; hideLater(); }} onFocusCapture={reveal} onBlurCapture={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) hideLater();
  }} onKeyDown={(event) => {
    if (event.key === 'Escape' && open && !panel.current?.querySelector('[aria-expanded="true"]')) {
      event.preventDefault(); event.stopPropagation(); trigger.current?.focus({ preventScroll: true }); cancelHide(); setOpen(false);
    }
  }}>
    <button ref={trigger} type="button" className="preview-tools-toggle" data-testid="preview-tools-toggle" aria-label="Preview tools" title="Preview tools" aria-expanded={open} aria-controls={id} onClick={(event) => {
      reveal();
      if (event.detail === 0) focusFrame.current = requestAnimationFrame(() => {
        const element = panel.current;
        void Promise.all(element?.getAnimations().map((animation) => animation.finished.catch(() => {})) ?? []).then(() => {
          if (document.activeElement === trigger.current && host.current?.dataset.open === 'true') element?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
        });
      });
    }}><span aria-hidden="true"/></button>
    <div ref={panel} id={id} className="preview-toolbar" data-testid="preview-tools-panel" role="toolbar" aria-label="Preview tools" aria-hidden={!open} {...(!open ? { inert: '' } : {})}>
      <strong>{title}</strong><div className="app-toolbar-actions">{children}</div>
    </div>
  </div>;
}
