// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getDataSource } from '../api/source';
import { usePiProjectNames } from './usePiProjectNames';
import { piMessages, type PiConversationReference, type PiCommand, type PiData, type PiMessage, type PiModel, type PiSession, type PiState, type PiStats } from '../api/pi';
import { folderDrop, fileReferenceDrop } from '../shell/fileDrag';
import { useAppCatalog } from '../shell/AppCatalogContext';
import { useAppPreference, useAppState } from '../shell/useAppState';
import { useShell } from '../shell/ShellContext';
import { useCurrentWindow } from '../shell/WindowContext';
import { IconFolder, IconGear, IconHome, IconPlus, IconRefresh, IconSend, IconStop } from '../shell/icons';
import { PiTranscript } from './PiTranscript';
import { PiQueuedMessage, type QueuedMessage } from './PiQueuedMessage';
import { Select } from '../shell/Select';
import { FilePicker } from './FilePicker';
import { AttachmentCards } from './PiAttachmentCards';
import { PiEditMessage } from './PiEditMessage';
import { PiComposerInput, type PiChatAction } from './PiComposerInput';
import type { Skill } from '../api/skills';
import { PiSettings } from './PiSettings';
import { PiSidebar } from './PiSidebar';
import { PiContextMeter } from './PiContextMeter';
import { isConversationDrag, takeConversationDrag } from './piConversationReferences';
import { PiModelControl } from './PiModelControl';
import { attachmentPrompt, splitAttachmentPrompt, expandSkillCommands, attachmentKeys, fileAttachmentKey, conversationAttachmentKey } from './piAttachments';
import { AppConfirmation } from './ServerAppUI';
import '../styles/pi.css';
import { usePiChats, type PiChatEntry } from './usePiChats';

export function Pi() {
  const chats = usePiChats();
  return <>{chats.chats.map((entry) => <PiChat key={entry.key} entry={entry} active={chats.active === entry.key} chats={chats}/>)}</>;
}

function PiChat({ entry, active, chats }: { entry: PiChatEntry; active: boolean; chats: ReturnType<typeof usePiChats> }) {
  const source = getDataSource();
  const { actions, state: shellState } = useShell();
  const win = useCurrentWindow();
  const { catalog, refresh } = useAppCatalog();
  const installed = catalog?.apps.some((app) => app.id === 'pi' && app.installed);
  const [project, setProject] = useAppState<string>('pi', 'project', win.projectPath ?? '~');
  const [collapsed, setCollapsed] = useAppPreference<boolean>('pi', 'sidebar-collapsed', false);
  const [run, setRun] = useState<{ project: string; session?: string; epoch: number }>(() => ({ project: entry.project, session: entry.session, epoch: 0 }));
  const [connection, setConnection] = useState<string | null>(null);
  const { sessionLists, setSessionLists } = chats;
  const [messages, setMessages] = useState<PiMessage[]>([]);
  const [models, setModels] = useState<PiModel[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [levels, setLevels] = useState<string[]>([]);
  const [status, setStatus] = useState<PiState>({});
  const [stats, setStats] = useState<PiStats>({});
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<string[]>([]);
  const [references, setReferences] = useState<PiConversationReference[]>([]);
  const [attachmentOrder, setAttachmentOrder] = useState<string[]>([]);
  const referenceRequests = useRef(new Set<string>());
  const [referencePending, setReferencePending] = useState(0);
  const referenceGeneration = useRef(0);
  const [busy, setBusy] = useState(entry.running);
  const [working, setWorking] = useState(false);
  const [queued, setQueued] = useState<QueuedMessage[]>([]);
  const queuedMessages = useRef(queued);
  queuedMessages.current = queued;
  const [error, setError] = useState<string | null>(null);
  const [compactNotice, setCompactNotice] = useState(0);
  const [settings, setSettings] = useState(false);
  const [settingsVisited, setSettingsVisited] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [compactionPending, setCompactionPending] = useState(false);
  const [compactionRevision, setCompactionRevision] = useState(0);
  const [setup, setSetup] = useState(false);
  const [editingMessage, setEditingMessage] = useState(false);
  const streamGeneration = useRef(0);
  const eventCursor = useRef(0);
  const [streamVersion, setStreamVersion] = useState(0);
  const [moveError, setMoveError] = useState('');
  const [archiveProject, setArchiveProject] = useState<{ project: string; name: string; sessions: PiSession[]; remove?: boolean } | null>(null);
  const [projectNames] = usePiProjectNames();
  const [sessionRevision, setSessionRevision] = useState(0);
  const [rename, setRename] = useState(false);
  const [name, setName] = useState('');
  const [pendingTitle, setPendingTitle] = useState('Close Pi?');
  const [pendingClose, setPendingClose] = useState<(() => void) | null>(null);
  const [picking, setPicking] = useState<'folder' | 'file' | null>(null);
  const [remembered, setRemembered] = useAppPreference<string[]>('pi', 'projects', []);
  const [removedProjects, setRemovedProjects] = useAppPreference<string[]>('pi', 'removed-projects', []);
  const promptInput = useRef<HTMLDivElement>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const current = useRef<string | null>(null);
  const actionLock = useRef(false);
  const queueMutation = useRef(false);
  const runtimeKey = `lumo.pi.runtime:${encodeURIComponent(shellState.user ?? '')}:${win.id}${entry.key === 'initial' ? '' : `:${entry.key}`}`;
  const resume = useRef<string | undefined>(undefined);
  const resumeLoaded = useRef(false);
  if (!resumeLoaded.current) {
    try { resume.current = sessionStorage.getItem(runtimeKey) ?? undefined; } catch {}
    resumeLoaded.current = true;
  }
  const lifecycle = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    if (!installed) return;
    let disposed = false;
    void source.listSkills().then((catalog) => { if (!disposed) setSkills(catalog.skills ?? []); }).catch(() => { if (!disposed) setSkills([]); });
    return () => { disposed = true; };
  }, [installed, source, shellState.fileRevision]);

  useEffect(() => {
    if (!compactNotice) return;
    const timeout = window.setTimeout(() => setCompactNotice(0), 4000);
    return () => window.clearTimeout(timeout);
  }, [compactNotice]);

  const anyRunning = chats.chats.some((chat) => chat.running);
  const anyDirty = chats.chats.some((chat) => chat.dirty);
  useLayoutEffect(() => { if (!active) return; return actions.registerWindowGuard(win.id, (proceed) => {
    if (anyRunning || anyDirty || draft.trim() || attachments.length || references.length || referencePending || settingsDirty) { setPendingTitle('Close Pi?'); setPendingClose(() => proceed); } else proceed();
  }); }, [active, actions, win.id, anyRunning, anyDirty, draft, attachments.length, references.length, referencePending, settingsDirty]);

  async function command(id: string, value: PiCommand): Promise<PiData> {
    const reply = await source.piCommand(id, value);
    if (!reply.success) throw new Error(reply.error || 'Pi could not complete that action.');
    return reply.data ?? {};
  }
  async function loadState(id: string, folder: string, history = false) {
    const generation = streamGeneration.current;
    const [state, available, thinking, usage, list, log] = await Promise.all([
      command(id, { type: 'get_state' }), command(id, { type: 'get_available_models' }),
      command(id, { type: 'get_available_thinking_levels' }), command(id, { type: 'get_session_stats' }),
      source.piSessions(folder), history ? source.piCommand(id, { type: 'get_messages' }) : Promise.resolve(null),
    ]);
    if (current.current !== id || generation !== streamGeneration.current) return;
    setStatus(state); setModels(available.models ?? []); setLevels(thinking.levels ?? ['off']); setStats(usage);
    const folderKey = folder === '~' ? source.absolutePath(source.homePath()) : folder;
    setSessionLists((lists) => ({ ...lists, [folderKey]: list }));
    setBusy(Boolean(state.isStreaming || state.isCompacting));
    if (log) {
      if (!log.success) throw new Error(log.error || 'Could not load conversation.');
      setMessages(log.data?.messages ?? []);
      if (Number.isSafeInteger(log.eventCursor)) eventCursor.current = log.eventCursor!;
    }
  }
  const chatRevision = chats.chats.map((chat) => `${chat.project}/${chat.session}:${chat.running}`).join('|');
  useEffect(() => {
    if (!active || !installed) return;
    let disposed = false;
    void source.piSessions(run.project).then((list) => {
      if (!disposed) setSessionLists((lists) => ({ ...lists, [chats.normalize(run.project)]: list }));
    }).catch(() => {});
    return () => { disposed = true; };
  }, [active, installed, run.project, chatRevision]);
  const keepAlive = active || busy;
  const savedSession = useRef(entry.session);
  useEffect(() => {
    if (active) actions.setPiProject(win.id, chats.normalize(run.project));
  }, [active, run.project, actions, win.id]);
  useEffect(() => {
    const session = status.sessionFile?.split('/').at(-1) ?? savedSession.current ?? run.session;
    if (session) savedSession.current = session;
    chats.update(entry.key, { project: run.project, session, running: busy, dirty: Boolean(draft.trim() || attachments.length || references.length || settingsDirty) });
  }, [run.project, run.session, status.sessionFile, busy, draft, attachments.length, references.length, settingsDirty, entry.key, chats.update]);
  useEffect(() => {
    if (!keepAlive) { setConnection(null); return; }
    if (!run || !installed || setup) return;
    let disposed = false; let id: string | null = null;
    setWorking(true); setConnection(null); setError(null); setMessages([]); setQueued([]); setStatus({}); setStats({});
    const launch = lifecycle.current.catch(() => {}).then(async () => {
      if (disposed) return;
      const result = await chats.start(run.project, savedSession.current ?? run.session, resume.current);
      resume.current = undefined;
      id = result.id;
      if (disposed) return;
      current.current = id;
      try { sessionStorage.setItem(runtimeKey, id); } catch {}
      eventCursor.current = 0;
      await loadState(id, run.project, true);
      if (!disposed) { setConnection(id); setCompactionRevision((value) => value + 1); }
    }).catch(async (err) => {
      if (disposed) return;
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      try {
        const list = await source.piSessions(run.project);
        const folder = run.project === '~' ? source.absolutePath(source.homePath()) : run.project;
        if (!disposed) setSessionLists((lists) => ({ ...lists, [folder]: list }));
      } catch {}
    }).finally(() => { if (!disposed) setWorking(false); });
    lifecycle.current = launch;
    return () => {
      disposed = true; current.current = null;
      lifecycle.current = launch.then(async () => { if (id) {
        try { if (sessionStorage.getItem(runtimeKey) === id) sessionStorage.removeItem(runtimeKey); } catch {}
        await source.piStop(id);
      } }).catch(() => {});
    };
  }, [run, installed, setup, keepAlive]);

  useEffect(() => {
    if (!connection || !run) return;
    let disposed = false; let cursor = eventCursor.current; const generation = streamGeneration.current;
    void (async () => {
      while (!disposed) {
        const batch = await source.piEvents(connection, cursor);
        if (disposed || generation !== streamGeneration.current) return;
        cursor = batch.cursor; eventCursor.current = cursor;
        for (const event of batch.events) {
          const incoming = event.message;
          const incomingText = incoming?.role === 'user' ? typeof incoming.content === 'string' ? incoming.content : incoming.content.map((block) => block.text ?? '').join('') : undefined;
          const delivery = incomingText == null ? undefined : queuedMessages.current.find((item) => item.text === incomingText)?.type;
          const received = incoming && delivery ? { ...event, message: { ...incoming, delivery } } : event;
          setMessages((items) => piMessages(items, received));
          if (event.type === 'message_start' && event.message?.role === 'user') {
            const message = event.message;
            const text = typeof message.content === 'string' ? message.content : message.content.map((block) => block.text ?? '').join('');
            setQueued((items) => { const index = items.findIndex((item) => item.text === text); return index < 0 ? items : items.filter((_, i) => i !== index); });
          }
          if (event.type === 'message_end' && event.message?.role === 'assistant') { void command(connection, { type: 'get_session_stats' }).then((usage) => { if (!disposed && generation === streamGeneration.current) setStats(usage); }).catch(() => {}); }
          if (event.type === 'agent_start') { setBusy(true); }
          if (event.type === 'auto_compaction_start') { setBusy(true); }
          if (event.type === 'agent_settled') { setBusy(false); if (!queueMutation.current) setQueued([]); void loadState(connection, run.project).catch((err) => { if (!disposed && generation === streamGeneration.current) setError(err instanceof Error ? err.message : 'Something went wrong.'); }); }
          if (event.message?.errorMessage) setError(event.message.errorMessage);
          if (event.error) setError(event.error);
        }
        if (batch.closed) throw new Error('Pi stopped. Reopen this session to continue.');
      }
    })().catch((err) => { if (!disposed && generation === streamGeneration.current) { setError(err instanceof Error ? err.message : 'Something went wrong.'); setConnection(null); setBusy(false); } });
    return () => { disposed = true; };
  }, [connection, run, streamVersion]);
  useEffect(() => { if (follow.current) transcript.current?.scrollTo({ top: transcript.current.scrollHeight }); }, [messages]);
  useEffect(() => {
    if (!active || !compactionPending || !connection || busy || working || setup || settingsBusy || queued.length || actionLock.current) return;
    setCompactionPending(false); setWorking(true); streamGeneration.current++; resume.current = undefined;
    setRun((currentRun) => ({ ...currentRun, session: status.sessionFile?.split('/').at(-1) ?? currentRun.session, epoch: Date.now() }));
  }, [compactionPending, connection, busy, working, setup, settingsBusy, queued.length, status.sessionFile]);

  async function act(value: PiCommand, reload = true) {
    if (!connection || actionLock.current) return;
    actionLock.current = true; setWorking(true); setError(null);
    try { await command(connection, value); if (reload && run) await loadState(connection, run.project); return true; }
    catch (err) {
      if (value.type === 'set_model' || value.type === 'set_thinking_level') await loadState(connection, run.project).catch(() => {});
      const message = err instanceof Error ? err.message : 'Something went wrong.';
      if (value.type === 'compact' && /^Nothing to compact\b/i.test(message)) setCompactNotice(Date.now());
      else setError(message);
      return false;
    }
    finally { actionLock.current = false; setWorking(false); }
  }
  async function send() {
    const slash = /^\s*\/(undo|rename|compact)(?:\s+([\s\S]*))?$/.exec(draft);
    if (slash) {
      const action = slash[1] as PiChatAction;
      if (chatActionDisabled(action)) { setError('Wait until Pi is idle and this conversation has messages.'); return; }
      runChatAction(action, slash[2] ?? '');
      return;
    }
    const text = expandSkillCommands(attachmentPrompt(draft, attachments, references, attachmentOrder), skills); if (!text || !connection || actionLock.current || referencePending) return;
    if (references.length > 8) { setError('Attach up to 8 conversations per message. Remove some references before sending.'); return; }
    actionLock.current = true; setWorking(true); setError(null); follow.current = true;
    const pending: QueuedMessage | null = busy ? { id: crypto.randomUUID(), text, type: 'follow_up' } : null;
    try {
      for (const reference of references) await source.piReference(reference.project, reference.session);
      if (pending) setQueued((items) => [...items, pending]);
      const reply = await command(connection, { type: pending ? 'follow_up' : 'prompt', message: text });
      rememberWorkspace(run.project);
      setDraft((value) => value === draft ? '' : value);
      const sentKeys = new Set(attachmentKeys(attachments, references));
      setAttachmentOrder((items) => items.filter((key) => !sentKeys.has(key)));
      setAttachments((items) => items.filter((path) => !attachments.includes(path)));
      setReferences((items) => items.filter((reference) => !references.some((sent) => sent.path === reference.path)));
      if (pending && (reply.disposition === 'started' || reply.disposition === 'handled')) setQueued((items) => items.filter((item) => item.id !== pending.id));
      if (!pending && reply.disposition !== 'handled') { setBusy(true); void loadState(connection, run.project).catch(() => {}); }
    } catch (err) { if (pending) setQueued((items) => items.filter((item) => item.id !== pending.id)); setError(err instanceof Error ? err.message : 'Something went wrong.'); }
    finally { actionLock.current = false; setWorking(false); }
  }
  function chatActionDisabled(action: PiChatAction) { return busy || working || !connection || !messages.length || (action === 'undo' && !messages.some((message) => message.role === 'user')); }
  function runChatAction(action: PiChatAction, remaining: string) {
    if (chatActionDisabled(action)) return;
    setDraft(remaining);
    if (action === 'undo') setEditingMessage(true);
    else if (action === 'rename') { setName(status.sessionName ?? ''); setRename(true); }
    else void act({ type: 'compact' });
  }
  function restoreQueue(data: PiData) {
    const restored = [...(data.steering ?? []), ...(data.followUp ?? [])].map(splitAttachmentPrompt);
    const text = restored.map((item) => item.text).filter(Boolean).join('\n\n');
    setAttachmentOrder((items) => [...new Set([...items, ...restored.flatMap((item) => attachmentKeys(item.paths, item.references, item.order))])]);
    const paths = restored.flatMap((item) => item.paths);
    const chats = restored.flatMap((item) => item.references);
    if (chats.length) setReferences((items) => [...new Map([...items, ...chats].map((item) => [item.path, item])).values()]);
    if (paths.length) setAttachments((items) => [...new Set([...items, ...paths])]);
    if (text) setDraft((value) => [value, text].filter(Boolean).join('\n\n'));
    setQueued([]);
    return Boolean(text || paths.length || chats.length);
  }
  async function stop() {
    if (!connection || actionLock.current) return;
    actionLock.current = true; setWorking(true); setError(null);
    try {
      restoreQueue(await command(connection, { type: 'clear_queue' }));
      await command(connection, { type: 'abort' });
      await loadState(connection, run.project, true);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not stop Pi.'); }
    finally { actionLock.current = false; setWorking(false); }
  }
  async function changeQueued(item: QueuedMessage, action: 'edit' | 'delete' | 'send', text?: string) {
    if (!connection || actionLock.current) return false;
    actionLock.current = true; setWorking(true); setError(null);
    queueMutation.current = true;
    let pending: QueuedMessage[] = [];
    try {
      const data = await command(connection, { type: 'clear_queue' });
      const available = [...queued];
      pending = (['steer', 'follow_up'] as const).flatMap((type) => (type === 'steer' ? data.steering ?? [] : data.followUp ?? []).map((value) => {
        const index = available.findIndex((entry) => entry.text === value && entry.type === type);
        return index < 0 ? { id: crypto.randomUUID(), text: value, type } : available.splice(index, 1)[0];
      }));
      const ambiguous = pending.filter((entry) => entry.text === item.text).length !== queued.filter((entry) => entry.text === item.text).length;
      const target = !ambiguous && pending.find((entry) => entry.id === item.id);
      if (target) {
        if (action === 'delete') pending = pending.filter((entry) => entry.id !== item.id);
        else if (action === 'edit') pending = pending.map((entry) => entry.id === item.id ? { ...entry, text: expandSkillCommands(text!, skills) } : entry);
        else pending = [{ ...target, type: 'steer' }, ...pending.filter((entry) => entry.id !== item.id)];
      }
      setQueued([...pending]);
      while (pending.length) {
        const next = pending[0];
        const reply = await command(connection, { type: next.type, message: next.text });
        if (reply.disposition === 'started' || reply.disposition === 'handled') setQueued((items) => items.filter((entry) => entry.id !== next.id));
        pending.shift();
      }
      await loadState(connection, run.project);
      if (!target) { setError('That message has already started. Stop the reply, then use /undo.'); return false; }
      return true;
    } catch (err) {
      if (pending.length) {
        const ids = new Set(pending.map((entry) => entry.id));
        setQueued((items) => items.filter((entry) => !ids.has(entry.id)));
        const restored = pending.map((entry) => splitAttachmentPrompt(entry.text));
        setAttachmentOrder((items) => [...new Set([...items, ...restored.flatMap((item) => attachmentKeys(item.paths, item.references, item.order))])]);
        setDraft((value) => [value, ...restored.map((entry) => entry.text)].filter(Boolean).join('\n\n'));
        setAttachments((items) => [...new Set([...items, ...restored.flatMap((entry) => entry.paths)])]);
        setReferences((items) => [...new Map([...items, ...restored.flatMap((entry) => entry.references)].map((entry) => [entry.path, entry])).values()]);
      }
      setError((err instanceof Error ? err.message : 'Could not update the queue.') + (pending.length ? ' Unsent messages were returned to the composer.' : ''));
      return false;
    } finally { queueMutation.current = false; actionLock.current = false; setWorking(false); }
  }
  async function resend(entryId: string, text: string) {
    if (!connection || !run || busy || actionLock.current) throw new Error('Stop the current reply before editing an earlier message.');
    actionLock.current = true; setWorking(true); setError(null);
    streamGeneration.current++;
    let forked = false;
    try {
      for (const reference of splitAttachmentPrompt(text).references) await source.piReference(reference.project, reference.session);
      const result = await source.piCommand(connection, { type: 'fork', entryId });
      if (!result.success) throw new Error(result.error || 'Could not create a new chat.');
      if (result.data?.cancelled) throw new Error('Pi cancelled the new chat. Your original conversation is unchanged.');
      forked = true;
      if (!Number.isSafeInteger(result.eventCursor) || result.eventCursor! < 0) throw new Error('Reconnect Pi before continuing this chat.');
      eventCursor.current = result.eventCursor!;
      await loadState(connection, run.project, true);
      setEditingMessage(false); follow.current = true;
      setStreamVersion((value) => value + 1);
      const reply = await command(connection, { type: 'prompt', message: expandSkillCommands(text, skills) });
      if (reply.disposition !== 'handled') { setBusy(true); }
    } catch (err) {
      if (forked) {
        setEditingMessage(false);
        restoreQueue({ steering: [text] });
        setError(err instanceof Error ? err.message : 'Could not send. Your edited message is kept below.');
      } else throw err;
    } finally {
      setStreamVersion((value) => value + 1);
      actionLock.current = false; setWorking(false);
    }
  }
  async function branch() {
    if (!connection || busy || actionLock.current) return;
    actionLock.current = true; setWorking(true); setError(null);
    streamGeneration.current++;
    try {
      const result = await source.piCommand(connection, { type: 'clone' });
      if (!result.success) throw new Error(result.error || 'Could not branch this chat.');
      if (result.data?.cancelled) throw new Error('Pi cancelled the branch. Your original chat is unchanged.');
      if (!Number.isSafeInteger(result.eventCursor) || result.eventCursor! < 0) throw new Error('Reconnect Pi before continuing this chat.');
      eventCursor.current = result.eventCursor!;
      await loadState(connection, run.project, true);
      promptInput.current?.focus();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not branch this chat.'); }
    finally { setStreamVersion((value) => value + 1); actionLock.current = false; setWorking(false); }
  }
  function rememberWorkspace(folder: string) {
    const path = folder === '~' ? source.absolutePath(source.homePath()) : folder;
    setRemovedProjects((items) => items.filter((item) => item !== path));
    setRemembered((items) => items.includes(path) ? items : [path, ...items].slice(0, 30));
  }
  function open(session?: string, folder = project, preserveDraft = false, remember = true) {
    resume.current = undefined; savedSession.current = session; setStatus({});
    const path = folder.trim() || '~';
    if (path !== '~' && !path.startsWith('/')) { setError('Use an absolute folder path, or ~ for your home folder.'); return; }
    if (remember) rememberWorkspace(path);
    setProject(path); setRun({ project: path, session, epoch: Date.now() }); if (!preserveDraft) { setDraft(''); setAttachments([]); setReferences([]); setAttachmentOrder([]); referenceRequests.current = new Set(); referenceGeneration.current++; } follow.current = true;
  }
  const sessionID = status.sessionFile?.split('/').at(-1) ?? savedSession.current ?? run.session;
  async function moveConversation(folder: string, target: string | string[], restore = false, removeWorkspace = false) {
    if (actionLock.current || busy || chats.chats.some((chat) => chat.running && chats.normalize(chat.project) === folder && (removeWorkspace || (typeof target === 'string' ? [target] : target).includes(chat.session ?? '')))) throw new Error('Stop this conversation before archiving it.');
    actionLock.current = true; setWorking(true); setError(null); setMoveError('');
    const activeFolder = (run.project === '~' ? source.absolutePath(source.homePath()) : run.project);
    const sameProject = folder === activeFolder;
    const id = connection;
    let stopped = false;
    let targets = typeof target === 'string' ? [target] : [...new Set(target)];
    const moved = new Set<string>();
    let removed = false;
    try {
      if (sameProject && id) {
        streamGeneration.current++; setConnection(null); current.current = null;
        await source.piStop(id); stopped = true; resume.current = undefined;
        try { sessionStorage.removeItem(runtimeKey); } catch {}
      }
      if (removeWorkspace) targets = (await source.piSessions(folder)).map((item) => item.id);
      for (const id of targets) {
        if (restore) await source.piRestoreSession(folder, id); else await source.piArchiveSession(folder, id);
        moved.add(id);
        if (!restore) setSessionLists((lists) => ({ ...lists, [folder]: (lists[folder] ?? []).filter((item) => item.id !== id) }));
      }
      if (removeWorkspace) {
        if ((await source.piSessions(folder)).length) throw new Error('New chats appeared in this workspace. Try removing it again.');
        setRemovedProjects((items) => [...new Set([...items, folder])]);
        setRemembered((items) => items.filter((item) => item !== folder));
        removed = true;
      }
    } finally {
      let saved: PiSession[] = [];
      if (stopped || moved.size) {
        try { saved = await source.piSessions(folder); setSessionLists((lists) => ({ ...lists, [folder]: saved })); } catch {}
      }
      if (moved.size) {
        if (!restore) chats.forget(folder, [...moved], entry.key);
        if (restore) rememberWorkspace(folder);
        setSessionRevision((value) => value + 1);
      }
      const reopen = restore && moved.size ? [...moved].at(-1) : saved.some((item) => item.id === sessionID) ? sessionID : undefined;
      if (stopped || (sameProject && moved.size)) open(removed ? undefined : reopen, activeFolder, true, !removed);
      else if (sameProject && id) { current.current = id; setConnection(id); setStreamVersion((value) => value + 1); }
      actionLock.current = false; setWorking(false);
    }
  }
  const empty = messages.length === 0;
  const loading = !connection && !error;
  const workspace = run.project;
  const hasDraft = Boolean(draft.trim() || attachments.length || references.length);
  const showStop = busy && !hasDraft;
  const workspaces = [...new Set([workspace, ...remembered.filter((path) => !removedProjects.includes(path))])];
  function attach(paths: string[]) { if (working) return; setAttachments((items) => [...new Set([...items, ...paths])]); setAttachmentOrder((items) => [...new Set([...items, ...paths.map(fileAttachmentKey)])]); promptInput.current?.focus(); }
  async function referenceConversation(folder: string, session: PiSession) {
    if (working || references.length + referencePending >= 8) { setError('Wait for the current action, or remove a reference before adding more. You can attach up to 8 chats.'); return; }
    const key = conversationAttachmentKey({ project: chats.normalize(folder), session: session.id });
    const requests = referenceRequests.current;
    if (requests.has(key) || references.some((item) => conversationAttachmentKey(item) === key)) return;
    requests.add(key); setAttachmentOrder((items) => [...items, key]);
    const generation = referenceGeneration.current; setReferencePending((count) => count + 1); setError(null);
    try {
      const reference = { ...await source.piReference(chats.normalize(folder), session.id), name: session.name };
      if (generation === referenceGeneration.current) setReferences((items) => items.some((item) => item.path === reference.path) ? items : [...items, reference].slice(0, 8));
      promptInput.current?.focus();
    } catch (err) { if (generation === referenceGeneration.current) { setAttachmentOrder((items) => items.filter((item) => item !== key)); setError(err instanceof Error ? err.message : 'Could not reference this conversation.'); } }
    finally { requests.delete(key); setReferencePending((count) => count - 1); }
  }
  const fileDrop = fileReferenceDrop(attach);
  const composerDrop = {
    onDragOver(event: React.DragEvent<HTMLElement>) {
      if (!isConversationDrag(event)) { fileDrop.onDragOver(event); return; }
      event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = working ? 'none' : 'copy';
      if (!working) event.currentTarget.dataset.fileDropTarget = 'true';
    },
    onDragLeave: fileDrop.onDragLeave,
    onDrop(event: React.DragEvent<HTMLElement>) {
      if (!isConversationDrag(event)) { fileDrop.onDrop(event); return; }
      event.preventDefault(); event.stopPropagation(); delete event.currentTarget.dataset.fileDropTarget;
      const item = takeConversationDrag(event);
      if (item) void referenceConversation(item.project, { id: item.session, name: item.name, modified: '' });
    },
  };
  function chooseProject(path: string) { if (busy || working) return; setError(null); open(undefined, path, true); }

  if (!active) return null;
  return <div className="app pi-app" data-testid="app-pi">
    {compactNotice !== 0 && <div className="pi-notification" key={compactNotice} role="status" data-testid="pi-notification"><span>Nothing to compact yet</span></div>}
    <nav className="pi-app-rail" aria-label="Pi navigation" data-testid="pi-app-rail">
      <button type="button" aria-label="Home" title="Home" data-testid="pi-home-button" aria-current={!settings ? 'page' : undefined} disabled={settingsBusy} onClick={() => { setSetup(false); setSettings(false); }}><IconHome size={20}/></button>
      <button type="button" aria-label="Settings" title="Settings" data-testid="pi-settings-button" aria-current={settings ? 'page' : undefined} onClick={() => { setSettingsVisited(true); setSettings(true); }}><IconGear size={20}/></button>
    </nav>
    {installed && !settings && <PiSidebar collapsed={collapsed} project={workspace} session={sessionID} sessions={sessionLists[workspace === '~' ? source.absolutePath(source.homePath()) : workspace]} disabled={working || settings || !!referencePending} navigationDisabled={actionLock.current || settings || !!referencePending} running={chats.chats.filter((chat) => chat.running).map((chat) => `${chats.normalize(chat.project)}/${chat.session}`)} onReference={(folder, session) => void referenceConversation(folder, session)} onRemoveProject={(path, name) => setArchiveProject({ project: path, name, sessions: [], remove: true })}
      onNew={() => chats.navigate(run.project)} onNewProject={(path) => chats.navigate(path)} onArchiveProject={(path, name, sessions) => setArchiveProject({ project: path, name, sessions })} onOpen={(path, id) => chats.navigate(path, id)}
      revision={`${sessionRevision}:${chatRevision}`} onArchive={(path, item) => { void moveConversation(path, item.id).catch((err) => setMoveError(err instanceof Error ? err.message : 'Could not archive this conversation.')); }} onCollapse={() => setCollapsed((value) => !value)}/>}
    {settingsVisited && <div className="pi-settings-host" hidden={!settings}><PiSettings onCompactionSaved={() => setCompactionPending(true)} compactionRevision={compactionRevision} compactionPending={compactionPending || working} installed={Boolean(installed)} provider={status.model?.provider} model={status.model} models={models} setup={setup} disabled={busy || working} onDirty={setSettingsDirty} onBusy={setSettingsBusy} revision={sessionRevision} onRestore={(folder, id) => moveConversation(folder, id, true)}
      onConnect={() => { if (run) setRun({ ...run, session: sessionID }); setSetup(true); }} onDone={() => setSetup(false)}/></div>}
    {settings ? null : !installed ? <div className="pi-welcome">
      <div className="pi-welcome-mark" aria-hidden="true">π</div><h1>Pi</h1>
      <div className="pi-install"><p>{catalog ? 'Install Pi to start working with your projects.' : 'Checking for Pi…'}</p><button className="btn btn-primary" onClick={() => actions.openApp('library')}>Open App Library</button><button className="btn btn-icon" aria-label="Check installation" onClick={() => void refresh().catch((err) => setError(err instanceof Error ? err.message : 'Something went wrong.'))}><IconRefresh size={16}/></button></div>
    </div> : <>
      <main className={`pi-main${empty && !loading ? ' pi-new-conversation' : ''}`} aria-busy={loading}>
          {loading ? <div className="pi-conversation-loading" role="status" aria-label="Loading conversation" data-testid="pi-conversation-loading"><span className="spinner" aria-hidden="true"/></div> : <>
          {(moveError || error) && <div className="pi-notice" role="alert">{moveError || error}{!connection && !working && <button className="btn" onClick={() => open(sessionID)}>Reconnect</button>}</div>}
          {!empty && <PiTranscript key={`${connection}-${status.sessionFile ?? ''}`} messages={messages} busy={busy} canBranch={!busy && !working} onBranch={() => void branch()} transcript={transcript} onFollow={(value) => { follow.current = value; }}/>}
          <footer className="pi-compose">
            {empty && <h1>What should we work on?</h1>}
            {queued.length > 0 && <div className="pi-queued" aria-label="Queued messages">{queued.map((item) => <PiQueuedMessage key={item.id} item={item} disabled={working || !connection} onChange={changeQueued}/>)}</div>}
            <form {...composerDrop} onSubmit={(event) => { event.preventDefault(); void send(); }}>
              {referencePending > 0 && <span className="pi-reference-loading" role="status">Attaching conversation…</span>}
              <AttachmentCards paths={attachments} references={references} order={attachmentOrder} onRemoveReference={(path) => { const reference = references.find((item) => item.path === path); if (reference) setAttachmentOrder((items) => items.filter((key) => key !== conversationAttachmentKey(reference))); setReferences((items) => items.filter((item) => item.path !== path)); }} disabled={working} onRemove={(path) => { setAttachmentOrder((items) => items.filter((key) => key !== fileAttachmentKey(path))); setAttachments((items) => items.filter((item) => item !== path)); }}/>
              <PiComposerInput value={draft} onChange={setDraft} onSend={() => void send()} onAction={runChatAction} inputRef={promptInput} skills={skills} disabled={!connection} actionDisabled={chatActionDisabled}/>
              <div className="pi-compose-controls">
                <button className="btn btn-ghost pi-attach" type="button" aria-label="Attach file path" title="Attach file path" disabled={working} onClick={() => setPicking('file')}><IconPlus size={18}/></button>
                <div className="pi-model-controls">
                {!empty && <PiContextMeter stats={stats} model={status.model}/>}
                <PiModelControl model={status.model} models={models} levels={levels} level={status.thinkingLevel} disabled={busy || working}
                  onModel={(model) => act({ type: 'set_model', provider: model.provider, modelId: model.id })} onLevel={(level) => act({ type: 'set_thinking_level', level })}/>
                </div>
                <div className="pi-send-controls">
                  <button className="btn btn-primary btn-icon pi-send-button" data-testid="pi-send" type={showStop ? 'button' : 'submit'} aria-label={showStop ? 'Stop' : 'Send'} title={showStop ? 'Stop' : 'Send'} onClick={showStop ? () => void stop() : undefined} disabled={!connection || working || !!referencePending || (!busy && !hasDraft)}>{showStop ? <IconStop size={18}/> : <IconSend size={20}/>}</button>
                </div>
              </div>
            </form>
            {empty && <div className="pi-workspace" data-testid="pi-project-drop" {...folderDrop(chooseProject, () => setError('Drag one server folder to select a workspace.'))}>
              <IconFolder size={16}/><Select aria-label="Workspace project" data-testid="pi-project" value={workspace} disabled={busy || working} options={[...workspaces.map((path) => ({ value: path, label: projectNames[path] || (path === '~' ? 'Home' : path.split('/').filter(Boolean).at(-1) || '/') })), { value: '__browse__', label: 'Choose another folder…' }]} onChange={(path) => path === '__browse__' ? setPicking('folder') : chooseProject(path)}/>
            </div>}
          </footer>
          </>}
      </main>
    </>}

    {picking && <FilePicker mode={picking} initialPath={workspace === '~' ? source.homePath() : ['', ...workspace.split('/').filter(Boolean)]} onCancel={() => setPicking(null)} onOpen={(path) => { setPicking(null); if (picking === 'folder') chooseProject(source.absolutePath(path)); else attach([source.absolutePath(path)]); }}/>}
    {editingMessage && connection && <PiEditMessage connection={connection} onCancel={() => setEditingMessage(false)} onResend={resend}/>}
    {archiveProject && <AppConfirmation title={archiveProject.remove ? 'Remove workspace?' : 'Archive workspace chats?'} confirm={archiveProject.remove ? 'Remove workspace' : `Archive ${archiveProject.sessions.length} chats`} busy={working} confirmDisabled={busy} onCancel={() => setArchiveProject(null)} onConfirm={() => { void moveConversation(archiveProject.project, archiveProject.sessions.map((item) => item.id), false, archiveProject.remove).catch((err) => setMoveError((err instanceof Error ? err.message : 'Could not archive every chat.') + (archiveProject.remove ? ' The workspace was kept. Archived chats remain available in Settings.' : ' Any completed moves are available in Archived chats.'))).finally(() => setArchiveProject(null)); }}><p>{archiveProject.remove ? `Remove “${archiveProject.name}” from the sidebar and archive all its chats? Your files stay in place. Chats can be restored in Settings → Archived chats.` : `Archive ${archiveProject.sessions.length} saved conversations in “${archiveProject.name}”? You can restore them in Settings → Archived chats.`}</p></AppConfirmation>}
    {rename && <AppConfirmation title="Rename conversation" confirm="Save" busy={working} confirmDisabled={!name.trim()} onCancel={() => setRename(false)} onConfirm={() => { void act({ type: 'set_session_name', name: name.trim() }).then((ok) => { if (ok) setRename(false); }); }}><input className="input" aria-label="Conversation name" value={name} onChange={(event) => setName(event.target.value)}/></AppConfirmation>}
    {pendingClose && <AppConfirmation title={pendingTitle} confirm="Close" onCancel={() => setPendingClose(null)} onConfirm={pendingClose}><p>{anyRunning ? 'This stops the current task and any other running chats in this window. Your conversations are saved.' : settingsDirty ? 'Your unsaved settings will be discarded.' : 'Your unsent message will be discarded.'}</p></AppConfirmation>}
  </div>;
}
