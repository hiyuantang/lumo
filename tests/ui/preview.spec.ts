// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test, type Page } from '@playwright/test';

async function login(page: Page) {
  await page.goto('/');
  await page.getByTestId('login-username').fill('demo');
  await page.getByTestId('login-password').fill('demo');
  await page.getByTestId('login-submit').click();
  await page.getByTestId('dock-app-files').click();
}

test('Files separates metadata, Preview and management actions', async ({ page }) => {
  await login(page);
  await expect(page.getByTestId('files-absolute-path')).toHaveText('/home/user');
  const file = page.getByTestId('file-row-notes.txt');
  await file.click();
  await expect(page.getByTestId('files-absolute-path')).toHaveText('/home/user/notes.txt');
  await page.getByTestId('files-view').click();
  await page.getByRole('menuitem', { name: 'Show Details', exact: true }).click();
  const details = page.getByTestId('files-details');
  await expect(details).toContainText('notes.txt');
  await expect(details).not.toContainText('Remember to rotate');
  await expect(details.getByRole('button', { name: 'Move to Trash' })).toHaveCount(0);
  const side = await details.boundingBox();
  const list = await page.getByTestId('files-table-scroll').boundingBox();
  expect(side!.x).toBeGreaterThanOrEqual(list!.x + list!.width - 1);
  await expect(page.getByTestId('files-sidebar')).toBeVisible();
  await file.dblclick();
  await expect(page.getByTestId('window-preview')).toBeVisible();
  await expect(page.getByTestId('editor-input')).toHaveValue(/Remember\ to\ rotate/);
  await page.getByTestId('window-close-preview').click();
  await page.getByRole('button', { name: 'Close Details', exact: true }).click();
  await page.getByTestId('file-row-Documents').dblclick();
  await page.getByTestId('file-row-server-notes.md').dblclick();
  await expect(page.getByTestId('preview-rendered').getByRole('heading', { name: 'Atlas server notes' })).toBeVisible();
  await page.getByTestId('preview-mode-raw').click();
  await expect(page.getByTestId('editor-input')).toHaveValue(/\#\ Atlas\ server\ notes/);
  await page.getByTestId('preview-mode-rendered').click();
  await expect(page.getByTestId('preview-rendered').getByRole('listitem')).toHaveCount(4);
  await page.reload();
  await expect(page.getByTestId('preview-rendered')).toContainText('Atlas server notes');
});

test('creation handles empty files and duplicate names without changing existing content', async ({ page }) => {
  await login(page);
  const create = async (kind: 'New File' | 'New Folder', name: string) => {
    await page.getByTestId('files-new').click();
    await page.getByRole('menuitem', { name: kind, exact: true }).click();
    await page.getByTestId('files-create-name').fill(name);
    await page.getByTestId('files-create-submit').click();
  };
  await create('New Folder', 'Notes');
  await page.getByTestId('file-row-Notes').dblclick();
  await expect(page.getByTestId('files-absolute-path')).toHaveText('/home/user/Notes');
  await create('New File', 'readme.md');
  await page.getByTestId('file-row-readme.md').dblclick();
  await expect(page.getByTestId('preview-rendered')).toBeVisible();
  await page.getByTestId('window-close-preview').click();
  await create('New File', 'readme.md');
  await expect(page.getByTestId('files-create-dialog').getByRole('alert')).toContainText('already exists');
  await page.getByTestId('files-create-dialog').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId('file-row-readme.md')).toHaveCount(1);
});

test('Markdown renders formatting without executing HTML or loading remote images', async ({ page }) => {
  await login(page);
  await page.getByTestId('file-row-Documents').dblclick();
  await page.getByTestId('file-row-server-notes.md').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Open in Preview', exact: true }).click();
  await page.getByTestId('preview-mode-raw').click();
  const text = '# Safe document\n\n**Bold** and *italic* and `code`.\n\n> A quotation\n\n| Name | Value |\n| --- | --- |\n| One | Two |\n\n```html\n<script>alert(1)</script>\n```\n\n<script>alert(2)</script>\n\n[Unsafe](javascript:alert(3))\n\n![Image](https://example.invalid/image.png)';
  await page.getByTestId('editor-input').fill(text);
  await page.getByTestId('editor-save').click();
  await page.getByTestId('dock-app-files').click();
  await page.getByTestId('file-row-server-notes.md').dblclick();
  await page.getByTestId('preview-mode-rendered').click();
  const preview = page.getByTestId('preview-rendered');
  await expect(preview.locator('strong')).toHaveText('Bold');
  await expect(preview.locator('table')).toContainText('One');
  await expect(preview.locator('script, iframe, img')).toHaveCount(0);
  await expect(preview.locator('a[href^="javascript:"]')).toHaveCount(0);
  await expect(preview).toContainText('<script>alert(2)</script>');
});

test('window placement animates and reduced motion settles immediately', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await login(page);
  const win = page.getByTestId('window-files');
  await expect(win).toHaveCSS('transform', 'none');
  const original = await win.boundingBox();
  await page.getByTestId('window-maximize-files').click();
  expect(await win.evaluate((node) => node.getAnimations().some((motion) => motion.playState === 'running'))).toBe(true);
  await win.evaluate((node) => Promise.all(node.getAnimations().map((motion) => motion.finished.catch(() => {}))));
  await expect(win).toHaveCSS('width', '1440px');
  await page.getByTestId('window-maximize-files').click();
  await win.evaluate((node) => Promise.all(node.getAnimations().map((motion) => motion.finished.catch(() => {}))));
  expect((await win.boundingBox())!.width).toBe(original!.width);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('html')).toHaveClass(/motion-reduced/);
  await page.getByTestId('window-maximize-files').click();
  await expect(win).toHaveCSS('width', '1440px');
  expect(await win.evaluate((node) => node.getAnimations().length)).toBe(0);
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'light');
  await page.getByTestId('dock-app-settings').click();
  await page.getByTestId('settings-section-appearance').click();
  await page.getByTestId('settings-theme-dark').click();
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark');
});

test('Preview protects unsaved edits while another file opens in its own window', async ({ page }) => {
  await login(page);
  await page.getByTestId('file-row-notes.txt').dblclick();
  await page.getByTestId('editor-input').fill('Keep my draft');
  await page.getByTestId('window-close-preview').click();
  const prompt = page.getByTestId('preview-unsaved-dialog');
  await expect(prompt).toBeVisible();
  await prompt.getByRole('button', { name: 'Keep editing' }).click();
  await expect(page.getByTestId('editor-input')).toHaveValue('Keep my draft');
  await page.getByTestId('dock-app-files').click();
  await page.getByTestId('files-view').click();
  await page.getByRole('menuitem', { name: 'Show Hidden Files', exact: true }).click();
  await page.getByTestId('file-row-.bashrc').dblclick();
  await expect(page.locator('.window[data-app-id="preview"]')).toHaveCount(2);
  await expect(prompt).toHaveCount(0);
  await expect(page.getByTestId('window-preview').getByTestId('editor-input')).toHaveValue('Keep my draft');
  await page.locator('.window[data-app-id="preview"]').last().getByRole('button', { name: 'Close Preview', exact: true }).click();
  await page.getByTestId('dock-app-preview').click();
  await page.getByTestId('window-preview').press('Alt+w');
  await prompt.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByTestId('window-preview')).toHaveCount(0);
  await page.getByTestId('file-row-notes.txt').dblclick();
  await expect(page.getByTestId('editor-input')).toHaveValue('Keep my draft');
  await page.getByTestId('editor-input').fill('Discard this draft');
  await page.getByTestId('preview-refresh').click();
  await prompt.getByRole('button', { name: 'Discard changes' }).click();
  await expect(page.getByTestId('editor-input')).toHaveValue('Keep my draft');
});

test('Files panels coexist, animate and leave a horizontally scrollable middle column', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 650 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await login(page);
  await expect(page.getByTestId('system-file-button')).toHaveCount(0);
  await page.getByTestId('file-row-notes.txt').click();
  await page.getByTestId('files-view').click();
  await page.getByRole('menuitem', { name: 'Show Details', exact: true }).click();
  const panel = page.getByTestId('files-details-panel');
  await expect(page.getByTestId('files-sidebar')).toBeVisible();
  await expect(page.getByTestId('files-details')).toContainText('notes.txt');
  await panel.evaluate((element) => Promise.all(element.getAnimations().map((motion) => motion.finished.catch(() => {}))));
  expect(await page.getByTestId('files-table-scroll').evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  await page.getByRole('button', { name: 'Close Details' }).click();
  expect(await panel.evaluate((element) => element.getAnimations().some((motion) => motion.playState === 'running'))).toBe(true);
  await expect(page.getByTestId('files-details')).toHaveCount(0);
  await page.getByTestId('files-sidebar-toggle').click();
  await expect(page.getByTestId('files-sidebar')).toHaveClass(/collapsed/);
  await expect(page.getByTestId('files-location-home')).toHaveAccessibleName('Home');
  await page.reload();
  await expect(page.getByTestId('files-sidebar')).toHaveClass(/collapsed/);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('html')).toHaveClass(/motion-reduced/);
  await page.getByTestId('files-view').click();
  await page.getByRole('menuitem', { name: 'Show Details', exact: true }).click();
  expect(await panel.evaluate((element) => element.getAnimations().length)).toBe(0);
  await expect(page.getByTestId('files-sidebar')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId('files-sidebar')).toBeVisible();
  await expect(page.getByTestId('files-details')).toBeVisible();
  expect(await page.getByTestId('files-table-scroll').evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/lumo-compact-panels.png' });
});

test('Markdown switches between rendered draft and editable raw text without losing changes', async ({ page }) => {
  await login(page);
  await page.getByTestId('file-row-Documents').dblclick();
  await page.getByTestId('file-row-server-notes.md').dblclick();
  await page.getByTestId('preview-mode-raw').click();
  await page.getByTestId('editor-input').fill('# Unsaved heading\n\nMy draft');
  await page.getByTestId('preview-mode-rendered').click();
  await expect(page.getByTestId('preview-rendered').getByRole('heading', { name: 'Unsaved heading' })).toBeVisible();
  await expect(page.getByTestId('preview-save-status')).toHaveText('Unsaved changes');
  await page.getByTestId('preview-refresh').click();
  await expect(page.getByTestId('preview-unsaved-dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await page.getByTestId('preview-mode-raw').click();
  await expect(page.getByTestId('editor-input')).toHaveValue('# Unsaved heading\n\nMy draft');
  await page.getByTestId('preview-mode-rendered').click();
  await page.getByTestId('editor-save').click();
  await expect(page.getByTestId('preview-save-status')).toHaveText('Saved');
  await page.getByTestId('preview-refresh').click();
  await expect(page.getByTestId('preview-rendered').getByRole('heading', { name: 'Unsaved heading' })).toBeVisible();
});
