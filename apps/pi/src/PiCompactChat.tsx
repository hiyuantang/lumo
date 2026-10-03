// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { PiAnswer, PiMessage, PiModel, PiPermissionMode, PiQuestion } from '@lumo/sdk/api/pi';
import { piPermissionModes } from '@lumo/sdk/api/pi';
import { Select } from '@lumo/sdk/shell/Select';
import { IconSend, IconStop } from '@lumo/sdk/shell/icons';
import { Markdown } from '@lumo/sdk/apps/Markdown';
import { PiModelControl } from './PiModelControl';
import { PiQuestionCard } from './PiQuestionCard';
import { messageText, workDuration, workGroups } from './piWorkGroups';

function latestAction(messages: PiMessage[]) {
  const latest = messages.at(-1);
  if (latest?.role === 'retry') return 'Retrying…';
  if (latest?.role === 'toolResult') {
    const name = latest.toolName || 'Working';
    const title = name === 'lumo_observe' ? 'Observing desktop' : name === 'lumo_act' ? 'Using desktop' : name.charAt(0).toUpperCase() + name.slice(1);
    const path = latest.args?.path ?? latest.args?.file_path;
    return `${title}${typeof path === 'string' ? ` · ${path.split('/').at(-1)}` : ''}${latest.isError ? ' · Failed' : '…'}`;
  }
  return 'Thinking…';
}

export function PiCompactChat({ installed, loading, working, busy, connection, messages, transcript, onFollow, draft, onDraft, onSend, onStop, showStop, models, model, levels, level, onModel, onLevel, permissionMode, onPermission, questions, onAnswer, context, hasDraft = Boolean(draft.trim()), location, error, onReconnect, onSetup }: {
  installed: boolean; loading: boolean; working: boolean; busy: boolean; connection: boolean;
  messages: PiMessage[]; transcript: RefObject<HTMLDivElement>; onFollow: (value: boolean) => void;
  draft: string; onDraft: (value: string) => void; onSend: () => void; onStop: () => void; showStop: boolean;
  models: PiModel[]; model?: PiModel; levels: string[]; level?: string;
  onModel: (model: PiModel) => Promise<boolean | undefined>; onLevel: (level: string) => Promise<boolean | undefined>;
  permissionMode: PiPermissionMode; onPermission: (value: string) => void;
  questions: PiQuestion[]; onAnswer: (answer: PiAnswer, requestId: string) => Promise<void>;
  context?: ReactNode; hasDraft?: boolean; location?: ReactNode; error: string | null; onReconnect: () => void; onSetup: () => void;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const history = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);
  const following = useRef(true);
  useEffect(() => {
    const node = transcript.current;
    if (!node) return;
    const observer = new ResizeObserver(() => {
      setOverflow(node.scrollHeight > node.clientHeight);
      if (following.current) node.scrollTop = node.scrollHeight;
    });
    observer.observe(node);
    if (history.current) observer.observe(history.current);
    return () => observer.disconnect();
  }, [transcript]);
  useEffect(() => {
    const field = input.current;
    const host = field?.closest<HTMLElement>('.pi-assistant');
    if (connection && !working && host && !host.hidden && document.activeElement === host) field?.focus({ preventScroll: true });
  }, [connection, working]);
  const groups = useMemo(() => workGroups(messages, busy), [messages, busy]);
  const current = groups.at(-1);
  if (location) return <div className="pi-compact-chat"><div className="pi-compact-composer"><div className="pi-assistant-drag-handle" data-testid="pi-assistant-drag-handle" title="Drag to move Pi assistant"/>{location}</div></div>;
  return <div className="pi-compact-chat" data-testid="pi-compact-chat">
    <div className="pi-compact-transcript" ref={transcript} data-testid="pi-compact-messages" data-empty={!groups.length} data-overflow={overflow} role="log" aria-label="Pi conversation" tabIndex={0} onScroll={(event) => { const node = event.currentTarget; following.current = node.scrollHeight - node.scrollTop - node.clientHeight < 40; onFollow(following.current); }}>
      <div className="pi-compact-history" ref={history}>
      {groups.map((group) => <section className="pi-compact-turn" key={group.id}>
        {group.users.map((message, index) => <article className="pi-compact-bubble pi-compact-user" aria-label="Your message" key={index}><Markdown text={messageText(message)}/></article>)}
        {group.final && <article className="pi-compact-bubble pi-compact-reply" aria-label="Pi response"><Markdown text={messageText(group.final)}/><span className="pi-compact-worked" data-testid="pi-compact-worked">{group.duration == null ? 'Worked' : `Worked for ${workDuration(group.duration)}`}</span></article>}
        {group.interrupted && <p className="pi-compact-bubble" role="status">{group.messages.at(-1)?.errorMessage || 'Work stopped'}</p>}
      </section>)}
      </div>
    </div>
    <div className="pi-compact-composer">
      <div className="pi-assistant-drag-handle" data-testid="pi-assistant-drag-handle" title="Drag to move Pi assistant"><div className="pi-compact-activity" role="status" data-testid="pi-compact-action">{questions.length ? 'Waiting for you' : loading ? 'Connecting…' : busy ? latestAction(current?.messages ?? []) : ''}</div></div>
      {error && <div className="pi-compact-error" role="alert">{error}{!connection && !working && <button type="button" className="btn" onClick={onReconnect}>Reconnect</button>}</div>}
      {context}
      {!installed ? <div className="pi-compact-setup"><p>Set up Pi to start using the assistant.</p><button className="btn" onClick={onSetup}>Open Pi</button></div> : <>
        {questions.length > 0 ? <div className="pi-compact-requests">{questions.map((question) => <PiQuestionCard key={question.id} question={question} onAnswer={onAnswer} compact/>)}</div> : <form onSubmit={(event) => { event.preventDefault(); if (!busy) onSend(); }}>
          <textarea ref={input} className="input" data-testid="pi-compact-prompt" aria-label="Message Pi" placeholder="Ask Pi to help…" rows={2} value={draft} disabled={!connection || working} onChange={(event) => onDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (!busy) onSend(); } }}/>
        </form>}
        <div className="pi-compact-controls">
          <Select className="pi-compact-permission" data-testid="pi-permission-mode" aria-label="Approval mode" value={permissionMode} options={piPermissionModes} onChange={onPermission} disabled={busy || working || !connection || !!questions.length}/>
          <PiModelControl model={model} models={models} levels={levels} level={level} disabled={busy || working || !connection} onModel={onModel} onLevel={onLevel}/>
          <button type="button" className="btn btn-primary btn-icon" data-testid="pi-compact-send" aria-label={showStop ? 'Stop' : 'Send'} title={showStop ? 'Stop' : 'Send'} onClick={showStop ? onStop : onSend} disabled={!connection || working || (!showStop && !hasDraft)}>{showStop ? <IconStop size={16}/> : <IconSend size={18}/>}</button>
        </div>
      </>}
    </div>
  </div>;
}
