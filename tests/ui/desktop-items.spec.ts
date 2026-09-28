// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '../offline';

test('Desktop reflects Files changes and supports opening, folder navigation and Trash drops', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByTestId('login-username').fill('demo');
  await page.getByTestId('login-password').fill('demo');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('desktop-items').getByRole('option')).toHaveCount(0);
  await page.getByTestId('dock-app-files').click();
  await page.getByTestId('file-row-notes.txt').dragTo(page.getByTestId('desktop-items'), { targetPosition: { x: 4, y: 890 } });
  await expect(page.getByTestId('file-row-notes.txt')).toBeVisible();
  await expect(page.getByTestId('desktop-item-notes.txt')).toHaveCount(0);
  await page.getByRole('button', { name: 'Close Files', exact: true }).click();
  await page.getByTestId('dock-app-settings').click();
  await page.getByTestId('settings-section-folders').click();
  await page.getByTestId('settings-folder-path-desktop').click();
  await page.getByRole('option', { name: '/data', exact: true }).click();
  await page.getByTestId('settings-folder-apply-desktop').click();
  await expect(page.getByTestId('settings-folder-remove-desktop')).toBeVisible();
  await page.getByRole('button', { name: 'Close Settings', exact: true }).click();
  await page.getByTestId('dock-app-files').click();
  await page.getByTestId('file-row-notes.txt').dragTo(page.getByTestId('desktop-items'), { targetPosition: { x: 1436, y: 500 } });
  const note = page.getByTestId('desktop-item-notes.txt');
  await expect(note).toBeVisible();
  await note.dblclick();
  await expect(page.getByTestId('editor-input')).toHaveValue(/Remember to rotate/);
  await page.getByRole('button', { name: 'Close Preview', exact: true }).click();
  await page.getByTestId('dock-app-files').click();
  await page.getByTestId('files-location-desktop').click();
  await expect(page.getByTestId('files-absolute-path')).toContainText('/data/Desktop');
  await page.getByTestId('files-new').click();
  await page.getByRole('menuitem', { name: 'New Folder', exact: true }).click();
  await page.getByTestId('files-create-name').fill('Project');
  await page.getByTestId('files-create-submit').click();
  const folder = page.getByTestId('desktop-item-Project');
  await expect(folder).toBeVisible();
  await page.getByRole('button', { name: 'Close Files', exact: true }).click();
  await folder.dblclick();
  await expect(page.getByTestId('files-current-folder')).toHaveText('Project');
  await expect(page.getByTestId('files-absolute-path')).toContainText('Desktop');
  await page.getByRole('button', { name: 'Close Files', exact: true }).click();
  await note.dragTo(folder);
  await expect(note).toHaveCount(0);
  await folder.dblclick();
  await expect(page.getByTestId('file-row-notes.txt')).toBeVisible();
  await page.getByTestId('file-row-notes.txt').dragTo(page.getByTestId('desktop-items'), { targetPosition: { x: 4, y: 890 } });
  await expect(note).toBeVisible();
  await expect(page.getByTestId('file-row-notes.txt')).toHaveCount(0);
  await page.getByRole('button', { name: 'Close Files', exact: true }).click();
  const first = (await folder.boundingBox())!;
  const last = (await note.boundingBox())!;
  await page.mouse.move(first.x - 8, first.y + 1);
  await page.mouse.down();
  await page.mouse.move(last.x + last.width - 1, last.y + last.height - 1, { steps: 8 });
  await expect(page.getByTestId('desktop-selection-box')).toBeVisible();
  await expect(page.getByTestId('desktop-items').locator('[aria-selected="true"]')).toHaveCount(2);
  await page.screenshot({ path: '/tmp/lumo-desktop-marquee.png' });
  await page.mouse.up();
  await expect(page.getByTestId('desktop-selection-box')).toHaveCount(0);
  await note.dragTo(page.getByTestId('dock-app-trash'));
  await expect(note).toHaveCount(0);
  await expect(folder).toHaveCount(0);
  await page.getByTestId('dock-app-trash').click();
  await expect(page.getByTestId('app-trash')).toContainText('notes.txt');
  await expect(page.getByTestId('app-trash')).toContainText('Project');
  expect(errors).toEqual([]);
});

test('Desktop uses configured paths and fills down from the top right before adding columns left', async ({ page }) => {
  let desktopPath = '/srv/custom desktop';
  let names = ['00 Projects', ...Array.from({ length: 11 }, (_, i) => `Notes ${i + 1}.txt`), '.hidden'];
  const listed: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.routeWebSocket(/\/api\/v1\/ws/, () => {});
  await page.route('**/api/v1/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/files/list')) listed.push(url.searchParams.get('path')!);
    const data = url.pathname.endsWith('/auth/session') ? { user: { name: 'demo', uid: 1000, gid: 1000, home: '/home/demo' } }
      : url.pathname.endsWith('/apps') ? { canInstall: false, apps: [] }
      : url.pathname.endsWith('/system/identity') ? { hostname: 'test', os: { prettyName: 'Ubuntu' }, user: { home: '/home/demo' } }
      : url.pathname.endsWith('/files/locations') ? { locations: [{ id: 'desktop', name: 'Desktop', path: desktopPath }] }
      : url.pathname.endsWith('/files/list') ? { path: url.searchParams.get('path'), entries: names.map((name) => ({ name, type: name === '00 Projects' ? 'directory' : 'file', sizeBytes: 10, mode: '0644', modifiedAt: '2026-09-27T12:00:00Z' })) } : {};
    return route.fulfill({ json: { ok: true, data } });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('http://localhost:5200');
  const grid = page.getByTestId('desktop-items');
  await expect(grid.getByRole('option')).toHaveCount(12);
  expect(listed).toContain('/srv/custom desktop');
  await expect(page.getByTestId('desktop-item-.hidden')).toHaveCount(0);
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const items = await grid.getByRole('option').all();
      const boxes = await Promise.all(items.map((item) => item.boundingBox()));
      const first = boxes[0]!;
      expect(first.x + first.width).toBeGreaterThan(width - 30);
      expect(first.y).toBeGreaterThanOrEqual(32);
      expect(boxes[1]!.x).toBe(first.x);
      expect(boxes[1]!.y).toBeGreaterThan(first.y);
      const nextColumn = boxes.find((box) => box!.x < first.x)!;
      expect(nextColumn.y).toBe(first.y);
      const dock = await page.getByTestId('dock').boundingBox();
      for (const box of boxes) expect(box!.y + box!.height).toBeLessThan(dock!.y);
      await page.screenshot({ path: `/tmp/lumo-desktop-items-${theme}-${width}.png` });
    }
  }
  await page.getByTestId('desktop-item-00 Projects').focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('desktop-item-Notes 1.txt')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('app-preview')).toBeVisible();
  await page.getByRole('button', { name: 'Close Preview', exact: true }).click();
  desktopPath = '/srv/relocated desktop';
  names = ['New file.txt'];
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByTestId('desktop-item-New file.txt')).toBeVisible();
  await expect(grid.getByRole('option')).toHaveCount(1);
  expect(listed).toContain('/srv/relocated desktop');
  expect(errors).toEqual([]);
});
