// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '../offline';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('login-username').fill('demo');
  await page.getByTestId('login-password').fill('demo');
  await page.getByTestId('login-submit').click();
  await page.getByTestId('dock-app-preview').click();
  await page.getByTestId('preview-open').click();
});

test('Preview picks files in its own dialog, with navigation, filtering and keyboard access', async ({ page }) => {
  const picker = page.getByTestId('file-picker');
  await expect(picker).toBeVisible();
  await expect(page.getByTestId('window-files')).toHaveCount(0);
  await expect(page.getByTestId('file-picker-open')).toBeDisabled();
  await expect(picker.getByRole('searchbox')).toBeFocused();
  await expect(page.getByTestId('file-picker-entry-.bashrc')).toHaveCount(0);
  await picker.getByRole('button', { name: 'Hidden files', exact: true }).click();
  await expect(page.getByTestId('file-picker-entry-.bashrc')).toBeVisible();
  await page.getByTestId('file-picker-entry-Documents').dblclick();
  await picker.getByRole('searchbox').fill('server-notes');
  await expect(picker.getByRole('option')).toHaveCount(1);
  await page.getByTestId('file-picker-entry-server-notes.md').press('Enter');
  await expect(picker).toHaveCount(0);
  await expect(page.getByTestId('preview-rendered')).toContainText('Atlas server notes');
  await expect(page.locator('.window[data-app-id="preview"]')).toHaveCount(1);
  await expect(page.getByTestId('window-files')).toHaveCount(0);
  await page.getByTestId('preview-open').click();
  await expect(picker.getByRole('navigation')).toContainText('Documents');
  await picker.getByRole('button', { name: 'Parent folder' }).click();
  await page.getByTestId('file-picker-entry-notes.txt').click();
  await page.getByTestId('file-picker-open').click();
  await expect(page.getByTestId('editor-input')).toHaveValue(/Remember\ to\ rotate/);
  await expect(page.locator('.window[data-app-id="preview"]')).toHaveCount(1);
});

test('picker cancels without opening apps, traps focus and fits a compact viewport', async ({ page }) => {
  const picker = page.getByTestId('file-picker');
  await picker.getByRole('button', { name: 'Cancel', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(picker.getByRole('button', { name: 'Cancel file selection' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(picker).toHaveCount(0);
  await expect(page.getByTestId('preview-open')).toBeFocused();
  await page.getByTestId('preview-open').click();
  await page.mouse.click(5, 5);
  await expect(picker).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 650 });
  await page.getByTestId('preview-open').click();
  const box = (await picker.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect(box.y + box.height).toBeLessThanOrEqual(650);
  await picker.getByRole('searchbox').fill('no-such-file');
  await expect(picker).toContainText('No matching files.');
  await expect(page.getByTestId('file-picker-open')).toBeDisabled();
  await picker.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByTestId('window-files')).toHaveCount(0);
});

test('opening another file protects the current draft until discard is confirmed', async ({ page }) => {
  await page.getByTestId('file-picker-entry-notes.txt').dblclick();
  await page.getByTestId('editor-input').fill('Unsaved draft');
  const choose = async () => {
    await page.getByTestId('preview-open').click();
    await page.getByTestId('file-picker-entry-Documents').dblclick();
    await page.getByTestId('file-picker-entry-server-notes.md').dblclick();
  };
  await choose();
  await page.getByTestId('preview-unsaved-dialog').getByRole('button', { name: 'Keep editing' }).click();
  await expect(page.getByTestId('editor-input')).toHaveValue('Unsaved draft');
  await choose();
  await page.getByTestId('preview-unsaved-dialog').getByRole('button', { name: 'Discard changes' }).click();
  await expect(page.getByTestId('preview-rendered')).toContainText('Atlas server notes');
  await expect(page.locator('.window[data-app-id="preview"]')).toHaveCount(1);
  await expect(page.getByTestId('window-files')).toHaveCount(0);
});
