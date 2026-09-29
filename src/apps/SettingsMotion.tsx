// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useMenuInput } from '../shell/useMenuInput';
import type { MotionPref } from '../shell/ShellContext';

const OPTIONS: { value: MotionPref; label: string }[] = [
  { value: 'system', label: 'Follow device' },
  { value: 'full', label: 'Full motion' },
  { value: 'reduced', label: 'Reduced motion' },
];

export function SettingsMotion({ value, onChange, active }: { value: MotionPref; onChange: (value: MotionPref) => void; active: boolean }) {
  const input = useMenuInput();
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef({ left: 0, top: 0 });
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const [showHighlight, setShowHighlight] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 0, maxHeight: 0 });
  const selected = OPTIONS.findIndex((option) => option.value === value);
  const expanded = open && active;

  useEffect(() => { if (!active) setOpen(false); }, [active]);

  useLayoutEffect(() => {
    if (!expanded || !triggerRef.current || !menuRef.current) return;
    const anchor = triggerRef.current.getBoundingClientRect();
    anchorRef.current = { left: anchor.left, top: anchor.top };
    const width = Math.min(Math.max(anchor.width, 188), window.innerWidth - 16);
    menuRef.current.style.width = `${width}px`;
    const bounds = triggerRef.current.closest('.window-body')?.getBoundingClientRect();
    const topEdge = Math.max(8, bounds?.top ?? 8);
    const bottomEdge = Math.min(window.innerHeight - 8, bounds?.bottom ?? window.innerHeight - 8);
    const below = Math.max(0, bottomEdge - anchor.bottom - 6);
    const above = Math.max(0, anchor.top - topEdge - 6);
    const height = menuRef.current.scrollHeight + 2;
    const opensAbove = below < height && above > below;
    const maxHeight = opensAbove ? above : below;
    setPosition({
      left: Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8)),
      top: opensAbove ? anchor.top - Math.min(height, maxHeight) - 6 : anchor.bottom + 6,
      width,
      maxHeight,
    });
  }, [expanded]);

  useEffect(() => {
    if (!expanded) return;
    const dismiss = (event: Event) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      if (event.type === 'scroll') {
        const anchor = triggerRef.current?.getBoundingClientRect();
        if (anchor?.left === anchorRef.current.left && anchor.top === anchorRef.current.top) return;
      }
      setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener('pointerdown', dismiss, true);
    document.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', dismiss, true);
      document.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('resize', close);
    };
  }, [expanded]);

  useEffect(() => {
    const menu = menuRef.current;
    const option = menu?.children[highlighted] as HTMLElement | undefined;
    if (!expanded || !menu || !option) return;
    if (option.offsetTop < menu.scrollTop) menu.scrollTop = option.offsetTop;
    else if (option.offsetTop + option.offsetHeight > menu.scrollTop + menu.clientHeight) menu.scrollTop = option.offsetTop + option.offsetHeight - menu.clientHeight;
  }, [expanded, highlighted, position.maxHeight]);

  function choose(index: number) {
    onChange(OPTIONS[index].value);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function show(index = selected, keyboard = false) {
    setShowHighlight(keyboard);
    setHighlighted(index);
    setOpen(true);
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    setShowHighlight(true);
    if (event.key === 'Tab') {
      setOpen(false);
      return;
    }
    if (event.key === 'Escape' && expanded) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (expanded) choose(highlighted); else show(selected, true);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (expanded) setHighlighted((index) => (index + (event.key === 'ArrowDown' ? 1 : -1) + OPTIONS.length) % OPTIONS.length);
      else show(selected, true);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      show(event.key === 'Home' ? 0 : OPTIONS.length - 1, true);
    } else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const index = OPTIONS.findIndex((option, index) => index > highlighted && option.label.toLowerCase().startsWith(event.key.toLowerCase()));
      const match = index >= 0 ? index : OPTIONS.findIndex((option) => option.label.toLowerCase().startsWith(event.key.toLowerCase()));
      if (match >= 0) {
        event.preventDefault();
        show(match, true);
      }
    }
  }

  return <>
    <button {...input} ref={triggerRef} type="button" role="combobox" className="settings-select" aria-label="Window animations" aria-haspopup="listbox" aria-expanded={expanded} aria-controls={expanded ? id : undefined} aria-activedescendant={expanded ? `${id}-${highlighted}` : undefined} data-testid="settings-motion" onClick={() => { if (expanded) setOpen(false); else show(); }} onKeyDown={onKeyDown} onBlur={() => setOpen(false)}>
      <span>{OPTIONS[selected].label}</span><svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3 4.5 3 3 3-3" /></svg>
    </button>
    {expanded ? createPortal(<div {...input} id={id} ref={menuRef} role="listbox" aria-label="Window animations" className="settings-select-menu menu-surface" data-testid="settings-motion-menu" style={{ ...position, visibility: position.width ? 'visible' : 'hidden' }} onPointerDown={(event) => event.preventDefault()}>
      {OPTIONS.map((option, index) => <div id={`${id}-${index}`} key={option.value} role="option" aria-selected={value === option.value} className={`popup-item settings-select-option${showHighlight && highlighted === index ? ' highlighted' : ''}`} data-testid={`settings-motion-${option.value}`} onPointerMove={() => { setHighlighted(index); setShowHighlight(true); }} onClick={() => choose(index)}>
        <span className="settings-select-check" aria-hidden="true">{value === option.value ? <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m3 8 3 3 7-7" /></svg> : null}</span>{option.label}
      </div>)}
    </div>, document.body) : null}
  </>;
}
