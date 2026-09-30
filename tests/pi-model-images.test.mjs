// SPDX-License-Identifier: AGPL-3.0-only
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createImagePreprocessor, encodeQuality90 } from '../server/internal/httpapi/pi_model_images.mjs';

const image = { type: 'image', mimeType: 'image/png', data: Buffer.alloc(5000, 42).toString('base64') };
const message = (timestamp, role = 'user') => ({ role, timestamp, ...(role === 'toolResult' ? { toolCallId: `read-${timestamp}`, toolName: 'read' } : {}), content: [{ type: 'text', text: 'Inspect this image.' }, { ...image }] });
function fixture(initial = 'quality90', branch = []) {
  let mode = initial; let encodes = 0; let reads = 0;
  const ctx = { sessionManager: { getBranch: () => branch } };
  const create = () => createImagePreprocessor({
    readQuality() { reads++; return mode; },
    async encode() { return { type: 'image', mimeType: 'image/webp', data: Buffer.from(`encoded-${++encodes}`).toString('base64') }; },
    save(images) { branch.push({ type: 'custom', customType: 'lumo-model-images-v1', data: { images: structuredClone(images) } }); },
  });
  return { ctx, branch, create, mode(value) { mode = value; }, encodes: () => encodes, reads: () => reads };
}

test('new user and tool images are compressed once without mutating the transcript or text', async () => {
  const f = fixture(); const processor = f.create(); processor.restore(f.ctx);
  const messages = [message(1), { role: 'assistant', content: [{ type: 'text', text: 'Looking.' }] }, message(2, 'toolResult')];
  const original = structuredClone(messages);
  const sent = await processor.transform(messages, f.ctx);
  assert.deepEqual(messages, original);
  assert.equal(sent[0].content[1].mimeType, 'image/webp');
  assert.equal(sent[2].content[1].mimeType, 'image/webp');
  assert.strictEqual(sent[1], messages[1]);
  assert.deepEqual(sent[0].content[0], messages[0].content[0]);
  assert.deepEqual(await processor.transform(structuredClone(messages), f.ctx), sent);
  assert.equal(f.encodes(), 2); assert.equal(f.reads(), 1); assert.equal(f.branch.length, 1);
});

test('changing to Original retains exact compressed history while the next image remains original', async () => {
  const f = fixture(); const processor = f.create(); processor.restore(f.ctx);
  const first = message(1); const encoded = await processor.transform([first], f.ctx);
  f.mode('original');
  const second = message(2, 'toolResult'); const mixed = await processor.transform([first, second], f.ctx);
  assert.deepEqual(mixed[0], encoded[0]); assert.strictEqual(mixed[1], second);
  f.mode('quality90');
  const third = message(3); const changed = await processor.transform([first, second, third], f.ctx);
  assert.deepEqual(changed.slice(0, 2), mixed); assert.equal(changed[2].content[1].mimeType, 'image/webp');
  assert.equal(f.encodes(), 2);
});

test('Original to Quality 90 applies to a new reading of the same file and leaves earlier images intact', async () => {
  const f = fixture('original'); const processor = f.create(); processor.restore(f.ctx);
  const first = message(1, 'toolResult'); const original = [first]; assert.strictEqual(await processor.transform(original, f.ctx), original);
  f.mode('quality90');
  const next = message(2, 'toolResult'); const sent = await processor.transform([first, next], f.ctx);
  assert.strictEqual(sent[0], first); assert.equal(sent[1].content[1].mimeType, 'image/webp'); assert.equal(f.encodes(), 1);
});

test('reopen, fork and session switch restore exact encoded bytes without using a new encoder', async () => {
  const f = fixture(); const first = message(1);
  f.branch.push({ type: 'message', message: first });
  const processor = f.create();
  const sent = await processor.transform([first], f.ctx);
  f.mode('original');
  for (const branch of [f.branch, structuredClone(f.branch)]) {
    const reopened = f.create(); const ctx = { sessionManager: { getBranch: () => branch } }; reopened.restore(ctx);
    assert.deepEqual(await reopened.transform(structuredClone([first]), ctx), sent);
  }
  const other = message(10); const ctx = { sessionManager: { getBranch: () => [{ type: 'message', message: other }] } };
  processor.restore(ctx); assert.deepEqual(await processor.transform([other], ctx), [other]);
  processor.restore(f.ctx); assert.deepEqual(await processor.transform([first], f.ctx), sent);
  assert.equal(f.encodes(), 1);
});

test('history predating compression keeps its original bytes when reopened with Quality 90', async () => {
  const first = message(1); const f = fixture('quality90', [{ type: 'message', message: first }]);
  const processor = f.create(); processor.restore(f.ctx);
  const next = message(2); const sent = await processor.transform([first, next], f.ctx);
  assert.strictEqual(sent[0], first); assert.equal(sent[1].content[1].mimeType, 'image/webp');
  assert.equal(f.encodes(), 1); assert.equal(f.branch[1].data.images[0].mode, 'original');
});

test('failed, unsupported or unhelpful compression stays original across setting changes and retries', async () => {
  for (const encode of [async () => { throw new Error('Unavailable'); }, async () => undefined]) {
    let calls = 0;
    const processor = createImagePreprocessor({ readQuality: () => 'quality90', encode: async (block) => { calls++; return encode(block); }, save() {} });
    const messages = [message(1)];
    assert.strictEqual(await processor.transform(messages, {}), messages);
    assert.strictEqual(await processor.transform(messages, {}), messages);
    assert.equal(calls, 1);
  }
  const processor = createImagePreprocessor({ readQuality: () => 'quality90', encode: async () => ({ ...image, mimeType: 'image/webp' }), save() { throw new Error('Disk full'); } });
  const messages = [message(2)];
  assert.strictEqual(await processor.transform(messages, {}), messages);
  assert.strictEqual(await processor.transform(messages, {}), messages);
});

test('duplicate content in one context is encoded once, and messages without images need no settings read', async () => {
  const f = fixture(); const processor = f.create(); const one = message(1);
  const sent = await processor.transform([one, structuredClone(one)], f.ctx);
  assert.deepEqual(sent[0], sent[1]); assert.equal(f.encodes(), 1);
  const text = [{ role: 'user', content: 'Just text' }];
  assert.strictEqual(await processor.transform(text, f.ctx), text); assert.equal(f.reads(), 1);
});

test('encoder preserves resolution, orientation and alpha quality, with bounded input and smaller output', async () => {
  const calls = [];
  const sharp = (bytes, options) => {
    assert.equal(bytes.length, 5000); assert.deepEqual(options, { limitInputPixels: 16 * 1024 * 1024, failOn: 'error' });
    const pipeline = {
      async metadata() { return { width: 1400, height: 800 }; },
      rotate() { calls.push('rotate'); return pipeline; },
      webp(options) { calls.push(options); return pipeline; },
      timeout(options) { calls.push(options); return pipeline; },
      async toBuffer() { return Buffer.alloc(1000, 9); },
    };
    return pipeline;
  };
  const sent = await encodeQuality90(image, sharp);
  assert.equal(sent.mimeType, 'image/webp'); assert.equal(Buffer.from(sent.data, 'base64').length, 1000);
  assert.deepEqual(calls, ['rotate', { quality: 90, alphaQuality: 100, effort: 6 }, { seconds: 10 }]);
  for (const block of [{ ...image, mimeType: 'image/svg+xml' }, { ...image, data: 'invalid~' }, { ...image, data: 'YQ==' }, { ...image, data: `${image.data}\n` }, { ...image, data: 'A'.repeat(45 * 1024 * 1024) }]) {
    assert.equal(await encodeQuality90(block, () => { throw new Error('Codec must not run'); }), undefined);
  }
  assert.equal(await encodeQuality90(image, () => ({ metadata: async () => ({ pages: 2, width: 1400, height: 800 }) })), undefined);
  const animatedPNG = Buffer.alloc(5000);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(animatedPNG);
  animatedPNG.writeUInt32BE(8, 8); animatedPNG.write('acTL', 12);
  assert.equal(await encodeQuality90({ ...image, data: animatedPNG.toString('base64') }, () => { throw new Error('Animated PNG must remain intact'); }), undefined);
  const larger = () => {
    const pipeline = { metadata: async () => ({ width: 100, height: 100 }), rotate: () => pipeline, webp: () => pipeline, timeout: () => pipeline, toBuffer: async () => Buffer.alloc(6000) };
    return pipeline;
  };
  assert.equal(await encodeQuality90(image, larger), undefined);
});
