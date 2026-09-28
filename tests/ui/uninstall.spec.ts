// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from '../offline';

for (const clean of [false, true]) {
  test(`${clean ? 'Clean' : 'Normal'} uninstall offers a compact choice and keeps Trash recoverable`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    await page.getByTestId('login-username').fill('demo');
    await page.getByTestId('login-password').fill('demo');
    await page.getByTestId('login-submit').click();
    await page.getByTestId('dock-app-library').click();
    await page.getByTestId('library-nginx').click();
    await page.getByTestId('library-primary').click();
    const dialog = page.getByTestId('server-app-confirm');
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId('uninstall-normal')).toBeChecked();
    await expect(page.getByTestId('library-plan')).toHaveCount(0);
    await page.getByTestId('uninstall-clean').check();
    await expect(dialog).toContainText('Also move settings, caches and stored app data to Trash.');
    await expect(page.getByTestId('server-app-confirm-ok')).toHaveText('Clean uninstall');
    await page.screenshot({ path: '/tmp/lumo-clean-uninstall-light.png' });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.screenshot({ path: '/tmp/lumo-clean-uninstall-dark.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId('server-app-confirm-ok')).toBeInViewport();
    expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: '/tmp/lumo-clean-uninstall-narrow.png' });
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByTestId('library-primary')).toHaveText('Uninstall');
    await page.getByTestId('library-primary').click();
    await expect(page.getByTestId('uninstall-normal')).toBeChecked();
    if (clean) await page.getByTestId('uninstall-clean').check();
    await page.getByTestId('server-app-confirm-ok').click();
    await expect(page.getByTestId('library-primary')).toHaveText('Install');
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByTestId('dock-app-trash').click();
    if (clean) {
      const row = page.getByRole('option').filter({ hasText: '/etc/nginx' });
      await expect(row).toBeVisible();
      await row.click();
      await page.getByTestId('trash-restore').click();
      await expect(row).toHaveCount(0);
    } else await expect(page.getByTestId('trash-empty-state')).toBeVisible();
    expect(errors).toEqual([]);
  });
}
