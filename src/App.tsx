// SPDX-License-Identifier: AGPL-3.0-only
import { DesktopAppsProvider } from './platform/catalog';
import { PluginServices, PluginProviders } from './platform/PluginApp';
import { useEffect, useState, type CSSProperties } from 'react';
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
import { PiAssistant } from './shell/PiAssistant';
import type { AssistantRequest as PiAssistantRequest } from './api/app-plugins';
import { MenuBar } from './shell/MenuBar';
import { NotificationCenter, ShortcutsDialog } from './shell/NotificationCenter';
import { ReauthProvider } from './shell/ReauthSheet';
import { ShellProvider, useIsNarrow, useShell } from './shell/ShellContext';
import { WindowManager } from './shell/WindowManager';
import { blockPinchZoom } from './shell/pinchZoom';
import { dockSpace } from './shell/windowGeometry';

function Desktop() {
  const narrow = useIsNarrow();
  const [overview, setOverview] = useState(false);
  const [piOpen, setPiOpen] = useState(false);
  const [piVisited, setPiVisited] = useState(false);
  const [piRequest, setPiRequest] = useState<PiAssistantRequest>();
  const { state, actions } = useShell();
  return (
    <div className={`desktop-root${narrow ? ' narrow' : ''}${overview ? ' overview-active' : ''}`} style={{ '--dock-space': `${dockSpace(state.viewport)}px` } as CSSProperties}>
      <MenuBar piOpen={piOpen} onTogglePi={() => { setPiVisited(true); setPiOpen((value) => !value); }} onNewPi={() => { setPiVisited(true); setPiOpen(true); setPiRequest({ action: 'new', id: crypto.randomUUID() }); }} onPiWorkspace={() => { setPiVisited(true); setPiOpen(true); setPiRequest({ action: 'workspace', id: crypto.randomUUID() }); }} />
      {piVisited && <PiAssistant open={piOpen} request={piRequest} onOpen={() => setPiOpen(true)} onHide={() => setPiOpen(false)}/>}
      <main className="desktop wallpaper" aria-label="Desktop" onPointerDown={(event) => { if (event.target === event.currentTarget) { (document.activeElement as HTMLElement | null)?.blur(); actions.focusDesktop(); } }}>
        <DesktopItems />
        <WindowManager />
      </main>
      <Dock onOverview={() => setOverview(true)} />
      {overview && <WindowOverview onClose={() => setOverview(false)}/>}
      <CommandCenter />
      <NotificationCenter />
      <PluginServices />
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
  return state.user ? <AppCatalogProvider><DesktopAppsProvider><ServerClockProvider><PluginProviders><Desktop /></PluginProviders></ServerClockProvider></DesktopAppsProvider></AppCatalogProvider> : <LoginScreen />;
}

export default function App() {
  useEffect(() => blockPinchZoom(document), []);
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
