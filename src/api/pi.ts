// SPDX-License-Identifier: AGPL-3.0-only
export interface PiTemplate { name: string; content: string; revision: string; path: string }
export interface PiRetry { attempt: number; maxAttempts: number; retryAt: number; errorMessage: string; source: string }
export type PiPermissionMode = 'read-only' | 'ask' | 'auto';
export const piPermissionModes: { value: PiPermissionMode; label: string }[] = [{ value: 'read-only', label: 'Read only' }, { value: 'ask', label: 'Ask for approval' }, { value: 'auto', label: 'Approve for me' }];
import type { DesktopRequest } from './lumo-use';
export interface PiStart { extensionsChanged?: boolean; lumoUse?: boolean; id: string; project: string; permissionMode: PiPermissionMode }
export interface PiContextBudget { mode: 'percent' | 'tokens'; value: number }
export interface PiCompaction { usageBudget?: PiContextBudget; model: string; enabled: boolean; reserveTokens: number; keepRecentTokens: number; defaultReserveTokens: number; defaultKeepRecentTokens: number; customized: boolean; revision: string }
export type PiCompactionChange = Pick<PiCompaction, 'model' | 'enabled' | 'reserveTokens' | 'keepRecentTokens' | 'customized' | 'revision' | 'usageBudget'>;
export interface PiImageSettings { mode: 'original' | 'quality90'; revision: string }
export type PiInstructionKind = 'instructions' | 'append';
export interface PiInstruction { kind: PiInstructionKind; path: string; content: string; revision: string; exists: boolean }
export interface PiForkMessage { entryId: string; text: string }
export interface PiArchivedSession extends PiSession { project: string }
export interface PiConversationReference { project: string; session: string; name: string; path: string; reader: string }
export interface PiSession { id: string; name: string; modified: string }
export interface PiModel { id: string; name: string; provider: string; reasoning?: boolean; contextWindow?: number }
export interface PiBlock { type: string; data?: string; mimeType?: string; text?: string; thinking?: string; name?: string; id?: string; arguments?: Record<string, unknown> }
export interface PiMessage { retry?: PiRetry; timestamp?: number; completedAt?: number; stopReason?: string; delivery?: 'steer' | 'follow_up'; role: string; content: PiBlock[] | string; toolCallId?: string; toolName?: string; isError?: boolean; errorMessage?: string; streaming?: boolean; args?: Record<string, unknown> }
export interface PiState { model?: PiModel; thinkingLevel?: string; isStreaming?: boolean; isCompacting?: boolean; sessionFile?: string; sessionName?: string; pendingMessageCount?: number }
export interface PiSessionMetrics { inputTokens: number; cachedTokens: number; outputTokens: number; responseMs: number; timedResponses: number }
export interface PiStats { metrics?: PiSessionMetrics; compaction?: { enabled: boolean; threshold: number }; tokens?: { total: number }; cost?: number; contextUsage?: { percent: number | null; tokens: number | null; contextWindow: number } }
export interface PiData extends PiState, PiStats { messages?: PiMessage[]; models?: PiModel[]; levels?: string[]; steering?: string[]; followUp?: string[]; disposition?: string; text?: string; cancelled?: boolean }
export interface PiQuestion { id: string; method: 'select' | 'input' | 'editor' | 'confirm'; title: string; message?: string; options?: string[]; placeholder?: string; prefill?: string; expiresAt?: number }
export type PiAnswer = { questionId: string } & ({ value: string } | { confirmed: boolean } | { cancelled: true });
export interface PiReply { retry?: PiRetry | null; questions?: PiQuestion[]; eventCursor?: number; type: string; command: string; success: boolean; error?: string; data?: PiData }
export type PiCommand = { type: 'set_auto_retry'; enabled: boolean } | { type: 'prompt' | 'steer' | 'follow_up'; message: string; streamingBehavior?: 'steer' | 'followUp' } | { type: 'set_model'; provider: string; modelId: string } | { type: 'set_thinking_level'; level: string } | { type: 'set_session_name'; name: string } | { type: 'fork'; entryId: string } | { type: 'compact'; customInstructions?: string } | { type: 'clone' | 'abort' | 'abort_retry' | 'clear_queue' | 'get_state' | 'get_messages' | 'get_fork_messages' | 'get_available_models' | 'get_available_thinking_levels' | 'get_session_stats' };
export interface PiEvent { attempt?: number; maxAttempts?: number; delayMs?: number; errorMessage?: string; finalError?: string; type: string; message?: PiMessage; assistantMessageEvent?: { type: string; contentIndex: number; delta?: string }; toolCallId?: string; toolName?: string; args?: Record<string, unknown>; result?: { content: PiBlock[] }; partialResult?: { content: PiBlock[] }; isError?: boolean; error?: string; reason?: string }
export interface PiEvents { desktop?: DesktopRequest[]; retry?: PiRetry | null; questions?: PiQuestion[]; events: PiEvent[]; cursor: number; closed: boolean }

export function piMessages(messages: PiMessage[], event: PiEvent): PiMessage[] {
  if (event.type === 'auto_retry_start' || event.type === 'summarization_retry_scheduled') {
    const index = event.type === 'auto_retry_start' ? lastIndex(messages, (message) => message.role === 'assistant' && message.stopReason === 'error') : -1;
    return [...messages.filter((_, i) => i !== index), piRetryMessage({ attempt: event.attempt ?? 1, maxAttempts: event.maxAttempts ?? 3, retryAt: Date.now() + (event.delayMs ?? 0), errorMessage: event.errorMessage ?? '', source: event.type === 'auto_retry_start' ? 'response' : 'summary' })];
  }
  if (['auto_retry_end', 'summarization_retry_finished', 'agent_settled'].includes(event.type)) {
    const remaining = messages.filter((message) => message.role !== 'retry' || event.type !== 'agent_settled' && message.retry?.source !== (event.type === 'auto_retry_end' ? 'response' : 'summary'));
    return event.finalError && remaining.at(-1)?.errorMessage !== event.finalError ? [...remaining, { role: 'assistant', content: [], errorMessage: event.finalError, stopReason: 'error' }] : remaining;
  }
  if (event.type === 'message_start' && event.message && event.message.role !== 'toolResult') return [...messages, { ...event.message, timestamp: event.message.timestamp ?? Date.now(), streaming: event.message.role === 'assistant' }];
  if (event.type === 'message_update' && event.assistantMessageEvent) {
    const delta = event.assistantMessageEvent;
    if (delta.type !== 'text_delta' && delta.type !== 'thinking_delta') return messages;
    const index = lastIndex(messages, (message) => message.role === 'assistant' && Boolean(message.streaming));
    if (index < 0) return messages;
    const next = [...messages]; const message = next[index];
    const content = Array.isArray(message.content) ? [...message.content] : [];
    const key = delta.type === 'thinking_delta' ? 'thinking' : 'text';
    const block = content[delta.contentIndex] ?? { type: key };
    content[delta.contentIndex] = { ...block, [key]: (block[key] ?? '') + (delta.delta ?? '') };
    next[index] = { ...message, content }; return next;
  }
  if (event.type === 'message_end' && event.message) {
    const message = event.message;
    const index = message.role === 'toolResult' ? messages.findIndex((item) => item.toolCallId === message.toolCallId) : lastIndex(messages, (item) => item.role === message.role && Boolean(item.streaming || item.role === 'user'));
    if (index < 0) return [...messages, { ...message, completedAt: message.role === 'assistant' ? Date.now() : undefined }];
    return messages.map((item, i) => i === index ? { ...message, timestamp: message.timestamp ?? item.timestamp, delivery: message.delivery ?? item.delivery, completedAt: message.role === 'assistant' ? Date.now() : undefined, args: item.args } : item);
  }
  if (event.type.startsWith('tool_execution_') && event.toolCallId) {
    const index = messages.findIndex((item) => item.toolCallId === event.toolCallId);
    const message: PiMessage = { role: 'toolResult', toolCallId: event.toolCallId, toolName: event.toolName, args: event.args ?? messages[index]?.args, content: event.result?.content ?? event.partialResult?.content ?? [], streaming: event.type !== 'tool_execution_end', isError: event.isError };
    return index < 0 ? [...messages, message] : messages.map((item, i) => i === index ? message : item);
  }
  return messages;
}

export function piRetryMessage(retry: PiRetry): PiMessage { return { role: 'retry', content: [], retry }; }

function lastIndex(items: PiMessage[], matches: (item: PiMessage) => boolean) { for (let index = items.length - 1; index >= 0; index--) if (matches(items[index])) return index; return -1; }

export type PiAuthMethod = 'oauth' | 'api_key';
export interface PiProvider { id: string; name: string; methods: { type: PiAuthMethod; label: string }[]; credential?: PiAuthMethod; keyPreview?: string }
export type PiConnection = Pick<PiProvider, 'id' | 'name' | 'keyPreview'> & { credential: PiAuthMethod };
export interface PiAuthPrompt { id: string; type: 'text' | 'secret' | 'manual_code' | 'select'; message: string; placeholder?: string; options?: { id: string; label: string }[] }
export interface PiAuthEvent { type: string; message?: string; url?: string; code?: string; links?: { url: string; label?: string }[] }
export interface PiAuthState { id: string; status: 'working' | 'done' | 'error' | 'cancelled'; prompt?: PiAuthPrompt; events: PiAuthEvent[]; error?: string }
