// SPDX-License-Identifier: AGPL-3.0-only
import { memo, useEffect, useState } from 'react';
import type { PiMessage } from '../api/pi';
import { Disclosure } from '../shell/Disclosure';
import { IconBranch, IconCode, IconCopy, IconFile, IconFolder, IconGear, IconSearch, IconSkills, IconTerminal, IconThinking } from '../shell/icons';
import { useServerClockSource } from '../shell/ServerClockContext';
import { copyText } from '../utils/clipboard';
import { AttachmentCards } from './PiAttachmentCards';
import { splitAttachmentPrompt } from './piAttachments';
import { Markdown } from './Markdown';

function ToolIcon({ name }: { name?: string }) {
  const icon = name?.toLowerCase() ?? '';
  const Icon = /^(bash|shell|terminal)$/.test(icon) ? IconTerminal : /^(read|write)$/.test(icon) ? IconFile : /^(edit|patch|apply_patch)$/.test(icon) ? IconCode : /^(grep|find|search)$/.test(icon) ? IconSearch : /^(ls|list)$/.test(icon) ? IconFolder : IconGear;
  return <Icon size={14}/>;
}

export const PiMessageView = memo(function PiMessageView({ message, final = false, onBranch }: { message: PiMessage; final?: boolean; onBranch?: () => void }) {
  const { clock } = useServerClockSource();
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const original = typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : message.content;
  const attached = message.role === 'user' ? splitAttachmentPrompt(original.map((block) => block.text ?? '').join('\n')) : { text: '', paths: [], references: [], skills: [], order: undefined };
  const content = (attached.paths.length || attached.references.length || (message.role === 'user' && attached.text !== original.map((block) => block.text ?? '').join('\n'))) ? [{ type: 'text', text: attached.text }] : original;
  const skillTokens = Object.fromEntries((attached.skills ?? []).map((skill) => [`/skill:${skill.name}`, <span className="pi-command-token" data-command-kind="skill" data-testid="pi-skill-reference" title={`Skill: ${skill.name}`}><IconSkills size={14}/><span className="pi-command-token-label">{skill.name}</span></span>]));
  const path = message.args?.path ?? message.args?.file_path;
  const file = message.toolName?.toLowerCase() === 'read' && typeof path === 'string' ? path.split('/').filter(Boolean).at(-1) : undefined;
  const toolLabel = `${message.toolName ?? 'Tool'}${file ? ` ${file}` : ''}`;
  if (message.role === 'toolResult') return <Disclosure className={`pi-tool ${message.isError ? 'has-error' : ''}`} testId="pi-tool" label={<><span className="pi-step-label"><ToolIcon name={message.toolName}/><span title={toolLabel}>{toolLabel}</span></span><small>{message.streaming ? 'Running…' : message.isError ? 'Failed' : 'Done'}</small></>}>{message.args && <pre>{JSON.stringify(message.args, null, 2)}</pre>}<pre>{content.map((block) => block.text ?? '').join('\n') || (message.streaming ? 'Waiting for output…' : 'No output')}</pre></Disclosure>;
  if (!attached.paths.length && !attached.references.length && !content.some((block) => block?.text || block?.thinking) && !message.errorMessage) return null;
  const text = content.filter((block) => block.type === 'text').map((block) => block.text ?? '').join('\n\n');
  const timestamp = typeof message.timestamp === 'number' && Number.isFinite(new Date(message.timestamp).getTime()) ? new Date(message.timestamp) : null;
  const timezone = clock?.timezone ?? 'UTC';
  async function copy() {
    try { await copyText(text); setCopied(true); setCopyError(false); }
    catch { setCopyError(true); }
  }
  return <article className={`pi-message pi-message-${message.role}${message.role !== 'user' && !final ? ' pi-message-activity' : ''}`} aria-label={message.role === 'user' ? 'Your message' : 'Pi response'}>
    <AttachmentCards paths={attached.paths} references={attached.references} order={attached.order}/>{content.map((block, index) => block?.type === 'thinking' ? <Disclosure className="pi-thinking" key={index} label={<span className="pi-step-label"><IconThinking size={14}/><span>Thinking</span></span>}><Markdown text={block.thinking ?? ''}/></Disclosure> : block?.type === 'text' ? <Markdown key={index} text={block.text ?? ''} tokens={skillTokens}/> : null)}
    {message.errorMessage && <p role="alert">{message.errorMessage}</p>}
    {(final || message.role === 'user') && text && <div className="pi-message-actions">
      {text && <button type="button" aria-label={copied ? 'Copied' : 'Copy message'} title={copied ? 'Copied' : 'Copy message'} onClick={() => void copy()}><IconCopy size={16}/></button>}
      {final && onBranch && <button type="button" aria-label="Branch chat" title="Branch chat" onClick={onBranch}><IconBranch size={16}/></button>}
      {timestamp && <time dateTime={timestamp.toISOString()} title={timestamp.toLocaleString(undefined, { timeZone: timezone, dateStyle: 'medium', timeStyle: 'long' })}>{timestamp.toLocaleTimeString(undefined, { timeZone: timezone, hour: 'numeric', minute: '2-digit' })}</time>}
      {copyError && <span role="alert">Could not copy</span>}
    </div>}
  </article>;
});
