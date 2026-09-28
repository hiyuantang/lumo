// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect, type Page } from '../offline';
async function open(page: Page) {
  await page.goto('/');
  await page.getByTestId('login-username').fill('demo');
  await page.getByTestId('login-password').fill('demo');
  await page.getByTestId('login-submit').click();
  await page.getByTestId('dock-app-containers').click();
}
test('Docker shows sizes, references and safe resource management', async ({ page }) => {
  await open(page);
  await expect(page.getByTestId('app-containers')).toContainText('Writable layer');
  await expect(page.getByTestId('app-containers')).toContainText('1.2 MB');
  await page.getByTestId('docker-section-images').click();
  await expect(page.getByRole('button', { name: 'Remove image nginx:stable-alpine', exact: true })).toBeDisabled();
  await expect(page.getByTestId('app-containers')).toContainText('51.2 MB');
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await page.screenshot({ path: `/tmp/lumo-docker-dividers-${colorScheme}.png`, animations: 'disabled' });
  }
  await page.getByTestId('docker-section-volumes').click();
  await expect(page.getByRole('button', { name: 'Remove volume notes-data' })).toBeDisabled();
  await page.getByRole('button', { name: 'Create volume', exact: true }).click();
  await page.getByLabel('New volume name').fill('test-data');
  await page.getByTestId('server-app-confirm-ok').click();
  await expect(page.getByRole('button', { name: 'Remove volume test-data' })).toBeVisible();
  await page.getByRole('button', { name: 'Remove volume old-backup' }).click();
  await expect(page.getByTestId('server-app-confirm-ok')).toBeDisabled();
  await page.getByLabel('Resource name to confirm').fill('wrong-name');
  await expect(page.getByTestId('server-app-confirm-ok')).toBeDisabled();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove volume old-backup' })).toBeVisible();
  await page.getByRole('button', { name: 'Remove volume test-data' }).click();
  await page.getByLabel('Resource name to confirm').fill('test-data');
  await page.getByTestId('server-app-confirm-ok').click();
  await expect(page.getByRole('button', { name: 'Remove volume test-data' })).toHaveCount(0);
  await page.getByTestId('docker-section-networks').click();
  await expect(page.getByTestId('app-containers')).toContainText('172.19.0.0/16');
  await expect(page.getByRole('button', { name: 'Remove network bridge', exact: true })).toBeDisabled();
  await page.getByTestId('docker-section-storage').click();
  await expect(page.getByTestId('app-containers')).toContainText('Shared layers counted once');
  await expect(page.getByTestId('app-containers')).toContainText('576.2 MB');
});
test('Engine update checks open the one-click App Library list', async ({ page }) => {
  await open(page);
  await page.locator('[data-menu-button=app]').click();
  await page.getByRole('menuitem', { name: 'Check for Updates…', exact: true }).click();
  await expect(page.getByTestId('library-update-docker')).toContainText('27.5.1 → 27.5.2');
  await expect(page.getByTestId('library-history')).toContainText('No updates recorded yet.');
  await expect(page.getByTestId('library-plan')).toHaveCount(0);
  await page.getByTestId('library-update-docker').getByRole('button', { name: 'Update', exact: true }).click();
  await expect(page.getByTestId('library-update-docker')).toHaveCount(0);
  await page.getByTestId('dock-app-containers').click();
  await page.locator('[data-menu-button=app]').click();
  await page.getByRole('menuitem', { name: 'Check for Updates…', exact: true }).click();
  await expect(page.getByTestId('library-update-docker')).toHaveCount(0);
});
test('Resource views remain reachable on a compact screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  for (const section of ['images', 'volumes', 'networks', 'storage']) {
    await page.getByTestId(`docker-section-${section}`).click();
    await expect(page.getByTestId(`docker-section-${section}`)).toBeInViewport();
    expect(await page.getByTestId('app-containers').evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  }
});

test('Unused images and networks can be removed, while running containers stay protected', async ({ page }) => {
  await open(page);
  await expect(page.getByTestId('app-containers').getByRole('button', { name: 'Remove…', exact: true })).toBeDisabled();
  await page.getByTestId('docker-section-networks').click();
  await page.getByRole('button', { name: 'Create network', exact: true }).click();
  await page.getByLabel('New network name').fill('temporary-net');
  await page.getByTestId('server-app-confirm-ok').click();
  await page.getByRole('button', { name: 'Remove network temporary-net' }).click();
  await page.getByLabel('Resource name to confirm').fill('temporary-net');
  await page.getByTestId('server-app-confirm-ok').click();
  await expect(page.getByRole('button', { name: 'Remove network temporary-net' })).toHaveCount(0);
  await page.getByTestId('docker-section-images').click();
  await page.getByRole('button', { name: 'Remove image 555555555555' }).click();
  await page.getByLabel('Resource name to confirm').fill('555555555555');
  await page.getByTestId('server-app-confirm-ok').click();
  await expect(page.getByRole('button', { name: 'Remove image 555555555555' })).toHaveCount(0);
});

test('Search and refresh stay with their resource lists', async ({ page }) => {
  await open(page);
  const sidebar = page.getByRole('complementary', { name: 'Containers', exact: true });
  await sidebar.getByRole('textbox', { name: 'Search containers' }).fill('archive');
  await expect(sidebar.getByTestId('container-row-archive-job')).toBeVisible();
  await expect(sidebar.getByTestId('container-row-notes-web')).toHaveCount(0);
  await sidebar.getByRole('button', { name: 'Refresh containers' }).click();
  await expect(sidebar.getByRole('textbox')).toHaveValue('archive');
  await page.getByTestId('docker-section-images').click();
  await page.getByRole('textbox', { name: 'Search images' }).fill('nginx');
  await expect(page.getByRole('row').filter({ hasText: 'nginx:stable-alpine' })).toHaveCount(1);
  await expect(page.getByRole('row').filter({ hasText: 'postgres:16-alpine' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Refresh images' }).click();
  await expect(page.getByRole('textbox', { name: 'Search images' })).toHaveValue('nginx');
  await page.getByRole('textbox', { name: 'Search images' }).fill('no-such-image');
  await expect(page.getByText('No matching images.', { exact: true })).toBeVisible();
});
