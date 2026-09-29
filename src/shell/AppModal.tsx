// SPDX-License-Identifier: AGPL-3.0-only
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import '../styles/app-modal.css';

export function AppModal({ children, onCancel }: { children: ReactNode; onCancel: () => void }) {
  const marker = useRef<HTMLSpanElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => { previousFocus.current = document.activeElement as HTMLElement | null; setHost(marker.current?.closest<HTMLElement>('.window') ?? null); }, []);
  useLayoutEffect(() => {
    if (!host || !overlay.current) return;
    const previous = previousFocus.current;
    const siblings = [...host.children].filter((node): node is HTMLElement => node instanceof HTMLElement && node !== overlay.current && (node.classList.contains('window-body') || node.classList.contains('app-modal-overlay')));
    const states = siblings.map((node) => node.inert);
    siblings.forEach((node) => { node.inert = true; });
    (overlay.current.querySelector<HTMLElement>('[autofocus], input:not(:disabled)') ?? overlay.current.querySelector<HTMLElement>('button:not(:disabled), [tabindex="0"]'))?.focus();
    return () => {
      siblings.forEach((node, index) => { node.inert = states[index]; });
      if (previous?.isConnected && !previous.closest('[inert]')) previous.focus({ preventScroll: true });
    };
  }, [host]);
  return <><span ref={marker} hidden/>{host && createPortal(<div ref={overlay} className="app-modal-overlay" data-testid="app-modal-overlay" onPointerDown={(event) => { event.stopPropagation(); if (event.target === event.currentTarget) onCancel(); }} onKeyDown={(event) => {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); onCancel(); }
    if (event.key !== 'Tab') return;
    const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]')].filter((node) => node.getClientRects().length > 0);
    const first = controls[0]; const last = controls.at(-1);
    if (!first) event.preventDefault();
    else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }}>{children}</div>, host)}</>;
}
