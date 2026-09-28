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
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('pi-terminal')).toHaveCount(0);
  expect(errors).toEqual([]);
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
