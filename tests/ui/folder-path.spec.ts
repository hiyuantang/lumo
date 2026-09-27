// SPDX-License-Identifier: AGPL-3.0-only
import { folderPath } from '../../src/utils/folder-path';
import { expect, test, type Page } from '@playwright/test';

async function openFiles(page: Page) {
  await page.goto('/');
  await page.getByTestId('login-username').fill('demo');
  await page.getByTestId('login-password').fill('demo');
  await page.getByTestId('login-submit').click();
  await page.getByTestId('dock-app-files').click();
}

test('folder paths resolve home aliases, dot segments and absolute root consistently', () => {
  expect(folderPath('~/a/../b', '/srv/alice/docs', '/srv/alice', ['alice'])).toEqual(['alice', 'b']);
  expect(folderPath('../../../../tmp//', '/srv/alice/docs', '/srv/alice', ['alice'])).toEqual(['', 'tmp']);
  expect(folderPath('/', '/home/user', '/home/user', ['user'])).toEqual(['']);
  expect(folderPath('/etc', '/', '/', ['user'])).toEqual(['user', 'etc']);
  expect(folderPath('/srv/alice-other', '/srv/alice', '/srv/alice', ['alice'])).toEqual(['', 'srv', 'alice-other']);
  expect(() => folderPath('~bob', '/', '/home/user', ['user'])).toThrow();
});


test('footer folders navigate directly and Copy copies the displayed absolute path', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openFiles(page);
  const trail = page.getByTestId('files-absolute-path');
  const copy = page.getByTestId('files-copy-path');
  await page.getByTestId('file-row-notes.txt').click();
  await copy.click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('/home/user/notes.txt');
  await expect(copy).toHaveText('Copied');
  await trail.getByRole('button', { name: 'user', exact: true }).click();
  await expect(trail).toHaveText('/home/user');
  await expect(page.getByTestId('file-row-notes.txt')).toHaveAttribute('aria-selected', 'false');
  await copy.click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('/home/user');
  await page.getByTestId('file-row-Documents').click();
  await copy.click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('/home/user/Documents');
  await trail.getByRole('button', { name: 'Documents', exact: true }).click();
  await expect(page.getByTestId('file-row-server-notes.md')).toBeVisible();
  await trail.getByRole('button', { name: 'user', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('file-row-notes.txt')).toBeVisible();
  await trail.getByRole('button', { name: 'home', exact: true }).click();
  await expect(page.getByTestId('file-row-user')).toBeVisible();
  await trail.getByRole('button', { name: '/', exact: true }).click();
  await expect(trail).toHaveText('/');
  await expect(page.getByTestId('file-row-tmp')).toBeVisible();
  await copy.click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('/');
});


test('footer stays compact with clickable folders and Copy, without path editing', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.setViewportSize({ width: 390, height: 844 });
  await openFiles(page);
  await page.getByTestId('file-row-Documents').dblclick();
  await page.getByTestId('file-row-server-notes.md').click();
  const trail = page.getByTestId('files-absolute-path');
  await expect(trail).toHaveText('/home/user/Documents/server-notes.md');
  const copy = page.getByTestId('files-copy-path');
  const bounds = (await copy.boundingBox())!;
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  await copy.click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('/home/user/Documents/server-notes.md');
  await trail.getByRole('button', { name: 'user', exact: true }).click();
  await expect(page.getByTestId('file-row-notes.txt')).toBeVisible();
  await expect(page.getByTestId('files-path-input')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Go to folder', exact: true })).toHaveCount(0);
  await page.screenshot({ path: '/tmp/lumo-folder-path-compact.png', animations: 'disabled' });
});
