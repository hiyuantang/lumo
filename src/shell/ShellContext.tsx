// SPDX-License-Identifier: AGPL-3.0-only
import {
  createContext,
  useContext,
  useCallback,
  useRef,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from 'react';
import { clearWindowState } from './appStateStorage';
import { getDataSource } from '../api/source';
import type { ServerAppID } from '../api/server-apps';
import { APPS, APP_ORDER, type AppId, type SettingsSection } from '../apps/registry';
import { canSnap, clampRect, snapRect, workArea, MENUBAR_H, type Rect, type SnapTarget, type Viewport } from './windowGeometry';

export type WindowId = AppId | `preview:${string}` | `opencode:${string}`;

export interface WindowState extends Rect {
  id: WindowId;
  previewMode?: 'rendered' | 'raw';
  appId: AppId;
  filePath?: string[];
  projectPath?: string;
  z: number;
  minimized: boolean;
  maximized: boolean;
  snapped: 'left' | 'right' | null;
  restore: Rect | null;
}

type WindowLayout = Pick<WindowState, 'x' | 'y' | 'w' | 'h' | 'maximized' | 'snapped' | 'restore'>;

function windowLayout({ x, y, w, h, maximized, snapped, restore }: WindowLayout): WindowLayout {
  return { x, y, w, h, maximized, snapped, restore };
}

export interface ShellNotification {
  id: number;
  title: string;
  body: string;
  ts: number;
}

export type ThemePref = 'light' | 'dark' | null;
export type MotionPref = 'system' | 'reduced' | 'full';

type NavigationIntent = (
  | { target: 'logs' | 'services'; unit: string }
  | { target: 'settings'; section: SettingsSection }
  | { target: 'library'; appId: ServerAppID }
  | { target: 'trash'; empty: true }
  | { target: 'preview'; windowId: WindowId; edit: boolean }
) & { nonce: number };

interface ShellState {
  user: string | null;
  authReady: boolean;
  windows: Partial<Record<WindowId, WindowState>>;
  remembered: Partial<Record<AppId, WindowLayout>>;
  zTop: number;
  focused: WindowId | null;
  notifications: ShellNotification[];
  unread: number;
  theme: ThemePref;
  motion: MotionPref;
  paletteOpen: boolean;
  notifOpen: boolean;
  shortcutsOpen: boolean;
  navigation: NavigationIntent | null;
  viewport: Viewport;
  fileRevision: number;
}

type Action =
  | { type: 'login'; user: string }
  | { type: 'logout' }
  | { type: 'auth-ready' }
  | { type: 'open-app'; appId: AppId }
  | { type: 'empty-trash' }
  | { type: 'opencode-project'; id: WindowId; path: string | null }
  | { type: 'new-preview' }
  | { type: 'open-opencode'; path: string }
  | { type: 'new-opencode' }
  | { type: 'preview-mode'; id: WindowId; mode: 'rendered' | 'raw' }
  | { type: 'open-preview'; path: string[]; edit: boolean; windowId?: WindowId }
  | { type: 'files-changed' }
  | { type: 'open-related'; target: 'logs' | 'services'; unit: string }
  | { type: 'open-settings'; section: SettingsSection }
  | { type: 'open-library'; appId: ServerAppID }
  | { type: 'close-app'; appId: WindowId }
  | { type: 'focus-app'; appId: WindowId }
  | { type: 'minimize-app'; appId: WindowId }
  | { type: 'toggle-maximize'; appId: WindowId }
  | { type: 'snap-window'; appId: WindowId; target: SnapTarget; restore?: Rect }
  | { type: 'cancel-window-gesture'; appId: WindowId; previous: WindowState }
  | { type: 'update-rect'; appId: WindowId; rect: Rect }
  | { type: 'cycle-window'; dir: 1 | -1 }
  | { type: 'notify'; title: string; body: string }
  | { type: 'clear-notifications' }
  | { type: 'toggle-theme' }
  | { type: 'toggle-motion' }
  | { type: 'set-theme'; theme: ThemePref }
  | { type: 'set-motion'; motion: MotionPref }
  | { type: 'set-palette'; open: boolean }
  | { type: 'toggle-palette' }
  | { type: 'set-notif-open'; open: boolean }
  | { type: 'set-shortcuts-open'; open: boolean }
  | { type: 'set-viewport'; viewport: Viewport };

const SESSION_KEY = 'lumo.session.v1';
const WINDOWS_KEY = 'lumo.windows.v1';
const PREFS_KEY = 'lumo.prefs.v1';

let notificationId = 1;

function loadJSON<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function localStorageAvailable(key: string): boolean {
  try { return localStorage.getItem(key) !== null; } catch { return false; }
}

function fitWindow(win: WindowState, viewport: Viewport): WindowState {
  if (win.maximized) return { ...win, snapped: null, ...workArea(viewport) };
  if (win.snapped && canSnap(win.snapped, viewport, APPS[win.appId].minSize)) {
    return { ...win, ...snapRect(win.snapped, viewport) };
  }
  return {
    ...win,
    ...clampRect(win.snapped ? (win.restore ?? win) : win, viewport),
    snapped: null,
    restore: null,
  };
}

function createWindow(state: ShellState, appId: AppId, id: WindowId): ShellState {
  const saved = state.remembered[appId];
  const count = Object.keys(state.windows).length;
  const rect = clampRect(saved ?? { x: 96 + count * 40, y: MENUBAR_H + 40 + count * 32, ...APPS[appId].defaultSize }, state.viewport);
  const win = fitWindow({ ...(saved ? windowLayout(saved) : {}), ...rect, appId, id, z: state.zTop + 1, minimized: false, maximized: saved?.maximized ?? false, snapped: saved?.snapped ?? null, restore: saved?.restore ?? null }, state.viewport);
  if ((appId === 'preview' || appId === 'opencode') && !win.maximized && !win.snapped && Object.values(state.windows).some((item) => item?.appId === appId)) {
    Object.assign(win, clampRect({ ...win, x: 96 + count * 40, y: MENUBAR_H + 40 + count * 32 }, state.viewport));
  }
  return { ...state, windows: { ...state.windows, [id]: win }, focused: id, zTop: win.z };
}

function reducer(state: ShellState, action: Action): ShellState {
  switch (action.type) {
    case 'login': {
      if (state.user === action.user) return state;
      const saved = initState(action.user);
      return { ...state, user: action.user, windows: saved.windows, remembered: saved.remembered, zTop: saved.zTop, focused: saved.focused, navigation: saved.navigation };
    }
    case 'logout':
      return {
        ...state,
        user: null,
        windows: {},
        remembered: {},
        focused: null,
        paletteOpen: false,
        notifOpen: false,
        shortcutsOpen: false,
        navigation: null,
      };
    case 'auth-ready':
      return { ...state, authReady: true };
    case 'files-changed':
      return { ...state, fileRevision: state.fileRevision + 1 };
    case 'new-opencode':
      return createWindow(state, 'opencode', state.windows.opencode ? `opencode:${state.zTop + 1}` : 'opencode');
    case 'new-preview':
      return createWindow(state, 'preview', state.windows.preview ? `preview:${state.zTop + 1}` : 'preview');
    case 'preview-mode': {
      const win = state.windows[action.id];
      return win ? { ...state, windows: { ...state.windows, [action.id]: { ...win, previewMode: action.mode } } } : state;
    }
    case 'open-preview': {
      const previews = Object.values(state.windows).filter((win): win is WindowState => win?.appId === 'preview').sort((a, b) => b.z - a.z);
      const existing = action.windowId ? previews.find((win) => win.id === action.windowId) : previews.find((win) => win.filePath?.join('/') === action.path.join('/')) ?? previews.find((win) => !win.filePath);
      const sameFile = existing?.filePath?.join('/') === action.path.join('/');
      const id: WindowId = existing?.id ?? (state.windows.preview ? `preview:${state.zTop + 1}` : 'preview');
      const next = existing ? reducer(state, { type: 'focus-app', appId: existing.id }) : createWindow(state, 'preview', id);
      return { ...next, navigation: { target: 'preview', windowId: id, edit: action.edit, nonce: (state.navigation?.nonce ?? 0) + 1 }, windows: { ...next.windows, [id]: { ...next.windows[id]!, filePath: sameFile ? existing!.filePath : action.path, previewMode: sameFile ? existing!.previewMode : undefined } } };
    }
    case 'empty-trash': {
      const next = reducer(state, { type: 'open-app', appId: 'trash' });
      return { ...next, navigation: { target: 'trash', empty: true, nonce: (state.navigation?.nonce ?? 0) + 1 } };
    }
    case 'opencode-project': {
      const win = state.windows[action.id];
      return win ? { ...state, windows: { ...state.windows, [action.id]: { ...win, projectPath: action.path ?? undefined } } } : state;
    }
    case 'open-opencode': {
      const existing = Object.values(state.windows).find((win) => win?.appId === 'opencode' && win.projectPath === action.path);
      if (existing) return reducer(state, { type: 'focus-app', appId: existing.id });
      const id: WindowId = state.windows.opencode ? `opencode:${state.zTop + 1}` : 'opencode';
      const next = createWindow(state, 'opencode', id);
      return { ...next, windows: { ...next.windows, [id]: { ...next.windows[id]!, projectPath: action.path } } };
    }
    case 'open-app': {
      const existing = Object.values(state.windows).filter((win): win is WindowState => win?.appId === action.appId).sort((a, b) => b.z - a.z)[0];
      return existing ? reducer(state, { type: 'focus-app', appId: existing.id }) : createWindow(state, action.appId, action.appId);
    }
    case 'open-related': {
      const opened = reducer(state, { type: 'open-app', appId: 'home' });
      return {
        ...opened,
        navigation: {
          target: action.target,
          unit: action.unit,
          nonce: (state.navigation?.nonce ?? 0) + 1,
        },
      };
    }
    case 'open-settings': {
      const opened = reducer(state, { type: 'open-app', appId: 'settings' });
      return {
        ...opened,
        navigation: { target: 'settings', section: action.section, nonce: (state.navigation?.nonce ?? 0) + 1 },
      };
    }
    case 'open-library': {
      const opened = reducer(state, { type: 'open-app', appId: 'library' });
      return { ...opened, navigation: { target: 'library', appId: action.appId, nonce: (state.navigation?.nonce ?? 0) + 1 } };
    }
    case 'close-app': {
      const closed = state.windows[action.appId];
      if (!closed) return state;
      const windows = { ...state.windows };
      delete windows[action.appId];
      let focused = state.focused;
      if (focused === action.appId) {
        const remaining = Object.values(windows)
          .filter((w): w is WindowState => !!w && !w.minimized)
          .sort((a, b) => b.z - a.z);
        focused = remaining[0]?.id ?? null;
      }
      return { ...state, windows, focused, navigation: (state.navigation?.target === 'preview' ? state.navigation.windowId === action.appId : state.navigation?.target === closed.appId || (closed.appId === 'home' && (state.navigation?.target === 'logs' || state.navigation?.target === 'services'))) ? null : state.navigation, remembered: { ...state.remembered, [closed.appId]: windowLayout(closed) } };
    }
    case 'focus-app': {
      const win = state.windows[action.appId];
      if (!win) return state;
      if (state.focused === action.appId && !win.minimized) return state;
      const z = state.zTop + 1;
      return {
        ...state,
        zTop: z,
        focused: action.appId,
        windows: { ...state.windows, [action.appId]: { ...win, minimized: false, z } },
      };
    }
    case 'minimize-app': {
      const win = state.windows[action.appId];
      if (!win) return state;
      const windows = { ...state.windows, [action.appId]: { ...win, minimized: true } };
      const remaining = Object.values(windows)
        .filter((w): w is WindowState => !!w && !w.minimized)
        .sort((a, b) => b.z - a.z);
      const focused = state.focused === action.appId ? (remaining[0]?.id ?? null) : state.focused;
      return { ...state, windows, focused };
    }
    case 'toggle-maximize': {
      const win = state.windows[action.appId];
      if (!win) return state;
      const z = state.zTop + 1;
      const next: WindowState = win.maximized
        ? { ...win, ...clampRect(win.restore ?? win, state.viewport), maximized: false, snapped: null, restore: null, z }
        : { ...win, maximized: true, snapped: null, restore: win.restore ?? { x: win.x, y: win.y, w: win.w, h: win.h }, ...workArea(state.viewport), z };
      return {
        ...state,
        zTop: z,
        focused: action.appId,
        windows: { ...state.windows, [action.appId]: next },
      };
    }
    case 'snap-window': {
      const win = state.windows[action.appId];
      if (!win || !canSnap(action.target, state.viewport, APPS[win.appId].minSize)) return state;
      const z = state.zTop + 1;
      const restore = action.restore ?? win.restore ?? { x: win.x, y: win.y, w: win.w, h: win.h };
      return {
        ...state,
        zTop: z,
        focused: action.appId,
        windows: {
          ...state.windows,
          [action.appId]: {
            ...win,
            ...snapRect(action.target, state.viewport),
            maximized: action.target === 'maximize',
            snapped: action.target === 'maximize' ? null : action.target,
            minimized: false,
            restore,
            z,
          },
        },
      };
    }
    case 'cancel-window-gesture': {
      const win = state.windows[action.appId];
      if (!win) return state;
      const previous = fitWindow(action.previous, state.viewport);
      return { ...state, windows: { ...state.windows, [action.appId]: { ...previous, z: win.z, minimized: win.minimized } } };
    }
    case 'update-rect': {
      const win = state.windows[action.appId];
      if (!win) return state;
      const rect = clampRect(action.rect, state.viewport);
      return { ...state, windows: { ...state.windows, [action.appId]: { ...win, ...rect, maximized: false, snapped: null, restore: null } } };
    }
    case 'cycle-window': {
      const visible = Object.values(state.windows).filter((win): win is WindowState => !!win && !win.minimized).sort((a, b) => APP_ORDER.indexOf(a.appId) - APP_ORDER.indexOf(b.appId) || a.id.localeCompare(b.id)).map((win) => win.id);
      if (visible.length === 0) return state;
      const raw = visible.indexOf(state.focused as WindowId);
      const idx = raw === -1 ? (action.dir === 1 ? -1 : 0) : raw;
      const nextId = visible[(idx + action.dir + visible.length) % visible.length] ?? visible[0];
      return reducer(state, { type: 'focus-app', appId: nextId });
    }
    case 'notify':
      return {
        ...state,
        unread: state.unread + 1,
        notifications: [
          { id: notificationId++, title: action.title, body: action.body, ts: Date.now() },
          ...state.notifications,
        ].slice(0, 50),
      };
    case 'clear-notifications':
      return { ...state, notifications: [], unread: 0 };
    case 'toggle-theme': {
      const resolved = state.theme ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      return { ...state, theme: resolved === 'dark' ? 'light' : 'dark' };
    }
    case 'set-theme':
      return { ...state, theme: action.theme };
    case 'set-motion':
      return { ...state, motion: action.motion };
    case 'toggle-motion': {
      const reduced =
        state.motion === 'reduced' ||
        (state.motion === 'system' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
      return { ...state, motion: reduced ? 'full' : 'reduced' };
    }
    case 'set-palette':
      return { ...state, paletteOpen: action.open, notifOpen: action.open ? false : state.notifOpen };
    case 'toggle-palette':
      return { ...state, paletteOpen: !state.paletteOpen, notifOpen: false };
    case 'set-notif-open':
      return {
        ...state,
        notifOpen: action.open,
        paletteOpen: action.open ? false : state.paletteOpen,
        unread: action.open ? 0 : state.unread,
      };
    case 'set-shortcuts-open':
      return { ...state, shortcutsOpen: action.open };
    case 'set-viewport': {
      if (action.viewport.w === state.viewport.w && action.viewport.h === state.viewport.h) return state;
      const windows: Partial<Record<WindowId, WindowState>> = {};
      for (const [id, win] of Object.entries(state.windows)) {
        if (!win) continue;
        windows[id as WindowId] = fitWindow(win, action.viewport);
      }
      return { ...state, viewport: action.viewport, windows };
    }
    default:
      return state;
  }
}

function initState(account?: string): ShellState {
  const session = loadJSON<{ user: string }>(SESSION_KEY);
  const prefs = loadJSON<{ theme: ThemePref; motion: MotionPref }>(PREFS_KEY);
  const isLive = getDataSource().capabilities.isLive;
  const user = account ?? (isLive ? null : session?.user ?? null);
  const stored = loadJSON<{
    remembered?: Partial<Record<AppId, WindowLayout>>;
    windows: Partial<Record<WindowId | 'network' | 'logs' | 'updates' | 'services', WindowState>>;
    zTop: number;
    focused: WindowId | 'network' | 'logs' | 'updates' | 'services' | null;
  }>(user && localStorageAvailable(`${WINDOWS_KEY}:${encodeURIComponent(user)}`) ? `${WINDOWS_KEY}:${encodeURIComponent(user)}` : (!isLive || session?.user === user ? WINDOWS_KEY : 'lumo.windows.unused'));
  const legacyPreviewMode = loadJSON<unknown>(`lumo.view.v1:${encodeURIComponent(user ?? '')}:preview:markdown-mode`);
  const restorePreviewMode = (win: WindowState): WindowState => win.appId === 'preview' && !win.id && (legacyPreviewMode === 'raw' || legacyPreviewMode === 'rendered') ? { ...win, previewMode: legacyPreviewMode } : win;
  const remembered = Object.fromEntries(Object.entries(stored?.remembered ?? {}).filter(([, win]) => !!win).map(([id, win]) => [id, windowLayout(win!)]));
  const viewport = { w: window.innerWidth, h: window.innerHeight };
  const windows: Partial<Record<WindowId, WindowState>> = {};
  if (stored?.windows) {
    for (const [id, win] of Object.entries(stored.windows)) {
      const appId = (id === 'network' || id === 'updates') ? 'settings' : (id === 'logs' || id === 'services') ? 'home' : id.startsWith('preview:') ? 'preview' : id.startsWith('opencode:') ? 'opencode' : id as AppId;
      const windowId = ((id === 'network' || id === 'updates') ? 'settings' : (id === 'logs' || id === 'services') ? 'home' : id) as WindowId;
      if (!win || !APPS[appId] || ((id === 'network' || id === 'updates') && stored.windows.settings) || ((id === 'logs' || id === 'services') && stored.windows.home)) continue;
      windows[windowId] = fitWindow({ ...restorePreviewMode(win), id: windowId, appId }, viewport);
    }
  }
  const focused = (stored?.focused === 'network' || stored?.focused === 'updates') ? 'settings' : (stored?.focused === 'logs' || stored?.focused === 'services') ? 'home' : stored?.focused;
  const migratedNetwork = stored?.windows.network && (stored.focused === 'network' || !stored.windows.settings);
  if (stored?.focused && ['network', 'logs', 'updates', 'services'].includes(stored.focused) && focused && windows[focused]) {
    windows[focused] = { ...windows[focused]!, minimized: false, z: Math.max(windows[focused]!.z, stored.windows[stored.focused]?.z ?? 0) };
  }
  return {
    user,
    authReady: !isLive,
    windows,
    remembered,
    zTop: stored?.zTop ?? 0,
    focused: focused && windows[focused] ? focused : null,
    notifications: [],
    unread: 0,
    theme: prefs?.theme ?? null,
    motion: prefs?.motion ?? 'system',
    paletteOpen: false,
    notifOpen: false,
    shortcutsOpen: false,
    navigation: stored?.focused === 'services' ? { target: 'services', unit: '', nonce: 1 } : stored?.focused === 'updates' ? { target: 'settings', section: 'updates', nonce: 1 } : stored?.focused === 'logs' ? { target: 'logs', unit: 'all', nonce: 1 } : migratedNetwork ? { target: 'settings', section: 'network', nonce: 1 } : null,
    viewport,
    fileRevision: 0,
  };
}

export interface ShellActions {
  login(user: string): void;
  logout(): void;
  openApp(appId: AppId): void;
  emptyTrash(): void;
  setOpenCodeProject(id: WindowId, path: string | null): void;
  openOpenCode(path: string): void;
  openPreview(path: string[], edit?: boolean, windowId?: WindowId): void;
  newPreviewWindow(): void;
  newOpenCodeWindow(): void;
  setPreviewMode(id: WindowId, mode: 'rendered' | 'raw'): void;
  filesChanged(): void;
  registerWindowGuard(appId: WindowId, guard: (proceed: () => void) => void): () => void;
  openSettings(section: SettingsSection): void;
  openLibrary(appId: ServerAppID): void;
  openLogs(unit: string): void;
  openService(unit: string): void;
  closeApp(appId: WindowId): void;
  focusApp(appId: WindowId): void;
  minimizeApp(appId: WindowId): void;
  toggleMaximize(appId: WindowId): void;
  snapWindow(appId: WindowId, target: SnapTarget, restore?: Rect): void;
  cancelWindowGesture(appId: WindowId, previous: WindowState): void;
  updateRect(appId: WindowId, rect: Rect): void;
  notify(title: string, body: string): void;
  clearNotifications(): void;
  toggleTheme(): void;
  toggleMotion(): void;
  setTheme(theme: ThemePref): void;
  setMotion(motion: MotionPref): void;
  setPalette(open: boolean): void;
  setNotifOpen(open: boolean): void;
  setShortcutsOpen(open: boolean): void;
}

interface ShellContextValue {
  state: ShellState;
  actions: ShellActions;
  resolvedTheme: 'light' | 'dark';
  reducedMotion: boolean;
}

const ShellContext = createContext<ShellContextValue | null>(null);

export function ShellProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, null as unknown as ShellState, () => initState());

  const currentState = useRef(state);
  currentState.current = state;
  const windowGuards = useRef(new Map<WindowId, (proceed: () => void) => void>());
  const requestWindowAction = useCallback((appId: WindowId, proceed: () => void) => {
    const guard = windowGuards.current.get(appId);
    if (guard) { dispatch({ type: 'focus-app', appId }); guard(proceed); }
    else proceed();
  }, []);

  const closeWindow = useCallback((appId: WindowId) => requestWindowAction(appId, () => {
    clearWindowState(currentState.current.user, appId);
    dispatch({ type: 'close-app', appId });
  }), [requestWindowAction]);

  const systemDark = useMediaQuery('(prefers-color-scheme: dark)');
  const systemReduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const resolvedTheme: 'light' | 'dark' = state.theme ?? (systemDark ? 'dark' : 'light');
  const reducedMotion = state.motion === 'reduced' || (state.motion === 'system' && systemReduced);

  useEffect(() => {
    const source = getDataSource();
    if (!source.capabilities.isLive) return;
    let alive = true;
    source
      .getSession()
      .then((user) => {
        if (!alive) return;
        if (user) dispatch({ type: 'login', user: user.name });
        dispatch({ type: 'auth-ready' });
      })
      .catch(() => {
        if (alive) dispatch({ type: 'auth-ready' });
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const source = getDataSource();
    if (!source.capabilities.isLive) return;
    return source.onSessionExpired(() => dispatch({ type: 'logout' }));
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
  }, [resolvedTheme]);

  useEffect(() => {
    document.documentElement.classList.toggle('motion-reduced', reducedMotion);
  }, [reducedMotion]);

  useEffect(() => {
    if (!state.user) return;
    try {
      localStorage.setItem(
        `${WINDOWS_KEY}:${encodeURIComponent(state.user)}`,
        JSON.stringify({ windows: state.windows, remembered: state.remembered, zTop: state.zTop, focused: state.focused }),
      );
    } catch {
      /* storage unavailable */
    }
  }, [state.user, state.windows, state.remembered, state.zTop, state.focused]);

  useEffect(() => {
    try {
      if (state.user) localStorage.setItem(SESSION_KEY, JSON.stringify({ user: state.user }));
      else if (state.authReady) localStorage.removeItem(SESSION_KEY);
    } catch {
      /* storage unavailable */
    }
  }, [state.user, state.authReady]);

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ theme: state.theme, motion: state.motion }));
    } catch {
      /* storage unavailable */
    }
  }, [state.theme, state.motion]);

  useEffect(() => {
    const onResize = () => dispatch({ type: 'set-viewport', viewport: { w: window.innerWidth, h: window.innerHeight } });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.altKey && e.code === 'KeyK') {
        e.preventDefault();
        dispatch({ type: 'toggle-palette' });
      } else if (e.altKey && !mod && e.code === 'KeyW') {
        e.preventDefault();
        const appId = currentState.current.focused;
        if (appId) closeWindow(appId);
      } else if (e.ctrlKey && e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        e.preventDefault();
        dispatch({ type: 'cycle-window', dir: e.key === 'ArrowRight' ? 1 : -1 });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const actions = useMemo<ShellActions>(
    () => ({
      login: (user) => dispatch({ type: 'login', user }),
      logout: () => {
        const ids = [...windowGuards.current.keys()];
        const next = () => { const id = ids.shift(); if (id) requestWindowAction(id, next); else logout(); };
        const logout = () => {
          const source = getDataSource();
          if (source.capabilities.isLive) {
            void source.logout().catch(() => {}).finally(() => dispatch({ type: 'logout' }));
          } else {
            dispatch({ type: 'logout' });
          }
        };
        next();
      },
      registerWindowGuard: (appId, guard) => { windowGuards.current.set(appId, guard); return () => { if (windowGuards.current.get(appId) === guard) windowGuards.current.delete(appId); }; },
      filesChanged: () => dispatch({ type: 'files-changed' }),
      newPreviewWindow: () => dispatch({ type: 'new-preview' }),
      newOpenCodeWindow: () => dispatch({ type: 'new-opencode' }),
      setPreviewMode: (id, mode) => dispatch({ type: 'preview-mode', id, mode }),
      emptyTrash: () => dispatch({ type: 'empty-trash' }),
      setOpenCodeProject: (id, path) => dispatch({ type: 'opencode-project', id, path }),
      openOpenCode: (path) => dispatch({ type: 'open-opencode', path }),
      openPreview: (path, edit = false, windowId) => {
        const open = () => dispatch({ type: 'open-preview', path, edit, windowId });
        if (windowId) requestWindowAction(windowId, open); else open();
      },
      openApp: (appId) => dispatch({ type: 'open-app', appId }),
      openSettings: (section) => dispatch({ type: 'open-settings', section }),
      openLibrary: (appId) => dispatch({ type: 'open-library', appId }),
      openLogs: (unit) => dispatch({ type: 'open-related', target: 'logs', unit }),
      openService: (unit) => dispatch({ type: 'open-related', target: 'services', unit }),
      closeApp: closeWindow,
      focusApp: (appId) => dispatch({ type: 'focus-app', appId }),
      minimizeApp: (appId) => dispatch({ type: 'minimize-app', appId }),
      toggleMaximize: (appId) => dispatch({ type: 'toggle-maximize', appId }),
      snapWindow: (appId, target, restore) => dispatch({ type: 'snap-window', appId, target, restore }),
      cancelWindowGesture: (appId, previous) => dispatch({ type: 'cancel-window-gesture', appId, previous }),
      updateRect: (appId, rect) => dispatch({ type: 'update-rect', appId, rect }),
      notify: (title, body) => dispatch({ type: 'notify', title, body }),
      clearNotifications: () => dispatch({ type: 'clear-notifications' }),
      toggleTheme: () => dispatch({ type: 'toggle-theme' }),
      toggleMotion: () => dispatch({ type: 'toggle-motion' }),
      setTheme: (theme) => dispatch({ type: 'set-theme', theme }),
      setMotion: (motion) => dispatch({ type: 'set-motion', motion }),
      setPalette: (open) => dispatch({ type: 'set-palette', open }),
      setNotifOpen: (open) => dispatch({ type: 'set-notif-open', open }),
      setShortcutsOpen: (open) => dispatch({ type: 'set-shortcuts-open', open }),
    }),
    [],
  );

  const value = useMemo(
    () => ({ state, actions, resolvedTheme, reducedMotion }),
    [state, actions, resolvedTheme, reducedMotion],
  );

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useReducer(
    (_: boolean, next: boolean) => next,
    false,
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  );
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

export function useShell(): ShellContextValue {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error('useShell must be used inside ShellProvider');
  return ctx;
}

export function useIsNarrow(): boolean {
  return useMediaQuery('(max-width: 700px)');
}

export function useNow(intervalMs: number): number {
  const [now, setNow] = useReducer((_: number, next: number) => next, Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
