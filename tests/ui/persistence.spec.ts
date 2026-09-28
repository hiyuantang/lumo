// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test, type Page } from '../offline';

async function login(page: Page, user = 'demo') {
  await page.getByTestId('login-username').fill(user);
  await page.getByTestId('login-password').fill('demo');
  await page.getByTestId('login-submit').click();
}

async function bounds(page: Page, app: string) {
  const win = page.getByTestId(`window-${app}`);
  await expect(win).toHaveCSS('transform', 'none');
  await win.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished.catch(() => {}))));
  return (await win.boundingBox())!;
}

test('closing Preview clears its document and mode while retaining window placement', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await login(page);
  await page.getByTestId('dock-app-files').click();
  await page.getByTestId('file-row-Documents').dblclick();
  await page.getByTestId('file-row-server-notes.md').dblclick();
  await page.getByTestId('preview-mode-raw').click();
  await bounds(page, 'preview');
  const title = (await page.getByTestId('window-titlebar-preview').boundingBox())!;
  await page.mouse.move(title.x + 300, title.y + 25);
  await page.mouse.down();
  await page.mouse.move(title.x + 390, title.y + 70, { steps: 8 });
  await page.mouse.up();
  const handle = (await page.getByTestId('window-resize-preview-se').boundingBox())!;
  await page.mouse.move(handle.x + 8, handle.y + 8);
  await page.mouse.down();
  await page.mouse.move(handle.x + 75, handle.y + 35, { steps: 8 });
  await page.mouse.up();
  const saved = await bounds(page, 'preview');
  await page.getByTestId('window-close-preview').click();
  await page.reload();
  await expect(page.getByTestId('window-preview')).toHaveCount(0);
  await page.getByTestId('dock-app-preview').click();
  await expect(page.getByTestId('app-preview')).toContainText('Choose a file to preview');
  await expect(page.getByTestId('editor-input')).toHaveCount(0);
  await page.getByTestId('dock-app-files').click();
  await page.getByTestId('file-row-server-notes.md').dblclick();
  await expect(page.getByTestId('preview-mode-rendered')).toHaveAttribute('aria-pressed', 'true');
  expect(await bounds(page, 'preview')).toEqual(saved);
  await page.getByTestId('window-maximize-preview').click();
  await expect(page.getByTestId('window-preview')).toHaveClass(/maximized/);
  await bounds(page, 'preview');
  await expect(page.getByTestId('window-preview')).not.toHaveCSS('border-top-left-radius', '0px');
  await page.getByTestId('window-close-preview').click();
  await page.getByTestId('dock-app-preview').click();
  await expect(page.getByTestId('window-preview')).toHaveClass(/maximized/);
  await page.getByTestId('window-maximize-preview').click();
  expect(await bounds(page, 'preview')).toEqual(saved);
  await page.setViewportSize({ width: 800, height: 650 });
  await page.reload();
  const fitted = await bounds(page, 'preview');
  expect(fitted.x).toBeGreaterThanOrEqual(0);
  expect(fitted.x + fitted.width).toBeLessThanOrEqual(800);
});

test('closing apps resets their views and keeps account preferences separate', async ({ page }) => {
  await page.goto('/');
  await login(page);
  await page.getByTestId('dock-app-files').click();
  await page.getByTestId('file-row-Documents').dblclick();
  await page.getByTestId('file-row-server-notes.md').click();
  await page.getByTestId('files-view').click();
  await page.getByRole('menuitem', { name: 'Show Details', exact: true }).click();
  await page.getByTestId('window-close-files').click();
  await page.getByTestId('dock-app-files').click();
  await expect(page.getByTestId('files-details')).toHaveCount(0);
  await expect(page.getByTestId('files-absolute-path')).toHaveText('/home/user');
  await page.getByTestId('dock-app-home').click();
  await page.getByTestId('monitor-section-services').click();
  await page.getByPlaceholder('Filter services').fill('ssh');
  await page.getByTestId('window-close-home').click();
  await page.getByTestId('dock-app-home').click();
  await page.getByTestId('monitor-section-services').click();
  await expect(page.getByPlaceholder('Filter services')).toHaveValue('');
  await page.getByTestId('dock-app-settings').click();
  await page.getByTestId('settings-section-time').click();
  await page.getByTestId('window-close-settings').click();
  await page.reload();
  await page.getByTestId('dock-app-settings').click();
  await expect(page.getByTestId('settings-section-system')).toHaveAttribute('aria-current', 'page');
  await page.getByTestId('settings-section-system').click();
  await page.getByTestId('logout-button').click();
  await login(page, 'other');
  await expect(page.getByTestId('window-files')).toHaveCount(0);
  await page.getByTestId('dock-app-files').click();
  await expect(page.getByTestId('files-details')).toHaveCount(0);
  await expect(page.getByTestId('files-absolute-path')).toHaveText('/home/user');
  await page.getByTestId('dock-app-settings').click();
  await page.getByTestId('logout-button').click();
  await login(page);
  await expect(page.getByTestId('files-details')).toHaveCount(0);
});

test('minimize preserves the current folder; close resets it and keeps pinned folders and display preferences', async ({ page }) => {
  await page.goto('/');
  await login(page);
  await page.getByTestId('dock-app-files').click();
  await page.getByTestId('files-view').click();
  await page.getByRole('menuitem', { name: 'Show Hidden Files', exact: true }).click();
  await page.getByTestId('file-row-Documents').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Pin Folder', exact: true }).click();
  await page.getByTestId('files-pin-user/Documents').click();
  await page.getByTestId('file-row-server-notes.md').click();
  await page.getByTestId('window-minimize-files').click();
  await page.getByTestId('dock-minimized-files').click();
  await expect(page.getByTestId('files-absolute-path')).toHaveText('/home/user/Documents/server-notes.md');
  await page.getByTestId('window-files').press('Alt+w');
  await page.getByTestId('dock-app-files').click();
  await expect(page.getByTestId('files-absolute-path')).toHaveText('/home/user');
  await expect(page.getByTestId('files-pin-user/Documents')).toBeVisible();
  await expect(page.getByTestId('file-row-.bashrc')).toBeVisible();
});

test('closing Monitor clears navigation from a service into Logs', async ({ page }) => {
  await page.goto('/');
  await login(page);
  await page.getByTestId('dock-app-home').click();
  await page.getByTestId('monitor-section-services').click();
  await page.getByPlaceholder('Filter services').fill('ssh');
  await page.getByRole('button', { name: 'Open logs', exact: true }).click();
  await expect(page.getByTestId('app-logs')).toBeVisible();
  await page.getByTestId('window-close-home').click();
  await page.getByTestId('dock-app-home').click();
  await expect(page.getByTestId('monitor-section-overview')).toHaveAttribute('aria-current', 'page');
  await page.getByTestId('monitor-section-services').click();
  await expect(page.getByPlaceholder('Filter services')).toHaveValue('');
});
