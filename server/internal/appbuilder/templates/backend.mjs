// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
const directory = process.env.LUMO_APP_DATA;
function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
function read() {
  try { return JSON.parse(fs.readFileSync(path.join(directory, 'note.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return { revision: '', text: '' }; throw error; }
}
function save(input) {
  if (typeof input.text !== 'string' || Buffer.byteLength(input.text) > 65536 || typeof input.revision !== 'string' || typeof input.requestId !== 'string' || !input.requestId || input.requestId.length > 128) fail('validation_failed', 'Supply text, revision and a requestId. Text must fit within 64 KiB.');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const lock = path.join(directory, '.write-lock');
  let descriptor;
  try { descriptor = fs.openSync(lock, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') fail('busy', 'Another save is in progress. Retry after reading the latest note.'); throw error; }
  let temp;
  try {
    const current = read();
    if (current.requestId === input.requestId) {
      if (current.text !== input.text || current.previousRevision !== input.revision) fail('conflict', 'This requestId was used with different content.');
      return current;
    }
    if (current.revision !== input.revision) fail('conflict', 'The note changed. Read the latest revision before saving.');
    const next = { revision: randomUUID(), text: input.text, requestId: input.requestId, previousRevision: input.revision };
    temp = path.join(directory, '.note-' + randomUUID());
    fs.writeFileSync(temp, JSON.stringify(next), { mode: 0o600, flag: 'wx' });
    fs.renameSync(temp, path.join(directory, 'note.json'));
    return next;
  } finally { if (temp && fs.existsSync(temp)) fs.unlinkSync(temp); fs.closeSync(descriptor); fs.unlinkSync(lock); }
}
function handle(operation, input) {
  if (!directory) fail('unavailable', 'LUMO_APP_DATA is required. Start through Lumo.');
  if (operation === 'read') return read();
  if (operation === 'save') return save(input);
  fail('not_found', 'Unknown operation.');
}
function main() {
  const mode = process.argv[2];
  const raw = fs.readFileSync(0);
  if (raw.length > 1100000) fail('validation_failed', 'Request is too large.');
  if (mode !== 'serve') { process.stdout.write(JSON.stringify(handle(mode, JSON.parse(raw.toString() || '{}')))); return; }
  let status = 200, envelope;
  try {
    const boundary = raw.indexOf('\r\n\r\n');
    if (boundary < 0) fail('validation_failed', 'Invalid host request.');
    const [method, url] = raw.subarray(0, boundary).toString().split('\r\n')[0].split(' ');
    if (url.split('?')[0] !== '/api/v1/plugins/__APP__' || !['GET', 'POST'].includes(method)) fail('not_found', 'Unknown route.');
    envelope = { ok: true, data: handle(method === 'GET' ? 'read' : 'save', method === 'POST' ? JSON.parse(raw.subarray(boundary + 4).toString()) : {}) };
  } catch (error) {
    const code = error.code || 'internal';
    status = { validation_failed: 400, conflict: 409, busy: 409, not_found: 404, unavailable: 503 }[code] || 500;
    envelope = { ok: false, error: { code, message: status === 500 ? 'The note could not be read or saved.' : error.message } };
  }
  process.stdout.write(JSON.stringify({ status, headers: { 'Content-Type': ['application/json'] }, body: Buffer.from(JSON.stringify(envelope)).toString('base64') }));
}
try { main(); } catch (error) { process.stderr.write(error.message); process.exitCode = 1; }
