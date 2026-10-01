// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useEffect, useRef, useState } from 'react';
import { getDataSource } from '../api/source';
import type { PiSession, PiPermissionMode } from '../api/pi';
import { useShell } from '../shell/ShellContext';
import { useCurrentWindow } from '../shell/WindowContext';

export interface PiChatEntry { key: string; project: string; session?: string; permissionMode?: PiPermissionMode; autoRetry?: boolean; running: boolean; dirty: boolean }
export function usePiChats() {
  const source = getDataSource();
  const { state } = useShell();
  const win = useCurrentWindow();
  const storage = `lumo.pi.chats:${encodeURIComponent(state.user ?? '')}:${win.id}`;
  const normalize = (path: string) => path === '~' ? source.absolutePath(source.homePath()) : path;
  const [group, setGroup] = useState<{ active: string; chats: PiChatEntry[] }>(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storage) ?? 'null');
      if (Array.isArray(saved?.chats) && saved.chats.length && saved.chats.every((chat: PiChatEntry) => typeof chat.key === 'string' && typeof chat.project === 'string') && saved.chats.some((chat: PiChatEntry) => chat.key === saved.active)) return saved;
    } catch {}
    return { active: 'initial', chats: [{ key: 'initial', project: win.projectPath ?? '~', running: false, dirty: false }] };
  });
  useEffect(() => { try { sessionStorage.setItem(storage, JSON.stringify(group)); } catch {} }, [storage, group]);
  const update = useCallback((key: string, patch: Partial<PiChatEntry>) => setGroup((previous) => {
    const entry = previous.chats.find((chat) => chat.key === key);
    if (!entry || Object.entries(patch).every(([field, value]) => entry[field as keyof PiChatEntry] === value)) return previous;
    return { ...previous, chats: previous.chats.map((chat) => chat.key === key ? { ...chat, ...patch } : chat) };
  }), []);
  const [sessionLists, setSessionLists] = useState<Record<string, PiSession[]>>({});
  const launches = useRef<Promise<unknown>>(Promise.resolve());
  const start = useCallback((project: string, session?: string, resume?: string, permissionMode?: PiPermissionMode, rememberPermissionMode = false) => {
    const next = launches.current.catch(() => {}).then(() => source.piStart(project, session, resume, permissionMode, rememberPermissionMode));
    launches.current = next;
    return next;
  }, [source]);
  const navigate = (project: string, session?: string) => setGroup((previous) => {
    const existing = session && previous.chats.find((chat) => normalize(chat.project) === normalize(project) && chat.session === session);
    const key = existing ? existing.key : crypto.randomUUID();
    return { active: key, chats: existing ? previous.chats : [...previous.chats, { key, project, session, running: false, dirty: false }] };
  });
  const forget = (project: string, sessions: string[], except: string) => setGroup((previous) => ({ ...previous, chats: previous.chats.filter((chat) => chat.key === except || normalize(chat.project) !== normalize(project) || !chat.session || !sessions.includes(chat.session)) }));
  const activate = useCallback((key: string) => setGroup((previous) => previous.chats.some((chat) => chat.key === key) ? { ...previous, active: key } : previous), []);
  return { ...group, update, navigate, activate, forget, normalize, start, sessionLists, setSessionLists };
}
