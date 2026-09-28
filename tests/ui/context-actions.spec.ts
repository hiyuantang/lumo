// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test, type Page } from '../offline';

async function login(page: Page) {
  await page.goto('/');
  await page.getByTestId('login-username').fill('demo');
  await page.getByTestId('login-password').fill('demo');
  await page.getByTestId('login-submit').click();
}

for (const width of [1440, 390]) {
  test(`common menus and empty surfaces stay focused at ${width}px`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 900 });
    await login(page);
    await expect(page).toHaveTitle(/Lumo/);
    await page.getByTestId('dock-app-settings').click({ button: 'right' });
    await expect(page.getByTestId('context-menu')).toHaveCount(0);
    await page.locator('[data-menu-button=app]').click();
    await page.getByRole('menuitem', { name: 'System Settings…', exact: true }).click();
    await page.getByTestId('settings-section-appearance').click();
    await page.getByRole('heading', { name: 'Theme', exact: true }).click({ button: 'right' });
    await expect(page.getByTestId('context-menu')).toHaveCount(0);
    await page.getByRole('menuitem', { name: 'Window', exact: true }).click();
    const menu = page.locator('[data-menu="window"]');
    await expect(menu).not.toContainText(/Theme|Motion/);
    await expect(menu.getByRole('menuitem', { name: 'Minimize Window', exact: true })).toBeEnabled();
    await page.screenshot({ path: `/tmp/lumo-common-menu-${width}.png`, animations: 'disabled' });
    await menu.getByRole('menuitem', { name: 'Show Desktop', exact: true }).click();
    await expect(page.getByTestId('window-settings')).toBeHidden();
    await page.getByRole('menuitem', { name: 'Window', exact: true }).click();
    await expect(menu.getByRole('menuitem', { name: 'Show Desktop', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(page.locator('vite-error-overlay')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test('file and Preview menus act on the clicked document', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await login(page);
  await page.getByTestId('dock-app-files').click();
  const row = page.getByTestId('file-row-notes.txt');
  const menu = page.getByTestId('context-menu');
  await row.click({ button: 'right' });
  await expect(menu).not.toContainText(/Minimize|Maximize|Tile/);
  await page.screenshot({ path: '/tmp/lumo-file-actions.png', animations: 'disabled' });
  await menu.getByRole('menuitem', { name: 'Copy Path', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('/home/user/notes.txt');
  await row.dblclick();
  await page.getByTestId('editor-input').click({ button: 'right' });
  await menu.getByRole('menuitem', { name: 'Select All', exact: true }).click();
  await expect(page.getByTestId('editor-input')).toBeVisible();
});

test('terminal tab menus close the clicked background session only', async ({ page }) => {
  await login(page);
  await page.getByTestId('dock-app-terminal').click();
  await page.getByTestId('terminal-input').fill('echo KEEP_SESSION');
  await page.getByTestId('terminal-input').press('Enter');
  const firstId = (await page.getByRole('tab').first().getAttribute('data-testid'))!;
  await page.getByRole('tab').first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'New Tab', exact: true }).click();
  const secondId = (await page.getByRole('tab').last().getAttribute('data-testid'))!;
  await page.getByTestId(firstId).locator('.terminal-tab-label').click();
  await page.getByTestId(secondId).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Close Tab', exact: true }).click();
  await expect(page.getByRole('tab')).toHaveCount(1);
  await expect(page.getByTestId(firstId)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.terminal-pane:not(.hidden)')).toContainText('KEEP_SESSION');
});

test('service menus preserve stop confirmation and log menus target their unit', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await login(page);
  await page.getByTestId('dock-app-home').click();
  await page.getByTestId('monitor-section-services').click();
  const row = page.locator('.service-row').filter({ has: page.locator('.state-active') }).first();
  const unit = (await row.locator('.service-name').textContent())!;
  await row.click({ button: 'right' });
  const menu = page.getByTestId('context-menu');
  await expect(menu.getByRole('menuitem', { name: 'Start', exact: true })).toHaveCount(0);
  await menu.getByRole('menuitem', { name: 'Stop', exact: true }).click();
  await expect(page.getByTestId('service-confirm')).toContainText(unit);
  await page.getByTestId('service-confirm-cancel').click();
  await expect(row).toContainText('active');
  await page.getByTestId('monitor-section-logs').click();
  const line = page.getByTestId('logs-row').first();
  const message = (await line.locator('.logs-message').textContent())!;
  const logUnit = (await line.locator('.logs-unit-name').textContent())!;
  await line.click({ button: 'right' });
  await menu.getByRole('menuitem', { name: 'Copy Message', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(message);
  await line.click({ button: 'right' });
  await menu.getByRole('menuitem', { name: 'Filter to This Unit', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Filter by unit' })).toHaveAttribute('value', logUnit);
});

test('skill menus open the clicked skill for editing in Preview', async ({ page }) => {
  await login(page);
  await page.getByTestId('dock-app-skills').click();
  const skill = page.getByRole('navigation', { name: 'Installed skills' }).getByRole('button').last();
  await skill.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Edit in Preview', exact: true }).click();
  await expect(page.getByTestId('app-preview').locator('.preview-path > span').first()).toHaveText('/home/user/.agents/skills/project-guide/SKILL.md');
  await expect(page.getByTestId('editor-input')).toHaveValue(/name: project-guide/);
  await expect(page.getByTestId('app-skills').getByRole('heading', { name: 'Server health', exact: true })).toBeVisible();
});
