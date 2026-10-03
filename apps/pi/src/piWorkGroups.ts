// SPDX-License-Identifier: AGPL-3.0-only
import type { PiMessage } from '@lumo/sdk/api/pi';

export interface PiWorkSegment { id: number; user?: PiMessage; steps: PiMessage[] }
export interface PiWorkGroup { segments: PiWorkSegment[]; id: number; messages: PiMessage[]; users: PiMessage[]; steps: PiMessage[]; final?: PiMessage; working: boolean; interrupted: boolean; duration?: number }
export function messageText(message: PiMessage): string {
  return typeof message.content === 'string' ? message.content : message.content.filter((block) => block.type === 'text').map((block) => block.text ?? '').join('\n\n');
}
export function messagePreview(message: PiMessage): string {
  return messageText(message).replace(/!?\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/(^|\n)\s*(?:#{1,6}|[-*+])\s+/g, '$1').replace(/`+|\*\*|__|~~/g, '').replace(/\s+/g, ' ').trim();
}
function terminal(message: PiMessage | undefined) {
  return message?.role === 'assistant' && !message.streaming && !message.errorMessage && !['toolUse', 'error', 'aborted'].includes(message.stopReason ?? '') && !(Array.isArray(message.content) && message.content.some((block) => block.type === 'toolCall')) && Boolean(messageText(message).trim());
}
function hasWorkContent(message: PiMessage) {
  return message.role === 'retry' || message.role === 'toolResult' || Boolean(message.errorMessage?.trim()) || (typeof message.content === 'string' ? Boolean(message.content.trim()) : message.content.some((block) => block.type === 'text' ? Boolean(block.text?.trim()) : block.type === 'thinking' && Boolean(block.thinking?.trim())));
}
export function workGroups(messages: PiMessage[], busy: boolean): PiWorkGroup[] {
  const toolArguments = new Map(messages.flatMap((message) => Array.isArray(message.content) ? message.content.flatMap((block) => block.type === 'toolCall' && block.id && block.arguments ? [[block.id, block.arguments] as const] : []) : []));
  const groups: { id: number; messages: PiMessage[] }[] = [];
  for (const [index, message] of messages.entries()) {
    let group = groups.at(-1);
    if (!group || (message.role === 'user' && message.delivery !== 'steer' && (terminal(group.messages.at(-1)) || ['error', 'aborted'].includes(group.messages.at(-1)?.stopReason ?? '')))) {
      group = { id: index, messages: [] }; groups.push(group);
    }
    group.messages.push(message);
  }
  return groups.map((group, index) => {
    const last = group.messages.at(-1);
    const working = index === groups.length - 1 && busy && !(['stop', 'length', 'error', 'aborted'].includes(last?.stopReason ?? '') && !last?.streaming);
    const final = !working && terminal(last) ? last : undefined;
    const users = group.messages.filter((message) => message.role === 'user');
    const segments: PiWorkSegment[] = [];
    for (const [position, message] of group.messages.entries()) {
      if (message.role === 'user') { segments.push({ id: position, user: message, steps: [] }); continue; }
      if (!segments.length) segments.push({ id: position, steps: [] });
      const segment = segments[segments.length - 1];
      if (message !== final) { if (hasWorkContent(message)) segment.steps.push(message.role === 'toolResult' && !message.args && message.toolCallId && toolArguments.has(message.toolCallId) ? { ...message, args: toolArguments.get(message.toolCallId) } : message); }
      else {
        const thinking = Array.isArray(message.content) ? message.content.filter((block) => block.type === 'thinking' && block.thinking?.trim()) : [];
        if (thinking.length) segment.steps.push({ ...message, content: thinking });
      }
    }
    const steps = segments.flatMap((segment) => segment.steps);
    const start = users[0]?.timestamp;
    const end = final?.completedAt ?? final?.timestamp;
    const duration = start != null && end != null && Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : undefined;
    return { ...group, users, steps, segments, final: final ? { ...final, content: typeof final.content === 'string' ? final.content : final.content.filter((block) => block.type === 'text') } : undefined, working, interrupted: Boolean(last?.errorMessage || ['error', 'aborted'].includes(last?.stopReason ?? '')), duration };
  });
}
export function workDuration(milliseconds: number) {
  const seconds = Math.max(1, Math.round(milliseconds / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}m${seconds % 60 ? ` ${seconds % 60}s` : ''}` : `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ''}`;
}
