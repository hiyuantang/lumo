// SPDX-License-Identifier: AGPL-3.0-only
import { createPortal } from 'react-dom';
import { PiAssistantFrame } from '@lumo/sdk/shell/PiAssistantFrame';
import { piSettingsSaved } from './pi-settings-notifications';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getDataSource } from '@lumo/sdk/api/source';
import { usePiProjectNames } from './usePiProjectNames';
import { piMessages, piRetryMessage, piPermissionModes, type PiPermissionMode, type PiQuestion, type PiAnswer, type PiConversationReference, type PiCommand, type PiData, type PiMessage, type PiModel, type PiSession, type PiState, type PiStats } from '@lumo/sdk/api/pi';
import { folderDrop, fileReferenceDrop } from '@lumo/sdk/shell/fileDrag';
import { useAppCatalog } from '@lumo/sdk/shell/AppCatalogContext';
import { useAppPreference, useAppState } from '@lumo/sdk/shell/useAppState';
import { useShell } from '@lumo/sdk/shell/ShellContext';
import { useCurrentWindow } from '@lumo/sdk/shell/WindowContext';
import { IconFolder, IconGear, IconHome, IconPlus, IconSend, IconStop, IconSidebar, IconNewChat } from '@lumo/sdk/shell/icons';
import { PiQuestionCard } from './PiQuestionCard';
import { PiTranscript } from './PiTranscript';
import { PiQueuedMessage, type QueuedMessage } from './PiQueuedMessage';
import { Select } from '@lumo/sdk/shell/Select';
import { FilePicker } from '@lumo/sdk/apps/FilePicker';
import { AttachmentCards } from './PiAttachmentCards';
import { PiEditMessage } from './PiEditMessage';
import { PiComposerInput, type PiChatAction } from './PiComposerInput';
import type { Skill } from '@lumo/sdk/api/skills';
import { PiEngine } from './PiEngine';
import { PiSettings } from './PiSettings';
import { PiSidebar } from './PiSidebar';
import { PiImageScope } from './PiImages';
import { templateCatalog, expandTemplateCommand } from './piTemplates';
import { bytesToBase64 } from '@lumo/sdk/api/encoding';
import type { PiTemplate } from '@lumo/sdk/api/pi';
import { PiContextMeter } from './PiContextMeter';
import { PiSessionMetrics } from './PiSessionMetrics';
import { isConversationDrag, takeConversationDrag } from './piConversationReferences';
import { PiModelControl } from './PiModelControl';
import { PiCompactChat } from './PiCompactChat';
import { PiConversationLocation, usePiConversationWindows } from './PiConversationLocation';
import { ApiError } from '@lumo/sdk/api/transport';
import { attachmentPrompt, splitAttachmentPrompt, expandSkillCommands, attachmentKeys, fileAttachmentKey, conversationAttachmentKey } from './piAttachments';
import { AppConfirmation } from '@lumo/sdk/apps/ServerAppUI';
import './pi.css';
import { useLumoUse } from './useLumoUse';
import { usePiChats, type PiChatEntry } from './usePiChats';

import type { AssistantRequest as PiAssistantRequest } from '@lumo/sdk/api/app-plugins';

export function Pi({ compact = false, onAttention, assistantRequest }: { compact?: boolean; onAttention?: () => void; assistantRequest?: PiAssistantRequest }) {
  const chats = usePiChats();
  const handled = useRef<string>();
  const workspaceTarget = useRef<{ id: string; key: string }>();
  if (assistantRequest?.action === 'workspace' && workspaceTarget.current?.id !== assistantRequest.id) workspaceTarget.current = { id: assistantRequest.id, key: chats.active };
  useEffect(() => {
    if (!compact || assistantRequest?.action !== 'new' || handled.current === assistantRequest.id) return;
    handled.current = assistantRequest.id;
    chats.navigate(chats.chats.find((entry) => entry.key === chats.active)?.project ?? '~');
  }, [compact, assistantRequest, chats]);
  return <>{chats.chats.map((entry) => <PiChat key={entry.key} entry={entry} active={chats.active === entry.key} chats={chats} compact={compact} onAttention={onAttention} assistantRequest={workspaceTarget.current?.key === entry.key ? assistantRequest : undefined}/>)}</>;
}

function PiChat({ entry, active, chats, compact, onAttention, assistantRequest }: { entry: PiChatEntry; active: boolean; chats: ReturnType<typeof usePiChats>; compact: boolean; onAttention?: () => void; assistantRequest?: PiAssistantRequest }) {
  const source = getDataSource();
  const floating = !compact && Boolean(entry.floating);
  const floatingId = `pi-chat-assistant-${entry.key}`;
  const { actions, state: shellState } = useShell();
  const win = useCurrentWindow();
  const { catalog } = useAppCatalog();
  const installed = catalog?.apps.some((app) => app.id === 'pi' && app.installed);
  const [project, setProject] = useAppState<string>('pi', 'project', win.projectPath ?? '~');
  const [collapsed, setCollapsed] = useAppPreference<boolean>('pi', 'sidebar-collapsed', false);
  const [run, setRun] = useState<{ project: string; session?: string; permissionMode?: PiPermissionMode; epoch: number }>(() => ({ project: entry.project, session: entry.session, permissionMode: piPermissionModes.some((mode) => mode.value === entry.permissionMode) ? entry.permissionMode! : undefined, epoch: 0 }));
  const [confirmedPermissionMode, setConfirmedPermissionMode] = useState<PiPermissionMode>();
  const rememberPermissionMode = useRef<PiPermissionMode>();
  const [connection, setConnection] = useState<string | null>(null);
  const { sessionLists, setSessionLists } = chats;
  const [messages, setMessages] = useState<PiMessage[]>([]);
  const [templates, setTemplates] = useState<PiTemplate[]>(templateCatalog([]));
  const [templatesRevision, setTemplatesRevision] = useState(0);
  const [autoRetry, setAutoRetry] = useState(entry.autoRetry ?? true);
  const [questions, setQuestions] = useState<PiQuestion[]>([]);
  useEffect(() => { if (active && questions.length) onAttention?.(); }, [active, questions.length, onAttention]);
  const answeredQuestions = useRef(new Set<string>());
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
  useEffect(() => {
    const key = `${win.id}:${entry.key}`;
    actions.setPiActivity(key, busy);
    return () => actions.setPiActivity(key, false);
  }, [actions, win.id, entry.key, busy]);
  const [working, setWorking] = useState(false);
  const [changingPermission, setChangingPermission] = useState(false);
  const [changingWorkspace, setChangingWorkspace] = useState(false);
  const preserveConversationView = useRef(false);
  const [queued, setQueued] = useState<QueuedMessage[]>([]);
  const [queuedEdit, setQueuedEdit] = useState<{ item: QueuedMessage; order: string[]; draft: string; paths: string[]; references: PiConversationReference[]; attachmentOrder: string[] } | null>(null);
  const queuedMessages = useRef(queued);
  queuedMessages.current = queued;
  const [error, setError] = useState<string | null>(null);
  const [openedElsewhere, setOpenedElsewhere] = useState(false);
  const conversationWindows = usePiConversationWindows();
  const showConversation = useRef<() => void>(() => {});
  showConversation.current = () => {
    chats.activate(entry.key); setSettings(false); setSetup(false);
    if (compact || floating) {
      onAttention?.();
      requestAnimationFrame(() => {
        const host = document.getElementById(floating ? floatingId : 'pi-assistant');
        (host?.querySelector<HTMLElement>('textarea:not(:disabled)') ?? host)?.focus({ preventScroll: true });
      });
    } else {
      actions.focusApp(win.id);
      requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-window-id="${win.id}"] [data-testid="pi-prompt"]`)?.focus({ preventScroll: true }));
    }
  };
  const showWindow = useCallback(() => showConversation.current(), []);
  const [notification, setNotification] = useState<{ id: number; message: string } | null>(null);
  const notify = useCallback((message: string) => setNotification((previous) => ({ id: (previous?.id ?? 0) + 1, message })), []);
  const [settings, setSettings] = useState(false);
  const [settingsVisited, setSettingsVisited] = useState(false);
  const [settingsRequest, setSettingsRequest] = useState<{ tab: 'pet'; nonce: number }>();
  const settingsNavigationNonce = useRef<number>();
  useEffect(() => {
    const intent = shellState.navigation;
    if (!active || intent?.target !== 'pi' || intent.windowId !== win.id || intent.nonce === settingsNavigationNonce.current) return;
    settingsNavigationNonce.current = intent.nonce;
    setSettingsRequest({ tab: intent.section, nonce: intent.nonce });
    setSettingsVisited(true); setSettings(true);
  }, [shellState.navigation, win.id, active]);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [compactionPending, setCompactionPending] = useState(false);
  const [extensionsPending, setExtensionsPending] = useState(false);
  const [desktopEnabled, setDesktopEnabled] = useState(false);
  const lumoUse = useLumoUse(connection, active || floating, desktopEnabled, floating ? floatingId : undefined);
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
  const handledAssistantRequest = useRef<string>();
  useEffect(() => {
    if (!compact || !active || assistantRequest?.action !== 'workspace' || handledAssistantRequest.current === assistantRequest.id) return;
    handledAssistantRequest.current = assistantRequest.id;
    setPicking('folder');
  }, [compact, active, assistantRequest]);
  const [remembered, setRemembered] = useAppPreference<string[]>('pi', 'projects', []);
  const [removedProjects, setRemovedProjects] = useAppPreference<string[]>('pi', 'removed-projects', []);
  const promptInput = useRef<HTMLDivElement>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const current = useRef<string | null>(null);
  const actionLock = useRef(false);
  const queueMutation = useRef(false);
  const queueRevision = useRef(0);
  const runtimeKey = `lumo.pi.runtime:${encodeURIComponent(shellState.user ?? '')}:${win.id}${entry.key === 'initial' ? '' : `:${entry.key}`}`;
  const resume = useRef<string | undefined>(undefined);
  const resumeLoaded = useRef(false);
  if (!resumeLoaded.current) {
    try { resume.current = sessionStorage.getItem(runtimeKey) ?? undefined; } catch {}
    resumeLoaded.current = true;
  }
  const lifecycle = useRef<Promise<void>>(Promise.resolve());
  const savedSession = useRef(entry.session);
  const runNotice = useRef({ active: entry.running, stopped: false, error: '' });
  const noticeContext = useRef('');
  const noticeProject = projectNames[chats.normalize(run.project)] || (run.project === '~' ? 'Home' : run.project.split('/').filter(Boolean).at(-1) || '/');
  const noticeSession = status.sessionFile?.split('/').at(-1) ?? savedSession.current ?? run.session;
  const noticeName = status.sessionName || sessionLists[chats.normalize(run.project)]?.find((item) => item.id === noticeSession)?.name;
  noticeContext.current = noticeName && noticeName !== noticeProject ? `${noticeName} · ${noticeProject}` : noticeProject;
  const noticeActive = useRef(active); noticeActive.current = active || floating;
  const noticeSurface = useRef({ floating, floatingId }); noticeSurface.current = { floating, floatingId };
  function shouldNotify() {
    const { floating, floatingId } = noticeSurface.current;
    const host = compact || floating ? document.getElementById(floating ? floatingId : 'pi-assistant') : document.querySelector<HTMLElement>(`[data-window-id="${win.id}"]`);
    return document.hidden || !host || host.hidden || !noticeActive.current || (!compact && !floating && (!host.classList.contains('focused') || !document.hasFocus()));
  }
  const announcedQuestions = useRef(new Set<string>());
  useEffect(() => {
    for (const question of questions) {
      if (announcedQuestions.current.has(question.id)) continue;
      announcedQuestions.current.add(question.id);
      if (shouldNotify()) actions.notify('Pi needs your attention', [noticeContext.current, question.title].filter(Boolean).join('\n'));
    }
  }, [questions, actions]);
  function startRunNotice() {
    if (!runNotice.current.active) runNotice.current = { active: true, stopped: false, error: '' };
  }
  function finishRunNotice(title?: string, detail?: string, force = false) {
    const currentNotice = runNotice.current;
    if (!currentNotice.active && !force) return;
    currentNotice.active = false;
    const stopped = currentNotice.stopped;
    const failure = currentNotice.error;
    actions.notify(title ?? (stopped ? 'Pi stopped' : failure ? 'Pi stopped with an error' : 'Pi finished'), [noticeContext.current, detail ?? (stopped ? 'Stopped by you.' : failure)].filter(Boolean).join('\n'), stopped || title === 'Pi stopped' ? 'stopped' : failure || title ? 'error' : 'done', !shouldNotify());
  }

  useEffect(() => {
    if (!installed) return;
    let disposed = false;
    void source.listSkills().then((catalog) => { if (!disposed) setSkills(catalog.skills ?? []); }).catch(() => { if (!disposed) setSkills([]); });
    return () => { disposed = true; };
  }, [installed, source, shellState.fileRevision]);

  useEffect(() => {
    if (!notification) return;
    const timeout = window.setTimeout(() => setNotification(null), 4000);
    return () => window.clearTimeout(timeout);
  }, [notification]);

  useEffect(() => {
    if (!installed) return;
    let disposed = false;
    void source.piTemplates().then((items) => { if (!disposed) setTemplates(templateCatalog(items ?? [])); }).catch(() => {});
    return () => { disposed = true; };
  }, [installed, source, templatesRevision, active]);
  const anyRunning = chats.chats.some((chat) => chat.running);
  const anyDirty = chats.chats.some((chat) => chat.dirty);
  useLayoutEffect(() => { if (!active) return; return actions.registerWindowGuard(win.id, (proceed) => {
    if (anyRunning || anyDirty || draft.trim() || attachments.length || references.length || referencePending || queuedEdit || settingsDirty) { setPendingTitle('Close Pi?'); setPendingClose(() => proceed); if (compact) onAttention?.(); } else proceed();
  }); }, [active, actions, win.id, anyRunning, anyDirty, draft, attachments.length, references.length, referencePending, queuedEdit, settingsDirty, compact, onAttention]);

  async function command(id: string, value: PiCommand): Promise<PiData> {
    const starting = value.type === 'prompt' && !runNotice.current.active;
    if (starting) { lumoUse.resume(); startRunNotice(); }
    try {
      const reply = await source.piCommand(id, value);
      if (!reply.success) throw new Error(reply.error || 'Pi could not complete that action.');
      if (starting && reply.data?.disposition === 'handled') runNotice.current.active = false;
      return reply.data ?? {};
    } catch (err) {
      if (starting) finishRunNotice('Pi stopped with an error', err instanceof Error ? err.message : 'The request failed.');
      throw err;
    }
  }
  async function loadState(id: string, folder: string, history = false, clearIdleQueue = false, preserveHistory = false) {
    const revision = queueRevision.current;
    const generation = streamGeneration.current;
    const [state, available, thinking, usage, list, log] = await Promise.all([
      command(id, { type: 'get_state' }), command(id, { type: 'get_available_models' }),
      command(id, { type: 'get_available_thinking_levels' }), command(id, { type: 'get_session_stats' }),
      source.piSessions(folder), history ? source.piCommand(id, { type: 'get_messages' }) : Promise.resolve(null),
    ]);
    if (current.current !== id || generation !== streamGeneration.current) return;
    setStatus(state); setModels(available.models ?? []); setLevels(thinking.levels ?? ['off']); setStats(usage);
    if (log && (state.isStreaming || state.isCompacting || log.retry)) startRunNotice();
    const folderKey = folder === '~' ? source.absolutePath(source.homePath()) : folder;
    setSessionLists((lists) => ({ ...lists, [folderKey]: list }));
    if (!clearIdleQueue || revision === queueRevision.current) {
      setBusy(Boolean(state.isStreaming || state.isCompacting));
      if (clearIdleQueue && !state.isStreaming && !state.isCompacting && !queueMutation.current) setQueued([]);
    }
    if (log) {
      if (!log.success) throw new Error(log.error || 'Could not load conversation.');
      if (!preserveHistory) setMessages([...(log.data?.messages ?? []), ...(log.retry ? [piRetryMessage(log.retry)] : [])]);
      setQuestions(log.questions ?? []);
      if (log.retry) setBusy(true);
      if (Number.isSafeInteger(log.eventCursor)) eventCursor.current = log.eventCursor!;
    }
  }
  useEffect(() => {
    const changed = (event: Event) => {
      const enabled = (event as CustomEvent<import('@lumo/sdk/api/lumo-use').PiExtensionSettings>).detail.lumoUse;
      if (!enabled) { lumoUse.cancel(); setDesktopEnabled(false); }
      setExtensionsPending(true);
    };
    window.addEventListener('lumo-pi-extensions-saved', changed);
    return () => window.removeEventListener('lumo-pi-extensions-saved', changed);
  }, []);
  const chatRevision = chats.chats.map((chat) => `${chat.project}/${chat.session}:${chat.running}`).join('|');
  useEffect(() => {
    if (!active || !installed) return;
    let disposed = false;
    void source.piSessions(run.project).then((list) => {
      if (!disposed) setSessionLists((lists) => ({ ...lists, [chats.normalize(run.project)]: list }));
    }).catch(() => {});
    return () => { disposed = true; };
  }, [active, installed, run.project, chatRevision]);
  const keepAlive = active || busy || floating;
  useEffect(() => {
    if (active) actions.setPiProject(win.id, chats.normalize(run.project));
  }, [active, run.project, actions, win.id]);
  useEffect(() => {
    const session = status.sessionFile?.split('/').at(-1) ?? savedSession.current ?? run.session;
    if (session) savedSession.current = session;
    chats.update(entry.key, { project: run.project, session, permissionMode: run.permissionMode ?? confirmedPermissionMode, autoRetry, running: busy, dirty: Boolean(draft.trim() || attachments.length || references.length || queuedEdit || settingsDirty) });
  }, [run.project, run.session, run.permissionMode, confirmedPermissionMode, autoRetry, status.sessionFile, busy, draft, attachments.length, references.length, queuedEdit, settingsDirty, entry.key, chats.update]);
  useEffect(() => {
    if (!keepAlive) { setConnection(null); return; }
    if (!run || !installed || setup) return;
    let disposed = false; let id: string | null = null;
    const preserveView = preserveConversationView.current;
    preserveConversationView.current = false;
    setWorking(true); setConnection(null); setError(null); setOpenedElsewhere(false);
    if (!preserveView) { setMessages([]); setQuestions([]); answeredQuestions.current.clear(); setQueued([]); setStatus({}); setStats({}); }
    const launch = lifecycle.current.catch(() => {}).then(async () => {
      if (disposed) return;
      const requestedMode = run.permissionMode ?? confirmedPermissionMode;
      const result = await chats.start(run.project, savedSession.current ?? run.session, resume.current, requestedMode, rememberPermissionMode.current !== undefined && rememberPermissionMode.current === requestedMode);
      resume.current = undefined;
      id = result.id;
      setDesktopEnabled(Boolean(result.lumoUse));
      if (result.extensionsChanged) setExtensionsPending(true);
      if (!piPermissionModes.some((mode) => mode.value === result.permissionMode) || requestedMode !== undefined && result.permissionMode !== requestedMode) { await source.piStop(id); throw new Error('Pi could not confirm the selected permission mode. Reopen this chat.'); }
      if (disposed) return;
      setConfirmedPermissionMode(result.permissionMode);
      if (rememberPermissionMode.current === result.permissionMode) rememberPermissionMode.current = undefined;
      current.current = id;
      try { sessionStorage.setItem(runtimeKey, id); } catch {}
      eventCursor.current = 0;
      await command(id, { type: 'set_auto_retry', enabled: autoRetry });
      await loadState(id, run.project, true, false, preserveView);
      if (!disposed) { setConnection(id); setCompactionRevision((value) => value + 1); }
    }).catch(async (err) => {
      if (disposed) return;
      const elsewhere = err instanceof ApiError && err.code === 'conflict' && err.message === 'This conversation is already open in another Pi window.';
      setOpenedElsewhere(elsewhere);
      if (elsewhere) { setBusy(false); runNotice.current.active = false; }
      if (!elsewhere) finishRunNotice('Pi stopped with an error', err instanceof Error ? err.message : 'Could not reconnect to Pi.');
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      try {
        const list = await source.piSessions(run.project);
        const folder = run.project === '~' ? source.absolutePath(source.homePath()) : run.project;
        if (!disposed) setSessionLists((lists) => ({ ...lists, [folder]: list }));
      } catch {}
    }).finally(() => { if (!disposed) { setWorking(false); setChangingPermission(false); setChangingWorkspace(false); } });
    lifecycle.current = launch;
    return () => {
      disposed = true; current.current = null;
      lifecycle.current = launch.then(async () => { if (id) {
        finishRunNotice('Pi stopped', 'Session closed.');
        try { if (sessionStorage.getItem(runtimeKey) === id) sessionStorage.removeItem(runtimeKey); } catch {}
        await source.piStop(id);
      } }).catch(() => {});
    };
  }, [run, installed, setup, keepAlive]);

  useEffect(() => {
    if (!connection || !run) return;
    let disposed = false; let cursor = eventCursor.current; const generation = streamGeneration.current;
    let processClosed = false;
    void (async () => {
      while (!disposed) {
        const batch = await source.piEvents(connection, cursor);
        if (disposed || generation !== streamGeneration.current) return;
        lumoUse.consume(batch.desktop ?? []);
        if (batch.retry) { startRunNotice(); setBusy(true); }
        if (batch.questions) setQuestions(batch.questions.filter((question) => !answeredQuestions.current.has(question.id)));
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
          if (event.type === 'message_end' && incoming?.role === 'assistant') {
            runNotice.current.error = incoming.stopReason === 'error' ? incoming.errorMessage || 'The request failed.' : '';
            if (incoming.stopReason === 'aborted') runNotice.current.stopped = true;
          }
          if (event.error || event.finalError) runNotice.current.error = event.error || event.finalError || '';
          if (event.type === 'agent_start' || event.type === 'auto_compaction_start' || event.type === 'auto_retry_start' || event.type === 'summarization_retry_scheduled') { if (event.type !== 'agent_start' || !runNotice.current.stopped) { startRunNotice(); setBusy(true); } }
          if (event.type === 'agent_settled') { if (!batch.closed) finishRunNotice(); setBusy(false); void loadState(connection, run.project, false, true).catch((err) => { if (!disposed && generation === streamGeneration.current) setError(err instanceof Error ? err.message : 'Something went wrong.'); }); }
          if (event.error) setError(event.error);
          if (event.finalError && event.type !== 'auto_retry_end') setError(event.finalError);
        }
        if (batch.closed) { processClosed = true; throw new Error(batch.events.map((event) => event.error).filter(Boolean).at(-1) || 'Pi stopped. Reopen this session to continue.'); }
      }
    })().catch((err) => { if (!disposed && generation === streamGeneration.current) { const message = err instanceof Error ? err.message : 'Something went wrong.'; finishRunNotice(processClosed ? 'Pi stopped' : 'Pi connection lost', message, true); setError(message); setConnection(null); setBusy(false); setQuestions([]); setMessages((items) => items.filter((message) => message.role !== 'retry')); } });
    return () => { disposed = true; };
  }, [connection, run, streamVersion]);
  useEffect(() => { if (follow.current) transcript.current?.scrollTo({ top: transcript.current.scrollHeight }); }, [messages, questions.length]);
  useEffect(() => {
    if (!active) { if (!busy && extensionsPending) setExtensionsPending(false); return; }
    if (!(compactionPending || extensionsPending) || !connection || busy || working || setup || settingsBusy || queued.length || actionLock.current) return;
    preserveConversationView.current = true;
    setCompactionPending(false); setExtensionsPending(false); setWorking(true); streamGeneration.current++; resume.current = undefined;
    setRun((currentRun) => ({ ...currentRun, session: status.sessionFile?.split('/').at(-1) ?? currentRun.session, epoch: Date.now() }));
  }, [active, compactionPending, extensionsPending, connection, busy, working, setup, settingsBusy, queued.length, status.sessionFile]);

  function changePermissionMode(value: string) {
    if (busy || working || actionLock.current || queued.length || queuedEdit || questions.length || !piPermissionModes.some((mode) => mode.value === value) || value === (run.permissionMode ?? confirmedPermissionMode ?? 'ask')) return;
    rememberPermissionMode.current = value as PiPermissionMode;
    preserveConversationView.current = true; setChangingPermission(true);
    setWorking(true); resume.current = undefined; streamGeneration.current++;
    setRun((previous) => ({ ...previous, permissionMode: value as PiPermissionMode, session: status.sessionFile?.split('/').at(-1) ?? savedSession.current ?? previous.session, epoch: Date.now() }));
  }
  async function answerQuestion(answer: PiAnswer, requestId: string) {
    if (!connection) throw new Error('Reconnect to answer this question.');
    await source.piAnswer(connection, answer, requestId);
    answeredQuestions.current.add(answer.questionId);
    setQuestions((items) => items.filter((item) => item.id !== answer.questionId));
  }
  async function act(value: PiCommand, reload = true) {
    if (!connection || actionLock.current) return;
    actionLock.current = true; setWorking(true); setError(null);
    try { await command(connection, value); if (reload && run) await loadState(connection, run.project); return true; }
    catch (err) {
      if (value.type === 'set_model' || value.type === 'set_thinking_level') await loadState(connection, run.project).catch(() => {});
      const message = err instanceof Error ? err.message : 'Something went wrong.';
      if (value.type === 'compact' && /^Nothing to compact\b/i.test(message)) notify('Nothing to compact yet');
      else setError(message);
      return false;
    }
    finally { actionLock.current = false; setWorking(false); }
  }
  async function send() {
    if (working || !connection || questions.length) return;
    const slash = /^\s*\/(undo|rename|compact)(?:\s+([\s\S]*))?$/.exec(draft);
    if (!compact && slash && !queuedEdit) {
      const action = slash[1] as PiChatAction;
      if (chatActionDisabled(action)) { setError('Wait until Pi is idle and this conversation has messages.'); return; }
      runChatAction(action, slash[2] ?? '');
      return;
    }
    let expandedDraft: string;
    try { expandedDraft = expandTemplateCommand(draft, templates); } catch (err) { setError(err instanceof Error ? err.message : 'Check template arguments.'); return; }
    const text = expandSkillCommands(attachmentPrompt(expandedDraft, attachments, references, attachmentOrder), skills); if (!text || !connection || actionLock.current || referencePending) return;
    if (references.length > 8) { setError('Attach up to 8 conversations per message. Remove some references before sending.'); return; }
    if (queuedEdit) { await sendQueuedEdit(text); return; }
    actionLock.current = true; setWorking(true); setError(null); follow.current = true; queueRevision.current++;
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
    finally { queueRevision.current++; actionLock.current = false; setWorking(false); }
  }
  function chatActionDisabled(action: PiChatAction) { return Boolean(queuedEdit) || busy || working || !connection || !messages.length || (action === 'undo' && !messages.some((message) => message.role === 'user')); }
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
    lumoUse.cancel();
    actionLock.current = true; setWorking(true); setError(null);
    runNotice.current.stopped = true;
    try {
      restoreQueue(await command(connection, { type: 'clear_queue' }));
      await command(connection, { type: 'abort' });
      await loadState(connection, run.project, true);
      finishRunNotice();
    } catch (err) { runNotice.current.stopped = false; setError(err instanceof Error ? err.message : 'Could not stop Pi.'); }
    finally { actionLock.current = false; setWorking(false); }
  }
  function reconcileQueue(data: PiData): QueuedMessage[] {
    const available = [...queuedMessages.current];
    return (['steer', 'follow_up'] as const).flatMap((type) => (type === 'steer' ? data.steering ?? [] : data.followUp ?? []).map((value) => {
      const index = available.findIndex((entry) => entry.text === value && entry.type === type);
      return index < 0 ? { id: crypto.randomUUID(), text: value, type } : available.splice(index, 1)[0];
    }));
  }
  function preserveUnsent(items: QueuedMessage[], editing: boolean) {
    if (!items.length) return;
    const restored = items.map((item) => splitAttachmentPrompt(item.text));
    const text = restored.map((item) => item.text).filter(Boolean).join('\n\n');
    const paths = restored.flatMap((item) => item.paths);
    const references = restored.flatMap((item) => item.references);
    const order = restored.flatMap((item) => attachmentKeys(item.paths, item.references, item.order));
    if (editing) setQueuedEdit((value) => value && ({
      ...value,
      draft: [value.draft, text].filter(Boolean).join('\n\n'),
      paths: [...new Set([...value.paths, ...paths])],
      references: [...new Map([...value.references, ...references].map((item) => [item.path, item])).values()],
      attachmentOrder: [...new Set([...value.attachmentOrder, ...order])],
    }));
    else {
      setDraft((value) => [value, text].filter(Boolean).join('\n\n'));
      setAttachments((items) => [...new Set([...items, ...paths])]);
      setReferences((items) => [...new Map([...items, ...references].map((item) => [item.path, item])).values()]);
      setAttachmentOrder((items) => [...new Set([...items, ...order])]);
    }
  }
  async function sendQueuedEdit(text: string) {
    if (!connection || !queuedEdit || actionLock.current || referencePending) return;
    const edit = queuedEdit;
    actionLock.current = true; setWorking(true); setError(null); queueMutation.current = true; queueRevision.current++;
    let pending: QueuedMessage[] = [];
    let accepted = false;
    try {
      for (const reference of splitAttachmentPrompt(text).references) await source.piReference(reference.project, reference.session);
      const data = await command(connection, { type: 'clear_queue' });
      const positions = new Map(edit.order.map((id, index) => [id, index]));
      const ordered = [...reconcileQueue(data), { ...edit.item, text }].sort((a, b) => (positions.get(a.id) ?? edit.order.length) - (positions.get(b.id) ?? edit.order.length));
      setQueued(ordered);
      pending = [...ordered.filter((item) => item.type === 'steer'), ...ordered.filter((item) => item.type === 'follow_up')];
      while (pending.length) {
        const next = pending[0];
        const reply = await command(connection, { type: 'prompt', message: next.text, streamingBehavior: next.type === 'steer' ? 'steer' : 'followUp' });
        if (reply.disposition === 'started' || reply.disposition === 'handled') setQueued((items) => items.filter((item) => item.id !== next.id));
        if (next.id === edit.item.id) {
          accepted = true; setQueuedEdit(null);
          setDraft(edit.draft); setAttachments(edit.paths); setReferences(edit.references); setAttachmentOrder(edit.attachmentOrder);
        }
        pending.shift();
      }
      follow.current = true;
      await loadState(connection, run.project);
    } catch (err) {
      const ids = new Set(pending.map((item) => item.id));
      setQueued((items) => items.filter((item) => !ids.has(item.id)));
      const unsent = pending.filter((item) => item.id !== edit.item.id);
      preserveUnsent(unsent, !accepted);
      setError((err instanceof Error ? err.message : 'Could not send this edit.') + (unsent.length ? ' Unsent messages were saved with your draft.' : ''));
    } finally { queueRevision.current++; queueMutation.current = false; actionLock.current = false; setWorking(false); promptInput.current?.focus(); }
  }
  async function changeQueued(item: QueuedMessage, action: 'edit' | 'delete' | 'send') {
    if (!connection || actionLock.current || queuedEdit || referencePending) return false;
    actionLock.current = true; setWorking(true); setError(null);
    queueMutation.current = true; queueRevision.current++;
    let pending: QueuedMessage[] = [];
    let editing = false;
    try {
      const data = await command(connection, { type: 'clear_queue' });
      pending = reconcileQueue(data);
      const ambiguous = pending.filter((entry) => entry.text === item.text).length !== queued.filter((entry) => entry.text === item.text).length;
      const target = !ambiguous && pending.find((entry) => entry.id === item.id);
      if (target) {
        if (action === 'delete') pending = pending.filter((entry) => entry.id !== item.id);
        else if (action === 'edit') {
          editing = true;
          const parts = splitAttachmentPrompt(target.text);
          setQueuedEdit({ item: target, order: queued.map((entry) => entry.id), draft, paths: attachments, references, attachmentOrder });
          setDraft(parts.text); setAttachments(parts.paths); setReferences(parts.references); setAttachmentOrder(attachmentKeys(parts.paths, parts.references, parts.order));
          pending = pending.filter((entry) => entry.id !== item.id);
          promptInput.current?.focus();
        }
        else pending = [{ ...target, type: 'steer' }, ...pending.filter((entry) => entry.id !== item.id)];
      }
      const positions = new Map(queued.map((entry, index) => [entry.id, index]));
      setQueued([...pending].sort((a, b) => (positions.get(a.id) ?? queued.length) - (positions.get(b.id) ?? queued.length)));
      while (pending.length) {
        const next = pending[0];
        const reply = await command(connection, action === 'edit' ? { type: 'prompt', message: next.text, streamingBehavior: next.type === 'steer' ? 'steer' : 'followUp' } : { type: next.type, message: next.text });
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
        preserveUnsent(pending, editing);
      }
      setError((err instanceof Error ? err.message : 'Could not update the queue.') + (pending.length ? editing ? ' Unsent messages were saved with your draft.' : ' Unsent messages were returned to the composer.' : ''));
      return false;
    } finally { queueRevision.current++; queueMutation.current = false; actionLock.current = false; setWorking(false); }
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
  function open(session?: string, folder = project, preserveDraft = false, remember = true, preserveView = false) {
    resume.current = undefined; savedSession.current = session; setStatus((previous) => preserveView ? { model: previous.model, thinkingLevel: previous.thinkingLevel } : {});
    const path = folder.trim() || '~';
    if (path !== '~' && !path.startsWith('/')) { setError('Use an absolute folder path, or ~ for your home folder.'); return; }
    if (remember) rememberWorkspace(path);
    setProject(path); setRun({ project: path, session, permissionMode: run.permissionMode ?? confirmedPermissionMode, epoch: Date.now() }); if (!preserveDraft) { setQueuedEdit(null); setDraft(''); setAttachments([]); setReferences([]); setAttachmentOrder([]); referenceRequests.current = new Set(); referenceGeneration.current++; } follow.current = true;
  }
  const sessionID = status.sessionFile?.split('/').at(-1) ?? savedSession.current ?? run.session;
  useEffect(() => {
    if (!active || !entry.renameRequest || !connection || working || sessionID !== entry.session) return;
    setName(entry.renameRequest.name); setRename(true);
    chats.update(entry.key, { renameRequest: undefined, floating: false });
  }, [active, entry.renameRequest, entry.session, entry.key, connection, working, sessionID, chats.update]);
  const conversationKey = `${win.id}:${entry.key}`;
  const conversationProject = chats.normalize(run.project);
  useEffect(() => {
    if (!connection || !sessionID) return;
    return conversationWindows.register({ key: conversationKey, project: conversationProject, session: sessionID, compact: compact || floating, show: showWindow });
  }, [connection, sessionID, conversationKey, conversationProject, compact, floating, showWindow, conversationWindows.register]);
  const conversationOwner = conversationWindows.windows.find((owner) => owner.key !== conversationKey && owner.project === conversationProject && owner.session === sessionID);
  const conversationLocation = openedElsewhere ? <PiConversationLocation owner={conversationOwner} onRetry={() => open(sessionID)}/> : undefined;
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
  const empty = messages.length === 0 && questions.length === 0;
  const loading = !connection && !error && !changingPermission && !changingWorkspace;
  const workspace = run.project;
  const hasDraft = Boolean(draft.trim() || attachments.length || references.length);
  const requestPending = questions.length > 0;
  const showStop = requestPending || (busy && !hasDraft && !queuedEdit);
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
  async function attachImages(files: File[]) {
    if (working || !files.length) return;
    const generation = referenceGeneration.current;
    setReferencePending((count) => count + 1); setError(null);
    try {
      if (files.length > 8) throw new Error('Attach up to eight images at a time.');
      for (const file of files) {
        if (file.size > 8 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)) throw new Error('Use PNG, JPEG, GIF or WebP images up to 8 MiB each.');
      }
      for (const file of files) {
        const image = await source.piUploadImage(bytesToBase64(new Uint8Array(await file.arrayBuffer())));
        if (generation === referenceGeneration.current) attach([image.path]);
      }
    } catch (err) { if (generation === referenceGeneration.current) setError(err instanceof Error ? err.message : 'Could not attach images.'); }
    finally { setReferencePending((count) => count - 1); }
  }
  const fileDrop = fileReferenceDrop(attach);
  const composerDrop = {
    onDragOver(event: React.DragEvent<HTMLElement>) {
      if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = working ? 'none' : 'copy'; return; }
      if (!isConversationDrag(event)) { fileDrop.onDragOver(event); return; }
      event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = working ? 'none' : 'copy';
      if (!working) event.currentTarget.dataset.fileDropTarget = 'true';
    },
    onDragLeave: fileDrop.onDragLeave,
    onDrop(event: React.DragEvent<HTMLElement>) {
      if (event.dataTransfer.files.length) { event.preventDefault(); event.stopPropagation(); void attachImages([...event.dataTransfer.files]); return; }
      if (!isConversationDrag(event)) { fileDrop.onDrop(event); return; }
      event.preventDefault(); event.stopPropagation(); delete event.currentTarget.dataset.fileDropTarget;
      const item = takeConversationDrag(event);
      if (item) void referenceConversation(item.project, { id: item.session, name: item.name, modified: '' });
    },
  };
  function chooseProject(path: string) {
    if (busy || working || chats.normalize(path) === chats.normalize(run.project)) return;
    const preserveView = empty && Boolean(connection);
    setChangingWorkspace(preserveView); preserveConversationView.current = preserveView;
    setWorking(true); setError(null); setStats({}); streamGeneration.current++;
    open(undefined, path, true, true, preserveView);
  }

  const closeConfirmation = pendingClose && <AppConfirmation title={pendingTitle} confirm="Close" onCancel={() => setPendingClose(null)} onConfirm={pendingClose}><p>{anyRunning ? 'This stops the current task and any other running chats in this window. Your conversations are saved.' : settingsDirty ? 'Your unsaved settings will be discarded.' : 'Your unsent message will be discarded.'}</p></AppConfirmation>;
  const compactView = <PiImageScope.Provider value={chats.normalize(run.project)}><PiCompactChat
    installed={Boolean(installed)} loading={loading} working={working || Boolean(queuedEdit) || referencePending > 0} busy={busy} connection={Boolean(connection)}
    messages={messages} transcript={transcript} onFollow={(value) => { follow.current = value; }}
    draft={draft} onDraft={setDraft} onSend={() => void send()} onStop={() => void stop()} showStop={busy || requestPending}
    models={models} model={status.model} levels={levels} level={status.thinkingLevel}
    onModel={(model) => act({ type: 'set_model', provider: model.provider, modelId: model.id })} onLevel={(level) => act({ type: 'set_thinking_level', level })}
    permissionMode={run.permissionMode ?? confirmedPermissionMode ?? 'ask'} onPermission={changePermissionMode}
    questions={questions} onAnswer={answerQuestion}
    context={<>{queuedEdit && <p className="pi-reference-loading">Return to the Pi window to finish editing the queued message.</p>}{queued.length > 0 && <p className="pi-reference-loading" role="status">{queued.length} queued {queued.length === 1 ? 'message' : 'messages'}</p>}<AttachmentCards paths={attachments} references={references} order={attachmentOrder} disabled={working} onRemove={(path) => { setAttachmentOrder((items) => items.filter((key) => key !== fileAttachmentKey(path))); setAttachments((items) => items.filter((item) => item !== path)); }} onRemoveReference={(path) => { const reference = references.find((item) => item.path === path); if (reference) setAttachmentOrder((items) => items.filter((key) => key !== conversationAttachmentKey(reference))); setReferences((items) => items.filter((item) => item.path !== path)); }}/></>}
    hasDraft={hasDraft} location={conversationLocation} error={error} onReconnect={() => open(sessionID)} onSetup={() => actions.openApp('pi')}/>{compact && picking && <FilePicker mode="folder" initialPath={workspace === '~' ? source.homePath() : ['', ...workspace.split('/').filter(Boolean)]} onCancel={() => setPicking(null)} onOpen={(path) => { setPicking(null); chats.navigate(source.absolutePath(path)); }}/>}{compact && closeConfirmation}</PiImageScope.Provider>;
  function returnToWindow() { setSettings(false); setSetup(false); chats.update(entry.key, { floating: false }); chats.activate(entry.key); actions.focusApp(win.id); }
  const floatingView = floating && createPortal(<PiAssistantFrame open id={floatingId} testId="pi-chat-assistant" label={`${noticeName || 'Chat'} · Pi assistant`} closeLabel="Return to Pi window" onHide={returnToWindow}>{compactView}</PiAssistantFrame>, document.body);
  if (compact) return active ? compactView : null;
  return <>{floatingView}{active && <div className="app pi-app" data-testid="app-pi">
    {notification && <div className="pi-notification" key={notification.id} role="status" data-testid="pi-notification"><span>{notification.message}</span></div>}
    <nav className="pi-app-rail" aria-label="Pi navigation" data-testid="pi-app-rail">
      {installed && <button type="button" disabled={settings} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed} aria-controls="pi-chat-sidebar" data-testid="pi-sidebar-toggle" onClick={() => setCollapsed((value) => !value)}><IconSidebar size={20}/></button>}
      <button type="button" aria-label="Home" title="Home" data-testid="pi-home-button" aria-current={!settings ? 'page' : undefined} disabled={settingsBusy} onClick={() => { setSetup(false); setSettings(false); }}><IconHome size={20}/></button>
      {installed && (collapsed || settings) && <button type="button" aria-label="New chat" title="New chat" data-testid="pi-new" disabled={settings || actionLock.current || !!referencePending} onClick={() => chats.navigate(run.project)}><IconNewChat size={20}/></button>}
      <button type="button" aria-label="Settings" title="Settings" data-testid="pi-settings-button" aria-current={settings ? 'page' : undefined} onClick={() => { setSettingsVisited(true); setSettings(true); }}><IconGear size={20}/></button>
    </nav>
    {installed && !settings && <PiSidebar collapsed={collapsed} project={workspace} session={sessionID} sessions={sessionLists[workspace === '~' ? source.absolutePath(source.homePath()) : workspace]} disabled={working || settings || !!referencePending} navigationDisabled={actionLock.current || settings || !!referencePending} running={chats.chats.filter((chat) => chat.running).map((chat) => `${chats.normalize(chat.project)}/${chat.session}`)} onRemoveProject={(path, name) => setArchiveProject({ project: path, name, sessions: [], remove: true })}
      floating={chats.chats.filter((chat) => chat.floating).map((chat) => `${chats.normalize(chat.project)}/${chat.session}`)}
      onRename={(path, item) => chats.navigate(path, item.id, { renameRequest: { id: crypto.randomUUID(), name: item.name }, floating: false })}
      onAssistant={(path, item, floating) => chats.navigate(path, item.id, { floating })}
      onNew={() => chats.navigate(run.project)} onNewProject={(path) => chats.navigate(path)} onArchiveProject={(path, name, sessions) => setArchiveProject({ project: path, name, sessions })} onOpen={(path, id) => chats.navigate(path, id)}
      revision={`${sessionRevision}:${chatRevision}`} onArchive={(path, item) => { void moveConversation(path, item.id).catch((err) => setMoveError(err instanceof Error ? err.message : 'Could not archive this conversation.')); }}/>}
    {settingsVisited && <div className="pi-settings-host" hidden={!settings}><PiSettings requestedTab={settingsRequest} onNotify={notify} autoRetry={autoRetry} onAutoRetry={(value) => { void act({ type: 'set_auto_retry', enabled: value }, false).then((ok) => { if (ok) { setAutoRetry(value); notify(piSettingsSaved()); } }); }} onExtensionsSaved={(enabled) => window.dispatchEvent(new CustomEvent('lumo-pi-extensions-saved', { detail: enabled }))} extensionsApplying={working} extensionsRunning={anyRunning} onTemplatesSaved={() => setTemplatesRevision((value) => value + 1)} onCompactionSaved={() => setCompactionPending(true)} compactionRevision={compactionRevision} compactionPending={compactionPending || working} installed={Boolean(installed)} visible={settings} model={status.model} models={models} setup={setup} disabled={busy || working} onDirty={setSettingsDirty} onBusy={setSettingsBusy} revision={sessionRevision} onRestore={(folder, id) => moveConversation(folder, id, true)}
      onConnect={() => { if (run) setRun({ ...run, session: sessionID }); setSetup(true); }} onDone={() => setSetup(false)}/></div>}
    {settings ? null : !installed ? <div className="pi-welcome">
      <div className="pi-welcome-mark" aria-hidden="true">π</div><h1>Pi</h1>
      <PiEngine/>
    </div> : <>
      <main className={`pi-main${empty && !loading ? ' pi-new-conversation' : ''}`} aria-busy={loading || changingWorkspace}>
          {(floating ? <div className="pi-conversation-location" role="status"><h2>Open in the assistant window</h2><p>{noticeName || 'This chat'} is in assistant window mode.</p><button className="btn" onClick={returnToWindow}>Return to Pi window</button></div> : conversationLocation) ?? (loading ? <div className="pi-conversation-loading" role="status" aria-label="Loading conversation" data-testid="pi-conversation-loading"><span className="spinner" aria-hidden="true"/></div> : <>
          {(moveError || error) && <div className="pi-notice" role="alert">{moveError || error}{!connection && !working && <button className="btn" onClick={() => open(sessionID)}>Reconnect</button>}</div>}
          {!empty && <PiImageScope.Provider value={chats.normalize(run.project)}><PiTranscript key={`${run.project}-${status.sessionFile ?? ''}`} messages={messages} busy={busy} canBranch={!busy && !working} onBranch={() => void branch()} transcript={transcript} onFollow={(value) => { follow.current = value; }}/></PiImageScope.Provider>}
          <footer className="pi-compose">
            {empty && <h1>What should we work on?</h1>}
            {queued.length > 0 && <div className="pi-queued" aria-label="Queued messages">{queued.map((item) => <PiQueuedMessage key={item.id} item={item} disabled={working || !connection || !!queuedEdit || !!referencePending} onChange={changeQueued}/>)}</div>}
            <div className={`pi-composer-box${requestPending ? ' has-request' : ''}`} {...requestPending ? {} : composerDrop}>
              {requestPending && <div className="pi-requests" aria-label="Pi requests">{questions.map((question) => <PiQuestionCard key={question.id} question={question} onAnswer={answerQuestion} compact/>)}</div>}
              <form hidden={requestPending} onSubmit={(event) => { event.preventDefault(); void send(); }}>
              {queuedEdit && <div className="pi-queue-editing" data-testid="pi-queue-editing"><span>Editing queued message</span><button type="button" disabled={working || !connection || !!referencePending} onClick={() => void sendQueuedEdit(queuedEdit.item.text)}>Cancel edit</button></div>}
              {referencePending > 0 && <span className="pi-reference-loading" role="status">Attaching context…</span>}
              <AttachmentCards paths={attachments} references={references} order={attachmentOrder} onRemoveReference={(path) => { const reference = references.find((item) => item.path === path); if (reference) setAttachmentOrder((items) => items.filter((key) => key !== conversationAttachmentKey(reference))); setReferences((items) => items.filter((item) => item.path !== path)); }} disabled={working} onRemove={(path) => { setAttachmentOrder((items) => items.filter((key) => key !== fileAttachmentKey(path))); setAttachments((items) => items.filter((item) => item !== path)); }}/>
              <PiComposerInput value={draft} onChange={setDraft} onSend={() => void send()} onAction={runChatAction} inputRef={promptInput} skills={skills} templates={templates} onImages={(files) => void attachImages(files)} disabled={(!connection || working) && !changingPermission && !changingWorkspace} actionDisabled={chatActionDisabled}/>
              </form>
              <div className="pi-compose-controls">
                <button className="btn btn-ghost btn-icon pi-attach" type="button" aria-label="Attach file path" title="Attach file path" disabled={working || requestPending} onClick={() => setPicking('file')}><IconPlus size={18}/></button>
                <Select className="pi-permission-mode" data-testid="pi-permission-mode" aria-label="Permission mode" value={run.permissionMode ?? confirmedPermissionMode ?? 'ask'} options={piPermissionModes} onChange={changePermissionMode} disabled={busy || working || !!queued.length || !!queuedEdit || !!questions.length}/>
                <PiSessionMetrics metrics={stats.metrics}/>
                <div className="pi-model-controls">
                {!empty && <PiContextMeter stats={stats} model={status.model}/>}
                <PiModelControl model={status.model} models={models} levels={levels} level={status.thinkingLevel} disabled={busy || working}
                  onModel={(model) => act({ type: 'set_model', provider: model.provider, modelId: model.id })} onLevel={(level) => act({ type: 'set_thinking_level', level })}/>
                </div>
                <div className="pi-send-controls">
                  <button className="btn btn-primary btn-icon pi-send-button" data-testid="pi-send" type="button" aria-label={showStop ? 'Stop' : 'Send'} title={showStop ? 'Stop' : 'Send'} onClick={() => showStop ? void stop() : void send()} disabled={!connection || working || (!showStop && (!!referencePending || !hasDraft))}>{showStop ? <IconStop size={18}/> : <IconSend size={20}/>}</button>
                </div>
              </div>
            </div>
            {empty && <div className="pi-workspace" data-testid="pi-project-drop" {...folderDrop(chooseProject, () => setError('Drag one server folder to select a workspace.'))}>
              <IconFolder size={16}/><Select aria-label="Workspace project" data-testid="pi-project" value={workspace} disabled={busy || working} options={[...workspaces.map((path) => ({ value: path, label: projectNames[path] || (path === '~' ? 'Home' : path.split('/').filter(Boolean).at(-1) || '/') })), { value: '__browse__', label: 'Choose another folder…' }]} onChange={(path) => path === '__browse__' ? setPicking('folder') : chooseProject(path)}/>
            </div>}
          </footer>
          </>)}
      </main>
    </>}

    {picking && <FilePicker mode={picking} initialPath={workspace === '~' ? source.homePath() : ['', ...workspace.split('/').filter(Boolean)]} onCancel={() => setPicking(null)} onOpen={(path) => { setPicking(null); if (picking === 'folder') chooseProject(source.absolutePath(path)); else attach([source.absolutePath(path)]); }}/>}
    {editingMessage && connection && <PiEditMessage connection={connection} onCancel={() => setEditingMessage(false)} onResend={resend}/>}
    {archiveProject && <AppConfirmation title={archiveProject.remove ? 'Remove workspace' : 'Archive workspace chats?'} confirm={archiveProject.remove ? 'Remove workspace' : `Archive ${archiveProject.sessions.length} chats`} busy={working} confirmDisabled={busy} onCancel={() => setArchiveProject(null)} onConfirm={() => { void moveConversation(archiveProject.project, archiveProject.sessions.map((item) => item.id), false, archiveProject.remove).catch((err) => setMoveError((err instanceof Error ? err.message : 'Could not archive every chat.') + (archiveProject.remove ? ' The workspace was kept. Archived chats remain available in Settings.' : ' Any completed moves are available in Archived chats.'))).finally(() => setArchiveProject(null)); }}><p>{archiveProject.remove ? `This will remove “${archiveProject.name}” from the sidebar and archive all its chats.` : `Archive ${archiveProject.sessions.length} saved conversations in “${archiveProject.name}”? You can restore them in Settings → Archived chats.`}</p></AppConfirmation>}
    {rename && <AppConfirmation title="Rename conversation" confirm="Save" busy={working} confirmDisabled={!name.trim() || !connection || busy} onCancel={() => setRename(false)} onConfirm={() => { void act({ type: 'set_session_name', name: name.trim() }).then((ok) => { if (ok) setRename(false); }); }}><input className="input" aria-label="Conversation name" value={name} onChange={(event) => setName(event.target.value)}/></AppConfirmation>}
    {closeConfirmation}
  </div>}</>;
}
