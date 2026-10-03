// SPDX-License-Identifier: AGPL-3.0-only
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
const source = await readFile(new URL('../server/internal/desktopapps/sdk.js', import.meta.url), 'utf8');
function fixture() {
  const handlers = {}; const messages = []; const timers = new Set();
  const parent = { postMessage() {} };
  const context = { parent, document: { documentElement: { dataset: {} } }, Event, dispatchEvent() {}, addEventListener(name, handler) { handlers[name] = handler; }, setTimeout(fn) { timers.add(fn); return fn; }, clearTimeout(id) { timers.delete(id); } };
  runInNewContext(source, context);
  const port = { start() {}, postMessage(value) { messages.push(value); } };
  return { context, port, messages, timers, connect() { handlers.message({ source: parent, data: { type: 'lumo-connect' }, ports: [port] }); } };
}
test('Dirty state survives connection and suppresses duplicate input reports', () => {
  const f = fixture();
  f.context.lumo.setDirty(true); f.connect();
  f.context.lumo.setDirty(true); f.context.lumo.setDirty(false);
  assert.deepEqual(f.messages.map((m) => [m.type, m.value]), [['dirty', true], ['dirty', false]]);
  assert.throws(() => f.context.lumo.setDirty('true'), /boolean/);
});
test('SDK preserves conflict codes and releases pending calls after an invalid message', async () => {
  const f = fixture(); f.connect();
  const result = f.context.lumo.call('app.storage.set', { revision: '', value: 1 });
  const id = f.messages[0].id;
  f.port.onmessage({ data: { id, error: 'Changed', code: 'conflict' } });
  await assert.rejects(result, (error) => error.code === 'conflict');
  assert.equal(f.timers.size, 0);
  f.port.postMessage = () => { throw new Error('Cannot clone'); };
  for (let i = 0; i < 10; i++) await assert.rejects(f.context.lumo.call('app.storage.set'), /Cannot clone/);
  assert.equal(f.timers.size, 0);
});

test('Menu and presentation contributions buffer until connection and commands unsubscribe', () => {
  const f = fixture(); const calls = [];
  f.context.lumo.setMenus({ tools: [{ id: 'export', label: 'Export' }] });
  f.context.lumo.setPresentation({ title: 'Draft', badge: '2' });
  const stop = f.context.lumo.onCommand((id) => calls.push(id));
  f.connect();
  assert.deepEqual(f.messages.map((m) => m.type), ['menus', 'presentation']);
  f.port.onmessage({ data: { type: 'command', id: 'export' } });
  stop(); f.port.onmessage({ data: { type: 'command', id: 'export' } });
  assert.deepEqual(calls, ['export']);
  f.context.lumo.setMenus({}); f.context.lumo.setPresentation({});
  assert.deepEqual(f.messages.slice(-2).map((m) => Object.keys(m.value).length), [0, 0]);
  assert.throws(() => f.context.lumo.setMenus(null), /object/);
  assert.throws(() => f.context.lumo.onCommand(null), /function/);
});
