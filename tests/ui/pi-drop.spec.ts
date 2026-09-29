// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '../offline';
import { piFixture } from './pi-fixture';
import { piAction } from './pi-actions';

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
  await expect(input).toHaveAttribute('value', '~');
  await page.getByTestId('file-row-my project').click();
  await page.getByTestId('file-row-another project').click({ modifiers: ['ControlOrMeta'] });
  await page.getByTestId('file-row-my project').dragTo(drop);
  await expect(input).toHaveAttribute('value', '~');
  await page.getByTestId('file-row-my project').click();
  await page.getByTestId('file-row-my project').dragTo(drop);
  await expect.poll(() => fixture.starts.at(-1)?.project).toBe('/home/demo/my project');
  await expect(input).toContainText('my project');
  await expect(page.getByTestId('pi-prompt')).toHaveText('Review these files');
  await page.getByTestId('file-row-notes.txt').dragTo(page.getByTestId('pi-prompt'));
  await expect(page.getByTestId('pi-prompt')).toHaveText('Review these files');
  await expect(page.locator('.pi-compose').getByTestId('pi-attachment')).toContainText('notes.txt');
  let releaseReference!: () => void;
  const referenceReady = new Promise<void>((resolve) => { releaseReference = resolve; });
  await page.route('**/api/v1/pi/reference**', async (route) => { await referenceReady; await route.fallback(); });
  await page.getByLabel('my project chats', { exact: true }).getByRole('button', { name: 'Earlier work', exact: true }).dragTo(page.getByTestId('pi-prompt'));
  await page.getByTestId('file-row-another project').dragTo(page.getByTestId('pi-prompt'));
  await page.getByTestId('file-row-notes.txt').dragTo(page.getByTestId('pi-prompt'));
  releaseReference();
  const cards = page.locator('.pi-compose .pi-attachments');
  const reference = cards.getByTestId('pi-conversation-reference');
  const file = cards.locator('[data-kind="file"]');
  const folder = cards.locator('[data-kind="folder"]');
  await expect(folder).toContainText('another project');
  await expect(folder).toHaveAttribute('title', '/home/demo/another project/');
  await expect(reference).toContainText('Earlier work');
  const referenceBox = (await reference.boundingBox())!; const fileBox = (await file.boundingBox())!;
  expect(referenceBox.y).toBe(fileBox.y);
  expect(referenceBox.width).toBe(fileBox.width); expect(referenceBox.height).toBe(fileBox.height);
  expect(referenceBox.x).toBeGreaterThan(fileBox.x + fileBox.width);
  await expect(cards.locator(':scope > div > span')).toHaveText(['notes.txt', 'Earlier work', 'another project']);
  for (const tile of [reference, file, folder]) {
    const bounds = (await tile.boundingBox())!;
    expect(bounds.width).toBe(referenceBox.width); expect(bounds.height).toBe(referenceBox.height);
    expect(bounds.y).toBe(referenceBox.y);
    const icon = (await tile.locator(':scope > svg').boundingBox())!;
    const label = (await tile.locator(':scope > span').boundingBox())!;
    expect(label.y).toBeGreaterThan(icon.y + icon.height);
    expect(icon.width).toBe(44);
  }
  for (const [tile, stroke, fill] of [[reference, 'rgb(128, 99, 189)', 'rgb(221, 209, 255)'], [file, 'rgb(117, 117, 117)', 'rgb(250, 250, 250)'], [folder, 'rgb(35, 125, 204)', 'rgb(138, 203, 255)']] as const) {
    await expect(tile.locator(':scope > svg')).toHaveCSS('stroke', stroke);
    await expect(tile.locator(':scope > svg')).toHaveCSS('fill', fill);
  }
  await expect(page.getByTestId('file-row-my project')).toBeVisible();
  await expect(page.getByTestId('pi-terminal')).toHaveCount(0);
  expect(terminals).toHaveLength(0);
  expect(mutations.filter((path) => path.includes('/files/'))).toEqual([]);
  expect(fixture.commands.some((command) => command.type === 'prompt')).toBe(false);
  await page.screenshot({ animations: 'disabled', path: '/tmp/lumo-pi-drop-light.png' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ animations: 'disabled', path: '/tmp/lumo-pi-drop-dark.png' });
  await page.locator('.pi-compose form').screenshot({ animations: 'disabled', path: '/tmp/lumo-attachment-tiles.png' });
  await page.getByTestId('pi-sidebar').getByRole('button', { name: 'Collapse sidebar', exact: true }).click();
  await page.setViewportSize({ width: 600, height: 800 });
  await expect(reference).toBeVisible();
  expect(await page.locator('.pi-main').evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.getByTestId('pi-send').click();
  await expect(page.locator('.pi-message-user .pi-attachment-folder')).toContainText('another project');
  expect(fixture.commands.find((command) => command.type === 'prompt')).toMatchObject({ message: expect.stringContaining('"/home/demo/another project/"') });
  await expect(page.locator('.pi-message-user .pi-attachments > div > span')).toHaveText(['notes.txt', 'Earlier work', 'another project']);
  fixture.finish();
  await expect(page.getByTestId('pi-send')).toHaveAttribute('aria-label', 'Send');
  await piAction(page, 'undo');
  await expect(page.getByRole('alertdialog').locator('.pi-attachments > div > span')).toHaveText(['notes.txt', 'Earlier work', 'another project']);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(errors).toEqual([]);
});
