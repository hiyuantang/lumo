// SPDX-License-Identifier: AGPL-3.0-only
import { test } from 'node:test';
import assert from 'node:assert/strict';
import questions from '../server/internal/httpapi/pi_questions.mjs';

function tool() {
  let registered;
  questions({ on() {}, registerTool(value) { registered = value; } });
  return registered;
}

test('ask_user returns the chosen or custom answer with its question', async () => {
  const result = await tool().execute('one', { question: 'Which size?', options: ['Small', 'Large'] }, undefined, undefined, {
    hasUI: true,
    ui: { select: async (question, options) => { assert.equal(question, 'Which size?'); assert.deepEqual(options, ['Small', 'Large']); return 'Medium'; } },
  });
  assert.deepEqual(result.details, { question: 'Which size?', answer: 'Medium', cancelled: false });
});

test('ask_user cancellation does not imply approval', async () => {
  const result = await tool().execute('one', { question: 'Proceed?' }, undefined, undefined, { hasUI: true, ui: { input: async () => undefined } });
  assert.equal(result.details.cancelled, true);
  assert.match(result.content[0].text, /Do not treat this as approval/);
});

test('ask_user abort interrupts waiting while another question stays independent', async () => {
  const first = new AbortController(); const second = new AbortController();
  let answerSecond;
  const one = tool().execute('one', { question: 'First?' }, first.signal, undefined, { hasUI: true, ui: { input: () => new Promise(() => {}) } });
  const two = tool().execute('two', { question: 'Second?' }, second.signal, undefined, { hasUI: true, ui: { input: () => new Promise((resolve) => { answerSecond = resolve; }) } });
  first.abort();
  assert.equal((await one).details.cancelled, true);
  answerSecond('Still here');
  assert.equal((await two).details.answer, 'Still here');
});

test('ask_user rejects unavailable UI and an already interrupted turn', async () => {
  await assert.rejects(tool().execute('one', {}, undefined, undefined, { hasUI: false }), /unavailable/);
  await assert.rejects(tool().execute('one', {}, AbortSignal.abort(), undefined, { hasUI: true }), /interrupted/);
});

async function permissions(mode) {
  const { readFile } = await import('node:fs/promises');
  const source = (await readFile(new URL('../server/internal/httpapi/pi_questions.mjs', import.meta.url), 'utf8')).replace("const permissionMode = 'ask';", `const permissionMode = '${mode}';`);
  const module = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const handlers = {};
  module.default({ on(name, handler) { handlers[name] = handler; }, registerTool() {} });
  return handlers.tool_call;
}

test('Read only permits inspection and questions, blocks every other tool', async () => {
  const check = await permissions('read-only');
  for (const toolName of ['read', 'grep', 'find', 'ls', 'ask_user', 'lumo_observe']) assert.equal(await check({ toolName }, {}), undefined);
  for (const toolName of ['bash', 'edit', 'write', 'powershell', 'unknown', 'codemode', 'lumo_act']) assert.equal((await check({ toolName }, {})).block, true);
});

test('Ask requires explicit approval for the exact action, including shell reads', async () => {
  const check = await permissions('ask');
  const input = { command: 'cat notes.txt' };
  for (const confirmed of [true, false, undefined]) {
    let seen;
    const result = await check({ toolName: 'bash', input }, { hasUI: true, ui: { confirm: async (_title, message) => { seen = JSON.parse(message); return confirmed; } } });
    assert.deepEqual(seen, input);
    assert.equal(result?.block, confirmed === true ? undefined : true);
  }
  for (const toolName of ['edit', 'write']) {
    const result = await check({ toolName, input: { path: '/tmp/file', content: 'proposed content' } }, { hasUI: true, ui: { confirm: async () => false } });
    assert.equal(result.block, true);
  }
  assert.equal((await check({ toolName: 'write', input }, { hasUI: false })).block, true);
});

test('Approval abort blocks the action and oversized actions are never partly reviewed', async () => {
  const check = await permissions('ask');
  const controller = new AbortController();
  const pending = check({ toolName: 'write', input: { path: '/tmp/x', content: 'change' } }, { signal: controller.signal, hasUI: true, ui: { confirm: () => new Promise(() => {}) } });
  controller.abort();
  assert.equal((await pending).block, true);
  assert.equal((await check({ toolName: 'write', input: { content: 'x'.repeat(120001) } }, { hasUI: true })).block, true);
});

test('Approve for me runs without dialogs and invalid modes fail closed', async () => {
  const automatic = await permissions('auto');
  assert.equal(await automatic({ toolName: 'bash', input: { command: 'echo test' } }, {}), undefined);
  const invalid = await permissions('invalid');
  assert.equal((await invalid({ toolName: 'write', input: {} }, { hasUI: true })).block, true);
});

test('Session metrics weight token counts and time, deduplicate timing, and exclude unrelated branches', async () => {
  const { sessionMetrics } = await import('../server/internal/httpapi/pi_questions.mjs');
  const message = (id, input, cacheRead, cacheWrite, output) => ({ type: 'message', id, message: { role: 'assistant', stopReason: 'stop', usage: { input, cacheRead, cacheWrite, output } } });
  const timing = (messageId, elapsedMs) => ({ type: 'custom', customType: 'lumo-response-timing', data: { messageId, elapsedMs } });
  const first = message('one', 20, 60, 20, 100);
  const second = message('two', 800, 100, 100, 900);
  const older = message('old', 40, 60, 0, 999);
  const entries = [first, timing('one', 1000), timing('one', 1000), second, timing('two', 9000), older, timing('abandoned', 99999)];
  assert.deepEqual(sessionMetrics(entries), { inputTokens: 1200, cachedTokens: 220, outputTokens: 1000, responseMs: 10000, timedResponses: 2 });
  assert.deepEqual(sessionMetrics([first, timing('one', 1000)]), { inputTokens: 100, cachedTokens: 60, outputTokens: 100, responseMs: 1000, timedResponses: 1 });
  assert.deepEqual(sessionMetrics([]), { inputTokens: 0, cachedTokens: 0, outputTokens: 0, responseMs: 0, timedResponses: 0 });
});

test('Session metrics do not invent timing or usage for missing, invalid, failed, or aborted responses', async () => {
  const { sessionMetrics } = await import('../server/internal/httpapi/pi_questions.mjs');
  const entries = ['aborted', 'error', 'stop', 'length'].map((stopReason, index) => ({ type: 'message', id: String(index), message: { role: 'assistant', stopReason, usage: { input: 10, cacheRead: 0, cacheWrite: 0, output: 20 } } }));
  entries.push(...entries.map((entry, i) => ({ type: 'custom', customType: 'lumo-response-timing', data: { messageId: entry.id, elapsedMs: i === 2 ? 0 : 1000 } })));
  entries.push({ type: 'message', id: 'missing', message: { role: 'assistant' } }, { type: 'message', id: 'invalid', message: { role: 'assistant', usage: { input: -2, cacheRead: 50, cacheWrite: 0 } } });
  assert.deepEqual(sessionMetrics(entries), { inputTokens: 40, cachedTokens: 0, outputTokens: 20, responseMs: 1000, timedResponses: 1 });
});

test('Loaded extension tools join the active set without activating excluded builtins or hidden tools', async () => {
  const handlers = {}; let active = ['read', 'ask_user'];
  questions({ on(name, handler) { handlers[name] = handler; }, registerTool() {},
    getAllTools: () => [{ name: 'lumo_calendar_list' }, { name: 'write' }, { name: 'custom' }, { name: 'ask_user' }, { name: 'hidden', exposure: 'hidden' }, { name: 'deferred', exposure: 'deferred' }],
    getActiveTools: () => active, setActiveTools: (value) => { active = value; },
  });
  await handlers.session_start({}, { sessionManager: { getBranch: () => [] }, ui: { setStatus() {} } });
  assert.deepEqual(active, ['read', 'ask_user', 'grep', 'find', 'ls', 'lumo_observe', 'lumo_calendar_list', 'custom']);
});

test('Disabling Questions removes ask_user while approval enforcement and session hooks remain active', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = (await readFile(new URL('../server/internal/httpapi/pi_questions.mjs', import.meta.url), 'utf8')).replace('const questionsEnabled = true;', 'const questionsEnabled = false;');
  const module = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const handlers = {}; const tools = [];
  module.default({ on(name, handler) { handlers[name] = handler; }, registerTool(value) { tools.push(value.name); } });
  assert.deepEqual(tools, []);
  assert.equal(typeof handlers.session_start, 'function');
  const denied = await handlers.tool_call({ toolName: 'write', input: { path: '/tmp/fixture' } }, { hasUI: true, ui: { confirm: async () => false } });
  assert.equal(denied.block, true);
  assert.match(denied.reason, /not approved/);
});
