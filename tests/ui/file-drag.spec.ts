// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test, type Page } from '../offline';

async function open(page: Page) {
  await page.goto('/');
  await page.getByTestId('login-username').fill('demo');
  await page.getByTestId('login-password').fill('demo');
  await page.getByTestId('login-submit').click();
  await page.getByTestId('dock-app-files').click();
  await expect(page.getByTestId('file-row-notes.txt')).toBeVisible();
}

for (const view of ['List', 'Grid']) {
  test(`${view} supports marquee, modifier selection and multi-item folder and Trash drops`, async ({ page }) => {
    await open(page);
    await page.getByTestId('files-view').click();
    await page.getByRole('menuitemradio', { name: view, exact: true }).click();
    const list = page.getByRole('listbox', { name: 'Files', exact: true });
    const first = await page.getByTestId('file-row-backups').boundingBox();
    const bounds = (await list.boundingBox())!;
    await page.mouse.move(bounds.x + 2, bounds.y + bounds.height - 4);
    await page.mouse.down();
    await page.mouse.move(first!.x + first!.width - 2, first!.y + 2, { steps: 8 });
    await expect(page.getByTestId('files-selection-box')).toBeVisible();
    await page.screenshot({ path: `/tmp/lumo-files-marquee-${view.toLowerCase()}.png` });
    await page.mouse.up();
    expect(await list.locator('[aria-selected="true"]').count()).toBeGreaterThan(0);
    await expect(page.getByTestId('files-selection-box')).toHaveCount(0);
    await page.getByTestId('file-row-Pictures').click();
    await page.getByTestId('file-row-notes.txt').click({ modifiers: ['ControlOrMeta'] });
    await expect(list.locator('[aria-selected="true"]')).toHaveCount(2);
    await page.getByTestId('file-row-notes.txt').dragTo(page.getByTestId('file-row-Documents'));
    await expect(page.getByTestId('file-row-notes.txt')).toHaveCount(0);
    await expect(page.getByTestId('file-row-Pictures')).toHaveCount(0);
    await page.getByTestId('file-row-Documents').dblclick();
    await expect(page.getByTestId('file-row-Pictures')).toBeVisible();
    await page.getByTestId('file-row-Pictures').click();
    await page.getByTestId('file-row-notes.txt').click({ modifiers: ['ControlOrMeta'] });
    await page.getByTestId('file-row-notes.txt').dragTo(page.getByTestId('dock-app-trash'));
    await expect(page.getByTestId('file-row-notes.txt')).toHaveCount(0);
    await expect(page.getByTestId('file-row-Pictures')).toHaveCount(0);
    await page.getByTestId('dock-app-trash').click();
    await expect(page.getByTestId('app-trash')).toContainText('notes.txt');
    await expect(page.getByTestId('app-trash')).toContainText('Pictures');
  });
}

test('folder drops refuse collisions and allow moving back through the path bar', async ({ page }) => {
  await open(page);
  await page.getByTestId('file-row-notes.txt').dragTo(page.getByTestId('file-row-Documents'));
  await expect(page.getByTestId('file-row-notes.txt')).toHaveCount(0);
  await page.getByTestId('files-new').click();
  await page.getByRole('menuitem', { name: 'New File', exact: true }).click();
  await page.getByTestId('files-create-name').fill('notes.txt');
  await page.getByTestId('files-create-submit').click();
  await page.getByTestId('file-row-notes.txt').dragTo(page.getByTestId('file-row-Documents'));
  await expect(page.getByTestId('file-row-notes.txt')).toBeVisible();
  await page.getByTestId('notifications-button').click();
  await expect(page.getByTestId('notification-item').first()).toContainText('already exists');
  await page.keyboard.press('Escape');
  await page.getByTestId('file-row-Documents').dblclick();
  await page.getByTestId('file-row-upgrade-plan.txt').dragTo(page.getByTestId('files-absolute-path').getByRole('button', { name: 'user', exact: true }));
  await expect(page.getByTestId('file-row-upgrade-plan.txt')).toHaveCount(0);
  await page.getByTestId('files-location-home').click();
  await expect(page.getByTestId('file-row-upgrade-plan.txt')).toBeVisible();
});

test('Holding a dragged folder over Back opens its parent once and keeps the move active', async ({ page }) => {
  await open(page);
  await page.getByTestId('file-row-Pictures').dragTo(page.getByTestId('file-row-Documents'));
  await page.getByTestId('file-row-Documents').dblclick();
  const folder = (await page.getByTestId('file-row-Pictures').boundingBox())!;
  const back = page.getByTestId('files-back'); const button = (await back.boundingBox())!;
  await page.mouse.move(folder.x + 35, folder.y + folder.height / 2);
  await page.mouse.down();
  await page.mouse.move(folder.x + 48, folder.y + folder.height / 2, { steps: 3 });
  await page.mouse.move(button.x + button.width / 2, button.y + button.height / 2, { steps: 8 });
  await page.mouse.move(button.x + button.width / 2 + 1, button.y + button.height / 2);
  await expect(back).toHaveAttribute('data-drag-navigating', 'true');
  await expect(back).toHaveCSS('animation-iteration-count', '2');
  await expect(page.getByTestId('files-current-folder')).toHaveText('Home');
  await page.waitForTimeout(1200);
  await expect(page.getByTestId('files-current-folder')).toHaveText('Home');
  const list = (await page.getByRole('listbox', { name: 'Files', exact: true }).boundingBox())!;
  await page.mouse.move(list.x + list.width - 15, list.y + list.height - 15, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByTestId('file-row-Pictures')).toBeVisible();
  await page.getByTestId('file-row-Documents').dblclick();
  await expect(page.getByTestId('file-row-Pictures')).toHaveCount(0);
});

test('Back drag navigation cancels on leave and accepts a folder even with no history', async ({ page }) => {
  await open(page);
  const back = page.getByTestId('files-back');
  await expect(back).toBeDisabled();
  const transfer = await page.evaluateHandle(() => new DataTransfer());
  await page.getByTestId('file-row-Pictures').dispatchEvent('dragstart', { dataTransfer: transfer });
  await back.dispatchEvent('dragover', { dataTransfer: transfer });
  await expect(back).toHaveAttribute('data-drag-navigating', 'true');
  await back.dispatchEvent('dragleave', { dataTransfer: transfer });
  await page.waitForTimeout(1100);
  await expect(page.getByTestId('files-current-folder')).toHaveText('Home');
  await expect(back).not.toHaveAttribute('data-drag-navigating', 'true');
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await back.dispatchEvent('dragover', { dataTransfer: transfer });
  await expect(back).toHaveCSS('animation-name', 'none');
  await page.getByTestId('app-files').screenshot({ path: '/tmp/lumo-files-back-hover.png' });
  await expect(page.getByTestId('files-current-folder')).toHaveText('home');
  await page.dispatchEvent('body', 'dragend', { dataTransfer: transfer });
  await expect(back).not.toHaveAttribute('data-drag-navigating', 'true');
});
