// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '@playwright/test';

test('files interface: navigation, editor and delete confirmation', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('login-username').fill('demo');
  await page.getByTestId('login-password').fill('demo');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('menu-bar')).toBeVisible();

  await page.getByTestId('dock-app-files').click();
  const files = page.getByTestId('app-files');

  await files.getByTestId('file-row-Documents').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Pin Folder', exact: true }).click();
  await files.getByTestId('files-pin-user/Documents').click();
  await expect(files.getByRole('navigation', { name: 'Path' })).toContainText('Documents');
  await expect(files.getByTestId('files-pin-user/Documents')).toHaveAttribute('aria-current', 'location');
  await page.reload();
  await expect(files.getByTestId('files-pin-user/Documents')).toHaveAttribute('aria-current', 'location');
  await files.getByTestId('files-pin-user/Documents').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Unpin Folder', exact: true }).click();
  await expect(files.getByTestId('files-pin-user/Documents')).toHaveCount(0);
  await files.getByTestId('files-location-home').click();

  await files.getByTestId('file-row-notes.txt').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();

  const input = page.getByTestId('editor-input');
  await expect(input).toHaveValue(/Remember to rotate/);
  await input.fill('Updated notes from the mock test\n');
  await page.getByTestId('editor-save').click();
  await expect(page.getByTestId('file-editor')).toHaveCount(0);

  await page.getByTestId('dock-app-files').click();
  await files.getByTestId('file-row-notes.txt').dblclick();
  await expect(page.getByTestId('app-preview')).toContainText('Updated notes from the mock test');

  await page.getByTestId('dock-app-files').click();
  await files.getByTestId('file-row-notes.txt').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Move to Trash', exact: true }).click();
  await expect(page.getByTestId('delete-confirm')).toBeVisible();
  await page.getByTestId('delete-confirm-button').click();
  await expect(page.getByTestId('delete-confirm')).toHaveCount(0);
  await expect(files.getByTestId('file-row-notes.txt')).toHaveCount(0);
});
