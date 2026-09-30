// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from '../offline';
import { piPage } from './pi-fixture';

test('Pi image quality saves for new images, preserves the chat draft and fits both themes and window sizes', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (event) => { if (event.type() === 'error' || event.type() === 'warning') errors.push(event.text()); });
  const fixture = await piPage(page);
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('http://localhost:5200');
  await expect(page).toHaveTitle('Lumo');
  await page.getByTestId('dock-app-pi').click();
  await expect(page.getByTestId('pi-prompt')).toBeEnabled();
  await page.getByTestId('pi-prompt').fill('Keep this chat draft');
  await page.getByTestId('pi-settings-button').click();
  await page.getByRole('tab', { name: 'Extensions', exact: true }).click();
  const quality = page.getByRole('switch', { name: 'Image compression', exact: true });
  await expect(quality).not.toBeChecked();
  await page.clock.install(); await page.clock.pauseAt(new Date(Date.now() + 1000));
  const notice = page.getByTestId('pi-notification');
  await quality.click();
  await expect(quality).toBeChecked();
  await expect(notice).toHaveText('Saved');
  await expect(notice).toHaveAttribute('role', 'status');
  await expect(notice).toHaveCSS('pointer-events', 'none');
  await expect(page.getByTestId('pi-image-settings').getByRole('status')).toHaveCount(0);
  await expect(page.getByTestId('pi-image-settings')).toContainText('Quality 90');
  await expect(page.getByRole('tab', { name: 'Images', exact: true })).toHaveCount(0);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await expect(quality).toBeVisible();
      expect(await page.getByTestId('pi-image-settings').evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
      const appBox = (await page.getByTestId('app-pi').boundingBox())!; const noticeBox = (await notice.boundingBox())!;
      expect(noticeBox.x).toBeGreaterThanOrEqual(appBox.x); expect(noticeBox.x + noticeBox.width).toBeLessThanOrEqual(appBox.x + appBox.width);
      await expect(page.locator('vite-error-overlay')).toHaveCount(0);
      await page.mouse.move(width - 5, 5);
      await page.screenshot({ path: `/private/tmp/lumo-pi-images-${width}-${theme}.png`, animations: 'disabled' });
    }
  }
  await page.clock.runFor(2500);
  await quality.focus(); await page.keyboard.press('Space');
  await expect(quality).not.toBeChecked();
  await expect(notice).toHaveText('Saved');
  await expect(notice).toHaveCount(1);
  await page.clock.runFor(2500); await expect(notice).toHaveCount(1);
  await page.clock.runFor(1600); await expect(notice).toHaveCount(0);
  await page.getByRole('button', { name: 'Reload extensions', exact: true }).click(); await expect(quality).not.toBeChecked();
  await page.getByTestId('pi-home-button').click();
  await expect(page.getByTestId('pi-prompt')).toHaveText('Keep this chat draft');
  expect(fixture.starts).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('Pi image settings blocks leaving during a save and recovers from stale server settings', async ({ page }) => {
  await piPage(page);
  let release: () => void = () => {};
  const saving = new Promise<void>((resolve) => { release = resolve; });
  let conflict = false;
  await page.route('**/api/v1/pi/image-settings', async (route) => {
    if (route.request().method() === 'POST') {
      await saving; conflict = true;
      return route.fulfill({ status: 409, json: { ok: false, error: { code: 'conflict', message: 'Pi settings changed on the server. Reload before saving.' } } });
    }
    if (!conflict) return route.fallback();
    return route.fulfill({ json: { ok: true, data: { mode: 'original', revision: 'external' } } });
  });
  await page.goto('http://localhost:5200'); await page.getByTestId('dock-app-pi').click();
  await page.getByTestId('pi-settings-button').click(); await page.getByRole('tab', { name: 'Extensions', exact: true }).click();
  const quality = page.getByTestId('pi-image-quality');
  await quality.click();
  await expect(quality).toBeDisabled();
  await expect(page.getByRole('tab', { name: 'Providers', exact: true })).toBeDisabled();
  await expect(page.getByTestId('pi-image-settings').getByRole('status')).toHaveText('Saving…');
  release();
  await expect(page.getByRole('alert')).toContainText('Reload before saving.');
  await expect(page.getByTestId('pi-notification')).toHaveCount(0);
  await expect(quality).not.toBeChecked(); await expect(quality).toBeEnabled();
  await page.getByRole('button', { name: 'Reload extensions', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0); await expect(quality).toBeEnabled();
});

test('Pi keeps the previous image mode when compression preparation fails', async ({ page }) => {
  await piPage(page);
  await page.route('**/api/v1/pi/image-settings', (route) => route.request().method() === 'POST'
    ? route.fulfill({ status: 400, json: { ok: false, error: { code: 'validation_failed', message: 'Could not prepare image compression. Your image setting was kept.' } } })
    : route.fallback());
  await page.goto('http://localhost:5200'); await page.getByTestId('dock-app-pi').click();
  await page.getByTestId('pi-settings-button').click(); await page.getByRole('tab', { name: 'Extensions', exact: true }).click();
  const quality = page.getByTestId('pi-image-quality');
  await quality.click();
  await expect(page.getByRole('alert')).toContainText('Your image setting was kept.');
  await expect(page.getByTestId('pi-notification')).toHaveCount(0);
  await expect(quality).not.toBeChecked(); await expect(quality).toBeEnabled();
});
