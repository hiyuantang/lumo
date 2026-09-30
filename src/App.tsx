// SPDX-License-Identifier: AGPL-3.0-only
import { useState, type CSSProperties } from 'react';
import { ServerClockProvider } from './shell/ServerClockContext';
import { WindowOverview } from './shell/WindowOverview';
import { CommandCenter } from './shell/CommandCenter';
import { ContextMenuProvider } from './shell/ContextMenu';
import { DesktopPet } from './shell/DesktopPet';
import { LumoUseCursor } from './shell/LumoUseCursor';
import { Dock } from './shell/Dock';
import { DesktopItems } from './shell/DesktopItems';
import { AppCatalogProvider } from './shell/AppCatalogContext';
import { LoginScreen } from './shell/LoginScreen';
import { MenuBar } from './shell/MenuBar';
import { NotificationCenter, ShortcutsDialog } from './shell/NotificationCenter';
import { ReauthProvider } from './shell/ReauthSheet';
import { ShellProvider, useIsNarrow, useShell } from './shell/ShellContext';
import { WindowManager } from './shell/WindowManager';
import { dockSpace } from './shell/windowGeometry';

function Desktop() {
  const narrow = useIsNarrow();
  const [overview, setOverview] = useState(false);
  const { state, actions } = useShell();
  return (
    <div className={`desktop-root${narrow ? ' narrow' : ''}${overview ? ' overview-active' : ''}`} style={{ '--dock-space': `${dockSpace(state.viewport)}px` } as CSSProperties}>
      <MenuBar />
      <main className="desktop wallpaper" aria-label="Desktop" onPointerDown={(event) => { if (event.target === event.currentTarget) { (document.activeElement as HTMLElement | null)?.blur(); actions.focusDesktop(); } }}>
        <DesktopItems />
        <WindowManager />
      </main>
      <Dock onOverview={() => setOverview(true)} />
      {overview && <WindowOverview onClose={() => setOverview(false)}/>}
      <CommandCenter />
      <NotificationCenter />
      <ShortcutsDialog />
      <DesktopPet />
      <LumoUseCursor />
    </div>
  );
}

function Shell() {
  const { state } = useShell();
  if (!state.authReady) {
    return (
      <div className="login wallpaper" data-testid="boot-splash">
        <p className="boot-splash-text">Connecting…</p>
      </div>
    );
  }
  return state.user ? <AppCatalogProvider><ServerClockProvider><Desktop /></ServerClockProvider></AppCatalogProvider> : <LoginScreen />;
}

export default function App() {
  return (
    <ShellProvider>
      <ContextMenuProvider>
        <ReauthProvider>
          <Shell />
        </ReauthProvider>
      </ContextMenuProvider>
    </ShellProvider>
  );
}
