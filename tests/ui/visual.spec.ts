// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '../offline';
import { fileURLToPath } from 'node:url';

for (const theme of ['light', 'dark'] as const) {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 800, height: 650 }]) {
    test(`login and Files remain readable in ${theme} at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error' || message.type() === 'warning') errors.push(message.text());
      });
      await page.emulateMedia({ colorScheme: theme });
      const suffix = theme === 'light' ? '' : '-dark';
      await page.setViewportSize(viewport);
      await page.clock.setFixedTime(new Date('2026-09-26T12:00:00Z'));
      await page.goto('/');
      await expect(page).toHaveTitle('Lumo');
      await expect(page.getByRole('form', { name: 'Log in to Lumo' })).toBeInViewport();
      await expect(page.getByTestId('login-submit')).toBeDisabled();
      await expect(page).toHaveScreenshot(`login-${viewport.width}${suffix}.png`, { animations: 'disabled' });
      await page.getByTestId('login-username').fill('demo');
      await page.getByTestId('login-password').fill('demo');
      await page.getByTestId('login-submit').click();
      await page.getByTestId('dock-app-files').click();
      await expect(page.getByTestId('file-row-notes.txt')).toBeVisible();
      await expect(page.getByTestId('window-files')).toHaveCSS('transform', 'none');
      const window = await page.getByTestId('window-files').boundingBox();
      const dock = await page.getByTestId('dock').boundingBox();
      expect(window).not.toBeNull();
      expect(dock).not.toBeNull();
      expect(window!.x).toBeGreaterThanOrEqual(0);
      expect(window!.x + window!.width).toBeLessThanOrEqual(viewport.width);
      expect(window!.y + window!.height).toBeLessThanOrEqual(dock!.y + 1);
      await expect(page.getByTestId('upload-button')).toBeInViewport();
      await expect(page.getByTestId('files-sidebar-toggle')).toBeInViewport();
      await expect(page.locator('vite-error-overlay')).toHaveCount(0);
      await page.mouse.move(viewport.width - 1, viewport.height - 1);
      await expect(page).toHaveScreenshot(`files-${viewport.width}${suffix}.png`, {
        animations: 'disabled',
        stylePath: fileURLToPath(new URL('./visual.css', import.meta.url)),
      });
      await testInfo.attach('Files desktop', { body: await page.screenshot(), contentType: 'image/png' });
      expect(errors).toEqual([]);
    });
  }

}
