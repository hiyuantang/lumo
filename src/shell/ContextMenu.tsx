// SPDX-License-Identifier: AGPL-3.0-only
import { copyText, readClipboard } from '../utils/clipboard';
import { createContext, useContext, useState, type MouseEvent, type ReactNode } from 'react';
import { editCommands } from './editCommands';
import { Popup } from './Popup';
import { useShell } from './ShellContext';

export interface ContextAction {
  label: string;
  run: () => void;
  disabled?: boolean;
  danger?: boolean;
  separator?: boolean;
}
type OpenMenu = (event: MouseEvent, items: ContextAction[]) => void;
const ContextMenuContext = createContext<OpenMenu>(() => {});
export const useContextMenu = () => useContext(ContextMenuContext);

export function ContextMenuProvider({ children }: { children: ReactNode }) {
  const { state, actions } = useShell();
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextAction[]; target: HTMLElement; placement?: 'above'; keyboard: boolean } | null>(null);
  const open: OpenMenu = (event, items) => {
    event.preventDefault();
    event.stopPropagation();
    if (!items.length) { setMenu(null); return; }
    const target = ((event.currentTarget as HTMLElement).style.display === 'contents' ? event.target : event.currentTarget) as HTMLElement;
    const box = target.getBoundingClientRect();
    const dock = !!target.closest('.dock');
    setMenu({ keyboard: event.clientX === 0 && event.clientY === 0, x: dock ? box.left + box.width / 2 : event.clientX || box.left + 12, y: dock ? box.top - 10 : event.clientY || box.top + 12, items, target, placement: dock ? 'above' : undefined });
  };
  function close(restore = false) {
    if (restore) menu?.target.focus();
    setMenu(null);
  }
  function fallback(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (target.closest('[data-rich-editor="true"]')) {
      open(event, editCommands(target, () => actions.notify('Clipboard unavailable', 'Use the keyboard shortcut to copy or paste.')).map((item) => ({ label: item.label, disabled: item.disabled, run: item.run ?? (() => {}), separator: item.separatorAbove })));
      return;
    }
    const input = target.closest('input, textarea') as HTMLInputElement | HTMLTextAreaElement | null;
    if (input && ['text', 'search', 'url', 'tel', 'password', 'textarea'].includes(input.type)) {
      const start = input.selectionStart ?? 0;
      const end = input.selectionEnd ?? 0;
      const selection = input.value.slice(start, end);
      const editable = !input.readOnly && !input.disabled;
      const focus = () => { input.focus(); input.setSelectionRange(start, end); };
      const error = () => actions.notify('Clipboard unavailable', 'Use the keyboard shortcut to copy or paste.');
      open(event, [
        { label: 'Cut', disabled: !editable || !selection || input.type === 'password', run: () => {
          void copyText(selection).then(() => { focus(); document.execCommand('delete'); }).catch(error);
        } },
        { label: 'Copy', disabled: !selection || input.type === 'password', run: () => { void copyText(selection).catch(error); } },
        { label: 'Paste', disabled: !editable, run: () => { void readClipboard().then((text) => { focus(); document.execCommand('insertText', false, text); }).catch(error); } },
        { label: 'Select All', run: () => { input.focus(); input.select(); } },
      ]);
      return;
    }
    if (!state.user) { event.preventDefault(); return; }
    const selected = window.getSelection()?.toString();
    if (selected && window.getSelection()?.containsNode(target, true)) {
      open(event, [{ label: 'Copy', run: () => { void copyText(selected).catch(() => actions.notify('Clipboard unavailable', 'Use the keyboard shortcut to copy.')); } }]);
      return;
    }
    if (!target.closest('a[href], [contenteditable="true"]')) event.preventDefault();
    setMenu(null);
  }
  return <ContextMenuContext.Provider value={open}>
    <div style={{ display: 'contents' }} onContextMenu={fallback}>{children}</div>
    {menu && <Popup keyboard={menu.keyboard} x={menu.x} y={menu.y} above={menu.y - 6} placement={menu.placement} onClose={() => close()}>
      <div role="menu" aria-label="Context menu" data-testid="context-menu" onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }}>
        {menu.items.map((item, index) => <div key={`${item.label}-${index}`}>
          {item.separator && <div role="separator" className="popup-separator" />}
          <button type="button" role="menuitem" className={`popup-item${item.danger ? ' danger' : ''}`} disabled={item.disabled} onClick={() => { close(true); item.run(); }}>{item.label}</button>
        </div>)}
      </div>
    </Popup>}
  </ContextMenuContext.Provider>;
}
