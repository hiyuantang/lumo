// SPDX-License-Identifier: AGPL-3.0-only
import { test } from 'node:test';
import assert from 'node:assert/strict';
import lumoUse, { desktopRequest } from '../apps/pi/backend/lumo_use.mjs';

function tools() { const result = {}; lumoUse({ on() {}, registerTool(tool) { result[tool.name] = tool; } }); return result; }

test('Lumo Use registers text tools and round-trips bounded native dialog results', async () => {
  const registered = tools();
  assert.deepEqual(Object.keys(registered), ['lumo_observe', 'lumo_act']);
  let title;
  const snapshot = JSON.stringify({ target: 'fada9312-658d-4661-85a7-58d5d94af906:10', label: 'Files', role: 'button', disabled: false });
  const result = await registered.lumo_observe.execute('one', {}, undefined, undefined, { hasUI: true, ui: { input: async (value) => { title = value; return JSON.stringify({ text: snapshot, error: false }); } } });
  assert.equal(title, 'Lumo Use: {"action":"observe"}');
  assert.deepEqual(result.content, [{ type: 'text', text: snapshot }]);
  assert.deepEqual(registered.lumo_act.parameters.required, ['action', 'target', 'label']);
});

test('Lumo Use forwards corrective browser errors unchanged and lets the model retry explicitly', async () => {
  const registered = tools(); const calls = [];
  const message = 'Invalid target format. Copy the target string value exactly from a lumo_observe JSON record; do not add brackets or whitespace. No action was performed.';
  const ctx = { hasUI: true, ui: { input: async (title) => { calls.push(JSON.parse(title.slice('Lumo Use: '.length))); return JSON.stringify(calls.length === 1 ? { text: message, error: true } : { text: 'Updated snapshot', error: false }); } } };
  const target = 'fada9312-658d-4661-85a7-58d5d94af906:10';
  await assert.rejects(registered.lumo_act.execute('bad', { action: 'click', target: `[${target}]`, label: 'Settings' }, undefined, undefined, ctx), (error) => error.message === message);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].target, `[${target}]`);
  const corrected = await registered.lumo_act.execute('corrected', { action: 'click', target, label: 'Settings' }, undefined, undefined, ctx);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].target, target);
  assert.deepEqual(corrected.content, [{ type: 'text', text: 'Updated snapshot' }]);
});

test('Lumo Use sends explicit resize dimensions through the native tool transport', async () => {
  const registered = tools(); let sent;
  const params = { action: 'resize', target: 'fada9312-658d-4661-85a7-58d5d94af906:10', label: 'Files', width: 640, height: 420 };
  const result = await registered.lumo_act.execute('resize', params, undefined, undefined, { hasUI: true, ui: { input: async (title) => { sent = JSON.parse(title.slice('Lumo Use: '.length)); return JSON.stringify({ text: 'Updated geometry', error: false }); } } });
  assert.deepEqual(sent, params);
  assert.deepEqual(result.content, [{ type: 'text', text: 'Updated geometry' }]);
  assert.ok(registered.lumo_act.parameters.properties.action.enum.includes('resize'));
  assert.equal(registered.lumo_act.parameters.properties.width.maximum, 8192);
});

test('Lumo Use cancellation, unavailable UI and malformed results fail instead of inventing success', async () => {
  await assert.rejects(desktopRequest({}, undefined, { hasUI: false }), /connected/);
  await assert.rejects(desktopRequest({}, AbortSignal.abort(), { hasUI: true }), /interrupted/);
  for (const value of [undefined, '{', JSON.stringify({ text: 1 }), JSON.stringify({ text: 'x'.repeat(24001) }), JSON.stringify({ text: 'Stale target', error: true })]) {
    await assert.rejects(desktopRequest({ action: 'observe' }, undefined, { hasUI: true, ui: { input: async () => value } }));
  }
  const abort = new AbortController();
  const pending = desktopRequest({ action: 'observe' }, abort.signal, { hasUI: true, ui: { input: () => new Promise(() => {}) } });
  abort.abort(); await assert.rejects(pending, /interrupted/);
});

test('Sibling desktop tools execute sequentially and a failed call does not poison the queue', async () => {
  const registered = tools(); const titles = []; let first;
  const ctx = { hasUI: true, ui: { input: (title) => { titles.push(title); return titles.length === 1 ? new Promise((resolve) => { first = resolve; }) : Promise.resolve(JSON.stringify({ text: 'Done' })); } } };
  const one = registered.lumo_observe.execute('one', {}, undefined, undefined, ctx);
  const two = registered.lumo_act.execute('two', { action: 'click', target: 'one', label: 'Files' }, undefined, undefined, ctx);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(titles.length, 1); first(JSON.stringify({ text: 'Cancelled', error: true }));
  await assert.rejects(one, /Cancelled/); await two;
  assert.equal(titles.length, 2);
});
