// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '../offline';
import { piPage } from './pi-fixture';
import type { Page } from '@playwright/test';

async function archivePage(page: Page) {
  const fixture = await piPage(page);
  const archived = new Set<string>();
  const deleted = new Set<string>();
  const order: string[] = [];
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  const items = [{ id: 'first.jsonl', name: 'Project notes', project: '/home/user', modified: '2026-09-28' }, { id: 'second.jsonl', name: 'Earlier work', project: '/home/user', modified: '2026-09-27' }];
  await page.route('**/api/v1/pi/sessions?**', (route) => route.fulfill({ json: { ok: true, data: { sessions: items.filter((item) => !archived.has(item.id) && !deleted.has(item.id)) } } }));
  await page.route('**/api/v1/pi/sessions/archived', (route) => route.fulfill({ json: { ok: true, data: { sessions: items.filter((item) => archived.has(item.id)) } } }));
  await page.route('**/api/v1/pi/stop', (route) => { order.push('stop'); return route.fulfill({ json: { ok: true, data: { closed: true } } }); });
  for (const action of ['archive', 'restore', 'delete']) await page.route(`**/api/v1/pi/sessions/${action}`, (route) => {
    const body = route.request().postDataJSON(); order.push(action);
    if (action === 'archive') archived.add(body.session);
    else { archived.delete(body.session); if (action === 'delete') deleted.add(body.session); }
    return route.fulfill({ json: { ok: true, data: { moved: true, deleted: true } } });
  });
  await page.goto('http://localhost:5200'); await page.getByTestId('dock-app-pi').click();
  await expect(page.getByTestId('pi-prompt')).toBeEnabled();
  return { ...fixture, archived, deleted, order, errors };
}
async function openArchive(page: Page) {
  await page.getByTestId('pi-settings-button').click();
  await page.getByRole('tab', { name: 'Archived chats' }).click();
  await expect(page.getByTestId('pi-archived').getByRole('status')).toHaveCount(0);
}

test('Pi archives with one click after stop, fills Settings, restores and keeps drafts', async ({ page }) => {
  const fixture = await archivePage(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const tree = page.getByRole('navigation', { name: 'Pi projects', exact: true });
  const recent = page.getByRole('navigation', { name: 'Recent Pi chats', exact: true });
  const archive = tree.getByRole('button', { name: 'Archive Project notes', exact: true });
  await page.getByTestId('pi-prompt').fill('Keep this unsent draft');
  await archive.focus();
  let release!: () => void; const wait = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/v1/pi/stop', async (route) => { fixture.order.push('stop'); await wait; return route.fulfill({ json: { ok: true, data: { closed: true } } }); });
  await page.keyboard.press('Enter');
  await expect.poll(() => fixture.order.length).toBe(1);
  expect(fixture.archived.size).toBe(0); await expect(page.getByRole('alertdialog')).toHaveCount(0);
  release();
  await expect(tree.getByRole('button', { name: 'Project notes', exact: true })).toHaveCount(0);
  await expect(recent.getByRole('button', { name: 'Project notes', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('pi-prompt')).toBeEnabled();
  await expect(page.getByTestId('pi-prompt')).toHaveText('Keep this unsent draft');
  expect(fixture.order.slice(0, 2)).toEqual(['stop', 'archive']); expect(fixture.starts.at(-1)?.session).toBe('');
  await openArchive(page);
  await expect(page.getByTestId('pi-sidebar')).toHaveCount(0);
  const app = (await page.getByTestId('app-pi').boundingBox())!;
  const settings = (await page.getByTestId('pi-settings').boundingBox())!;
  const rail = (await page.getByTestId('pi-app-rail').boundingBox())!;
  expect(settings.x).toBe(app.x + rail.width); expect(settings.width).toBe(app.width - rail.width);
  await expect(page.getByTestId('pi-archived')).toContainText('Project notes');
  await page.screenshot({ path: '/tmp/lumo-pi-archive-light.png', animations: 'disabled' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: '/tmp/lumo-pi-archive-dark.png', animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '/tmp/lumo-pi-archive-narrow.png', animations: 'disabled' });
  expect(await page.getByTestId('pi-settings').evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(page.getByTestId('pi-archived')).toContainText('No archived chats');
  await page.getByTestId('pi-home-button').click();
  await expect(page.getByTestId('pi-prompt')).toBeEnabled();
  await expect(page.getByTestId('pi-prompt')).toHaveText('Keep this unsent draft');
  await expect(tree.getByRole('button', { name: 'Project notes', exact: true })).toBeVisible();
  expect(fixture.errors).toEqual([]);
});

test('Pi deletes one or all archived chats only after confirmation', async ({ page }) => {
  const fixture = await archivePage(page); fixture.archived.add('first.jsonl'); fixture.archived.add('second.jsonl');
  await openArchive(page);
  await page.getByRole('button', { name: 'Delete Project notes', exact: true }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Escape'); expect(fixture.deleted.size).toBe(0);
  await page.getByRole('button', { name: 'Delete Project notes', exact: true }).click();
  await page.getByRole('button', { name: 'Delete permanently' }).click();
  await expect(page.getByTestId('pi-archived')).not.toContainText('Project notes');
  await expect(page.getByTestId('pi-archived')).toContainText('Earlier work');
  expect(fixture.deleted.has('first.jsonl')).toBe(true);
  fixture.archived.add('first.jsonl');
  await page.getByRole('button', { name: 'Refresh archived chats' }).click();
  await expect(page.getByRole('button', { name: 'Delete Project notes' })).toBeVisible();
  await page.getByRole('button', { name: 'Delete all', exact: true }).click();
  await expect(dialog).toContainText('2 archived conversations');
  await page.getByRole('button', { name: 'Delete 2 chats' }).click();
  await expect(page.getByTestId('pi-archived')).toContainText('No archived chats');
  await expect(page.getByRole('button', { name: 'Delete all', exact: true })).toBeDisabled();
  expect(fixture.deleted.size).toBe(2); expect(fixture.errors).toEqual([]);
});

test('Pi preserves active chats when stop or archive fails', async ({ page }) => {
  const fixture = await archivePage(page);
  await page.route('**/api/v1/pi/stop', (route) => route.fulfill({ status: 503, json: { ok: false, error: { code: 'UNAVAILABLE', message: 'Pi is still stopping. Try again.' } } }));
  const archive = page.getByRole('navigation', { name: 'Recent Pi chats' }).getByRole('button', { name: 'Archive Project notes' });
  await page.getByRole('navigation', { name: 'Recent Pi chats' }).getByRole('button', { name: 'Project notes', exact: true }).hover();
  await archive.click(); await expect(page.getByRole('alert')).toContainText('Pi is still stopping'); expect(fixture.archived.size).toBe(0);
  await page.route('**/api/v1/pi/stop', (route) => route.fulfill({ json: { ok: true, data: { closed: true } } }));
  await page.route('**/api/v1/pi/sessions/archive', (route) => route.fulfill({ status: 409, json: { ok: false, error: { code: 'CONFLICT', message: 'Project is open in another Pi window.' } } }));
  await archive.click();
  await expect(page.getByRole('alert')).toContainText('Project is open in another Pi window');
  await expect.poll(() => fixture.starts.at(-1)?.session).toBe('first.jsonl');
  expect(fixture.archived.size).toBe(0); expect(fixture.errors).toEqual([]);
});

test('Pi disables archival while a reply is running', async ({ page }) => {
  const fixture = await archivePage(page);
  await page.getByTestId('pi-prompt').fill('Work on this'); await page.getByTestId('pi-send').click();
  await expect(page.getByRole('navigation', { name: 'Recent Pi chats' }).getByRole('button', { name: 'Archive Project notes' })).toBeDisabled();
  fixture.finish();
  await expect(page.getByRole('navigation', { name: 'Recent Pi chats' }).getByRole('button', { name: 'Archive Project notes' })).toBeEnabled();
});

test('Pi refreshes remaining archived chats after a partial bulk deletion failure', async ({ page }) => {
  const fixture = await archivePage(page); fixture.archived.add('first.jsonl'); fixture.archived.add('second.jsonl');
  await page.route('**/api/v1/pi/sessions/delete', (route) => route.request().postDataJSON().session === 'second.jsonl' ? route.fulfill({ status: 409, json: { ok: false, error: { code: 'CONFLICT', message: 'File could not be removed.' } } }) : route.fallback());
  await openArchive(page); await page.getByRole('button', { name: 'Delete all', exact: true }).click(); await page.getByRole('button', { name: 'Delete 2 chats' }).click();
  await expect(page.getByTestId('pi-archived')).toContainText('File could not be removed');
  await expect(page.getByRole('button', { name: 'Delete Earlier work' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete Project notes' })).toHaveCount(0);
  expect(fixture.deleted.has('first.jsonl')).toBe(true); expect(fixture.archived.has('second.jsonl')).toBe(true);
});

test('Pi archives an older conversation and resumes the active one', async ({ page }) => {
  const fixture = await archivePage(page);
  await page.getByRole('navigation', { name: 'Recent Pi chats' }).getByRole('button', { name: 'Earlier work', exact: true }).hover();
  await page.getByRole('navigation', { name: 'Recent Pi chats' }).getByRole('button', { name: 'Archive Earlier work' }).click();
  await expect.poll(() => fixture.starts.at(-1)?.session).toBe('first.jsonl');
  await expect(page.getByRole('button', { name: 'Earlier work', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('pi-prompt')).toBeEnabled();
  expect(fixture.archived.has('second.jsonl')).toBe(true);
  expect(fixture.archived.has('first.jsonl')).toBe(false);
});
