// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test, type Page, type Locator } from '../offline';
import { piPage } from './pi-fixture';

async function highlighted(rows: Locator, active?: Locator) {
  await expect.poll(() => rows.evaluateAll((nodes) => nodes.filter((node) => getComputedStyle(node).backgroundColor !== 'rgba(0, 0, 0, 0)').length)).toBe(active ? 1 : 0);
  if (active) await expect(active).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
}
async function trailingCheck(row: Locator, selector = '.dropdown-menu-check') {
  const check = await row.locator(selector).boundingBox();
  const bounds = await row.boundingBox();
  const label = await row.locator(':scope > :first-child').boundingBox();
  expect(check).not.toBeNull();
  expect(check!.x).toBeGreaterThanOrEqual(label!.x + label!.width);
  expect(bounds!.x + bounds!.width - check!.x - check!.width).toBeLessThanOrEqual(12);
}
async function login(page: Page) {
  await page.goto('/');
  await page.getByTestId('login-username').fill('demo'); await page.getByTestId('login-password').fill('demo'); await page.getByTestId('login-submit').click();
}

for (const width of [1440, 390]) test(`Pi context unit menus have one active highlight at ${width}px`, async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  await piPage(page); await page.setViewportSize({ width, height: 900 });
  await page.goto('http://localhost:5200'); await page.getByTestId('dock-app-pi').click();
  await page.route('**/api/v1/pi/compaction**', (route) => route.fulfill({ json: { ok: true, data: { enabled: true, customized: false, reserveTokens: 16384, keepRecentTokens: 20000, defaultReserveTokens: 16384, defaultKeepRecentTokens: 20000, revision: 'test', usageBudget: { mode: 'percent', value: 80 } } } }));
  await page.getByTestId('pi-settings-button').click(); await page.getByRole('tab', { name: 'Context & compaction', exact: true }).click();
  const trigger = page.getByRole('combobox', { name: 'Context budget unit' });
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await trigger.click();
    const rows = page.getByRole('option'); const selected = rows.nth(0); const other = rows.nth(1);
    await highlighted(rows); await expect(selected).toHaveAttribute('aria-selected', 'true');
    await expect(selected.locator('.dropdown-menu-check')).toHaveText('✓');
    await trailingCheck(selected);
    await other.hover(); await highlighted(rows, other);
    await expect(selected).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await page.screenshot({ path: `/tmp/lumo-menu-compaction-${width}-${theme}.png` });
    await page.keyboard.press('ArrowUp'); await highlighted(rows, selected);
    await expect(other).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await other.hover({ position: { x: 10, y: 10 } }); await highlighted(rows, other);
    await page.mouse.move(1, 1); await highlighted(rows);
    await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
    await expect(trigger).toContainText('Tokens');
    await trigger.click(); await page.getByRole('option', { name: 'Percentage', exact: true }).click();
    await expect(trigger).toContainText('Percentage');
    await trigger.press('ArrowDown');
    await highlighted(rows, rows.nth(0));
    await page.keyboard.press('Escape');
  }
  expect(errors).toEqual([]);
});

test('Files dropdowns, context menus and the menu bar share one input highlight', async ({ page }) => {
  await login(page); await page.getByTestId('dock-app-files').click();
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.getByTestId('files-view').click();
    const dropdown = page.getByTestId('files-view-menu'); const checked = dropdown.locator('[aria-checked=true]').first();
    await trailingCheck(checked);
    await dropdown.getByRole('menuitemradio', { name: 'Grid', exact: true }).hover();
    await highlighted(dropdown.locator('.popup-item'), dropdown.getByRole('menuitemradio', { name: 'Grid', exact: true }));
    await expect(checked).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await page.keyboard.press('End'); await highlighted(dropdown.locator('.popup-item'), dropdown.locator(':focus'));
    await page.keyboard.press('Escape');
    await page.locator('[data-menu-button=window]').click();
    await trailingCheck(page.locator('[data-menu=window] [aria-checked=true]'), '.menubar-check');
    await page.keyboard.press('Escape');
    await page.getByTestId('file-row-Documents').click({ button: 'right' });
    const context = page.getByTestId('context-menu'); const last = context.getByRole('menuitem').last();
    await last.hover(); await highlighted(context.locator('.popup-item'), last);
    await page.keyboard.press('Home'); await highlighted(context.locator('.popup-item'), context.locator(':focus'));
    await page.keyboard.press('Escape');
    await page.locator('[data-menu-button=view]').click();
    const menu = page.locator('[data-menu=view]');
    await menu.locator('button:not(:disabled)').last().hover();
    await highlighted(menu.locator('.popup-item'), menu.locator('button:not(:disabled)').last());
    await page.keyboard.press('Home'); await highlighted(menu.locator('.popup-item'), menu.locator(':focus'));
    await page.screenshot({ path: `/tmp/lumo-menu-bar-${theme}.png` });
    await page.keyboard.press('Escape');
  }
});

test('Settings motion and searchable selectors follow pointer and keyboard navigation', async ({ page }) => {
  await login(page); await page.getByTestId('dock-app-settings').click();
  await page.getByTestId('settings-section-appearance').click(); await page.getByTestId('settings-motion').click();
  const rows = page.getByRole('option');
  await rows.nth(1).hover(); await highlighted(rows, rows.nth(1));
  await page.keyboard.press('ArrowUp'); await highlighted(rows, rows.nth(0));
  await page.keyboard.press('Escape');
  await page.getByTestId('settings-section-time').click(); await page.getByTestId('settings-timezone').click();
  await page.getByRole('textbox', { name: 'Search options' }).fill('America');
  await rows.nth(1).hover(); await highlighted(rows, rows.nth(1));
  await page.keyboard.press('ArrowUp'); await highlighted(rows, rows.nth(0));
  await page.keyboard.press('Escape');
});

test('Pi model choices use checkmarks and the shared highlight colors', async ({ page }) => {
  await piPage(page); await page.goto('http://localhost:5200'); await page.getByTestId('dock-app-pi').click();
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.getByTestId('pi-model').click(); await page.getByRole('button', { name: 'Choose model', exact: true }).click();
    const rows = page.getByRole('option');
    await rows.nth(1).hover(); await highlighted(rows, rows.nth(1));
    await expect(rows.nth(0)).toHaveAttribute('aria-selected', 'true');
    await trailingCheck(rows.nth(0), '.pi-model-check');
    await expect(rows.nth(0)).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await page.keyboard.press('End'); await highlighted(rows, rows.nth(1));
    await page.keyboard.press('Home'); await highlighted(rows, rows.nth(0));
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  }
});
