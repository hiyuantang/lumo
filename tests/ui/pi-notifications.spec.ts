// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test, type Page } from '../offline';
import { piPage } from './pi-fixture';

async function start(page: Page, background = true) {
  const fixture = await piPage(page);
  await page.route('**/api/v1/files/list*', (route) => route.fulfill({ json: { ok: true, data: { path: '/home/user', entries: [] } } }));
  await page.route('**/api/v1/system/settings', (route) => route.fulfill({ json: { ok: true, data: { serverTime: '2026-10-01T12:00:00Z', timezone: 'America/New_York' } } }));
  await page.goto('http://localhost:5200');
  await page.getByTestId('dock-app-pi').click();
  await expect(page.getByTestId('pi-prompt')).toBeEnabled();
  await expect(page.getByTestId('notifications-badge')).toHaveCount(0);
  await page.getByTestId('pi-prompt').fill('Inspect the project');
  await page.getByTestId('pi-send').click();
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeEnabled();
  if (background) await page.getByTestId('dock-app-files').click();
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
      await page.getByTestId('notification-item').hover();
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
  await page.getByTestId('notification-item').hover();
  await page.getByTestId('notification-close').click();
  await page.keyboard.press('Escape');
  await page.getByTestId('dock-app-pi').click();
  await page.getByTestId('pi-prompt').fill('Try again'); await page.getByTestId('pi-send').click();
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeEnabled();
  fixture.setRetry({ attempt: 1, maxAttempts: 3, retryAt: Date.now() + 10000, errorMessage: 'Rate limit exceeded', source: 'response' });
  await expect(page.getByTestId('pi-retry-notice')).toBeVisible();
  await page.getByTestId('dock-app-files').click();
  fixture.finish('Recovered');
  await expect(page.getByTestId('notifications-badge')).toHaveText('1');
  await page.getByTestId('notifications-button').click();
  await expect(page.getByTestId('notification-item')).toContainText('Pi finished');
  await expect(page.getByTestId('notification-item')).not.toContainText('Rate limit');
});

test('Stopping focused Pi stays quiet and closing running Pi notifies once', async ({ page }) => {
  await start(page, false);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.getByTestId('notifications-badge')).toHaveCount(0);
  await page.getByTestId('pi-prompt').fill('Another task'); await page.getByTestId('pi-send').click();
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Close Pi', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByTestId('notifications-badge')).toHaveText('1');
  await page.getByTestId('notifications-button').click();
  await expect(page.getByTestId('notification-item')).toHaveCount(1);
  await expect(page.getByTestId('notification-item')).toContainText('Session closed.');
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


test('Focused Pi keeps completion, failure and attention inside the window', async ({ page }) => {
  const fixture = await start(page, false);
  fixture.finish();
  await expect(page.getByTestId('pi-messages')).toContainText('React and Go');
  await expect(page.getByTestId('pet-bubble')).toContainText('Work done');
  await expect(page.getByTestId('notifications-badge')).toHaveCount(0);
  await expect(page.getByTestId('notification-banner')).toHaveCount(0);
  await page.getByTestId('pi-prompt').fill('Another task'); await page.getByTestId('pi-send').click();
  fixture.ask({ id: 'focused-approval', method: 'confirm', title: 'Allow this change?' });
  await expect(page.getByTestId('pi-question')).toContainText('Allow this change?');
  await expect(page.getByTestId('notifications-badge')).toHaveCount(0);
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  fixture.finish('', 'error', 'Could not finish.');
  await expect(page.getByTestId('pi-messages')).toContainText('Could not finish.');
  await expect(page.getByTestId('notifications-badge')).toHaveCount(0);
});

test('Unfocused Pi announces a required approval once', async ({ page }) => {
  const fixture = await start(page);
  fixture.ask({ id: 'background-approval', method: 'confirm', title: 'Allow this change?' });
  await expect(page.getByTestId('notification-banner')).toContainText('Pi needs your attention');
  await expect(page.getByTestId('notifications-badge')).toHaveText('1');
  await page.getByTestId('notifications-button').click();
  await expect(page.getByTestId('notification-item')).toHaveCount(1);
  await expect(page.getByTestId('notification-item')).toContainText('Allow this change?');
});

test('Visible floating Pi stays quiet while another app is focused and hidden Pi notifies', async ({ page }) => {
  const fixture = await piPage(page);
  await page.route('**/api/v1/files/list*', (route) => route.fulfill({ json: { ok: true, data: { path: '/home/user', entries: [] } } }));
  await page.route('**/api/v1/system/settings', (route) => route.fulfill({ json: { ok: true, data: { serverTime: '2026-10-01T12:00:00Z', timezone: 'America/New_York' } } }));
  await page.goto('http://localhost:5200');
  await page.getByTestId('pi-tray-button').click(); await page.getByTestId('pi-tray-toggle').click();
  const prompt = page.getByTestId('pi-compact-prompt');
  await expect(prompt).toBeEnabled(); await prompt.fill('Help me'); await prompt.press('Enter');
  await page.getByTestId('dock-app-files').click();
  fixture.finish();
  await expect(page.getByTestId('pi-compact-worked')).toBeVisible();
  await expect(page.getByTestId('notifications-badge')).toHaveCount(0);
  await expect(page.getByTestId('notification-banner')).toHaveCount(0);
  await prompt.fill('Next task'); await prompt.press('Enter');
  await page.getByTestId('dock-app-files').click();
  fixture.ask({ id: 'floating-approval', method: 'confirm', title: 'Allow this change?' });
  await expect(page.getByTestId('pi-question')).toContainText('Allow this change?');
  await expect(page.getByTestId('notifications-badge')).toHaveCount(0);
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  fixture.finish('', 'error', 'Could not finish.');
  await expect(page.getByTestId('pi-compact-messages')).toContainText('Could not finish.');
  await expect(page.getByTestId('notifications-badge')).toHaveCount(0);
  await prompt.fill('Hidden task'); await prompt.press('Enter');
  await page.getByTestId('pi-tray-button').click(); await page.getByTestId('pi-tray-toggle').click();
  await expect(page.getByTestId('pi-assistant')).toBeHidden();
  fixture.finish('Finished while hidden.');
  await expect(page.getByTestId('notifications-badge')).toHaveText('1');
  await expect(page.getByTestId('notification-banner')).toContainText('Pi finished');
});

test('New cards slide in, pause on hover, slide back and remain in history', async ({ page }) => {
  await page.clock.install();
  const fixture = await start(page);
  fixture.finish();
  const banner = page.getByTestId('notification-banner');
  await expect(banner).toContainText('Pi finished');
  await expect(banner).toHaveCSS('animation-name', 'notification-slide-in');
  await page.mouse.move(20, 100);
  await page.clock.fastForward(5500);
  await expect(banner).toBeVisible();
  await banner.hover();
  await expect(banner.getByTestId('notification-close')).toHaveCSS('opacity', '1');
  await page.clock.fastForward(15000);
  await expect(banner).toBeVisible();
  await page.mouse.move(20, 100);
  await page.clock.fastForward(6000);
  await expect(banner).toHaveCSS('animation-name', 'notification-slide-out');
  await page.clock.fastForward(250);
  await expect(banner).toHaveCount(0);
  await expect(page.getByTestId('notifications-badge')).toHaveText('1');
  await page.getByTestId('notifications-button').click();
  const center = page.getByTestId('notification-center');
  await expect(center).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(center).toHaveCSS('box-shadow', 'none');
  await expect(center.getByRole('heading')).toHaveCount(0);
  await expect(page.locator('.notifications-backdrop')).toHaveCount(0);
  const card = page.getByTestId('notification-item');
  const close = card.getByTestId('notification-close');
  await expect(close).toHaveCSS('opacity', '0');
  await close.focus(); await close.press('Tab'); await page.keyboard.press('Shift+Tab');
  await expect(close).toHaveCSS('opacity', '1');
  await close.press('Enter');
  await expect(card).toHaveCount(0);
  await expect(center).toContainText('No notifications.');
});

test('Banner focus pauses dismissal and reduced motion skips sliding', async ({ page }) => {
  await page.clock.install(); await page.emulateMedia({ reducedMotion: 'reduce' });
  const fixture = await start(page); fixture.finish();
  const banner = page.getByTestId('notification-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toHaveCSS('animation-name', 'none');
  await banner.getByTestId('notification-close').focus();
  await page.mouse.move(20, 100);
  await page.clock.fastForward(15000);
  await expect(banner).toBeVisible();
  await banner.hover();
  await page.getByTestId('notifications-button').focus();
  await page.clock.fastForward(15000);
  await expect(banner).toBeVisible();
  await page.mouse.move(20, 100);
  await page.clock.fastForward(6250);
  await expect(banner).toHaveCount(0);
  await expect(page.getByTestId('notifications-badge')).toHaveText('1');
});


test('Transient notification cards occupy space in desktop observations', async ({ page }) => {
  const fixture = await start(page); fixture.finish();
  const banner = page.getByTestId('notification-banner');
  await expect(banner).toBeVisible();
  await banner.evaluate((node) => Promise.all(node.getAnimations().map((animation) => animation.finished)));
  const id = fixture.requestDesktop({ action: 'observe' });
  await expect.poll(() => fixture.desktopResults.some((item) => item.desktopId === id)).toBe(true);
  const result = fixture.desktopResults.find((item) => item.desktopId === id)!;
  expect(result.error).toBe(false);
  const bounds = (await banner.boundingBox())!;
  const overlays = result.text.split('\n').filter((line) => line.startsWith('Overlay: ')).map((line) => JSON.parse(line.slice(9)));
  expect(overlays.some((overlay) => Math.abs(overlay.bounds.x - bounds.x) < 1 && Math.abs(overlay.bounds.y - bounds.y) < 1 && Math.abs(overlay.bounds.h - bounds.height) < 1)).toBe(true);
});
