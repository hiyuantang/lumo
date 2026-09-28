// SPDX-License-Identifier: AGPL-3.0-only
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getDataSource } from '../api/source';
import { usePiProjectNames } from './usePiProjectNames';
import { piMessages, type PiCommand, type PiData, type PiMessage, type PiModel, type PiSession, type PiState, type PiStats } from '../api/pi';
import { folderDrop, fileReferenceDrop } from '../shell/fileDrag';
import { useAppCatalog } from '../shell/AppCatalogContext';
import { useAppPreference, useAppState } from '../shell/useAppState';
import { useShell } from '../shell/ShellContext';
import { useCurrentWindow } from '../shell/WindowContext';
import { IconBranch, IconCopy, IconFile, IconFolder, IconGear, IconHome, IconPlus, IconRefresh, IconX } from '../shell/icons';
import { Select } from '../shell/Select';
import { useServerClockSource } from '../shell/ServerClockContext';
import { copyText } from '../utils/clipboard';
import { FilePicker } from './FilePicker';
import { PiEditMessage } from './PiEditMessage';
import { PiSettings } from './PiSettings';
import { PiSidebar } from './PiSidebar';
import { PiModelControl } from './PiModelControl';
import { attachmentPrompt, splitAttachmentPrompt } from './piAttachments';
import { Markdown } from './Markdown';
import { AppConfirmation } from './ServerAppUI';
import '../styles/pi.css';

export function Pi() {
  const source = getDataSource();
  const { actions, state: shellState } = useShell();
  const win = useCurrentWindow();
  const { catalog, refresh } = useAppCatalog();
  const installed = catalog?.apps.some((app) => app.id === 'pi' && app.installed);
  const [project, setProject] = useAppState<string>('pi', 'project', win.projectPath ?? '~');
  const [collapsed, setCollapsed] = useAppPreference<boolean>('pi', 'sidebar-collapsed', false);
  const [run, setRun] = useState<{ project: string; session?: string; epoch: number }>(() => ({ project: win.projectPath ?? project, epoch: 0 }));
  const [connection, setConnection] = useState<string | null>(null);
  const [sessionLists, setSessionLists] = useState<Record<string, PiSession[]>>({});
  const [messages, setMessages] = useState<PiMessage[]>([]);
  const [models, setModels] = useState<PiModel[]>([]);
  const [levels, setLevels] = useState<string[]>([]);
  const [status, setStatus] = useState<PiState>({});
  const [stats, setStats] = useState<PiStats>({});
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [working, setWorking] = useState(false);
  const [queue, setQueue] = useState<'steer' | 'follow_up'>('steer');
  const [queued, setQueued] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);
  const [settingsVisited, setSettingsVisited] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [setup, setSetup] = useState(false);
  const [editingMessage, setEditingMessage] = useState(false);
  const streamGeneration = useRef(0);
  const eventCursor = useRef(0);
  const [streamVersion, setStreamVersion] = useState(0);
  const [moveError, setMoveError] = useState('');
  const [archiveProject, setArchiveProject] = useState<{ project: string; name: string; sessions: PiSession[] } | null>(null);
  const [projectNames] = usePiProjectNames();
  const [sessionRevision, setSessionRevision] = useState(0);
  const [rename, setRename] = useState(false);
  const [name, setName] = useState('');
  const [pendingTitle, setPendingTitle] = useState('Close Pi?');
  const [pendingClose, setPendingClose] = useState<(() => void) | null>(null);
  const [picking, setPicking] = useState<'folder' | 'file' | null>(null);
  const [remembered] = useAppPreference<string[]>('pi', 'projects', []);
  const promptInput = useRef<HTMLTextAreaElement>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const current = useRef<string | null>(null);
  const actionLock = useRef(false);
  const runtimeKey = `lumo.pi.runtime:${encodeURIComponent(shellState.user ?? '')}:${win.id}`;
  const resume = useRef<string | undefined>(undefined);
  const resumeLoaded = useRef(false);
  if (!resumeLoaded.current) {
    try { resume.current = sessionStorage.getItem(runtimeKey) ?? undefined; } catch {}
    resumeLoaded.current = true;
  }
  const lifecycle = useRef<Promise<void>>(Promise.resolve());

  useLayoutEffect(() => actions.registerWindowGuard(win.id, (proceed) => {
    if (busy || draft.trim() || attachments.length || settingsDirty) { setPendingTitle('Close Pi?'); setPendingClose(() => proceed); } else proceed();
  }), [actions, win.id, busy, draft, attachments.length, settingsDirty]);

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
  useEffect(() => {
    if (!run || !installed || setup) return;
    let disposed = false; let id: string | null = null;
    setWorking(true); setConnection(null); setError(null); setMessages([]); setQueued([]); setStatus({}); setStats({});
    const launch = lifecycle.current.catch(() => {}).then(async () => {
      if (disposed) return;
      const result = await source.piStart(run.project, run.session, resume.current);
      resume.current = undefined;
      id = result.id;
      if (disposed) return;
      current.current = id;
      try { sessionStorage.setItem(runtimeKey, id); } catch {}
      actions.setPiProject(win.id, result.project);
      eventCursor.current = 0;
      await loadState(id, run.project, true);
      if (!disposed) { setConnection(id); }
    }).catch((err) => { if (!disposed) { setError(err instanceof Error ? err.message : 'Something went wrong.'); } }).finally(() => { if (!disposed) setWorking(false); });
    lifecycle.current = launch;
    return () => {
      disposed = true; current.current = null;
      lifecycle.current = launch.then(async () => { if (id) {
        try { if (sessionStorage.getItem(runtimeKey) === id) sessionStorage.removeItem(runtimeKey); } catch {}
        await source.piStop(id);
      } }).catch(() => {});
    };
  }, [run, installed, setup]);

  useEffect(() => {
    if (!connection || !run) return;
    let disposed = false; let cursor = eventCursor.current; const generation = streamGeneration.current;
    void (async () => {
      while (!disposed) {
        const batch = await source.piEvents(connection, cursor);
        if (disposed || generation !== streamGeneration.current) return;
        cursor = batch.cursor; eventCursor.current = cursor;
        for (const event of batch.events) {
          setMessages((items) => piMessages(items, event));
          if (event.type === 'message_start' && event.message?.role === 'user') {
            const message = event.message;
            const text = typeof message.content === 'string' ? message.content : message.content.map((block) => block.text ?? '').join('');
            setQueued((items) => { const index = items.indexOf(text); return index < 0 ? items : items.filter((_, i) => i !== index); });
          }
          if (event.type === 'agent_start') { setBusy(true); }
          if (event.type === 'auto_compaction_start') { setBusy(true); }
          if (event.type === 'agent_settled') { setBusy(false); setQueued([]); void loadState(connection, run.project).catch((err) => { if (!disposed && generation === streamGeneration.current) setError(err instanceof Error ? err.message : 'Something went wrong.'); }); }
          if (event.message?.errorMessage) setError(event.message.errorMessage);
          if (event.error) setError(event.error);
        }
        if (batch.closed) throw new Error('Pi stopped. Reopen this session to continue.');
      }
    })().catch((err) => { if (!disposed && generation === streamGeneration.current) { setError(err instanceof Error ? err.message : 'Something went wrong.'); setConnection(null); setBusy(false); } });
    return () => { disposed = true; };
  }, [connection, run, streamVersion]);
  useEffect(() => { if (follow.current) transcript.current?.scrollTo({ top: transcript.current.scrollHeight }); }, [messages]);

  async function act(value: PiCommand, reload = true) {
    if (!connection || actionLock.current) return;
    actionLock.current = true; setWorking(true); setError(null);
    try { await command(connection, value); if (reload && run) await loadState(connection, run.project); return true; }
    catch (err) { setError(err instanceof Error ? err.message : 'Something went wrong.'); return false; }
    finally { actionLock.current = false; setWorking(false); }
  }
  async function send() {
    const text = attachmentPrompt(draft, attachments); if (!text || !connection || actionLock.current) return;
    actionLock.current = true; setWorking(true); setError(null); follow.current = true;
    try {
      const reply = await command(connection, { type: busy ? queue : 'prompt', message: text });
      setDraft(''); setAttachments([]);
      if (reply.disposition === 'queued') setQueued((items) => [...items, text]);
      else if (reply.disposition !== 'handled') { setBusy(true); }
    } catch (err) { setError(err instanceof Error ? err.message : 'Something went wrong.'); }
    finally { actionLock.current = false; setWorking(false); }
  }
  function restoreQueue(data: PiData) {
    const restored = [...(data.steering ?? []), ...(data.followUp ?? [])].map(splitAttachmentPrompt);
    const text = restored.map((item) => item.text).filter(Boolean).join('\n\n');
    const paths = restored.flatMap((item) => item.paths);
    if (paths.length) setAttachments((items) => [...new Set([...items, ...paths])]);
    if (text) setDraft((value) => [value, text].filter(Boolean).join('\n\n'));
    setQueued([]);
    return Boolean(text || paths.length);
  }
  async function takeBack(stopReply = false) {
    if (!connection || actionLock.current) return;
    actionLock.current = true; setWorking(true); setError(null);
    try {
      const restored = restoreQueue(await command(connection, { type: 'clear_queue' }));
      if (stopReply) {
        await command(connection, { type: 'abort' });
        if (run) await loadState(connection, run.project, true);
      } else if (!restored) setError('That message has already started. Stop the reply, then use Edit & resend.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not stop Pi.'); }
    finally { actionLock.current = false; setWorking(false); }
  }
  async function resend(entryId: string, text: string) {
    if (!connection || !run || busy || actionLock.current) throw new Error('Stop the current reply before editing an earlier message.');
    actionLock.current = true; setWorking(true); setError(null);
    streamGeneration.current++;
    let forked = false;
    try {
      const result = await source.piCommand(connection, { type: 'fork', entryId });
      if (!result.success) throw new Error(result.error || 'Could not create a new chat.');
      if (result.data?.cancelled) throw new Error('Pi cancelled the new chat. Your original conversation is unchanged.');
      forked = true;
      if (!Number.isSafeInteger(result.eventCursor) || result.eventCursor! < 0) throw new Error('Reconnect Pi before continuing this chat.');
      eventCursor.current = result.eventCursor!;
      await loadState(connection, run.project, true);
      setEditingMessage(false); follow.current = true;
      setStreamVersion((value) => value + 1);
      const reply = await command(connection, { type: 'prompt', message: text });
      if (reply.disposition !== 'handled') { setBusy(true); }
    } catch (err) {
      if (forked) {
        setEditingMessage(false);
        setDraft((value) => [value, text].filter(Boolean).join('\n\n'));
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
  function leave(proceed: () => void) {
    if (draft.trim() || attachments.length) { setPendingTitle('Leave conversation?'); setPendingClose(() => () => { setPendingClose(null); proceed(); }); } else proceed();
  }
  function open(session?: string, folder = project, preserveDraft = false) {
    resume.current = undefined;
    const path = folder.trim() || '~';
    if (path !== '~' && !path.startsWith('/')) { setError('Use an absolute folder path, or ~ for your home folder.'); return; }
    setProject(path); setRun({ project: path, session, epoch: Date.now() }); if (!preserveDraft) { setDraft(''); setAttachments([]); } follow.current = true;
  }
  const sessionID = status.sessionFile?.split('/').at(-1) ?? run.session;
  async function moveConversation(folder: string, target: string | string[], restore = false) {
    if (actionLock.current || busy) throw new Error('Stop the current reply before moving a conversation.');
    actionLock.current = true; setWorking(true); setError(null); setMoveError('');
    const activeFolder = win.projectPath ?? (run.project === '~' ? source.absolutePath(source.homePath()) : run.project);
    const sameProject = folder === activeFolder;
    const id = connection;
    let stopped = false;
    const targets = typeof target === 'string' ? [target] : [...new Set(target)];
    const moved = new Set<string>();
    try {
      if (sameProject && id) {
        streamGeneration.current++; setConnection(null); current.current = null;
        await source.piStop(id); stopped = true; resume.current = undefined;
        try { sessionStorage.removeItem(runtimeKey); } catch {}
      }
      for (const id of targets) {
        if (restore) await source.piRestoreSession(folder, id); else await source.piArchiveSession(folder, id);
        moved.add(id);
        if (!restore) setSessionLists((lists) => ({ ...lists, [folder]: (lists[folder] ?? []).filter((item) => item.id !== id) }));
      }
    } finally {
      if (moved.size) setSessionRevision((value) => value + 1);
      if (stopped || (sameProject && moved.size)) open(!restore && sessionID && moved.has(sessionID) ? undefined : sessionID, activeFolder, true);
      else if (sameProject && id) { current.current = id; setConnection(id); setStreamVersion((value) => value + 1); }
      actionLock.current = false; setWorking(false);
    }
  }
  const empty = messages.length === 0;
  const lastConversationMessage = messages.filter((message) => message.role === 'user' || message.role === 'assistant').at(-1);
  const workspace = win.projectPath ?? run.project;
  const workspaces = [...new Set([workspace, ...remembered])];
  function attach(paths: string[]) { if (working) return; setAttachments((items) => [...new Set([...items, ...paths])]); promptInput.current?.focus(); }
  function chooseProject(path: string) { if (busy || working) return; setError(null); open(undefined, path, true); }

  return <div className="app pi-app" data-testid="app-pi">
    <nav className="pi-app-rail" aria-label="Pi navigation" data-testid="pi-app-rail">
      <button type="button" aria-label="Home" title="Home" data-testid="pi-home-button" aria-current={!settings ? 'page' : undefined} disabled={settingsBusy} onClick={() => { setSetup(false); setSettings(false); }}><IconHome size={20}/></button>
      <button type="button" aria-label="Settings" title="Settings" data-testid="pi-settings-button" aria-current={settings ? 'page' : undefined} onClick={() => { setSettingsVisited(true); setSettings(true); }}><IconGear size={20}/></button>
    </nav>
    {installed && !settings && <PiSidebar collapsed={collapsed} project={win.projectPath ?? run?.project ?? ''} session={sessionID} sessions={sessionLists[win.projectPath ?? run.project]} disabled={busy || working || settings}
      onNew={() => leave(() => open(undefined, run?.project ?? project))} onNewProject={(path) => leave(() => open(undefined, path))} onArchiveProject={(path, name, sessions) => setArchiveProject({ project: path, name, sessions })} onOpen={(path, id) => leave(() => open(id, path))}
      revision={sessionRevision} onArchive={(path, item) => { void moveConversation(path, item.id).catch((err) => setMoveError(err instanceof Error ? err.message : 'Could not archive this conversation.')); }} onCollapse={() => setCollapsed((value) => !value)}/>}
    {settingsVisited && <div className="pi-settings-host" hidden={!settings}><PiSettings installed={Boolean(installed)} provider={status.model?.provider} setup={setup} disabled={busy || working} onDirty={setSettingsDirty} onBusy={setSettingsBusy} revision={sessionRevision} onRestore={(folder, id) => moveConversation(folder, id, true)}
      onConnect={() => { if (run) setRun({ ...run, session: sessionID }); setSetup(true); }} onDone={() => setSetup(false)}/></div>}
    {settings ? null : !installed ? <div className="pi-welcome">
      <div className="pi-welcome-mark" aria-hidden="true">π</div><h1>Pi</h1>
      <div className="pi-install"><p>{catalog ? 'Install Pi to start working with your projects.' : 'Checking for Pi…'}</p><button className="btn btn-primary" onClick={() => actions.openApp('library')}>Open App Library</button><button className="btn btn-icon" aria-label="Check installation" onClick={() => void refresh().catch((err) => setError(err instanceof Error ? err.message : 'Something went wrong.'))}><IconRefresh size={16}/></button></div>
    </div> : <>
      <main className={`pi-main${empty ? ' pi-new-conversation' : ''}`}>
          {(moveError || error) && <div className="pi-notice" role="alert">{moveError || error}{!connection && !working && <button className="btn" onClick={() => open(sessionID)}>Reconnect</button>}</div>}
          {!empty && <div className="pi-transcript" ref={transcript} onScroll={() => { const node = transcript.current; if (node) follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80; }} data-testid="pi-messages" aria-label="Conversation">
            {messages.map((message, index) => <Message key={`${index}-${message.toolCallId ?? message.role}`} message={message} onBranch={message.role === 'assistant' && message === lastConversationMessage && !message.streaming && !busy && !working ? () => void branch() : undefined}/>)}
          </div>}
          <footer className="pi-compose">
            {empty && <h1>What should we work on?</h1>}
            {!empty && <div className="pi-session-actions">
              <span>{stats.contextUsage?.percent != null ? `${Math.round(stats.contextUsage.percent)}% context` : ' '}{stats.cost != null ? ` · $${stats.cost.toFixed(3)}` : ''}</span>
              <button className="btn btn-ghost" disabled={busy || working || !connection || !messages.some((message) => message.role === 'user')} onClick={() => setEditingMessage(true)}>Edit &amp; resend</button>
              <button className="btn btn-ghost" disabled={busy || working || !connection} onClick={() => { setName(status.sessionName ?? ''); setRename(true); }}>Rename</button>
              <button className="btn btn-ghost" disabled={busy || working || !messages.length || !connection} onClick={() => void act({ type: 'compact' })}>Compact</button>
            </div>}
            {queued.length > 0 && <div className="pi-queued" role="status">{queued.length} queued <button className="btn btn-ghost" disabled={working} onClick={() => void takeBack()}>Take back</button></div>}
            <form {...fileReferenceDrop(attach)} onSubmit={(event) => { event.preventDefault(); void send(); }}>
              <AttachmentCards paths={attachments} disabled={working} onRemove={(path) => setAttachments((items) => items.filter((item) => item !== path))}/>
              <textarea ref={promptInput} className="input" data-testid="pi-prompt" aria-label="Message Pi" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Ask Pi to help with this project…" rows={3} disabled={!connection} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }}/>
              <div className="pi-compose-controls">
                <button className="btn btn-ghost pi-attach" type="button" aria-label="Attach file path" title="Attach file path" disabled={working} onClick={() => setPicking('file')}><IconPlus size={18}/></button>
                <div className="pi-model-controls">
                <PiModelControl model={status.model} models={models} levels={levels} level={status.thinkingLevel} disabled={busy || working}
                  onModel={(model) => act({ type: 'set_model', provider: model.provider, modelId: model.id })} onLevel={(level) => act({ type: 'set_thinking_level', level })}/>
                </div>
                <div className="pi-send-controls">{busy && <><Select aria-label="Send behavior" value={queue} options={[{ value: 'steer', label: 'Steer' }, { value: 'follow_up', label: 'Follow up' }]} onChange={(value) => setQueue(value as typeof queue)}/><button className="btn" type="button" onClick={() => void takeBack(true)} disabled={working}>Stop</button></>}
                  <button className="btn btn-primary" data-testid="pi-send" type="submit" disabled={!connection || working || (!draft.trim() && !attachments.length)}>{busy ? 'Queue' : 'Send'}</button>
                </div>
              </div>
            </form>
            {empty && <div className="pi-workspace" data-testid="pi-project-drop" {...folderDrop(chooseProject, () => setError('Drag one server folder to select a workspace.'))}>
              <IconFolder size={16}/><Select aria-label="Workspace project" data-testid="pi-project" value={workspace} disabled={busy || working} options={[...workspaces.map((path) => ({ value: path, label: projectNames[path] || (path === '~' ? 'Home' : path.split('/').filter(Boolean).at(-1) || '/') })), { value: '__browse__', label: 'Choose another folder…' }]} onChange={(path) => path === '__browse__' ? setPicking('folder') : chooseProject(path)}/>
            </div>}
          </footer>
      </main>
    </>}

    {picking && <FilePicker mode={picking} initialPath={workspace === '~' ? source.homePath() : ['', ...workspace.split('/').filter(Boolean)]} onCancel={() => setPicking(null)} onOpen={(path) => { setPicking(null); if (picking === 'folder') chooseProject(source.absolutePath(path)); else attach([source.absolutePath(path)]); }}/>}
    {editingMessage && connection && <PiEditMessage connection={connection} onCancel={() => setEditingMessage(false)} onResend={resend}/>}
    {archiveProject && <AppConfirmation title="Archive workspace chats?" confirm={`Archive ${archiveProject.sessions.length} chats`} busy={working} confirmDisabled={busy} onCancel={() => setArchiveProject(null)} onConfirm={() => { void moveConversation(archiveProject.project, archiveProject.sessions.map((item) => item.id)).catch((err) => setMoveError((err instanceof Error ? err.message : 'Could not archive every chat.') + ' Any completed moves are available in Archived chats.')).finally(() => setArchiveProject(null)); }}><p>Archive {archiveProject.sessions.length} saved conversations in “{archiveProject.name}”? You can restore them in Settings → Archived chats.</p></AppConfirmation>}
    {rename && <AppConfirmation title="Rename conversation" confirm="Save" busy={working} confirmDisabled={!name.trim()} onCancel={() => setRename(false)} onConfirm={() => { void act({ type: 'set_session_name', name: name.trim() }).then((ok) => { if (ok) setRename(false); }); }}><input className="input" aria-label="Conversation name" value={name} onChange={(event) => setName(event.target.value)}/></AppConfirmation>}
    {pendingClose && <AppConfirmation title={pendingTitle} confirm="Close" onCancel={() => setPendingClose(null)} onConfirm={pendingClose}><p>{busy ? 'This stops the current task. Your conversation is saved.' : settingsDirty ? 'Your unsaved settings will be discarded.' : 'Your unsent message will be discarded.'}</p></AppConfirmation>}
  </div>;
}
function AttachmentCards({ paths, disabled, onRemove }: { paths: string[]; disabled?: boolean; onRemove?: (path: string) => void }) {
  if (!paths.length) return null;
  return <div className="pi-attachments" aria-label="Attached files">{paths.map((path) => {
    const name = path.split('/').at(-1) || path;
    return <div className="pi-attachment" key={path} title={path} data-testid="pi-attachment">
      <IconFile size={24}/><span>{name}</span>
      {onRemove && <button type="button" aria-label={`Remove ${name}`} title="Remove attachment" disabled={disabled} onClick={() => onRemove(path)}><IconX size={14}/></button>}
    </div>;
  })}</div>;
}
const Message = memo(function Message({ message, onBranch }: { message: PiMessage; onBranch?: () => void }) {
  const { clock } = useServerClockSource();
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const original = typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : message.content;
  const attached = message.role === 'user' ? splitAttachmentPrompt(original.map((block) => block.text ?? '').join('\n')) : { text: '', paths: [] };
  const content = attached.paths.length ? [{ type: 'text', text: attached.text }] : original;
  if (message.role === 'toolResult') return <details className={`pi-tool ${message.isError ? 'has-error' : ''}`} data-testid="pi-tool"><summary><span>{message.toolName ?? 'Tool'}</span><small>{message.streaming ? 'Running…' : message.isError ? 'Failed' : 'Done'}</small></summary>{message.args && <pre>{JSON.stringify(message.args, null, 2)}</pre>}<pre>{content.map((block) => block.text ?? '').join('\n') || (message.streaming ? 'Waiting for output…' : 'No output')}</pre></details>;
  if (!attached.paths.length && !content.some((block) => block?.text || block?.thinking) && !message.errorMessage) return null;
  const text = original.filter((block) => block.type === 'text').map((block) => block.text ?? '').join('\n\n');
  const timestamp = message.role === 'assistant' && typeof message.timestamp === 'number' && Number.isFinite(new Date(message.timestamp).getTime()) ? new Date(message.timestamp) : null;
  const timezone = clock?.timezone ?? 'UTC';
  async function copy() {
    try { await copyText(text); setCopied(true); setCopyError(false); }
    catch { setCopyError(true); }
  }
  return <article className={`pi-message pi-message-${message.role}`} aria-label={message.role === 'user' ? 'Your message' : 'Pi response'}>
    <AttachmentCards paths={attached.paths}/>{content.map((block, index) => block?.type === 'thinking' ? <details className="pi-thinking" key={index}><summary>Thinking</summary><Markdown text={block.thinking ?? ''}/></details> : block?.type === 'text' ? <Markdown key={index} text={block.text ?? ''}/> : null)}
    {message.errorMessage && <p role="alert">{message.errorMessage}</p>}
    <div className="pi-message-actions">
      {text && <button type="button" aria-label={copied ? 'Copied' : 'Copy message'} title={copied ? 'Copied' : 'Copy message'} onClick={() => void copy()}><IconCopy size={16}/></button>}
      {onBranch && <button type="button" aria-label="Branch chat" title="Branch chat" onClick={onBranch}><IconBranch size={16}/></button>}
      {timestamp && <time dateTime={timestamp.toISOString()} title={timestamp.toLocaleString(undefined, { timeZone: timezone, dateStyle: 'medium', timeStyle: 'long' })}>{timestamp.toLocaleTimeString(undefined, { timeZone: timezone, hour: 'numeric', minute: '2-digit' })}</time>}
      {copyError && <span role="alert">Could not copy</span>}
    </div>
  </article>;
});
