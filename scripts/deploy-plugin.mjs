// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [name, target, option] = process.argv.slice(2);
const ids = { calendar: 'calendar', skills: 'skills', git: 'git', docker: 'containers', nginx: 'websites', monitor: 'home' };
if (!Object.hasOwn(ids, name) || !target || (option && !['--rollback', '--bundled'].includes(option))) throw new Error('Usage: node scripts/deploy-plugin.mjs <calendar|skills|git|docker|nginx|monitor> <plugin-directory> [--rollback|--bundled]');
const destination = path.resolve(target, name);
if (option === '--bundled') {
  try { await unlink(path.join(destination, 'manifest.json')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  console.log('Restored the bundled plugin. Reopen its window.');
  process.exit(0);
}
const source = option ? destination : path.join(root, 'public/plugins', name);
const raw = await readFile(path.join(source, option ? 'previous.json' : 'manifest.json'), 'utf8');
const manifest = JSON.parse(raw);
if (manifest.schemaVersion !== 1 || manifest.hostApiVersion !== 1 || manifest.id !== ids[name] || manifest.license !== 'AGPL-3.0-only') throw new Error('Incompatible plugin package.');
const files = [];
for (const field of ['entry', 'styles', 'background']) {
  const filename = manifest[field];
  if (filename === undefined && field !== 'entry') continue;
  if (typeof filename !== 'string' || !/^[a-f0-9]{64}\.(js|css)$/.test(filename) || !filename.endsWith(field === 'styles' ? '.css' : '.js')) throw new Error(`Invalid ${field} asset.`);
  const bytes = await readFile(path.join(source, filename));
  if (createHash('sha256').update(bytes).digest('hex') !== filename.slice(0,64)) throw new Error(`Corrupt ${field} asset.`);
  files.push({ filename, bytes });
}
await mkdir(destination, { recursive: true });
for (const { filename, bytes } of files) {
  try { await writeFile(path.join(destination, filename), bytes, { flag: 'wx', mode: 0o644 }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (!(await readFile(path.join(destination, filename))).equals(bytes)) throw new Error(`Existing asset is corrupt: ${filename}`);
  }
}
let previous;
try { previous = await readFile(path.join(destination, 'manifest.json')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const nonce = process.pid + '-' + Date.now();
if (previous) {
  const temp = path.join(destination, 'previous.' + nonce);
  await writeFile(temp, previous, { flag: 'wx', mode: 0o644 });
  await rename(temp, path.join(destination, 'previous.json'));
}
const temp = path.join(destination, 'manifest.' + nonce);
await writeFile(temp, raw, { flag: 'wx', mode: 0o644 });
await rename(temp, path.join(destination, 'manifest.json'));
console.log(`${manifest.name} ${manifest.version} ${option ? 'restored' : 'deployed'}. Reopen its window to load the selected bundle. Background services update on desktop reload.`);
