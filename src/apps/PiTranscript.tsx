// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useId, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { PiMessage } from '../api/pi';
import { DisclosureBody, DisclosureTrigger } from '../shell/Disclosure';
import { IconChatBubble } from '../shell/icons';
import { PiMessageView } from './PiMessageView';
import { splitAttachmentPrompt } from './piAttachments';
import { messagePreview, messageText, workDuration, workGroups, type PiWorkGroup, type PiWorkSegment } from './piWorkGroups';

export function PiTranscript({ messages, busy, canBranch, onBranch, transcript, onFollow }: { messages: PiMessage[]; busy: boolean; canBranch: boolean; onBranch: () => void; transcript: RefObject<HTMLDivElement>; onFollow: (value: boolean) => void }) {
  const previewId = useId();
  const groups = useMemo(() => workGroups(messages, busy), [messages, busy]);
  const markers = useMemo(() => groups.flatMap((group) => group.segments.filter((segment) => segment.user).map((segment) => ({ id: group.id + segment.id, group, segment }))), [groups]);
  const [active, setActive] = useState<number | null>(null);
  const [hoverPosition, setHoverPosition] = useState<number | null>(null);
  const [preview, setPreview] = useState<{ id: number; top: number; width: number } | null>(null);
  const layout = useRef<HTMLDivElement>(null);
  const navigation = useRef<HTMLElement>(null);
  const current = markers.find((marker) => marker.id === preview?.id);
  function reveal(id: number, target: HTMLButtonElement) {
    const bounds = navigation.current!.getBoundingClientRect();
    const anchor = target.getBoundingClientRect();
    setPreview({ id, top: Math.max(0, Math.min(anchor.top - bounds.top - 24, bounds.height - 180)), width: Math.min(300, (layout.current?.clientWidth ?? 348) - 48) });
  }
  function jump(id: number) {
    const scroll = transcript.current;
    const target = scroll?.querySelector<HTMLElement>(`[data-message-anchor="${id}"]`);
    if (!scroll || !target) return;
    onFollow(false); setActive(markers.find((marker) => marker.id === id)?.group.id ?? null); setPreview(null);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches || Boolean(scroll.closest('.motion-reduced'));
    scroll.scrollTo({ top: scroll.scrollTop + target.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 16, behavior: reduced ? 'instant' : 'smooth' });
    target.focus({ preventScroll: true });
  }
  return <div className="pi-transcript-layout" ref={layout}>
    <nav className="pi-turn-nav" aria-label="Conversation turns" ref={navigation} onMouseLeave={() => setPreview(null)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setPreview(null); }} onKeyDown={(event) => { if (event.key === 'Escape') setPreview(null); }}>
      <div className="pi-turn-markers" onMouseMove={(event) => setHoverPosition((event.clientY - event.currentTarget.getBoundingClientRect().top + event.currentTarget.scrollTop) / 12 - .5)} onMouseLeave={() => setHoverPosition(null)}>{markers.map((marker, index) => {
        const distance = hoverPosition == null ? Infinity : Math.abs(index - hoverPosition);
        const width = distance < 3.5 ? 8 + 5 * (1 + Math.cos(distance * Math.PI / 3.5)) : 8;
        return <button type="button" key={marker.id} data-testid={`pi-turn-marker-${index}`} data-work-group={marker.group.id} className={(active ?? groups.at(-1)?.id) === marker.group.id ? 'is-current-work' : undefined} aria-label={`Jump to message ${index + 1}`} aria-describedby={preview?.id === marker.id ? previewId : undefined} onMouseEnter={(event) => reveal(marker.id, event.currentTarget)} onFocus={(event) => reveal(marker.id, event.currentTarget)} onClick={() => jump(marker.id)}><span style={{ width }}/></button>;
      })}</div>
      {current && preview && <div className="pi-turn-preview" id={previewId} role="tooltip" data-testid="pi-turn-preview" style={{ top: preview.top, width: preview.width }}>
        {current.group.users.map((message, index) => { const parts = splitAttachmentPrompt(messageText(message)); return <div className="pi-turn-preview-user" key={index}><IconChatBubble size={14}/><span>{parts.text || parts.references.map((reference) => reference.name).join(', ') || parts.paths.map((path) => path.split('/').at(-1)).join(', ') || 'Attached context'}</span></div>; })}
        <p>{current.group.final ? messagePreview(current.group.final) : current.group.working ? 'Working…' : 'No final response'}</p>
      </div>}
    </nav>
    <div className="pi-transcript" ref={transcript} data-testid="pi-messages" aria-label="Conversation" onScroll={() => {
      const node = transcript.current;
      if (!node) return;
      onFollow(node.scrollHeight - node.scrollTop - node.clientHeight < 80);
      const top = node.getBoundingClientRect().top + node.clientHeight * .3;
      const visible = [...node.querySelectorAll<HTMLElement>('[data-work-id]')].filter((section) => section.getBoundingClientRect().top <= top).at(-1);
      if (visible) setActive(Number(visible.dataset.workId));
    }}>
      {groups.map((group, index) => <Work key={group.id} group={group} index={index} onBranch={canBranch && index === groups.length - 1 ? onBranch : undefined}/>)}
    </div>
  </div>;
}

function Work({ group, index, onBranch }: { group: PiWorkGroup; index: number; onBranch?: () => void }) {
  const completed = Boolean(group.final);
  const [expanded, setExpanded] = useState(!completed);
  const id = useId();
  useEffect(() => { setExpanded(!completed); }, [completed]);
  const label = completed ? group.duration == null ? 'Worked' : `Worked for ${workDuration(group.duration)}` : group.working ? <WorkingTime since={group.users[0]?.timestamp}/> : group.interrupted ? 'Work interrupted' : 'Work steps';
  const controls = group.segments.filter((segment) => segment.steps.length).map((segment) => `${id}-${segment.id}`).join(' ');
  const firstUser = Math.max(0, group.segments.findIndex((segment) => segment.user));
  const heading = controls ? <div className="pi-work-summary" data-testid="pi-work-summary"><DisclosureTrigger label={label} expanded={expanded} controls={controls} onToggle={() => setExpanded(!expanded)}/></div> : <div className="pi-work-heading">{label}</div>;
  return <section className={`pi-work${completed ? ' is-complete' : ''}`} data-testid="pi-work" data-work-id={group.id} tabIndex={-1} aria-label={`Turn ${index + 1}`}>
    {group.segments.map((segment, position) => <WorkSegment key={segment.id} id={`${id}-${segment.id}`} anchor={group.id + segment.id} segment={segment} expanded={expanded} heading={position === firstUser ? heading : undefined}/>)}
    {group.final && <PiMessageView message={group.final} final onBranch={onBranch}/>}
  </section>;
}

function WorkingTime({ since }: { since?: number }) {
  const [now, setNow] = useState(Date.now);
  const fallback = useRef(now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return <>Working for {workDuration(Math.max(0, now - (since != null && Number.isFinite(since) ? since : fallback.current)))}</>;
}

function WorkSegment({ id, anchor, segment, expanded, heading }: { id: string; anchor: number; segment: PiWorkSegment; expanded: boolean; heading?: ReactNode }) {
  return <div className="pi-work-segment" data-testid="pi-work-segment" data-message-anchor={segment.user ? anchor : undefined} tabIndex={-1}>
    {segment.user && <div className="pi-work-users"><PiMessageView message={segment.user}/></div>}
    {heading}
    {segment.steps.length > 0 && <DisclosureBody id={id} expanded={expanded}><div className="pi-work-steps">{segment.steps.map((message, i) => <PiMessageView key={`${i}-${message.toolCallId ?? message.role}`} message={message}/>)}</div></DisclosureBody>}
  </div>;
}
