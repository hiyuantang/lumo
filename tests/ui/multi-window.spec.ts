// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test, type Page } from '@playwright/test';

const previews = (page: Page) => page.locator('.window[data-app-id="preview"]');

async function newPreview(page: Page) {
  await page.getByTestId('dock-app-preview').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'New Window', exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.getByTestId('login-username').fill('demo');
  await page.getByTestId('login-password').fill('demo');
  await page.getByTestId('login-submit').click();
});

test('Preview windows keep separate documents and drafts, with individual Dock destinations', async ({ page }) => {
  await page.getByTestId('dock-app-files').click();
  await page.getByTestId('file-row-notes.txt').dblclick();
  const first = page.getByTestId('window-preview');
  await first.getByTestId('preview-edit').click();
  await first.getByTestId('editor-input').fill('First window draft');
  await page.getByTestId('dock-app-files').click();
  await page.getByTestId('files-view').click();
  await page.getByRole('menuitem', { name: 'Show Hidden Files', exact: true }).click();
  await page.getByTestId('file-row-.bashrc').dblclick();
  await expect(previews(page)).toHaveCount(2);
  const second = previews(page).last();
  const secondId = await second.getAttribute('data-window-id');
  await second.getByTestId('preview-edit').click();
  await second.getByTestId('editor-input').fill('Second window draft');
  await second.getByRole('button', { name: 'Minimize Preview', exact: true }).click();
  await page.getByTestId('dock-app-preview').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'notes.txt — Preview', exact: true }).click();
  await first.getByRole('button', { name: 'Minimize Preview', exact: true }).click();
  await expect(page.locator('.dock-window')).toHaveCount(2);
  await expect(page.getByTestId('dock-app-preview')).toHaveCount(1);
  const divider = (await page.getByTestId('dock-divider').boundingBox())!;
  const tray = (await page.locator('.dock-tray').boundingBox())!;
  const apps = (await page.locator('.dock-apps').boundingBox())!;
  const windows = (await page.getByTestId('dock-windows').boundingBox())!;
  expect(divider.x).toBeGreaterThan(apps.x + apps.width);
  expect(windows.x).toBeGreaterThan(divider.x);
  expect(divider.y - tray.y).toBeGreaterThan(8);
  expect(tray.y + tray.height - divider.y - divider.height).toBeGreaterThan(8);
  await page.screenshot({ path: '/tmp/lumo-window-dock.png' });
  await page.getByTestId(`dock-minimized-${secondId}`).click();
  await expect(second.getByTestId('editor-input')).toHaveValue('Second window draft');
  await expect(first).toBeHidden();
  await page.getByTestId('dock-minimized-preview').click();
  await expect(first.getByTestId('editor-input')).toHaveValue('First window draft');
  await expect(page.getByTestId('dock-divider')).toHaveCount(1);
  await page.getByTestId('dock-app-files').click();
  await page.getByTestId('file-row-notes.txt').dblclick();
  await expect(previews(page)).toHaveCount(2);
  await expect(first).toHaveClass(/focused/);
  await expect(first.getByTestId('editor-input')).toHaveValue('First window draft');
  await newPreview(page);
  await expect(previews(page)).toHaveCount(3);
  await expect(previews(page).last()).toContainText('Choose a file to preview');
});

test('each Preview placement and Markdown mode survives reload', async ({ page }) => {
  await page.getByTestId('dock-app-files').click();
  await page.getByTestId('file-row-Documents').dblclick();
  await page.getByTestId('file-row-server-notes.md').dblclick();
  const first = page.getByTestId('window-preview');
  await first.getByTestId('preview-mode-raw').click();
  await first.getByRole('button', { name: 'Maximize Preview', exact: true }).click();
  await first.getByRole('button', { name: 'Minimize Preview', exact: true }).click();
  await newPreview(page);
  const second = previews(page).last();
  const id = await second.getAttribute('data-window-id');
  await expect(second).toHaveCSS('transform', 'none');
  const bounds = await second.boundingBox();
  await page.reload();
  await expect(previews(page)).toHaveCount(2);
  await expect(first).toBeHidden();
  await expect(page.getByTestId(`window-${id}`)).toBeVisible();
  expect(await page.getByTestId(`window-${id}`).boundingBox()).toEqual(bounds);
  await page.getByTestId('dock-minimized-preview').click();
  await expect(first).toHaveAttribute('data-window-placement', 'maximized');
  await expect(first.getByTestId('preview-mode-raw')).toHaveAttribute('aria-pressed', 'true');
  await first.getByRole('button', { name: 'Close Preview', exact: true }).click();
  await expect(previews(page)).toHaveCount(1);
  await expect(page.getByTestId(`window-${id}`)).toBeVisible();
});

test('many minimized windows scroll within the Dock on compact screens', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (let index = 0; index < 6; index++) {
    await newPreview(page);
    await previews(page).last().getByRole('button', { name: 'Minimize Preview', exact: true }).click();
  }
  await expect(page.locator('.dock-window')).toHaveCount(6);
  const tray = (await page.locator('.dock-tray').boundingBox())!;
  expect(tray.x).toBeGreaterThanOrEqual(0);
  expect(tray.x + tray.width).toBeLessThanOrEqual(390);
  expect(await page.getByTestId('dock-windows').evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  await page.locator('.dock-apps button').last().focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.dock-window').first()).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('window-preview')).toBeVisible();
});

test('signing out checks unsaved changes in every Preview window', async ({ page }) => {
  await page.getByTestId('dock-app-files').click();
  await page.getByTestId('file-row-notes.txt').dblclick();
  const first = page.getByTestId('window-preview');
  await first.getByTestId('preview-edit').click();
  await first.getByTestId('editor-input').fill('First draft');
  await page.getByTestId('dock-app-files').click();
  await page.getByTestId('files-view').click();
  await page.getByRole('menuitem', { name: 'Show Hidden Files', exact: true }).click();
  await page.getByTestId('file-row-.bashrc').dblclick();
  const second = previews(page).last();
  await second.getByTestId('preview-edit').click();
  await second.getByTestId('editor-input').fill('Second draft');
  await page.getByTestId('dock-app-settings').click();
  await page.getByTestId('logout-button').click();
  await expect(first.getByTestId('preview-unsaved-dialog')).toBeVisible();
  await first.getByRole('button', { name: 'Discard changes' }).click();
  await expect(second.getByTestId('preview-unsaved-dialog')).toBeVisible();
  await second.getByRole('button', { name: 'Keep editing' }).click();
  await expect(second.getByTestId('editor-input')).toHaveValue('Second draft');
  await expect(page.getByTestId('login-submit')).toHaveCount(0);
});
