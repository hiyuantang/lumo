// SPDX-License-Identifier: AGPL-3.0-only
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import '../styles/popup.css';

export function Popup({ x, y, width, above, placement, anchorElement, keepAnchorVisible, onClose, children }: {
  x: number; y: number; width?: number; above?: number; placement?: 'above'; anchorElement?: HTMLElement | null; keepAnchorVisible?: boolean; onClose: () => void; children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useLayoutEffect(() => {
    const node = ref.current!;
    let bounds = node.getBoundingClientRect();
    let top = placement === 'above' ? y - bounds.height : y + bounds.height > window.innerHeight - 8 && above !== undefined ? above - bounds.height : y;
    if (keepAnchorVisible && above !== undefined) {
      const belowSpace = Math.max(0, window.innerHeight - y - 8);
      const aboveSpace = Math.max(0, above - 8);
      const opensAbove = bounds.height > belowSpace && aboveSpace > belowSpace;
      node.style.maxHeight = `${opensAbove ? aboveSpace : belowSpace}px`;
      bounds = node.getBoundingClientRect();
      top = opensAbove ? above - bounds.height : y;
    }
    node.style.left = `${Math.max(8, Math.min(placement === 'above' ? x - bounds.width / 2 : x, window.innerWidth - bounds.width - 8))}px`;
    node.style.top = `${Math.max(8, Math.min(top, window.innerHeight - bounds.height - 8))}px`;
    node.querySelector<HTMLElement>('[data-autofocus]')?.focus({ preventScroll: true });
    if (!node.contains(document.activeElement)) node.querySelector<HTMLElement>('button:not(:disabled)')?.focus({ preventScroll: true });
    node.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
    const outside = (event: PointerEvent) => { if (!node.contains(event.target as Node) && !anchorElement?.contains(event.target as Node)) closeRef.current(); };
    const dismiss = () => closeRef.current();
    window.addEventListener('pointerdown', outside, true);
    const scroll = (event: WheelEvent) => { if (!node.contains(event.target as Node)) dismiss(); };
    window.addEventListener('wheel', scroll, { capture: true, passive: true });
    window.addEventListener('resize', dismiss);
    window.addEventListener('blur', dismiss);
    return () => {
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('wheel', scroll, true);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('blur', dismiss);
    };
  }, [x, y, above, placement, anchorElement, keepAnchorVisible]);
  return createPortal(<div ref={ref} className="shell-popup" style={{ left: x, top: y, width, maxHeight: placement === 'above' ? Math.max(48, y - 8) : undefined }} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); }} onKeyDown={(event) => {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); onClose(); }
    if (event.key === 'Tab') onClose();
  }}>{children}</div>, document.body);
}
