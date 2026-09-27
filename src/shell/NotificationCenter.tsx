// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect } from 'react';
import { IconX } from './icons';
import { useShell } from './ShellContext';
import '../styles/notification-center.css';

export function NotificationCenter() {
  const { state, actions } = useShell();

  useEffect(() => {
    if (!state.notifOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') actions.setNotifOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.notifOpen, actions]);

  if (!state.notifOpen) return null;

  return (
    <>
      <div className="notifications-backdrop" onClick={() => actions.setNotifOpen(false)} />
      <aside className="notifications" data-testid="notification-center" aria-label="Notification center">
        <header className="notifications-header">
          <h2>Notifications</h2>
          <button type="button" className="notifications-clear" onClick={actions.clearNotifications}>
            Clear all
          </button>
        </header>
        <div className="notifications-list" tabIndex={0} role="region" aria-label="Notifications">
          {state.notifications.length === 0 && (
            <p className="notifications-empty">No notifications.</p>
          )}
          {state.notifications.map((n) => (
            <article key={n.id} className="notification" data-testid="notification-item">
              <header>
                <strong>{n.title}</strong>
                <time dateTime={new Date(n.ts).toISOString()}>
                  {new Date(n.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </time>
              </header>
              {n.body && <p>{n.body}</p>}
            </article>
          ))}
        </div>
      </aside>
    </>
  );
}

export function ShortcutsDialog() {
  const { state, actions } = useShell();

  useEffect(() => {
    if (!state.shortcutsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') actions.setShortcutsOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.shortcutsOpen, actions]);

  if (!state.shortcutsOpen) return null;

  const rows: [string, string][] = [
    ['Ctrl / ⌘ K', 'Command Center'],
    ['Alt W', 'Close window'],
    ['Ctrl Alt → / ←', 'Switch windows'],
    ['Esc', 'Dismiss'],
    ['↑ ↓ Enter', 'Navigate and select'],
    ['Space', 'Show Details in Files'],
  ];

  return (
    <div className="shortcuts-overlay" onPointerDown={() => actions.setShortcutsOpen(false)}>
      <div
        className="shortcuts"
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        data-testid="shortcuts-dialog"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <header className="shortcuts-header">
          <h2>Keyboard shortcuts</h2>
          <button
            type="button"
            className="shortcuts-close"
            aria-label="Close keyboard shortcuts"
            onClick={() => actions.setShortcutsOpen(false)}
          >
            <IconX size={14} />
          </button>
        </header>
        <dl className="shortcuts-list">
          {rows.map(([keys, desc]) => (
            <div className="shortcuts-row" key={keys}>
              <dt>
                {keys.split(' ').map((k, i) => (
                  <kbd key={i}>{k}</kbd>
                ))}
              </dt>
              <dd>{desc}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
