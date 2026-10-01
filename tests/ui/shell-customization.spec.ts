// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test, type Page } from '../offline';

async function login(page: Page) {
  await page.goto('/');
  await page.getByTestId('login-username').fill('demo');
  await page.getByTestId('login-password').fill('demo');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('dock-app-websites')).toBeVisible();
}

const dockOrder = (page: Page) => page.locator('.dock-app[data-app]').evaluateAll((buttons) => buttons.map((button) => button.getAttribute('data-app')));

test('dock supports dragging and keyboard reordering and remembers the order', async ({ page }) => {
  await login(page);
  await page.getByTestId('dock-app-files').dragTo(page.getByTestId('dock-app-home'));
  await expect.poll(() => dockOrder(page)).toEqual(['files', 'home', 'preview', 'terminal', 'git', 'containers', 'websites', 'library', 'skills', 'settings', 'trash']);
  await page.reload();
  await expect(page.locator('.dock-app[data-app]').first()).toHaveAttribute('data-app', 'files');
  await page.getByTestId('dock-app-files').focus();
  await page.keyboard.press('Alt+ArrowRight');
  await expect(page.locator('.dock-app[data-app]').nth(1)).toHaveAttribute('data-app', 'files');
  await expect(page.getByTestId('dock-app-files')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('app-files')).toBeVisible();
});

test('transparent top bar has aligned labels and account controls live in Settings', async ({ page }) => {
  await login(page);
  await page.getByTestId('dock-app-files').click();
  const bar = page.getByTestId('menu-bar');
  await expect(bar).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(bar).toHaveCSS('backdrop-filter', 'none');
  await expect(bar.getByRole('menubar', { name: 'User menu' })).toHaveCount(0);
  const centers = await bar.locator('.menubar-brand, .menubar-host, .menubar-focused, .menubar-button').evaluateAll((items) => items.map((item) => { const box = item.getBoundingClientRect(); return box.y + box.height / 2; }));
  expect(Math.max(...centers) - Math.min(...centers)).toBeLessThan(1);
  await bar.locator('[data-menu-button="file"]').focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'New File', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await page.getByTestId('dock-app-settings').click();
  await expect(page.getByRole('region', { name: 'Account', exact: true })).toContainText('demo');
  await page.getByTestId('logout-button').click();
  await expect(page.getByTestId('login-screen')).toBeVisible();
});

test('notifications fit short lists and scroll long lists above the dock', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 650 });
  await login(page);
  await page.getByTestId('dock-app-settings').click();
  await page.getByTestId('settings-section-updates').click();
  const refresh = page.getByTestId('updates-plan');
  await refresh.click();
  await expect(refresh).toBeEnabled();
  await page.getByTestId('notifications-button').click();
  const panel = page.getByTestId('notification-center');
  const first = await panel.boundingBox();
  expect(first!.height).toBeLessThan(200);
  await page.keyboard.press('Escape');
  for (let index = 0; index < 12; index++) {
    await refresh.press('Enter');
    await expect(refresh).toBeEnabled();
  }
  await page.getByTestId('notifications-button').click();
  await expect(page.getByTestId('notification-item')).toHaveCount(13);
  const list = panel.getByRole('region', { name: 'Notifications', exact: true });
  expect(await list.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  await list.focus();
  await page.keyboard.press('End');
  await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  const bounds = await panel.boundingBox();
  const dock = await page.getByTestId('dock').boundingBox();
  expect(bounds!.y + bounds!.height).toBeLessThan(dock!.y);
  while (await panel.getByTestId('notification-close').count()) { await panel.getByTestId('notification-item').first().hover(); await panel.getByTestId('notification-close').first().click(); }
  await expect(panel).toContainText('No notifications.');
  expect((await panel.boundingBox())!.height).toBeLessThan(200);
});

test('custom dropdowns support keyboard choice and the clock opens notifications on small screens', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await login(page);
  await expect(page.locator('.menubar-host, .menubar-focused, .menubar-icon-button')).toHaveCount(0);
  await page.getByTestId('notifications-button').click();
  await expect(page.getByTestId('notification-center')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByTestId('dock-app-settings').click();
  await page.getByTestId('settings-section-time').click();
  const timezone = page.getByTestId('settings-timezone');
  await timezone.click();
  await expect(page.getByRole('listbox', { name: 'Time zone' })).toBeVisible();
  await expect(page.locator('select')).toHaveCount(0);
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect(timezone).toBeFocused();
  await timezone.click();
  const popup = page.locator('.shell-popup');
  const bounds = await popup.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(360);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(740);
  await page.keyboard.press('Escape');
  await expect(popup).toHaveCount(0);
  await expect(timezone).toBeFocused();
  await timezone.click();
  await timezone.click();
  await expect(popup).toHaveCount(0);
  await page.getByTestId('dock-app-home').click();
  await page.getByTestId('monitor-section-logs').click();
  const boot = page.getByRole('combobox', { name: 'Filter by boot' });
  await boot.click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect(boot).toContainText('Previous boot');
});

test('right-click menus are limited to actionable items and text fields', async ({ page }) => {
  await login(page);
  const menu = page.getByTestId('context-menu');
  await page.locator('main.desktop').click({ button: 'right', position: { x: 1200, y: 400 } });
  await expect(menu.getByRole('menuitem', { name: 'Open Desktop Folder' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByTestId('dock-app-files').click();
  await expect(page.getByTestId('app-files')).toBeVisible();
  const row = page.locator('[data-kind="file"]').first();
  await row.click({ button: 'right' });
  await expect(row).toHaveAttribute('aria-selected', 'true');
  await menu.getByRole('menuitem', { name: 'Open in Preview', exact: true }).click();
  await expect(page.getByTestId('app-preview')).toBeVisible();
  await page.getByTestId('window-close-preview').click();
  await row.click({ button: 'right' });
  await menu.getByRole('menuitem', { name: 'Move to Trash', exact: true }).click();
  await expect(page.getByTestId('delete-confirm')).toBeVisible();
  await page.getByTestId('delete-cancel-button').click();
  await expect(row).toBeVisible();
  await page.getByTestId('window-titlebar-files').click({ button: 'right' });
  await expect(menu).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'Window', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Minimize Window', exact: true }).click();
  await expect(page.getByTestId('window-files')).toBeHidden();
  const dock = page.getByTestId('dock-app-files');
  await dock.click({ button: 'right' });
  const bounds = await menu.boundingBox();
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(720);
  await menu.getByRole('menuitem', { name: 'Restore', exact: true }).click();
  await expect(page.getByTestId('window-files')).toBeVisible();
  await dock.click({ button: 'right' });
  await page.keyboard.press('Escape');
  await expect(dock).toBeFocused();
  await page.getByTestId('dock-app-home').click();
  await page.getByTestId('monitor-section-logs').click();
  const search = page.getByRole('textbox', { name: 'Search logs' });
  await search.fill('example search');
  await search.click({ button: 'right' });
  await menu.getByRole('menuitem', { name: 'Select All', exact: true }).click();
  expect(await search.evaluate((node: HTMLInputElement) => node.value.slice(node.selectionStart!, node.selectionEnd!))).toBe('example search');
});

test('text and terminal context menus preserve editing and clipboard actions', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await login(page);
  await page.getByTestId('dock-app-home').click();
  await page.getByTestId('monitor-section-logs').click();
  const input = page.getByRole('textbox', { name: 'Search logs' });
  const menu = page.getByTestId('context-menu');
  await input.fill('clipboard test');
  await input.click({ button: 'right' });
  await menu.getByRole('menuitem', { name: 'Select All', exact: true }).click();
  await input.click({ button: 'right' });
  await menu.getByRole('menuitem', { name: 'Cut', exact: true }).click();
  await expect(input).toHaveValue('');
  await input.click({ button: 'right' });
  await menu.getByRole('menuitem', { name: 'Paste', exact: true }).click();
  await expect(input).toHaveValue('clipboard test');
  await input.press('ControlOrMeta+z');
  await expect(input).toHaveValue('');
  await page.getByTestId('dock-app-terminal').click();
  await page.getByTestId('terminal-input').click({ button: 'right' });
  await expect(menu.getByRole('menuitem', { name: 'Copy', exact: true })).toBeDisabled();
  await menu.getByRole('menuitem', { name: 'Select All', exact: true }).click();
  await page.getByTestId('terminal-input').click({ button: 'right' });
  await expect(menu.getByRole('menuitem', { name: 'Copy', exact: true })).toBeEnabled();
  await menu.getByRole('menuitem', { name: 'Clear Display', exact: true }).click();
  await expect(page.getByTestId('terminal-input')).toBeFocused();
});

test('desktop folder menu and item menus dismiss on outside clicks', async ({ page }) => {
  await login(page);
  const menu = page.getByTestId('context-menu');
  const desktop = page.locator('main.desktop');
  await desktop.click({ button: 'right', position: { x: 1150, y: 200 } });
  await expect(menu.getByRole('menuitem', { name: 'Folder Settings' })).toBeVisible();
  await desktop.click({ position: { x: 1100, y: 180 } });
  await expect(menu).toHaveCount(0);
  await page.getByTestId('dock-app-files').click();
  const row = page.locator('[data-kind="file"]').first();
  await row.click({ button: 'right' });
  await row.click({ position: { x: 15, y: 5 } });
  await expect(menu).toHaveCount(0);
  const title = page.getByTestId('window-titlebar-files');
  await title.click({ button: 'right' });
  await title.click({ position: { x: 200, y: 8 } });
  await expect(menu).toHaveCount(0);
  const dock = page.getByTestId('dock-app-files');
  await dock.click({ button: 'right' });
  await dock.click();
  await expect(menu).toHaveCount(0);
  await page.getByTestId('dock-app-settings').click();
  await page.getByTestId('settings-section-time').click();
  const select = page.getByTestId('settings-timezone');
  await select.click();
  await page.getByTestId('settings-section-time').click();
  await expect(page.locator('.shell-popup [role="listbox"]')).toHaveCount(0);
  await select.click();
  await select.click();
  await expect(page.locator('.shell-popup [role="listbox"]')).toHaveCount(0);
  await page.getByTestId('notifications-button').click();
  await page.getByTestId('settings-section-network').click();
  await expect(page.getByTestId('settings-section-network')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('notification-center')).toHaveCount(0);
});
