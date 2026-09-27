// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page) {
  await page.goto('/');
  await page.getByTestId('login-username').fill('demo');
  await page.getByTestId('login-password').fill('demo');
  await page.getByTestId('login-submit').click();
}

test('network settings stay in one window and changes require explicit confirmation', async ({ page }) => {
  await signIn(page);
  await expect(page.getByTestId('dock-app-network')).toHaveCount(0);
  await page.getByTestId('dock-app-settings').click();
  await page.getByTestId('settings-section-network').click();
  const network = page.getByTestId('app-network');
  await expect(network).toBeVisible();
  await expect(page.getByTestId('window-settings').getByTestId('app-network')).toBeVisible();
  await expect(page.getByTestId('window-network')).toHaveCount(0);
  await expect(page.getByTestId('settings-open-updates')).toHaveCount(0);
  await expect(page.getByTestId('settings-open-services')).toHaveCount(0);
  await expect(network.getByTestId('network-interface-eth0')).toContainText('Connected');
  await network.getByTestId('network-mode-dhcp').click();
  await network.getByTestId('network-apply').click();
  await expect(page.getByTestId('network-confirm-dialog')).toContainText('within 90 seconds');
  await page.getByTestId('network-confirm-apply').click();

  await expect(network.getByTestId('network-pending')).toContainText('Automatic rollback');
  await page.getByTestId('settings-section-system').click();
  await page.getByTestId('settings-section-network').click();
  await expect(network.getByTestId('network-pending')).toBeVisible();
  await network.getByTestId('network-keep').click();
  await expect(network.getByTestId('network-pending')).toHaveCount(0);
  await expect(page.getByTestId('notifications-badge')).toHaveText('2');
});

test('Command Center opens Network inside Settings and keeps drafts across sections', async ({ page }) => {
  await signIn(page);
  await page.keyboard.press('Control+k');
  await page.getByLabel('Search actions').fill('network');
  const command = page.getByRole('option', { name: /Open Network Settings/ });
  await expect(command).toHaveCount(1);
  await command.click();
  await expect(page.getByTestId('app-network')).toBeVisible();
  await page.getByTestId('network-mode-static').click();
  await page.getByLabel('Address and prefix').fill('192.0.2.20/24');
  await page.getByLabel('Default gateway').fill('192.0.2.1');
  await page.getByLabel('DNS server').fill('1.1.1.1');
  await page.getByTestId('settings-section-time').click();
  await page.keyboard.press('Control+k');
  await page.getByLabel('Search actions').fill('network');
  await command.click();
  await expect(page.getByLabel('Address and prefix')).toHaveValue('192.0.2.20/24');
  await expect(page.getByLabel('Default gateway')).toHaveValue('192.0.2.1');
  await expect(page.getByLabel('DNS server')).toHaveValue('1.1.1.1');
  await expect(page.getByTestId('window-settings')).toHaveCount(1);
  await expect(page.getByTestId('window-network')).toHaveCount(0);
  await page.getByTestId('network-apply').click();
  await page.getByTestId('network-confirm-apply').click();
  await expect(page.getByTestId('network-pending')).toBeVisible();
  await page.getByTestId('settings-section-system').click();
  await page.getByTestId('window-close-settings').click();
  await page.getByTestId('dock-app-settings').click();
  await expect(page.getByTestId('network-pending')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('network-pending')).toBeVisible();
  await page.getByTestId('network-keep').click();
  await expect(page.getByTestId('network-pending')).toHaveCount(0);
});

test('previous Network windows migrate into the existing Settings window', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const window = { x: 100, y: 70, w: 840, h: 610, z: 2, minimized: false, maximized: false, snapped: null, restore: null };
    localStorage.setItem('lumo.windows.v1', JSON.stringify({ windows: { settings: { ...window, appId: 'settings', minimized: true }, network: { ...window, appId: 'network', z: 3 } }, focused: 'network', zTop: 3 }));
  });
  await signIn(page);
  await expect(page.getByTestId('window-settings')).toHaveCount(1);
  await expect(page.getByTestId('window-settings')).toBeVisible();
  await expect(page.getByTestId('window-network')).toHaveCount(0);
  await expect(page.getByTestId('app-network')).toBeVisible();
  await expect(page.getByTestId('dock-app-network')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Network settings fit a compact window with accessible inputs and confirmation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await page.getByTestId('dock-app-settings').click();
  await page.getByRole('button', { name: 'Network', exact: true }).click();
  await page.getByTestId('network-mode-static').click();
  await page.getByLabel('Address and prefix').fill('192.0.2.20/24');
  await page.getByLabel('DNS server').fill('1.1.1.1');
  const overflow = await page.getByTestId('app-settings').evaluate((element) => element.scrollWidth > element.clientWidth || [...element.querySelectorAll('.settings-content, .settings-network')].some((child) => child.scrollWidth > child.clientWidth));
  expect(overflow).toBe(false);
  await page.getByTestId('network-apply').click();
  await expect(page.getByTestId('network-confirm-dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByTestId('network-confirm-dialog')).toHaveCount(0);
  await expect(page.getByLabel('Address and prefix')).toHaveValue('192.0.2.20/24');
});
