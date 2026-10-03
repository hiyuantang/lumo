// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [name, target, option] = process.argv.slice(2);
const required = ['pi','files','preview','terminal','settings','library','trash'];
const ids = { ...Object.fromEntries(required.map(name => [name,name])), calendar: 'calendar', skills: 'skills', git: 'git', docker: 'containers', nginx: 'websites', monitor: 'home' };
if ((!/^[a-z][a-z0-9-]{0,47}$/.test(name) || ['app','plugin','home','containers','websites'].includes(name)) || !target || (option && !['--rollback', '--bundled'].includes(option))) throw new Error('Usage: node scripts/deploy-plugin.mjs <app-name> <plugin-directory> [--rollback|--bundled]');
const destination = path.resolve(target, name);
if (option === '--bundled') {
  try { await unlink(path.join(destination, 'manifest.json')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  console.log('Restored the bundled plugin. Reopen its window.');
  process.exit(0);
}
const source = option ? destination : path.join(root, '.tools/plugin-packages', name);
const raw = await readFile(path.join(source, option ? 'previous.json' : 'manifest.json'), 'utf8');
const manifest = JSON.parse(raw);
if (manifest.schemaVersion !== 1 || manifest.hostApiVersion !== 1 || manifest.id !== (ids[name] ?? `plugin:${name}`) || manifest.license !== 'AGPL-3.0-only' || Boolean(manifest.required) !== required.includes(name)) throw new Error('Incompatible plugin package.');
if (['calendar','skills','git','docker','nginx','pi'].includes(name) && !manifest.backend) throw new Error('The complete package must include its backend.');
if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error('Invalid package version.');
const files = [];
const assets = { entry: manifest.entry, styles: manifest.styles, background: manifest.background, backend: manifest.backend?.entry, pi: manifest.pi?.entry };
if (manifest.backend && (manifest.backend.protocolVersion !== 1 || !/^(linux|darwin)\/(arm64|amd64)$/.test(manifest.backend.platform) || !assets.backend)) throw new Error('Incompatible app backend.');
if (manifest.pi && !assets.pi) throw new Error('Missing Pi extension.');
for (const [field, filename] of Object.entries(assets)) {
  if (filename === undefined && field !== 'entry') continue;
  if (typeof filename !== 'string' || !/^[a-f0-9]{64}\.(js|css|bin|mjs)$/.test(filename) || !filename.endsWith(field === 'backend' ? '.bin' : field === 'pi' ? '.mjs' : field === 'styles' ? '.css' : '.js')) throw new Error(`Invalid ${field} asset.`);
  const bytes = await readFile(path.join(source, filename));
  if (createHash('sha256').update(bytes).digest('hex') !== filename.slice(0,64)) throw new Error(`Corrupt ${field} asset.`);
  files.push({ filename, bytes, mode: field === 'backend' ? 0o755 : 0o644 });
}
await mkdir(destination, { recursive: true });
for (const { filename, bytes, mode } of files) {
  try { await writeFile(path.join(destination, filename), bytes, { flag: 'wx', mode }); }
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
console.log(`${manifest.name} ${manifest.version} ${option ? 'restored' : 'deployed'}. Reopen its window to load the selected bundle. Frontend background services update on desktop reload. Resident system apps require an agent restart; other backend requests and new Pi chats use the selected complete package.`);
