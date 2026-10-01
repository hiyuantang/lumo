// SPDX-License-Identifier: AGPL-3.0-only
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useWindowMenus, type AppCommand } from './appMenus';
import { editCommands } from './editCommands';
import { windowTitle } from './WindowContext';
import { APPS } from '../apps/registry';
import { useServerClock } from './ServerClockContext';
import { timezoneLabel } from '../utils/timezone';
import { useShell } from './ShellContext';
import { canSnap, COMPACT_WIDTH, MENUBAR_H } from './windowGeometry';
import '../styles/menubar.css';
import { IconPi } from './icons';
import { DropdownMenu } from './DropdownMenu';
import { useMenuInput } from './useMenuInput';

type MenuId = 'app' | 'file' | 'edit' | 'view' | 'window';
const order: MenuId[] = ['app', 'file', 'edit', 'view', 'window'];

export function MenuBar({ piOpen, onTogglePi, onNewPi, onPiWorkspace }: { piOpen: boolean; onTogglePi: () => void; onNewPi: () => void; onPiWorkspace: () => void }) {
  const input = useMenuInput();
  const { state, actions } = useShell();
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null);
  const { instant, timezone } = useServerClock();
  const barRef = useRef<HTMLElement>(null);

  const focusedWindow = state.focused ? state.windows[state.focused] : null;

  const registered = useWindowMenus(state.focused ?? 'files');
  const custom = state.focused ? registered : Object.fromEntries(Object.entries(registered).map(([category, items]) => [category, items.map((item: AppCommand) => ({ ...item, run: () => { actions.openApp('files'); item.run(); } }))])) as typeof registered;
  const appName = focusedWindow ? APPS[focusedWindow.appId].title : 'Files';
  const editTarget = useRef<HTMLElement | null>(null);
  const [editing, setEditing] = useState<AppCommand[]>(() => editCommands(null, () => {}));
  const dropdownRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const remember = (event: FocusEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('.menubar')) editTarget.current = target.closest('.window') ? target : null;
    };
    document.addEventListener('focusin', remember);
    return () => document.removeEventListener('focusin', remember);
  }, []);
  useEffect(() => { setOpenMenu(null); editTarget.current = null; }, [state.focused]);
  useEffect(() => {
    const dismiss = () => setOpenMenu(null);
    window.addEventListener('blur', dismiss);
    window.addEventListener('resize', dismiss);
    return () => { window.removeEventListener('blur', dismiss); window.removeEventListener('resize', dismiss); };
  }, []);
  useEffect(() => {
    if (!openMenu) return;
    const outside = (event: Event) => {
      const menus = barRef.current?.querySelector('.menubar-menus');
      if (!menus?.contains(event.target as Node)) setOpenMenu(null);
    };
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('focusin', outside, true);
    window.addEventListener('wheel', outside, { capture: true, passive: true });
    return () => {
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('focusin', outside, true);
      window.removeEventListener('wheel', outside, true);
    };
  }, [openMenu]);
  useLayoutEffect(() => {
    const node = dropdownRef.current;
    if (!node) return;
    node.style.translate = '';
    const box = node.getBoundingClientRect();
    node.style.translate = `${Math.min(0, window.innerWidth - box.right - 8)}px 0`;
  }, [openMenu, appName]);
  function open(menu: MenuId | null) {
    const selection = window.getSelection();
    const selectedNode = selection?.toString() ? selection.anchorNode?.parentElement : null;
    const field = editTarget.current;
    const target = field?.isConnected && (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field.isContentEditable) ? field : selectedNode?.closest('.window') ? selectedNode : field;
    const windowNode = target?.closest<HTMLElement>('.window');
    const valid = !!target?.isConnected && windowNode?.dataset.testid === `window-${state.focused}`;
    setEditing(editCommands(valid ? target : null, () => actions.notify('Edit command unavailable', 'Use the keyboard shortcut to complete this action.')));
    setOpenMenu(menu);
  }
  const combine = (base: AppCommand[], extra: AppCommand[] = []) => [...base.map((item) => extra.find((command) => command.id === item.id) ?? item), ...extra.filter((item) => !base.some((command) => command.id === item.id))];
  const disabled = (id: string, label: string): AppCommand => ({ id, label, disabled: true, run: () => {} });
  const menus: Record<MenuId, { label: string; items: AppCommand[] }> = {
    app: { label: appName, items: [
      ...(custom.app ?? []),
      { id: 'settings', label: 'System Settings…', separatorAbove: !!custom.app?.length, run: () => actions.openApp('settings') },
      { id: 'command-center', label: 'Command Center', hint: '⌘K', run: () => actions.setPalette(true) },
      { id: 'shortcuts', label: 'Keyboard Shortcuts', run: () => actions.setShortcutsOpen(true) },
      { id: 'quit', label: `Quit ${appName}`, separatorAbove: true, disabled: !focusedWindow && !state.windows.files, run: () => actions.quitApp(focusedWindow?.appId ?? 'files') },
    ] },
    file: { label: 'File', items: [
      ...combine([
        { id: 'new-window', label: 'New Window', disabled: !focusedWindow || !['preview', 'pi'].includes(focusedWindow.appId), run: () => focusedWindow?.appId === 'preview' ? actions.newPreviewWindow() : actions.newPiWindow() },
        disabled('new-file', 'New File'), disabled('new-folder', 'New Folder'),
        { ...(!focusedWindow ? { id: 'open', label: 'Open Files', run: () => actions.openApp('files') } : disabled('open', 'Open File…')), separatorAbove: true },
        disabled('upload', 'Upload File…'), disabled('download', 'Download'), disabled('save', 'Save'),
      ], custom.file),
      { id: 'close-window', label: 'Close Window', hint: '⌥W', separatorAbove: true, disabled: !focusedWindow, run: () => focusedWindow && actions.closeApp(focusedWindow.id) },
    ] },
    edit: { label: 'Edit', items: editing },
    view: { label: 'View', items: combine([disabled('refresh', 'Refresh'), disabled('sidebar', 'Show Sidebar')], custom.view) },
    window: { label: 'Window', items: [
      { id: 'minimize-window', label: 'Minimize Window', disabled: !focusedWindow, run: () => focusedWindow && actions.minimizeApp(focusedWindow.id) },
      { id: 'maximize-window', label: 'Maximize Window', disabled: !focusedWindow || focusedWindow.maximized || state.viewport.w <= COMPACT_WIDTH, run: () => focusedWindow && actions.toggleMaximize(focusedWindow.id) },
      { id: 'restore-window', label: 'Restore Window', disabled: !focusedWindow || (!focusedWindow.maximized && !focusedWindow.snapped) || state.viewport.w <= COMPACT_WIDTH, run: () => focusedWindow && actions.updateRect(focusedWindow.id, focusedWindow.restore ?? focusedWindow) },
      { id: 'tile-left', label: 'Tile Window Left', separatorAbove: true, disabled: !focusedWindow || !canSnap('left', state.viewport, APPS[focusedWindow.appId].minSize), run: () => focusedWindow && actions.snapWindow(focusedWindow.id, 'left') },
      { id: 'tile-right', label: 'Tile Window Right', disabled: !focusedWindow || !canSnap('right', state.viewport, APPS[focusedWindow.appId].minSize), run: () => focusedWindow && actions.snapWindow(focusedWindow.id, 'right') },
      { id: 'show-desktop', label: 'Show Desktop', separatorAbove: true, disabled: !Object.values(state.windows).some((win) => win && !win.minimized), run: () => Object.values(state.windows).forEach((win) => { if (win && !win.minimized) actions.minimizeApp(win.id); }) },
      ...Object.values(state.windows).flatMap((win) => win ? [{ id: win.id, label: windowTitle(win), checked: win.id === state.focused, run: () => actions.focusApp(win.id) }] : []),
    ] },
  };

  function focusTopButton(menuId: MenuId) {
    const btn = barRef.current?.querySelector<HTMLButtonElement>(`[data-menu-button="${menuId}"]`);
    btn?.focus();
  }

  function siblingMenu(menuId: MenuId, dir: 1 | -1): MenuId {
    const idx = order.indexOf(menuId);
    return order[(idx + dir + order.length) % order.length];
  }

  function onMenuButtonKey(e: ReactKeyboardEvent, menuId: MenuId) {
    if (openMenu && (e.key === 'Home' || e.key === 'End')) {
      onMenuListKey(e, menuId);
    } else if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      open(menuId);
      requestAnimationFrame(() => {
        barRef.current
          ?.querySelector<HTMLButtonElement>(`[data-menu="${menuId}"] [data-menu-item]:not([disabled])`)
          ?.focus();
      });
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const next = siblingMenu(menuId, e.key === 'ArrowRight' ? 1 : -1);
      if (openMenu) open(next);
      focusTopButton(next);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpenMenu(null);
    }
  }

  function onMenuListKey(e: ReactKeyboardEvent, menuId: MenuId) {
    const items = Array.from(
      barRef.current?.querySelectorAll<HTMLButtonElement>(`[data-menu="${menuId}"] [data-menu-item]`) ?? [],
    ).filter((el) => !el.disabled);
    const idx = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpenMenu(null);
      focusTopButton(menuId);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[(idx + 1 + items.length) % items.length]?.focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      (e.key === 'Home' ? items[0] : items.at(-1))?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(idx - 1 + items.length) % items.length]?.focus();
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const next = siblingMenu(menuId, e.key === 'ArrowRight' ? 1 : -1);
      open(next);
      requestAnimationFrame(() => focusTopButton(next));
    } else if (e.key === 'Tab') {
      setOpenMenu(null);
    }
  }

  function renderMenu(menuId: MenuId) {
    const menu = menus[menuId];
    const isOpen = openMenu === menuId;
    return (
      <div className="menubar-menu" key={menuId}>
        <button
          type="button"
          data-menu-button={menuId}
          className={`menubar-button${menuId === 'app' ? ' menubar-app-name' : ''}`}
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={isOpen}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => { open(isOpen ? null : menuId); focusTopButton(menuId); }}
          onKeyDown={(e) => onMenuButtonKey(e, menuId)}
          onMouseEnter={() => {
            if (openMenu && openMenu !== menuId) open(menuId);
          }}
        >
          {menu.label}
        </button>
        {isOpen && (
          <div ref={dropdownRef} className="menubar-dropdown" role="menu" aria-label={menu.label} data-menu={menuId} onKeyDown={(e) => onMenuListKey(e, menuId)}>
            {menu.items.map((item) => (
              <Fragment key={item.id}>
              {item.separatorAbove && <div className="menubar-separator" role="separator" />}
              <button
                type="button"
                role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"}
                aria-checked={item.checked}
                data-testid={menuId === 'app' && item.id === 'auto-save' ? 'preview-autosave' : `menu-${item.id}`}
                data-menu-item
                className="popup-item menubar-item"
                disabled={item.disabled}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setOpenMenu(null);
                  item.run();
                }}
              >
                <span>{item.label}</span>
                <span className="menubar-trailing">{item.hint && <kbd>{item.hint}</kbd>}<span className="menubar-check" aria-hidden="true">{item.checked ? '✓' : ''}</span></span>
              </button>
              </Fragment>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <header {...input} ref={barRef} className="menubar menu-surface" data-testid="menu-bar" style={{ height: MENUBAR_H }}>
      <div className="menubar-left">
        <nav className="menubar-menus" role="menubar" aria-label="Application menus">
          {order.map(renderMenu)}
        </nav>
      </div>
      <div className="menubar-right">
        <DropdownMenu label="Pi assistant" ariaLabel="Pi assistant" testId="pi-tray-button" className="menubar-button menubar-pi" protected icon={<><IconPi size={18}/>{Object.keys(state.piActivity).some((key) => key.startsWith('pi:assistant:')) && <span className="pi-tray-activity" aria-label="Working"/>}</>} items={[
          { label: piOpen ? 'Hide assistant' : 'Show assistant', testId: 'pi-tray-toggle', run: onTogglePi },
          { label: 'New conversation', testId: 'pi-tray-new', run: onNewPi },
          { label: 'Workspace folder…', testId: 'pi-tray-workspace', separator: true, run: onPiWorkspace },
        ]}/>
        <button
          type="button"
          className="menubar-button menubar-clock"
          title={timezone ? `Server time · ${timezoneLabel(timezone)}` : 'Server time unavailable'}
          data-testid="notifications-button"
          aria-label={state.unread > 0 ? `Notifications, ${state.unread} unread` : 'Notifications'}
          aria-expanded={state.notifOpen}
          onClick={() => actions.setNotifOpen(!state.notifOpen)}
        >
<time data-testid="server-menubar-clock" dateTime={instant?.toISOString()}>
          {instant ? <><span className="menubar-date">{instant.toLocaleDateString([], { timeZone: timezone, weekday: 'short', month: 'short', day: 'numeric' })}{' '}</span>
          {instant.toLocaleTimeString([], { timeZone: timezone, hour: '2-digit', minute: '2-digit' })}</> : '—'}
        </time>
          {state.unread > 0 && (
            <span className="menubar-badge" aria-hidden="true" data-testid="notifications-badge">
              {state.unread}
            </span>
          )}
        </button>
      </div>
    </header>
  );
}
