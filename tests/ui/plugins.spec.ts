// SPDX-License-Identifier: AGPL-3.0-only
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { test, expect, type Page } from '../offline';

async function login(page: Page) {
  await page.goto('/');
  await page.getByTestId('login-username').fill('demo');
  await page.getByTestId('login-password').fill('demo');
  await page.getByTestId('login-submit').click();
}

test('a missing or incompatible plugin leaves built-in apps usable and can retry', async ({ page }) => {
  let available = false;
  await page.route('**/plugins/skills/manifest.json', async (route) => {
    if (available) { await route.continue(); return; }
    await route.fulfill({ json: { schemaVersion: 1, hostApiVersion: 99, id: 'skills', entry: 'invalid.js' } });
  });
  await login(page);
  await page.getByTestId('dock-app-skills').click();
  await expect(page.getByTestId('plugin-load-error')).toContainText('incompatible');
  await page.getByTestId('dock-app-files').click();
  await expect(page.getByTestId('app-files')).toBeVisible();
  await page.getByTestId('dock-app-skills').click();
  available = true;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByTestId('app-skills')).toBeVisible();
});

test('an independently updated plugin loads on reopen without reloading the desktop', async ({ page }) => {
  const manifest = JSON.parse(await readFile('public/plugins/skills/manifest.json', 'utf8'));
  const original = await readFile('public/plugins/skills/' + manifest.entry, 'utf8');
  expect(original).toContain('My skills');
  const updated = original.replace('My skills', 'Updated skills');
  const filename = createHash('sha256').update(updated).digest('hex') + '.js';
  let useUpdate = false;
  await page.route('**/plugins/skills/manifest.json', async (route) => {
    await route.fulfill({ json: useUpdate ? { ...manifest, version: '1.0.1', entry: filename } : manifest });
  });
  await page.route('**/plugins/skills/' + filename + '*', (route) => route.fulfill({ contentType: 'application/javascript', body: updated }));
  const navigations: string[] = [];
  page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) navigations.push(frame.url()); });
  await login(page);
  await page.getByTestId('dock-app-skills').click();
  await expect(page.getByRole('heading', { name: 'My skills', exact: true })).toBeVisible();
  useUpdate = true;
  await expect(page.getByRole('heading', { name: 'My skills', exact: true })).toBeVisible();
  await page.getByTestId('window-close-skills').click();
  await page.getByTestId('dock-app-skills').click();
  await expect(page.getByRole('heading', { name: 'Updated skills', exact: true })).toBeVisible();
  expect(navigations).toHaveLength(1);
  useUpdate = false;
  await page.getByTestId('window-close-skills').click();
  await page.getByTestId('dock-app-skills').click();
  await expect(page.getByRole('heading', { name: 'My skills', exact: true })).toBeVisible();
  await expect(page.locator('link[data-lumo-plugin-style="skills"]')).toHaveCount(1);
});

test('plugin code loads on demand and shares the desktop theme at both sizes', async ({ page }) => {
  const requests: string[] = [];
  const errors: string[] = [];
  page.on('request', (request) => { if (request.url().includes('/plugins/')) requests.push(request.url()); });
  page.on('pageerror', (error) => errors.push(error.message));
  await login(page);
  expect(requests.some((url) => url.includes('/skills/'))).toBe(false);
  await page.getByTestId('dock-app-skills').click();
  await expect(page.getByTestId('app-skills')).toBeVisible();
  expect(requests.some((url) => /\/skills\/[a-f0-9]+\.js$/.test(new URL(url).pathname))).toBe(true);
  for (const colorScheme of ['light', 'dark'] as const) for (const width of [1440,390]) {
    await page.emulateMedia({ colorScheme });
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByTestId('skill-edit')).toBeVisible();
    await page.screenshot({ path: `/tmp/lumo-plugins-${width}-${colorScheme}.png` });
  }
  expect(errors).toEqual([]);
});
