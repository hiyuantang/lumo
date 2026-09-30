// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const settingsPath = '';
const codecAnchor = '';
const imageEntryType = 'lumo-model-images-v1';
const imageLimit = 32 * 1024 * 1024;

function imagesIn(messages) {
  return messages.flatMap((message) => Array.isArray(message.content) ? message.content.flatMap((block, index) => {
    if (block?.type !== 'image' || typeof block.data !== 'string' || typeof block.mimeType !== 'string') return [];
    const key = createHash('sha256').update(JSON.stringify([message.role, message.timestamp, message.toolCallId, index, block.mimeType])).update(block.data).digest('hex');
    return [{ message, index, block, key }];
  }) : []);
}

export function createImagePreprocessor({ readQuality, encode, save }) {
  let versions = new Map();
  function remember(records, ctx) {
    if (!records.length) return;
    try { save(records, ctx); } catch { records = records.map(({ key }) => ({ key, mode: 'original' })); }
    for (const record of records) versions.set(record.key, record);
  }
  function restore(ctx) {
    versions = new Map();
    const branch = ctx.sessionManager.getBranch();
    for (const entry of branch) {
      if (entry.type !== 'custom' || entry.customType !== imageEntryType || !Array.isArray(entry.data?.images)) continue;
      for (const record of entry.data.images) {
        if (!record || !/^[a-f0-9]{64}$/.test(record.key) || !['original', 'quality90'].includes(record.mode)) continue;
        if (record.mode === 'quality90' && (record.mimeType !== 'image/webp' || typeof record.data !== 'string' || record.data.length > Math.ceil(imageLimit / 3) * 4)) continue;
        versions.set(record.key, record);
      }
    }
    const records = imagesIn(branch.flatMap((entry) => entry.type === 'message' ? [entry.message] : [])).filter(({ key }) => !versions.has(key)).map(({ key }) => ({ key, mode: 'original' }));
    remember(records, ctx);
  }
  async function transform(messages, ctx) {
    const images = imagesIn(messages);
    if (!images.length) return messages;
    let mode;
    const records = [];
    const pending = new Map();
    for (const image of images) {
      if (versions.has(image.key) || pending.has(image.key)) continue;
      mode ??= await readQuality();
      let encoded;
      if (mode === 'quality90') {
        try { encoded = await encode(image.block); } catch {}
      }
      const record = encoded ? { key: image.key, mode: 'quality90', mimeType: encoded.mimeType, data: encoded.data } : { key: image.key, mode: 'original' };
      records.push(record); pending.set(image.key, record);
    }
    remember(records, ctx);
    const replacements = new Map();
    for (const { message, index, block, key } of images) {
      const version = versions.get(key);
      if (version?.mode !== 'quality90') continue;
      const content = replacements.get(message) ?? [...message.content];
      content[index] = { ...block, mimeType: version.mimeType, data: version.data };
      replacements.set(message, content);
    }
    return replacements.size ? messages.map((message) => replacements.has(message) ? { ...message, content: replacements.get(message) } : message) : messages;
  }
  return { restore, transform };
}

export async function encodeQuality90(block, sharp) {
  if (block.data.length > Math.ceil(imageLimit / 3) * 4 || !/^image\/(png|jpeg|webp|gif)$/.test(block.mimeType) || !/^[A-Za-z0-9+/]*={0,2}$/.test(block.data)) return;
  const input = Buffer.from(block.data, 'base64');
  if (input.length < 4096 || input.length > imageLimit || input.toString('base64') !== block.data) return;
  if (input.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    for (let offset = 8; offset + 12 <= input.length; offset += input.readUInt32BE(offset) + 12) {
      const chunk = input.toString('ascii', offset + 4, offset + 8);
      if (chunk === 'acTL') return;
      if (chunk === 'IDAT') break;
    }
  }
  const image = sharp(input, { limitInputPixels: 16 * 1024 * 1024, failOn: 'error' });
  const metadata = await image.metadata();
  if ((metadata.pages ?? 1) > 1 || !metadata.width || !metadata.height) return;
  const data = await image.rotate().webp({ quality: 90, alphaQuality: 100, effort: 6 }).timeout({ seconds: 10 }).toBuffer();
  if (data.length >= input.length) return;
  return { type: 'image', mimeType: 'image/webp', data: data.toString('base64') };
}

export default function (pi) {
  let sharp;
  const processor = createImagePreprocessor({
    async readQuality() {
      try {
        const info = await lstat(settingsPath);
        if (!info.isFile() || info.size > 1024 * 1024) return 'original';
        const settings = JSON.parse(await readFile(settingsPath, 'utf8'));
        return settings.lumoImageQuality === 'quality90' ? 'quality90' : 'original';
      } catch { return 'original'; }
    },
    async encode(block) {
      sharp ??= createRequire(codecAnchor)('sharp');
      return encodeQuality90(block, sharp);
    },
    save(images) { pi.appendEntry(imageEntryType, { images }); },
  });
  for (const event of ['session_start', 'session_switch', 'session_fork', 'session_tree']) pi.on(event, (_event, ctx) => {
    processor.restore(ctx);
    if (event === 'session_start') ctx.ui.setStatus('lumo-model-images', 'ready');
  });
  pi.on('context', async (event, ctx) => ({ messages: await processor.transform(event.messages, ctx) }));
}
