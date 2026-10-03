// SPDX-License-Identifier: AGPL-3.0-only
const permissionMode = 'ask';
const questionsEnabled = true;
const pluginReadTools = [];

async function waitForDialog(dialog, signal) {
  if (signal?.aborted) return undefined;
  let abort;
  const interrupted = new Promise((resolve) => {
    abort = () => resolve(undefined);
    signal?.addEventListener('abort', abort, { once: true });
  });
  try { return await Promise.race([dialog, interrupted]); }
  finally { signal?.removeEventListener('abort', abort); }
}

export function sessionMetrics(entries) {
  const messages = new Map(entries.filter((entry) => entry.type === 'message' && entry.message?.role === 'assistant').map((entry) => [entry.id, entry.message]));
  let inputTokens = 0; let cachedTokens = 0; let outputTokens = 0; let responseMs = 0; let timedResponses = 0;
  const counted = new Set();
  const valid = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  for (const message of messages.values()) {
    const usage = message.usage;
    if (usage && [usage.input, usage.cacheRead, usage.cacheWrite].every(valid)) {
      inputTokens += usage.input + usage.cacheRead + usage.cacheWrite;
      cachedTokens += usage.cacheRead;
    }
  }
  for (const entry of entries) {
    const data = entry.data;
    if (entry.type !== 'custom' || entry.customType !== 'lumo-response-timing' || !data || counted.has(data.messageId)) continue;
    const message = messages.get(data.messageId);
    if (!message || !['stop', 'toolUse', 'length'].includes(message.stopReason) || !valid(message.usage?.output) || message.usage.output === 0 || !valid(data.elapsedMs) || data.elapsedMs <= 0) continue;
    counted.add(data.messageId); outputTokens += message.usage.output; responseMs += data.elapsedMs; timedResponses++;
  }
  return { inputTokens, cachedTokens, outputTokens, responseMs, timedResponses };
}

export default function (pi) {
  let responseStarted;
  let pendingTiming;
  const publishMetrics = (ctx) => ctx.ui.setStatus('lumo-metrics', JSON.stringify(sessionMetrics(ctx.sessionManager.getBranch())));
  const saveTiming = (ctx) => {
    if (pendingTiming) {
      const pending = pendingTiming; pendingTiming = undefined;
      const entry = ctx.sessionManager.getBranch().findLast((entry) => entry.type === 'message' && entry.message?.role === 'assistant' && entry.message.timestamp === pending.timestamp);
      if (entry) pi.appendEntry('lumo-response-timing', { messageId: entry.id, elapsedMs: pending.elapsedMs });
    }
    publishMetrics(ctx);
  };
  pi.on('message_start', async (event) => {
    if (event.message?.role === 'assistant') responseStarted = performance.now();
  });
  pi.on('message_end', async (event) => {
    if (event.message?.role !== 'assistant') return;
    if (responseStarted !== undefined && ['stop', 'toolUse', 'length'].includes(event.message.stopReason)) pendingTiming = { timestamp: event.message.timestamp, elapsedMs: performance.now() - responseStarted };
    responseStarted = undefined;
  });
  pi.on('turn_end', async (_event, ctx) => saveTiming(ctx));
  pi.on('agent_before_settle', async (_event, ctx) => saveTiming(ctx));
  for (const event of ['session_switch', 'session_fork', 'session_tree']) pi.on(event, async (_event, ctx) => {
    responseStarted = undefined; pendingTiming = undefined; publishMetrics(ctx);
  });
  const readingTools = new Set(['read', 'grep', 'find', 'ls', 'ask_user', 'lumo_observe', ...pluginReadTools, 'lumo_app_api', 'lumo_app_list', 'lumo_app_status']);
  pi.on('tool_call', async (event, ctx) => {
    if (ctx.signal?.aborted) return { block: true, reason: 'Action interrupted.' };
    if (readingTools.has(event.toolName)) return;
    if (permissionMode === 'read-only') return { block: true, reason: 'Read only mode allows inspection and search. Ask the user to change the mode before making changes or running commands.' };
    if (permissionMode === 'auto') return;
    if (permissionMode !== 'ask' || !ctx.hasUI) return { block: true, reason: 'Approval is unavailable. Action blocked.' };
    const details = JSON.stringify(event.input, null, 2);
    if (!details || details.length > 120000) return { block: true, reason: 'This action is too large to review. Split it into smaller actions and request approval for each.' };
    const title = event.toolName === 'lumo_act' ? 'Use Lumo?' : event.toolName === 'bash' ? 'Run this command?' : event.toolName === 'write' ? 'Write this file?' : event.toolName === 'edit' ? 'Apply this edit?' : `Allow ${event.toolName}?`;
    const approved = await waitForDialog(ctx.ui.confirm(title, details), ctx.signal);
    if (approved !== true || ctx.signal?.aborted) return { block: true, reason: 'The action was not approved. Do not retry it or use another tool to bypass the decision.' };
  });
  pi.on('session_start', async (_event, ctx) => {
    const readable = [...readingTools].filter((name) => ![...pluginReadTools, 'lumo_app_api', 'lumo_app_list', 'lumo_app_status'].includes(name) || pi.getAllTools().some((tool) => tool.name === name));
    if (permissionMode === 'read-only') {
      pi.setActiveTools(readable);
    } else {
      const builtins = new Set(['read', 'bash', 'powershell', 'edit', 'write', 'grep', 'find', 'ls']);
      const extensions = pi.getAllTools().filter((tool) => !builtins.has(tool.name) && (!tool.exposure || tool.exposure === 'direct' || tool.exposure === 'model-only')).map((tool) => tool.name);
      pi.setActiveTools([...new Set([...pi.getActiveTools(), ...readable, ...extensions])]);
    }
    publishMetrics(ctx);
    ctx.ui.setStatus('lumo-permissions', permissionMode);
  });
  if (!questionsEnabled) return;
  pi.registerTool({
    name: 'ask_user',
    label: 'Ask user',
    description: 'Ask the user a focused question when their answer is needed to continue. Supply optional short choices; the user can also write their own answer. Do not repeat the question as a chat message. Cancellation is not approval.',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', minLength: 1, maxLength: 2000 },
        options: { type: 'array', maxItems: 6, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 300 } },
      },
      required: ['question'],
      additionalProperties: false,
    },
    async execute(_id, params, signal, _update, ctx) {
      if (!ctx.hasUI) throw new Error('Interactive questions are unavailable in this mode.');
      if (signal?.aborted) throw new Error('Question interrupted.');
      const dialog = params.options?.length ? ctx.ui.select(params.question, params.options) : ctx.ui.input(params.question);
      const answer = await waitForDialog(dialog, signal);
      const cancelled = answer === undefined;
      return {
        content: [{ type: 'text', text: cancelled ? 'The user did not answer. Do not treat this as approval or assume a choice.' : `User answer: ${answer}` }],
        details: { question: params.question, answer, cancelled },
      };
    },
  });
}
