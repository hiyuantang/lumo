// SPDX-License-Identifier: AGPL-3.0-only
import { useId, useRef, useState, type ReactNode } from 'react';
import { Popup } from './Popup';
import { IconChevronDown } from './icons';
import type { ContextAction } from './ContextMenu';

export function DropdownMenu({ label, testId, items, className = '', ariaLabel, disabled, icon }: { icon?: ReactNode; label: string; testId: string; items: (ContextAction & { checked?: boolean; testId?: string })[]; className?: string; ariaLabel?: string; disabled?: boolean }) {
  const menuId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [last, setLast] = useState(false);
  const [keyboard, setKeyboard] = useState(false);
  function close(restore = false) {
    setAnchor(null);
    if (restore) trigger.current?.focus();
  }
  function open(fromEnd = false, fromKeyboard = false) {
    setKeyboard(fromKeyboard);
    setLast(fromEnd);
    setAnchor(trigger.current!.getBoundingClientRect());
  }
  const hasChecks = items.some((item) => item.checked !== undefined);
  const enabled = items.filter((item) => !item.disabled);
  const initial = last ? enabled.at(-1) : enabled[0];
  return <>
    <button ref={trigger} type="button" className={`btn ${className}`} disabled={disabled} aria-label={ariaLabel} data-testid={testId} aria-haspopup="menu" aria-expanded={Boolean(anchor)} aria-controls={anchor ? menuId : undefined} onClick={(event) => anchor ? close() : open(false, event.detail === 0)} onKeyDown={(event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); open(event.key === 'ArrowUp', true); }
    }}>{icon ?? <><span>{label}</span><IconChevronDown size={14} strokeWidth={2} /></>}</button>
    {anchor && <Popup keyboard={keyboard} x={anchor.left} y={anchor.bottom + 4} above={anchor.top - 4} width={220} anchorElement={trigger.current} keepAnchorVisible onClose={() => close()}>
      <div id={menuId} role="menu" aria-label={ariaLabel ?? label} data-testid={`${testId}-menu`} onKeyDown={(event) => {
        if (event.key === 'Escape' || event.key === 'Tab') { event.stopPropagation(); if (event.key === 'Escape') event.preventDefault(); close(true); return; }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }}>
        {items.map((item, index) => <div key={`${item.label}-${index}`}>
          {item.separator && <div className="popup-separator" role="separator" />}
          <button type="button" data-testid={item.testId} role={item.checked === undefined ? "menuitem" : "menuitemradio"} aria-checked={item.checked} className={`popup-item dropdown-menu-item${item.danger ? ' danger' : ''}`} data-autofocus={item === initial || undefined} disabled={item.disabled} onClick={() => { close(true); item.run(); }}>{hasChecks && <span aria-hidden="true" className="dropdown-menu-check">{item.checked ? '✓' : ''}</span>}<span>{item.label}</span></button>
        </div>)}
      </div>
    </Popup>}
  </>;
}
