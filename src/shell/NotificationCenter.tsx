// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useEffect, useRef, useState } from 'react';
import { IconX } from './icons';
import { useShell, type ShellNotification } from './ShellContext';
import '../styles/notification-center.css';

function NotificationCard({ notification, banner = false, leaving = false, onDismiss, onPause }: { notification: ShellNotification; banner?: boolean; leaving?: boolean; onDismiss: () => void; onPause?: (paused: boolean) => void }) {
  return <article className={`notification${banner ? ' notification-banner' : ''}${leaving ? ' is-leaving' : ''}`} data-testid={banner ? 'notification-banner' : 'notification-item'} onPointerEnter={() => onPause?.(true)} onPointerLeave={(event) => onPause?.(event.currentTarget.contains(document.activeElement))} onFocusCapture={() => onPause?.(true)} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onPause?.(event.currentTarget.matches(':hover')); }}>
    <button type="button" className="notification-close" data-testid="notification-close" aria-label={`Dismiss ${notification.title}`} onClick={onDismiss}><IconX size={14} strokeWidth={2}/></button>
    <header><strong>{notification.title}</strong><time dateTime={new Date(notification.ts).toISOString()}>{new Date(notification.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></header>
    {notification.body && <p>{notification.body}</p>}
  </article>;
}

function NotificationBanner({ notification, onExit }: { notification: ShellNotification; onExit: (id: number) => void }) {
  const { actions, reducedMotion } = useShell();
  const [paused, setPaused] = useState(false);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (paused || leaving) return;
    const timer = window.setTimeout(() => setLeaving(true), 6000);
    return () => window.clearTimeout(timer);
  }, [paused, leaving]);
  useEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(() => onExit(notification.id), reducedMotion ? 0 : 220);
    return () => window.clearTimeout(timer);
  }, [leaving, notification.id, onExit, reducedMotion]);
  return <NotificationCard notification={notification} banner leaving={leaving} onPause={setPaused} onDismiss={() => actions.dismissNotification(notification.id)}/>;
}

export function NotificationCenter() {
  const { state, actions } = useShell();
  const center = useRef<HTMLElement>(null);
  const lastSeen = useRef(state.notifications[0]?.id ?? 0);
  const [banners, setBanners] = useState<ShellNotification[]>([]);
  const exitBanner = useCallback((id: number) => setBanners((items) => items.filter((item) => item.id !== id)), []);
  useEffect(() => {
    const incoming = state.notifications.filter((item) => item.id > lastSeen.current);
    lastSeen.current = Math.max(lastSeen.current, state.notifications[0]?.id ?? 0);
    setBanners((items) => state.notifOpen ? [] : [...incoming, ...items].filter((item) => state.notifications.some((saved) => saved.id === item.id)).slice(0, 3));
  }, [state.notifications, state.notifOpen]);
  useEffect(() => {
    if (!state.notifOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') actions.setNotifOpen(false); };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Element;
      if (!center.current?.contains(target) && !target.closest('[data-testid="notifications-button"]')) actions.setNotifOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointer, true);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('pointerdown', onPointer, true); };
  }, [state.notifOpen, actions]);
  return <>
    {state.notifOpen && <aside ref={center} className="notifications" data-testid="notification-center" aria-label="Notification center">
      <div className="notifications-list" tabIndex={0} role="region" aria-label="Notifications">
        {state.notifications.length === 0 && <p className="notification notifications-empty">No notifications.</p>}
        {state.notifications.map((notification) => <NotificationCard key={notification.id} notification={notification} onDismiss={() => actions.dismissNotification(notification.id)}/>)}
      </div>
    </aside>}
    {!state.notifOpen && <aside className="notification-banners" aria-label="New notifications" role="status" aria-live="polite">{banners.map((notification) => <NotificationBanner key={notification.id} notification={notification} onExit={exitBanner}/>)}</aside>}
  </>;
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
