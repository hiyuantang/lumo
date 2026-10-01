// SPDX-License-Identifier: AGPL-3.0-only
import { clickPreviewTool } from '../preview-tools';
import { test, expect, type Page } from '../offline';

async function login(page: Page) {
  await page.goto('/');
  await page.getByTestId('login-username').fill('demo');
  await page.getByTestId('login-password').fill('demo');
  await page.getByTestId('login-submit').click();
  await expect(page.getByRole('main', { name: 'Desktop', exact: true })).toBeVisible();
}
async function menu(page: Page, id: string) { await page.locator(`[data-menu-button="${id}"]`).click(); }

for (const width of [1440, 390]) {
  test(`app menus follow focus, default to Files and fit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await login(page);
    await page.getByTestId('dock-app-home').click();
    await menu(page, 'window');
    await page.getByTestId('menu-show-desktop').click();
    await expect(page.locator('[data-menu-button=app]')).toHaveText('Files');
    await expect(page.locator('[data-menu-button=app]')).toHaveCSS('font-weight', '700');
    await expect(page.locator('.menubar-menus > .menubar-menu')).toHaveCount(5);
    await menu(page, 'file');
    await expect(page.getByTestId('menu-save')).toBeDisabled();
    await page.keyboard.press('Escape');
    await page.getByTestId('dock-app-files').click();
    await menu(page, 'file');
    await page.getByTestId('menu-new-file').click();
    await expect(page.getByTestId('files-create-dialog')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByTestId('file-row-Documents').dblclick();
    await page.getByTestId('file-row-server-notes.md').dblclick();
    await expect(page.locator('[data-menu-button=app]')).toHaveText('Preview');
    await menu(page, 'app');
    await expect(page.getByTestId('preview-autosave')).toHaveAttribute('aria-checked', 'false');
    await page.getByTestId('menu-settings').hover();
    await page.screenshot({ path: `/tmp/lumo-preview-app-menu-${width}.png`, animations: 'disabled' });
    await page.keyboard.press('Escape');
    await menu(page, 'window');
    const box = await page.locator('[data-menu=window]').boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `/tmp/lumo-window-menu-${width}.png`, animations: 'disabled' });
    await page.keyboard.press('Escape');
    await page.getByTestId('dock-app-home').click();
    await expect(page.locator('[data-menu-button=app]')).toHaveText('Monitor');
    if (width > 700) {
      await page.getByRole('main', { name: 'Desktop', exact: true }).click({ position: { x: 4, y: 60 } });
      await expect(page.locator('[data-menu-button=app]')).toHaveText('Files');
      await page.getByTestId('dock-app-home').click();
    }
    await menu(page, 'app');
    await expect(page.getByTestId('preview-autosave')).toHaveCount(0);
    await page.getByTestId('menu-quit').click();
    await expect(page.getByTestId('window-home')).toHaveCount(0);
  });
}

test('Edit menu preserves selection and supports native undo, redo and clipboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await login(page);
  await page.getByTestId('dock-app-files').click();
  await page.getByTestId('file-row-notes.txt').dblclick();
  const input = page.getByTestId('editor-input');
  await input.fill('Original');
  await input.press('End');
  await input.pressSequentially(' additions');
  await page.locator('[data-menu-button=edit]').focus();
  await page.keyboard.press('ArrowDown');
  await page.getByTestId('menu-undo').click();
  await expect(input).not.toHaveValue('Original additions');
  await menu(page, 'edit');
  await page.getByTestId('menu-redo').click();
  await expect(input).toHaveValue('Original additions');
  await menu(page, 'edit');
  await page.getByTestId('menu-select-all').click();
  await menu(page, 'edit');
  await page.getByTestId('menu-copy').click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('Original additions');
  await menu(page, 'edit');
  await page.getByTestId('menu-cut').click();
  await expect(input).toHaveValue('');
  await menu(page, 'edit');
  await page.getByTestId('menu-paste').click();
  await expect(input).toHaveValue('Original additions');
  await menu(page, 'file');
  await page.getByTestId('menu-save').click();
  await expect(page.getByTestId('preview-save-status')).toHaveText('Saved');
  await page.getByTestId('dock-app-home').click();
  await menu(page, 'edit');
  await expect(page.getByTestId('menu-cut')).toBeDisabled();
  await expect(page.getByTestId('menu-paste')).toBeDisabled();
});

test('Quit Preview checks every draft and cancellation leaves all windows open', async ({ page }) => {
  await login(page);
  await page.getByTestId('dock-app-files').click();
  await page.getByTestId('file-row-notes.txt').dblclick();
  await page.getByTestId('editor-input').fill('Draft one');
  await page.getByTestId('dock-app-files').click();
  await page.getByTestId('file-row-Documents').dblclick();
  await page.getByTestId('file-row-server-notes.md').dblclick();
  await clickPreviewTool(page.locator('.window[data-app-id=preview]').last(), 'preview-mode-raw');
  await page.locator('.window[data-app-id=preview]').last().getByTestId('editor-input').fill('# Draft two');
  await menu(page, 'app');
  await page.getByTestId('menu-quit').click();
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(page.locator('.window[data-app-id=preview]')).toHaveCount(2);
  await expect(page.getByTestId('window-preview').getByTestId('editor-input')).toHaveValue('Draft one');
  await menu(page, 'app');
  await page.getByTestId('menu-quit').click();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.locator('.window[data-app-id=preview]')).toHaveCount(0);
});

test('Auto-save preference follows Preview across already open windows', async ({ page }) => {
  await login(page);
  await page.getByTestId('dock-app-files').click();
  await page.getByTestId('file-row-notes.txt').dblclick();
  await page.getByTestId('dock-app-files').click();
  await page.getByTestId('file-row-Documents').dblclick();
  await page.getByTestId('file-row-server-notes.md').dblclick();
  await menu(page, 'app');
  await page.getByTestId('preview-autosave').click();
  await menu(page, 'window');
  await page.getByRole('menuitemcheckbox', { name: 'notes.txt — Preview', exact: true }).click();
  await menu(page, 'app');
  await expect(page.getByTestId('preview-autosave')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('preview-autosave').click();
  await menu(page, 'window');
  await page.getByRole('menuitemcheckbox', { name: 'server-notes.md — Preview', exact: true }).click();
  await menu(page, 'app');
  await expect(page.getByTestId('preview-autosave')).toHaveAttribute('aria-checked', 'false');
});

test('outside clicks dismiss the menu and reach the active app, dock and wallpaper', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  await page.getByTestId('dock-app-files').click();
  const dropdown = page.getByRole('menu', { name: 'Window', exact: true });
  await menu(page, 'window');
  await page.getByTestId('file-row-notes.txt').click();
  await expect(dropdown).toHaveCount(0);
  await expect(page.getByTestId('file-row-notes.txt')).toHaveAttribute('aria-selected', 'true');
  await menu(page, 'window');
  await page.getByTestId('files-view').click();
  await page.getByRole('menuitem', { name: 'Show Details', exact: true }).click();
  await expect(dropdown).toHaveCount(0);
  await expect(page.getByTestId('files-details')).toBeVisible();
  await menu(page, 'window');
  await page.getByTestId('window-files').locator('.window-titlebar').click({ position: { x: 400, y: 18 } });
  await expect(dropdown).toHaveCount(0);
  await menu(page, 'window');
  await page.getByTestId('dock-app-files').click();
  await expect(dropdown).toHaveCount(0);
  await expect(page.getByTestId('window-files')).toBeVisible();
  await menu(page, 'window');
  await page.getByRole('main', { name: 'Desktop', exact: true }).click({ position: { x: 4, y: 60 } });
  await expect(dropdown).toHaveCount(0);
  await menu(page, 'window');
  await page.getByTestId('notifications-button').click();
  await expect(dropdown).toHaveCount(0);
  await expect(page.getByTestId('notifications-button')).toHaveAttribute('aria-expanded', 'true');
});

test('touch outside a menu dismisses it without swallowing the app action', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 800, height: 650 }, hasTouch: true });
  const page = await context.newPage();
  try {
    await login(page);
    await page.getByTestId('dock-app-files').tap();
    await page.locator('[data-menu-button=window]').tap();
    await expect(page.getByRole('menu', { name: 'Window', exact: true })).toBeVisible();
    await page.getByTestId('file-row-notes.txt').tap();
    await expect(page.getByRole('menu', { name: 'Window', exact: true })).toHaveCount(0);
    await expect(page.getByTestId('file-row-notes.txt')).toHaveAttribute('aria-selected', 'true');
  } finally {
    await context.close();
  }
});
