// SPDX-License-Identifier: AGPL-3.0-only
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

const names = { calendar: 'calendar', skills: 'skills', git: 'git', docker: 'containers', nginx: 'websites', monitor: 'home' };
for (const [name, id] of Object.entries(names)) test(`${name} has a standalone package with intact assets`, async () => {
  const directory = path.join('public/plugins', name);
  const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
  assert.equal(manifest.id, id);
  assert.equal(manifest.hostApiVersion, 1);
  assert.equal(manifest.license, 'AGPL-3.0-only');
  for (const field of ['entry','styles','background']) {
    if (!manifest[field] && field !== 'entry') continue;
    const bytes = await readFile(path.join(directory, manifest[field]));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest[field].slice(0,64));
    if (field !== 'styles') {
      assert.match(bytes.toString(), /__LUMO_HOST_V1__/);
      assert.doesNotMatch(bytes.toString(), /react\.production\.min|createRoot\(/);
    }
  }
});

test('deployment validates before activation and supports rollback and bundled recovery', async () => {
  const destination = await mkdtemp(path.join(tmpdir(), 'lumo-plugin-deploy-'));
  const run = (option) => spawnSync(process.execPath, ['scripts/deploy-plugin.mjs','skills',destination,...(option ? [option] : [])], { encoding: 'utf8' });
  try {
    const first = run(); assert.equal(first.status,0,first.stderr);
    const file = path.join(destination,'skills/manifest.json');
    const original = await readFile(file,'utf8');
    const second = run(); assert.equal(second.status,0,second.stderr);
    assert.equal(await readFile(path.join(destination,'skills/previous.json'),'utf8'),original);
    const rollback = run('--rollback'); assert.equal(rollback.status,0,rollback.stderr);
    const invalid = { ...JSON.parse(original), entry: '../outside.js' };
    await writeFile(path.join(destination,'skills/previous.json'),JSON.stringify(invalid));
    assert.notEqual(run('--rollback').status,0);
    assert.equal(await readFile(file,'utf8'),original);
    const asset = 'a'.repeat(64)+'.js';
    await writeFile(path.join(destination,'skills',asset),'wrong digest');
    await writeFile(path.join(destination,'skills/previous.json'),JSON.stringify({...JSON.parse(original),entry:asset}));
    assert.notEqual(run('--rollback').status,0);
    assert.equal(await readFile(file,'utf8'),original);
    const bundled = run('--bundled'); assert.equal(bundled.status,0,bundled.stderr);
    await assert.rejects(readFile(file),{code:'ENOENT'});
  } finally { await rm(destination,{recursive:true,force:true}); }
});
