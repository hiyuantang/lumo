// SPDX-License-Identifier: AGPL-3.0-only
import { execFileSync } from 'node:child_process';
import { expect, test } from '../offline';

function ubuntu(...args: string[]) {
  return execFileSync('docker', ['exec', process.env.LUMO_TEST_CONTAINER!, ...args], { encoding: 'utf8' }).trim();
}

test('Complete app packages run as the account and isolate backend failures', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('login-username').fill('alice');
  await page.getByTestId('login-password').fill('alice-pass');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('menu-bar')).toBeVisible();
  const csrf = (await page.context().cookies()).find((cookie) => cookie.name === 'lumo_csrf')!.value;
  const post = (path: string, data: unknown) => page.request.post(path, { headers: { 'X-Lumo-CSRF': csrf }, data });
  const body = { requestId: crypto.randomUUID(), action: 'save', item: { collectionId: 'personal', kind: 'event', title: 'Plugin integration', start: '2026-10-03T09:00:00Z', end: '2026-10-03T10:00:00Z', timeZone: 'UTC' } };
  const created = await post('/api/v1/calendar', body);
  expect(created.status()).toBe(200);
  const item = (await created.json()).data;
  expect((await (await post('/api/v1/calendar', body)).json()).data.id).toBe(item.id);
  const snapshot = await page.request.get('/api/v1/calendar?from=2026-10-01T00:00:00Z&to=2026-11-01T00:00:00Z&google=0');
  expect((await snapshot.json()).data.items.some((event: { id: string }) => event.id === item.id)).toBe(true);
  expect(ubuntu('stat', '-c', '%U', '/home/alice/.local/share/lumo/calendar/calendar.db')).toBe('alice');
  const cli = ubuntu('runuser', '-u', 'alice', '--', 'sh', '-c', 'printf \'%s\' \'{"from":"2026-10-01T00:00:00Z","to":"2026-11-01T00:00:00Z"}\' | /usr/local/bin/lumod plugin calendar list');
  expect(JSON.parse(cli).items.some((event: { id: string }) => event.id === item.id)).toBe(true);
  expect((await post('/api/v1/calendar', { requestId: crypto.randomUUID(), action: 'delete', id: item.id, revision: item.revision })).status()).toBe(200);
  for (const path of ['/api/v1/skills', '/api/v1/containers', '/api/v1/websites']) expect((await page.request.get(path)).status()).toBe(200);
  const manifest = await (await page.request.get('/plugins/calendar/manifest.json')).json();
  for (const asset of [manifest.backend.entry, manifest.pi.entry]) expect((await page.request.get(`/plugins/calendar/${asset}`)).status()).toBe(404);
  ubuntu('python3', '-c', String.raw`import pathlib, json, hashlib
root = pathlib.Path('/usr/local/lib/lumo/plugin-overrides/skills')
root.mkdir(parents=True, exist_ok=True)
manifest = json.loads(pathlib.Path('/usr/local/lib/lumo/plugins/skills/manifest.json').read_text())
code = b'#!/bin/sh\nexit 7\n'
name = hashlib.sha256(code).hexdigest() + '.bin'
(root / name).write_bytes(code)
(root / name).chmod(0o755)
manifest['backend']['entry'] = name
(root / 'manifest.json').write_text(json.dumps(manifest))`);
  try {
    expect((await page.request.get('/api/v1/skills')).status()).toBe(503);
    expect((await page.request.get('/api/v1/system/identity')).status()).toBe(200);
  } finally {
    ubuntu('rm', '/usr/local/lib/lumo/plugin-overrides/skills/manifest.json');
  }
  expect((await page.request.get('/api/v1/skills')).status()).toBe(200);
  await page.getByTestId('dock-app-library').click();
  await expect(page.getByTestId('library-pi')).toHaveCount(0);
  await expect(page.getByTestId('dock-app-pi')).toBeVisible();
});
