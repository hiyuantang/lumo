// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '../offline';

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
  await expect(files.getByTestId('files-current-folder')).toContainText('Documents');
  await expect(files.getByTestId('files-pin-user/Documents')).toHaveAttribute('aria-current', 'location');
  await page.reload();
  await expect(files.getByTestId('files-pin-user/Documents')).toHaveAttribute('aria-current', 'location');
  await files.getByTestId('files-pin-user/Documents').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Unpin Folder', exact: true }).click();
  await expect(files.getByTestId('files-pin-user/Documents')).toHaveCount(0);
  await files.getByTestId('files-location-home').click();

  await files.getByTestId('file-row-notes.txt').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Details', exact: true }).click();
  await expect(files.getByTestId('files-details')).toContainText('218 B');
  await files.getByRole('button', { name: 'Close Details', exact: true }).click();
  await files.getByTestId('file-row-notes.txt').click({ button: 'right' });
  await expect(page.getByTestId('context-menu').getByRole('menuitem', { name: 'Edit', exact: true })).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'Open in Preview', exact: true }).click();
  await expect(page.getByTestId('editor-input')).toHaveValue(/Remember\ to\ rotate/);

  const input = page.getByTestId('editor-input');
  await expect(input).toHaveValue(/Remember to rotate/);
  await input.fill('Updated notes from the mock test\n');
  await page.getByTestId('editor-save').click();
  await expect(page.getByTestId('editor-save')).toBeDisabled();

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

for (const width of [1440, 390]) {
  test(`Files dropdowns stay anchored and support keyboard navigation at ${width}px`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await page.getByTestId('login-username').fill('demo');
    await page.getByTestId('login-password').fill('demo');
    await page.getByTestId('login-submit').click();
    await page.getByTestId('dock-app-files').click();
    const trigger = page.getByTestId('files-new');
    await trigger.click();
    await page.keyboard.press('Escape');
    await trigger.focus();
    await trigger.press('ArrowDown');
    const menu = page.getByTestId('files-new-menu');
    await expect(menu).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'New Folder', exact: true })).toBeFocused();
    const buttonBox = (await trigger.boundingBox())!;
    const popup = (await menu.locator('..').boundingBox())!;
    expect(popup.y).toBeGreaterThanOrEqual(buttonBox.y + buttonBox.height);
    expect(popup.y - buttonBox.y - buttonBox.height).toBeLessThan(8);
    expect(popup.x).toBeGreaterThanOrEqual(0);
    expect(popup.x + popup.width).toBeLessThanOrEqual(width);
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitem', { name: 'New File', exact: true })).toBeFocused();
    await page.screenshot({ path: `/tmp/lumo-files-dropdown-${width}.png`, animations: 'disabled' });
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await trigger.click();
    await trigger.click();
    await expect(menu).toHaveCount(0);
    await page.getByTestId('files-view').click();
    await page.getByRole('menuitem', { name: 'Show Hidden Files', exact: true }).click();
    await expect(page.getByTestId('file-row-.bashrc')).toBeVisible();
    await page.getByTestId('files-view').click();
    await page.getByTestId('files-absolute-path').getByRole('button', { name: 'user', exact: true }).click();
    await expect(page.getByTestId('files-view-menu')).toHaveCount(0);
  });
}

for (const width of [1440, 390]) {
  test(`Files grid and sorting preserve navigation and preferences at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await page.getByTestId('login-username').fill('demo');
    await page.getByTestId('login-password').fill('demo');
    await page.getByTestId('login-submit').click();
    await page.getByTestId('dock-app-files').click();
    const choose = async (name: string) => {
      await page.getByTestId('files-view').click();
      await page.getByTestId('files-view-menu').getByRole('menuitemradio', { name, exact: true }).click();
    };
    await choose('Grid');
    const area = page.getByTestId('files-table-scroll');
    await expect(area).toHaveAttribute('data-view', 'grid');
    await expect(area.locator('.file-size')).toHaveCount(0);
    expect(await area.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.getByTestId('file-row-Documents').dblclick();
    const rows = page.getByRole('listbox', { name: 'Files', exact: true }).getByRole('option');
    const names = () => rows.evaluateAll((elements) => elements.map((element) => element.getAttribute('data-file-row')));
    await expect.poll(names).toEqual(['invoice-june.pdf', 'server-notes.md', 'upgrade-plan.txt']);
    await choose('Sort by Type');
    await expect.poll(names).toEqual(['server-notes.md', 'invoice-june.pdf', 'upgrade-plan.txt']);
    await choose('Descending');
    await expect.poll(names).toEqual(['upgrade-plan.txt', 'invoice-june.pdf', 'server-notes.md']);
    await page.reload();
    await expect.poll(names).toEqual(['upgrade-plan.txt', 'invoice-june.pdf', 'server-notes.md']);
    await choose('List');
    await expect(area.locator('.file-size')).toHaveCount(0);
    await expect(area.locator('.files-head')).not.toContainText('Size');
    await expect.poll(names).toEqual(['upgrade-plan.txt', 'invoice-june.pdf', 'server-notes.md']);
    await choose('Grid');
    await choose('Ascending');
    await choose('Sort by Size');
    await expect.poll(names).toEqual(['upgrade-plan.txt', 'server-notes.md', 'invoice-june.pdf']);
    await choose('Sort by Modified Date');
    await expect.poll(names).toEqual(['invoice-june.pdf', 'upgrade-plan.txt', 'server-notes.md']);
    await choose('Descending');
    await expect.poll(names).toEqual(['server-notes.md', 'upgrade-plan.txt', 'invoice-june.pdf']);
    await page.getByTestId('file-row-server-notes.md').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('file-row-upgrade-plan.txt')).toBeFocused();
    await expect(page.getByTestId('files-absolute-path')).toHaveText('/home/user/Documents/upgrade-plan.txt');
    await page.reload();
    await expect(area).toHaveAttribute('data-view', 'grid');
    await expect.poll(names).toEqual(['server-notes.md', 'upgrade-plan.txt', 'invoice-june.pdf']);
    await page.getByTestId('files-view').click();
    await expect(page.getByTestId('files-view-menu').getByRole('menuitemradio', { name: 'Grid', exact: true })).toBeChecked();
    await expect(page.getByTestId('files-view-menu').getByRole('menuitemradio', { name: 'Descending', exact: true })).toBeChecked();
    await page.keyboard.press('Escape');
    await page.screenshot({ path: `/tmp/lumo-files-grid-${width}.png`, animations: 'disabled' });
    await choose('List');
    await expect(area).toHaveAttribute('data-view', 'list');
    await expect.poll(names).toEqual(['server-notes.md', 'upgrade-plan.txt', 'invoice-june.pdf']);
    await page.getByTestId('file-row-server-notes.md').dblclick();
    await expect(page.getByTestId('app-preview')).toContainText('Atlas server notes');
  });
}


for (const width of [1440, 390]) {
  test(`Files back and forward navigate folders, breadcrumbs and Trash at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await page.getByTestId('login-username').fill('demo');
    await page.getByTestId('login-password').fill('demo');
    await page.getByTestId('login-submit').click();
    await page.getByTestId('dock-app-files').click();
    const back = page.getByTestId('files-back');
    const forward = page.getByTestId('files-forward');
    const title = page.getByTestId('files-current-folder');
    await expect(back).toBeDisabled();
    await expect(forward).toBeDisabled();
    await page.getByTestId('file-row-Documents').dblclick();
    await expect(title).toHaveText('Documents');
    await expect(title).not.toContainText('Home');
    await back.click();
    await expect(title).toHaveText('Home');
    await expect(back).toBeDisabled();
    await forward.click();
    await expect(page.getByTestId('file-row-server-notes.md')).toBeVisible();
    await expect(forward).toBeDisabled();
    await page.getByTestId('files-absolute-path').getByRole('button', { name: 'user', exact: true }).click();
    await back.click();
    await expect(title).toHaveText('Documents');
    await page.getByTestId('app-files').press('Alt+ArrowRight');
    await expect(title).toHaveText('Home');
    await page.getByTestId('files-location-trash').click();
    await expect(title).toHaveText('Trash');
    await back.click();
    await expect(title).toHaveText('Home');
    await forward.click();
    await expect(title).toHaveText('Trash');
    await back.click();
    await page.getByTestId('file-row-Pictures').dblclick();
    await expect(title).toHaveText('Pictures');
    await expect(forward).toBeDisabled();
    await expect(page.getByTestId('file-row-rack-photo.jpg')).toBeVisible();
    expect((await back.boundingBox())!.x).toBeLessThan((await title.boundingBox())!.x);
    await page.screenshot({ path: `/tmp/lumo-files-history-${width}.png`, animations: 'disabled' });
  });
}
