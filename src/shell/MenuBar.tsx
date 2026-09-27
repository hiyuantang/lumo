// SPDX-License-Identifier: AGPL-3.0-only
import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { APPS } from '../apps/registry';
import { useNow, useShell } from './ShellContext';
import { canSnap, COMPACT_WIDTH, MENUBAR_H } from './windowGeometry';
import '../styles/menubar.css';

type MenuId = 'file' | 'view';

interface MenuItemDef {
  id: string;
  label: string;
  hint?: string;
  disabled?: boolean;
  separatorAbove?: boolean;
  run: () => void;
}

export function MenuBar() {
  const { state, actions, resolvedTheme, reducedMotion } = useShell();
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null);
  const now = useNow(1000);
  const barRef = useRef<HTMLElement>(null);

  const focusedWindow = state.focused ? state.windows[state.focused] : null;

  const menus: Record<MenuId, { label: string; items: MenuItemDef[] }> = {
    file: {
      label: 'File',
      items: [
        ...(focusedWindow?.appId === 'opencode' ? [{ id: 'new-opencode', label: 'New Window', run: actions.newOpenCodeWindow }] : []),
        ...(focusedWindow?.appId === 'preview' ? [{ id: 'new-preview', label: 'New Window', run: actions.newPreviewWindow }] : []),
        {
          id: 'command-center',
          label: 'Command Center',
          hint: '⌘K',
          run: () => actions.setPalette(true),
        },
        {
          id: 'close-window',
          label: 'Close Window',
          hint: '⌥W',
          disabled: !state.focused,
          run: () => state.focused && actions.closeApp(state.focused),
        },
      ],
    },
    view: {
      label: 'View',
      items: [
        {
          id: 'toggle-theme',
          label: resolvedTheme === 'dark' ? 'Light Theme' : 'Dark Theme',
          run: actions.toggleTheme,
        },
        {
          id: 'toggle-motion',
          label: reducedMotion ? 'Full Motion' : 'Reduced Motion',
          run: actions.toggleMotion,
        },
        {
          id: 'shortcuts',
          label: 'Keyboard Shortcuts',
          run: () => actions.setShortcutsOpen(true),
        },
        {
          id: 'maximize-window',
          label: 'Maximize Window',
          separatorAbove: true,
          disabled: !focusedWindow || focusedWindow.maximized || state.viewport.w <= COMPACT_WIDTH,
          run: () => focusedWindow && actions.toggleMaximize(focusedWindow.id),
        },
        {
          id: 'restore-window',
          label: 'Restore Window',
          disabled: !focusedWindow || (!focusedWindow.maximized && !focusedWindow.snapped) || state.viewport.w <= COMPACT_WIDTH,
          run: () => focusedWindow && actions.updateRect(focusedWindow.id, focusedWindow.restore ?? focusedWindow),
        },
        {
          id: 'tile-left',
          label: 'Tile Window Left',
          disabled: !focusedWindow || !canSnap('left', state.viewport, APPS[focusedWindow.appId].minSize),
          run: () => focusedWindow && actions.snapWindow(focusedWindow.id, 'left'),
        },
        {
          id: 'tile-right',
          label: 'Tile Window Right',
          disabled: !focusedWindow || !canSnap('right', state.viewport, APPS[focusedWindow.appId].minSize),
          run: () => focusedWindow && actions.snapWindow(focusedWindow.id, 'right'),
        },
      ],
    },

  };

  function focusTopButton(menuId: MenuId) {
    const btn = barRef.current?.querySelector<HTMLButtonElement>(`[data-menu-button="${menuId}"]`);
    btn?.focus();
  }

  function siblingMenu(menuId: MenuId, dir: 1 | -1): MenuId {
    const order: MenuId[] = ['file', 'view'];
    const idx = order.indexOf(menuId);
    return order[(idx + dir + order.length) % order.length];
  }

  function onMenuButtonKey(e: ReactKeyboardEvent, menuId: MenuId) {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setOpenMenu(menuId);
      requestAnimationFrame(() => {
        barRef.current
          ?.querySelector<HTMLButtonElement>(`[data-menu="${menuId}"] [data-menu-item]:not([disabled])`)
          ?.focus();
      });
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const next = siblingMenu(menuId, e.key === 'ArrowRight' ? 1 : -1);
      if (openMenu) setOpenMenu(next);
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
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(idx - 1 + items.length) % items.length]?.focus();
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const next = siblingMenu(menuId, e.key === 'ArrowRight' ? 1 : -1);
      setOpenMenu(next);
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
          className="menubar-button"
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={isOpen}
          onClick={() => setOpenMenu(isOpen ? null : menuId)}
          onKeyDown={(e) => onMenuButtonKey(e, menuId)}
          onMouseEnter={() => {
            if (openMenu && openMenu !== menuId) setOpenMenu(menuId);
          }}
        >
          {menu.label}
        </button>
        {isOpen && (
          <div className="menubar-dropdown" role="menu" data-menu={menuId} onKeyDown={(e) => onMenuListKey(e, menuId)}>
            {menu.items.map((item) => (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                data-menu-item
                className={`menubar-item${item.separatorAbove ? ' separator-above' : ''}`}
                disabled={item.disabled}
                onClick={() => {
                  setOpenMenu(null);
                  item.run();
                }}
              >
                <span>{item.label}</span>
                {item.hint && <kbd>{item.hint}</kbd>}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <header ref={barRef} className="menubar" data-testid="menu-bar" style={{ height: MENUBAR_H }}>
      {openMenu && <div className="menubar-backdrop" onClick={() => setOpenMenu(null)} />}
      <div className="menubar-left">
        <span className="menubar-brand">Lumo</span>
        <nav className="menubar-menus" role="menubar" aria-label="Application menus">
          {renderMenu('file')}
          {renderMenu('view')}
        </nav>
      </div>
      <div className="menubar-right">
        <button
          type="button"
          className="menubar-button menubar-clock"
          data-testid="notifications-button"
          aria-label={state.unread > 0 ? `Notifications, ${state.unread} unread` : 'Notifications'}
          aria-expanded={state.notifOpen}
          onClick={() => actions.setNotifOpen(!state.notifOpen)}
        >
<time dateTime={new Date(now).toISOString()}>
          {new Date(now).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}{' '}
          {new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
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
