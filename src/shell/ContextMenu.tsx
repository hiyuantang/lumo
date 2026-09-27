// SPDX-License-Identifier: AGPL-3.0-only
import { copyText, readClipboard } from '../utils/clipboard';
import { createContext, useContext, useState, type MouseEvent, type ReactNode } from 'react';
import { Popup } from './Popup';
import { useShell, type ShellActions, type WindowState } from './ShellContext';
import { APPS } from '../apps/registry';
import { canSnap, COMPACT_WIDTH, type Viewport } from './windowGeometry';

export interface ContextAction {
  label: string;
  run: () => void;
  disabled?: boolean;
  danger?: boolean;
  separator?: boolean;
}
export function windowContextActions(win: WindowState, viewport: Viewport, actions: ShellActions): ContextAction[] {
  return [
    { label: 'Minimize', run: () => actions.minimizeApp(win.id) },
    { label: win.maximized ? 'Restore' : 'Maximize', disabled: viewport.w <= COMPACT_WIDTH, run: () => actions.toggleMaximize(win.id) },
    { label: 'Tile Left', disabled: !canSnap('left', viewport, APPS[win.appId].minSize), run: () => actions.snapWindow(win.id, 'left') },
    { label: 'Tile Right', disabled: !canSnap('right', viewport, APPS[win.appId].minSize), run: () => actions.snapWindow(win.id, 'right') },
    { label: 'Close Window', separator: true, run: () => actions.closeApp(win.id) },
  ];
}

type OpenMenu = (event: MouseEvent, items: ContextAction[]) => void;
const ContextMenuContext = createContext<OpenMenu>(() => {});
export const useContextMenu = () => useContext(ContextMenuContext);

export function ContextMenuProvider({ children }: { children: ReactNode }) {
  const { state, actions, resolvedTheme } = useShell();
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextAction[]; target: HTMLElement; placement?: 'above' } | null>(null);
  const open: OpenMenu = (event, items) => {
    event.preventDefault();
    event.stopPropagation();
    const target = ((event.currentTarget as HTMLElement).style.display === 'contents' ? event.target : event.currentTarget) as HTMLElement;
    const box = target.getBoundingClientRect();
    const dock = !!target.closest('.dock');
    setMenu({ x: dock ? box.left + box.width / 2 : event.clientX || box.left + 12, y: dock ? box.top - 10 : event.clientY || box.top + 12, items, target, placement: dock ? 'above' : undefined });
  };
  function close(restore = false) {
    if (restore) menu?.target.focus();
    setMenu(null);
  }
  function fallback(event: MouseEvent) {
    const target = event.target as HTMLElement;
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
    const windowId = target.closest('.window')?.getAttribute('data-testid');
    const win = Object.values(state.windows).find((item) => item && `window-${item.id}` === windowId);
    const contextActions: ContextAction[] = win ? windowContextActions(win, state.viewport, actions) : [
      { label: 'Open Files', run: () => actions.openApp('files') },
      { label: 'Open Terminal', run: () => actions.openApp('terminal') },
      { label: 'Show Desktop', disabled: !Object.values(state.windows).some((item) => item && !item.minimized), run: () => Object.values(state.windows).forEach((item) => { if (item && !item.minimized) actions.minimizeApp(item.id); }), separator: true },
      { label: resolvedTheme === 'dark' ? 'Light Theme' : 'Dark Theme', run: actions.toggleTheme },
      { label: 'Settings', run: () => actions.openApp('settings') },
    ];
    open(event, [
      ...(selected ? [{ label: 'Copy', run: () => { void copyText(selected).catch(() => actions.notify('Clipboard unavailable', 'Use the keyboard shortcut to copy.')); } }] : []),
      ...contextActions,
    ]);
  }
  return <ContextMenuContext.Provider value={open}>
    <div style={{ display: 'contents' }} onContextMenu={fallback}>{children}</div>
    {menu && <Popup x={menu.x} y={menu.y} above={menu.y - 6} placement={menu.placement} onClose={() => close()}>
      <div role="menu" aria-label="Context menu" data-testid="context-menu" onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }}>
        {menu.items.map((item) => <div key={item.label}>
          {item.separator && <div role="separator" className="popup-separator" />}
          <button type="button" role="menuitem" className={`popup-item${item.danger ? ' danger' : ''}`} disabled={item.disabled} onClick={() => { close(true); item.run(); }}>{item.label}</button>
        </div>)}
      </div>
    </Popup>}
  </ContextMenuContext.Provider>;
}
