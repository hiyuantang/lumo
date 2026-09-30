// SPDX-License-Identifier: AGPL-3.0-only
import { useId, useRef, useState, type AriaAttributes } from 'react';
import { Popup } from './Popup';
import { IconChevronDown } from './icons';

type Option = { value: string; label: string };
interface Props extends AriaAttributes {
  id?: string;
  'data-testid'?: string;
  className?: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function Select({ value, options, onChange, disabled, className = '', ...attrs }: Props) {
  const listId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(value);
  const [highlight, setHighlight] = useState(false);
  const [keyboard, setKeyboard] = useState(false);
  const filtered = options.filter((option) => option.label.toLowerCase().includes(query.toLowerCase()));
  const current = filtered.find((option) => option.value === active) ?? filtered[0];
  const searchable = options.length > 10;
  function close() { setAnchor(null); }
  function restore() { close(); trigger.current?.focus(); }
  function choose(next: string) { onChange(next); restore(); }
  function open(fromKeyboard = false) {
    setKeyboard(fromKeyboard);
    setQuery('');
    setActive(value); setHighlight(fromKeyboard);
    setAnchor(trigger.current!.getBoundingClientRect());
  }
  return <>
    <button {...attrs} ref={trigger} type="button" role="combobox" className={`custom-select ${className}`} value={value} disabled={disabled}
      aria-haspopup="listbox" aria-expanded={Boolean(anchor)} aria-controls={anchor ? listId : undefined}
      onClick={(event) => anchor ? close() : open(event.detail === 0)} onKeyDown={(event) => {
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); open(true); }
      }}>
      <span>{options.find((option) => option.value === value)?.label ?? value}</span><IconChevronDown size={16}/>
    </button>
    {anchor && !disabled && <Popup keyboard={keyboard} keepAnchorVisible anchorElement={trigger.current} x={anchor.left} y={anchor.bottom + 4} above={anchor.top - 4} width={Math.max(220, anchor.width)} onClose={close}>
      <div className="select-menu" onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); restore(); return; }
        const index = filtered.findIndex((option) => option.value === current?.value);
        let next = index;
        if (event.key === 'ArrowDown') next = Math.min(index + 1, filtered.length - 1);
        else if (event.key === 'ArrowUp') next = Math.max(index - 1, 0);
        else if (event.key === 'Home' && !searchable) next = 0;
        else if (event.key === 'End' && !searchable) next = filtered.length - 1;
        else if (event.key === 'Enter' || (event.key === ' ' && !searchable)) {
          event.preventDefault();
          if (current) choose(current.value);
          return;
        } else if (!searchable && event.key.length === 1) {
          next = filtered.findIndex((option, position) => position > index && option.label.toLowerCase().startsWith(event.key.toLowerCase()));
          if (next < 0) next = filtered.findIndex((option) => option.label.toLowerCase().startsWith(event.key.toLowerCase()));
        } else return;
        event.preventDefault();
        if (filtered[next]) {
          setActive(filtered[next].value); setHighlight(true);
          document.getElementById(`${listId}-${next}`)?.scrollIntoView({ block: 'nearest' });
        }
      }}>
        {searchable && <input data-autofocus className="input select-search" aria-label="Search options" placeholder="Search…" value={query} onChange={(event) => { setQuery(event.target.value); }} aria-controls={listId} aria-activedescendant={current ? `${listId}-${filtered.indexOf(current)}` : undefined} />}
        <div id={listId} role="listbox" aria-label={attrs['aria-label'] ?? 'Options'} className="select-options" tabIndex={searchable ? -1 : 0} data-autofocus={!searchable || undefined} aria-activedescendant={current ? `${listId}-${filtered.indexOf(current)}` : undefined}>
          {filtered.map((option, index) => <button id={`${listId}-${index}`} key={option.value} type="button" role="option" tabIndex={-1} aria-selected={option.value === value}
            className={`popup-item${highlight && current?.value === option.value ? ' highlighted' : ''}`} onPointerMove={() => { setActive(option.value); setHighlight(true); }} onClick={() => choose(option.value)}>
            <span>{option.label}</span><span aria-hidden="true" className="dropdown-menu-check">{option.value === value ? '✓' : ''}</span>
          </button>)}
          {!filtered.length && <p className="popup-empty">No matches</p>}
        </div>
      </div>
    </Popup>}
  </>;
}
