// SPDX-License-Identifier: AGPL-3.0-only
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { APP_ORDER, APPS, type AppId } from '../apps/registry';
import { useShell } from './ShellContext';
import { IconZoom } from './icons';
import '../styles/dock.css';

export function Dock() {
  const { state, actions } = useShell();

  function onAppClick(appId: AppId) {
    const win = state.windows[appId];
    if (!win) actions.openApp(appId);
    else actions.focusApp(appId);
  }

  function onKeyDown(e: ReactKeyboardEvent) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const current = (e.target as HTMLElement).closest('button');
    const sibling =
      e.key === 'ArrowRight' ? current?.nextElementSibling : current?.previousElementSibling;
    (sibling as HTMLButtonElement | null)?.focus();
  }

  return (
    <nav className="dock" data-testid="dock" aria-label="Dock" onKeyDown={onKeyDown}>
      <div className="dock-tray">
        {APP_ORDER.map((appId) => {
          const meta = APPS[appId];
          const win = state.windows[appId];
          const running = Boolean(win);
          const minimized = Boolean(win?.minimized);
          const active = running && !minimized && state.focused === appId;
          const Icon = meta.icon;
          return (
            <button
              key={appId}
              type="button"
              className={`dock-app${active ? ' active' : ''}${minimized ? ' minimized' : ''}`}
              data-testid={`dock-app-${appId}`}
              data-app={appId}
              aria-label={`${meta.title}${running ? (minimized ? ', minimized' : ', running') : ''}`}
              title={minimized ? `Restore ${meta.title}` : meta.title}
              onClick={() => onAppClick(appId)}
            >
              <span className="dock-icon">
                <Icon size={31} />
              </span>
              {minimized && <span className="dock-minimized-badge" data-testid={`dock-minimized-${appId}`} aria-hidden="true"><IconZoom size={13} /></span>}
              <span className="dock-label" aria-hidden="true">{minimized ? `Restore ${meta.title}` : meta.title}</span>
              <span className={`dock-dot${running ? ' on' : ''}${minimized ? ' minimized' : ''}`} aria-hidden="true" />
            </button>
          );
        })}
      </div>
    </nav>
  );
}
