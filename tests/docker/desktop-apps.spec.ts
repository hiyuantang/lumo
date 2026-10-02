// SPDX-License-Identifier: AGPL-3.0-only
import { execFileSync } from 'node:child_process';
import { expect, test } from '../offline';
import type { DesktopApp, DesktopBuild, DesktopCatalog } from '../../src/api/desktop-apps';

test.use({ serviceWorkers: 'allow' });
const container = process.env.LUMO_TEST_CONTAINER!;
function appCommand<T>(operation: string, params: unknown): T {
  return JSON.parse(execFileSync('docker', ['exec', '-i', '-u', 'alice', container, 'lumod', 'desktop-app', operation], { input: JSON.stringify(params), encoding: 'utf8' }));
}

test('A same-account app builds offline and survives activation, update and rollback on Ubuntu', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const project = '/home/alice/desktop-app-test';
  appCommand('create', { project, id: 'local.docker-pulse', name: 'Docker Pulse' });
  const first = appCommand<DesktopBuild>('build', { project });
  const installed = appCommand<DesktopApp>('install', { id: first.manifest.id, digest: first.digest, revision: '', requestId: crypto.randomUUID() });
  await page.goto('/');
  await page.getByTestId('login-username').fill('alice');
  await page.getByTestId('login-password').fill('alice-pass');
  await page.getByTestId('login-submit').click();
  await page.getByTestId('dock-app-app:local.docker-pulse').click();
  const app = page.getByTestId('window-app:local.docker-pulse');
  const frame = app.frameLocator('iframe');
  await expect(frame.locator('#status')).toContainText('Updated');
  await expect(frame.locator('#memory')).not.toContainText('0.0 / 0.0');
  await expect(frame.locator('#cpu')).toHaveText(/\d+\.\d%/);
  await page.screenshot({ path: '/tmp/lumo-app-ubuntu.png', animations: 'disabled' });
  await page.reload();
  await expect(frame.locator('#status')).toContainText('Updated');
  execFileSync('docker', ['exec', '-u', 'alice', container, 'node', '-e', "const fs=require('fs');const p=process.argv[1];const file=p+'/lumo.app.json';const m=JSON.parse(fs.readFileSync(file));m.version='0.2.0';fs.writeFileSync(file,JSON.stringify(m));const js=p+'/src/main.js';fs.writeFileSync(js,fs.readFileSync(js,'utf8').replace('Docker Pulse','Updated Pulse'));", project]);
  const second = appCommand<DesktopBuild>('build', { project });
  const updated = appCommand<DesktopApp>('install', { id: first.manifest.id, digest: second.digest, revision: installed.revision, requestId: crypto.randomUUID() });
  await page.reload();
  await expect(frame.getByRole('heading', { name: 'Updated Pulse' })).toBeVisible();
  appCommand('restore', { id: first.manifest.id, revision: updated.revision, requestId: crypto.randomUUID() });
  await page.reload();
  await expect(frame.getByRole('heading', { name: 'Docker Pulse' })).toBeVisible();
  const catalog = appCommand<DesktopCatalog>('list', {});
  expect(catalog.apps.find((entry) => entry.manifest.id === first.manifest.id)?.digest).toBe(first.digest);
  await page.getByTestId('dock-app-library').click();
  await page.getByTestId('desktop-card-local.docker-pulse').getByRole('button', { name: 'Uninstall', exact: true }).click();
  await page.getByTestId('server-app-confirm-ok').click();
  await expect(page.getByTestId('dock-app-app:local.docker-pulse')).toHaveCount(0);
  execFileSync('docker', ['exec', '-u', 'alice', container, 'test', '-f', project + '/src/main.js']);
  expect(errors).toEqual([]);
});

test('App-owned data survives Ubuntu app updates and normal reinstall', async ({ page }) => {
  const project = '/home/alice/desktop-counter-test';
  const id = 'local.docker-counter';
  appCommand('create', { project, id, name: 'Counter', template: 'counter' });
  const first = appCommand<DesktopBuild>('build', { project });
  const installed = appCommand<DesktopApp>('install', { id, digest: first.digest, revision: '', requestId: crypto.randomUUID() });
  await page.goto('/');
  await page.getByTestId('login-username').fill('alice');
  await page.getByTestId('login-password').fill('alice-pass');
  await page.getByTestId('login-submit').click();
  await page.getByTestId(`dock-app-app:${id}`).click();
  const frame = page.getByTestId(`window-app:${id}`).frameLocator('iframe');
  await expect(frame.locator('#count')).toHaveText('0');
  await frame.getByRole('button', { name: 'Add one', exact: true }).click();
  await expect(frame.locator('#count')).toHaveText('1');
  execFileSync('docker', ['exec', '-u', 'alice', container, 'node', '-e', "const fs=require('fs');const f=process.argv[1]+'/lumo.app.json';const m=JSON.parse(fs.readFileSync(f));m.version='0.2.0';fs.writeFileSync(f,JSON.stringify(m));", project]);
  const second = appCommand<DesktopBuild>('build', { project });
  const updated = appCommand<DesktopApp>('install', { id, digest: second.digest, revision: installed.revision, requestId: crypto.randomUUID() });
  await page.reload();
  await expect(frame.locator('#count')).toHaveText('1');
  appCommand('restore', { id, revision: updated.revision, requestId: crypto.randomUUID() });
  await page.reload();
  await expect(frame.locator('#count')).toHaveText('1');
  for (const clean of [false, true]) {
    await page.getByTestId('dock-app-library').click();
    await page.getByTestId(`desktop-card-${id}`).getByRole('button', { name: 'Uninstall', exact: true }).click();
    if (clean) await page.getByRole('checkbox', { name: 'Clean uninstall' }).check();
    await page.getByTestId('server-app-confirm-ok').click();
    await expect(page.getByTestId(`dock-app-app:${id}`)).toHaveCount(0);
    const build = appCommand<DesktopBuild>('build', { project });
    appCommand('install', { id, digest: build.digest, revision: '', requestId: crypto.randomUUID() });
    await page.reload();
    await page.getByTestId(`dock-app-app:${id}`).click();
    await expect(frame.locator('#count')).toHaveText(clean ? '0' : '1');
  }
});
