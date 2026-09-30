// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '../offline';
import { piPage } from './pi-fixture';

async function openProviders(page: import('@playwright/test').Page) {
  await piPage(page);
  await page.goto('http://localhost:5200'); await page.getByTestId('dock-app-pi').click();
  await page.getByTestId('pi-settings-button').click();
  await page.getByRole('button', { name: 'Connect provider', exact: true }).click();
  await page.getByRole('combobox', { name: 'Provider', exact: true }).click();
  await page.getByRole('option', { name: 'Fixture', exact: true }).click();
}

test('Pi displays browser sign-in and device codes, then disconnects inside Settings', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  await openProviders(page);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Open sign-in page' })).toHaveAttribute('href', 'https://login.example.test/authorize');
  await expect(page.getByTestId('pi-auth-flow')).toContainText('DEMO-CODE');
  await expect(page.getByTestId('pi-auth-answer')).toHaveAttribute('type', 'password');
  await page.screenshot({ path: '/tmp/lumo-pi-sign-in-light.png', animations: 'disabled' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: '/tmp/lumo-pi-sign-in-dark.png', animations: 'disabled' });
  await expect(page.getByTestId('pi-sidebar')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '/tmp/lumo-pi-sign-in-narrow.png', animations: 'disabled' });
  await page.getByTestId('pi-auth-answer').fill('https://localhost/callback?code=offline-code');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByText('Signed in', { exact: true })).toBeVisible();
  await expect(page.getByTestId('pi-notification')).toHaveText('Saved');
  await expect(page.getByTestId('pi-providers').getByText('Provider settings updated.', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByTestId('pi-connected-fixture')).toContainText('Signed in');
  await page.getByRole('button', { name: 'Disconnect Fixture', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Disconnect Fixture', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('pi-notification')).toHaveText('Saved');
  await expect(page.getByTestId('pi-notification')).toHaveCount(1);
  await expect(page.getByTestId('pi-terminal')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Connected providers use the JSON overview, masked keys and shared rows in both themes and sizes', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  await piPage(page);
  let providers = [{ id: 'deepseek', name: 'DeepSeek', credential: 'api_key', keyPreview: '••••1234' }, { id: 'openai', name: 'OpenAI', credential: 'oauth' }, { id: 'custom', name: 'My custom provider with a longer name', credential: 'api_key' }];
  let reads = 0; let catalogs = 0;
  await page.route('**/api/v1/pi/connections', (route) => { reads++; return route.fulfill({ json: { ok: true, data: { providers } } }); });
  await page.route('**/api/v1/pi/providers', (route) => { catalogs++; return route.fallback(); });
  await page.route('**/api/v1/pi/auth/start', (route) => { const body = route.request().postDataJSON(); if (body.operation === 'logout') providers = providers.filter((item) => item.id !== body.provider); return route.fallback(); });
  await page.goto('http://localhost:5200'); await page.getByTestId('dock-app-pi').click();
  await page.getByTestId('pi-settings-button').click();
  await expect(page.getByTestId('pi-connected-deepseek')).toContainText('API key ••••1234');
  await expect(page.getByTestId('pi-connected-openai')).toContainText('Signed in');
  await expect(page.getByTestId('pi-connected-custom')).toContainText('API key saved');
  await expect(page.getByRole('combobox', { name: 'Provider', exact: true })).toHaveCount(0);
  expect(catalogs).toBe(0);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      await expect(page.getByRole('button', { name: 'Disconnect DeepSeek' })).toBeVisible();
      expect(await page.getByTestId('pi-settings').evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
      expect(await page.locator('.pi-settings-pane:not([hidden]) .pi-settings-scroll').evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
      await page.screenshot({ path: `/tmp/lumo-pi-connections-${width}-${colorScheme}.png`, animations: 'disabled' });
    }
  }
  providers[0].keyPreview = '••••5678';
  const beforeRefresh = reads;
  await page.getByRole('button', { name: 'Refresh providers', exact: true }).click();
  await expect(page.getByTestId('pi-connected-deepseek')).toContainText('••••5678');
  expect(reads).toBeGreaterThan(beforeRefresh);
  await page.getByRole('button', { name: 'Disconnect DeepSeek', exact: true }).click();
  await expect(page.getByTestId('pi-connected-deepseek')).toHaveCount(0);
  await expect(page.getByTestId('pi-connected-openai')).toBeVisible();
  await expect(page.getByTestId('pi-notification')).toHaveText('Saved');
  expect(catalogs).toBe(0);
  const beforeReopen = reads;
  await page.getByTestId('pi-home-button').click();
  providers = [];
  await page.getByTestId('pi-settings-button').click();
  await expect(page.getByText('No connected providers.', { exact: true })).toBeVisible();
  expect(reads).toBeGreaterThan(beforeReopen);
  await page.getByRole('button', { name: 'Connect provider', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Provider', exact: true })).toBeVisible();
  expect(catalogs).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('Provider storage errors can be refreshed without presenting stale connections', async ({ page }) => {
  await piPage(page);
  let failed = true;
  await page.route('**/api/v1/pi/connections', (route) => failed ? route.fulfill({ status: 503, json: { ok: false, error: { code: 'unavailable', message: 'Could not read saved providers.' } } }) : route.fulfill({ json: { ok: true, data: { providers: [{ id: 'deepseek', name: 'DeepSeek', credential: 'api_key', keyPreview: '••••1234' }] } } }));
  await page.goto('http://localhost:5200'); await page.getByTestId('dock-app-pi').click();
  await page.getByTestId('pi-settings-button').click();
  await expect(page.getByRole('alert')).toHaveText('Could not read saved providers.');
  await expect(page.getByText('No connected providers.', { exact: true })).toHaveCount(0);
  failed = false;
  await page.getByRole('button', { name: 'Refresh providers', exact: true }).click();
  await expect(page.getByTestId('pi-connected-deepseek')).toContainText('••••1234');
  failed = true;
  await page.getByRole('button', { name: 'Refresh providers', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByTestId('pi-connected-deepseek')).toHaveCount(0);
});

test('Pi cancels abandoned sign-in and preserves a failed response for retry', async ({ page }) => {
  await openProviders(page);
  let cancelled = 0;
  await page.route('**/pi/auth/cancel', (route) => { cancelled++; return route.fallback(); });
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByTestId('pi-auth-answer')).toBeVisible();
  await page.getByTestId('pi-auth-answer').fill('offline-code');
  await page.route('**/pi/auth/reply', (route) => route.fulfill({ status: 409, json: { ok: false, error: { code: 'conflict', message: 'This sign-in step has changed.' } } }));
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('step has changed');
  await expect(page.getByTestId('pi-notification')).toHaveCount(0);
  await expect(page.getByTestId('pi-auth-answer')).toHaveValue('offline-code');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByTestId('pi-auth-answer')).toHaveCount(0);
  expect(cancelled).toBe(1);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByTestId('pi-auth-answer')).toBeVisible();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect.poll(() => cancelled).toBe(2);
  await expect(page.getByTestId('pi-terminal')).toHaveCount(0);
});
