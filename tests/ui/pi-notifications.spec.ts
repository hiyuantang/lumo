// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test, type Page } from '../offline';
import { piPage } from './pi-fixture';

async function start(page: Page) {
  const fixture = await piPage(page);
  await page.goto('http://localhost:5200');
  await page.getByTestId('dock-app-pi').click();
  await expect(page.getByTestId('pi-prompt')).toBeEnabled();
  await expect(page.getByTestId('notifications-badge')).toHaveCount(0);
  await page.getByTestId('pi-prompt').fill('Inspect the project');
  await page.getByTestId('pi-send').click();
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeEnabled();
  return fixture;
}

test('Pi completion notifies once through the system center while minimized', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  const fixture = await start(page);
  await page.getByRole('button', { name: 'Minimize Pi', exact: true }).click();
  fixture.finish();
  await expect(page.getByTestId('notifications-badge')).toHaveText('1');
  fixture.emit({ type: 'agent_settled' });
  await page.getByTestId('notifications-button').click();
  await expect(page.getByTestId('notification-item')).toHaveCount(1);
  await expect(page.getByTestId('notification-item')).toContainText('Pi finished');
  await expect(page.getByTestId('notification-item')).toContainText('Project notes');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      await expect(page.getByTestId('notification-item')).toBeVisible();
      expect(await page.getByTestId('notification-center').evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
      await page.screenshot({ path: `/tmp/lumo-pi-system-notification-${width}-${colorScheme}.png`, animations: 'disabled' });
    }
  }
  expect(errors).toEqual([]);
});

test('Retry attempts stay quiet and only the final result produces a notification', async ({ page }) => {
  const fixture = await start(page);
  fixture.setRetry({ attempt: 1, maxAttempts: 3, retryAt: Date.now() + 10000, errorMessage: 'Connection error.', source: 'response' });
  await expect(page.getByTestId('pi-retry-notice')).toBeVisible();
  await expect(page.getByTestId('notifications-badge')).toHaveCount(0);
  fixture.setRetry({ attempt: 2, maxAttempts: 3, retryAt: Date.now() + 10000, errorMessage: 'Connection error.', source: 'response' });
  await expect(page.getByTestId('pi-retry-notice').last()).toContainText('Attempt 2 of 3');
  await expect(page.getByTestId('notifications-badge')).toHaveCount(0);
  fixture.finish('', 'error', 'Connection error.');
  await expect(page.getByTestId('notifications-badge')).toHaveText('1');
  await page.getByTestId('notifications-button').click();
  await expect(page.getByTestId('notification-item')).toHaveCount(1);
  await expect(page.getByTestId('notification-item')).toContainText('Pi stopped with an error');
  await expect(page.getByTestId('notification-item')).toContainText('Connection error.');
  await page.getByRole('button', { name: 'Clear all', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.getByTestId('pi-prompt').fill('Try again'); await page.getByTestId('pi-send').click();
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeEnabled();
  fixture.setRetry({ attempt: 1, maxAttempts: 3, retryAt: Date.now() + 10000, errorMessage: 'Rate limit exceeded', source: 'response' });
  await expect(page.getByTestId('pi-retry-notice')).toBeVisible();
  fixture.finish('Recovered');
  await expect(page.getByTestId('notifications-badge')).toHaveText('1');
  await page.getByTestId('notifications-button').click();
  await expect(page.getByTestId('notification-item')).toContainText('Pi finished');
  await expect(page.getByTestId('notification-item')).not.toContainText('Rate limit');
});

test('Stop and confirmed window close each notify once with the chat name', async ({ page }) => {
  await start(page);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.getByTestId('notifications-badge')).toHaveText('1');
  await page.getByTestId('notifications-button').click();
  await expect(page.getByTestId('notification-item')).toHaveCount(1);
  await expect(page.getByTestId('notification-item')).toContainText('Pi stopped');
  await expect(page.getByTestId('notification-item')).toContainText('Stopped by you.');
  await page.keyboard.press('Escape');
  await page.getByTestId('pi-prompt').fill('Another task'); await page.getByTestId('pi-send').click();
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Close Pi', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByTestId('notifications-badge')).toHaveText('1');
  await page.getByTestId('notifications-button').click();
  await expect(page.getByTestId('notification-item')).toHaveCount(2);
  await expect(page.getByTestId('notification-item').first()).toContainText('Session closed.');
});

test('A process exit emits one notification even when the same batch settles the run', async ({ page }) => {
  const fixture = await start(page);
  fixture.emit({ type: 'agent_settled' });
  fixture.close('Pi exited unexpectedly.');
  await expect(page.getByRole('button', { name: 'Reconnect', exact: true })).toBeVisible();
  await expect(page.getByTestId('notifications-badge')).toHaveText('1');
  await page.getByTestId('notifications-button').click();
  await expect(page.getByTestId('notification-item')).toHaveCount(1);
  await expect(page.getByTestId('notification-item')).toContainText('Pi stopped');
  await expect(page.getByTestId('notification-item')).toContainText('Pi exited unexpectedly.');
});

test('A lost event connection uses the system notification center', async ({ page }) => {
  await start(page);
  await page.route('**/api/v1/pi/events**', (route) => route.fulfill({ status: 503, json: { ok: false, error: { code: 'unavailable', message: 'Server connection interrupted.' } } }));
  await expect(page.getByRole('button', { name: 'Reconnect', exact: true })).toBeVisible();
  await expect(page.getByTestId('notifications-badge')).toHaveText('1');
  await page.getByTestId('notifications-button').click();
  await expect(page.getByTestId('notification-item')).toHaveCount(1);
  await expect(page.getByTestId('notification-item')).toContainText('Pi connection lost');
  await expect(page.getByTestId('notification-item')).toContainText('Server connection interrupted.');
});

test('A connection loss after completion still notifies while Pi is idle', async ({ page }) => {
  const fixture = await start(page);
  fixture.finish();
  await expect(page.getByTestId('notifications-badge')).toHaveText('1');
  await page.route('**/api/v1/pi/events**', (route) => route.fulfill({ status: 503, json: { ok: false, error: { code: 'unavailable', message: 'Server connection interrupted.' } } }));
  await expect(page.getByRole('button', { name: 'Reconnect', exact: true })).toBeVisible();
  await expect(page.getByTestId('notifications-badge')).toHaveText('2');
  await page.getByTestId('notifications-button').click();
  await expect(page.getByTestId('notification-item')).toHaveCount(2);
  await expect(page.getByTestId('notification-item').first()).toContainText('Pi connection lost');
});
