// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '../offline';
import { piFixture } from './pi-fixture';

test('Files drops project folders into the workspace and file paths into the composer without moving them', async ({ page }) => {
  const errors: string[] = [];
  const terminals: { program: string; directory: string }[] = [];
  const mutations: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== 'GET') mutations.push(path);
    const data = path.endsWith('/auth/session') ? { user: { name: 'demo', uid: 1000, gid: 1000, home: '/home/demo' } }
      : path.endsWith('/apps') ? { canInstall: true, apps: [{ id: 'pi', installed: true }] }
      : path.endsWith('/files/list') ? { path: '/home/demo', entries: ['my project', 'another project', 'notes.txt'].map((name) => ({ name, type: name.endsWith('.txt') ? 'file' : 'directory', sizeBytes: 0, modifiedAt: '2026-09-27T12:00:00Z', mode: 493 })) } : {};
    return route.fulfill({ json: { ok: true, data } });
  });
  await page.routeWebSocket(/\/api\/v1\/ws/, (socket) => {
    socket.onMessage((raw) => {
      const frame = JSON.parse(String(raw));
      if (frame.type !== 'subscribe' || frame.capability !== 'terminal.open') return;
      terminals.push(frame.params);
      socket.send(JSON.stringify({ type: 'subscribed', channel: frame.channel, data: { session: 'project-drop-test' } }));
    });
  });
  const fixture = await piFixture(page);
  await page.goto('http://localhost:5200');
  await page.getByTestId('dock-app-files').click();
  await page.getByRole('menuitem', { name: 'Window', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Tile Window Left', exact: true }).click();
  await page.getByTestId('dock-app-pi').click();
  await page.getByRole('menuitem', { name: 'Window', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Tile Window Right', exact: true }).click();
  const input = page.getByTestId('pi-project');
  const drop = page.getByTestId('pi-project-drop');
  await expect(page.getByTestId('pi-prompt')).toBeEnabled();
  await page.getByTestId('pi-prompt').fill('Review these files');
  await page.getByTestId('file-row-notes.txt').dragTo(drop);
  await expect(input).toContainText('user');
  await page.getByTestId('file-row-my project').click();
  await page.getByTestId('file-row-another project').click({ modifiers: ['ControlOrMeta'] });
  await page.getByTestId('file-row-my project').dragTo(drop);
  await expect(input).toContainText('user');
  await page.getByTestId('file-row-my project').click();
  await page.getByTestId('file-row-my project').dragTo(drop);
  await expect.poll(() => fixture.starts.at(-1)?.project).toBe('/home/demo/my project');
  await expect(input).toContainText('my project');
  await expect(page.getByTestId('pi-prompt')).toHaveValue('Review these files');
  await page.getByTestId('file-row-notes.txt').dragTo(page.getByTestId('pi-prompt'));
  await expect(page.getByTestId('pi-prompt')).toHaveValue('Review these files');
  await expect(page.locator('.pi-compose').getByTestId('pi-attachment')).toContainText('notes.txt');
  await expect(page.getByTestId('file-row-my project')).toBeVisible();
  await expect(page.getByTestId('pi-terminal')).toHaveCount(0);
  expect(terminals).toHaveLength(0);
  expect(mutations.filter((path) => path.includes('/files/'))).toEqual([]);
  expect(fixture.commands.some((command) => command.type === 'prompt')).toBe(false);
  await page.screenshot({ animations: 'disabled', path: '/tmp/lumo-pi-drop-light.png' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ animations: 'disabled', path: '/tmp/lumo-pi-drop-dark.png' });
  expect(errors).toEqual([]);
});
