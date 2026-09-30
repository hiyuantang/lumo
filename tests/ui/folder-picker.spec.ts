// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '../offline';
import { piPage } from './pi-fixture';

test('Folder chooser creates and selects a folder, cancels drafts and toggles hidden folders with eye icons', async ({ page }) => {
  const fixture = await piPage(page);
  const created: string[] = [];
  await page.route('**/api/v1/files/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/create')) {
      const body = route.request().postDataJSON(); expect(body.kind).toBe('directory');
      created.push(body.path);
      return route.fulfill({ json: { ok: true, data: {} } });
    }
    const path = url.searchParams.get('path') || '/home/user';
    return route.fulfill({ json: { ok: true, data: { path, entries: ['Projects', '.secret', ...created.map((path) => path.split('/').at(-1)!)].map((name) => ({ name, type: 'directory', sizeBytes: 0, modifiedAt: '', mode: 493 })) } } });
  });
  await page.goto('http://localhost:5200'); await page.getByTestId('dock-app-pi').click();
  await expect(page.getByTestId('pi-prompt')).toBeEnabled();
  await page.getByTestId('pi-project').click(); await page.getByRole('option', { name: 'Choose another folder…' }).click();
  const picker = page.getByTestId('file-picker');
  const hidden = page.getByTestId('file-picker-hidden');
  await expect(hidden).toHaveAttribute('title', 'Show hidden files');
  await expect(hidden.locator('svg')).toHaveCount(1); await expect(hidden).toHaveText('');
  await expect(page.getByTestId('file-picker-entry-.secret')).toHaveCount(0);
  await hidden.click(); await expect(hidden).toHaveAttribute('aria-pressed', 'true');
  await expect(hidden).toHaveAttribute('title', 'Hide hidden files');
  await expect(hidden.locator('circle')).toHaveCount(1);
  await expect(page.getByTestId('file-picker-entry-.secret')).toBeVisible();
  await hidden.click(); await expect(page.getByTestId('file-picker-entry-.secret')).toHaveCount(0);
  const start = page.getByTestId('file-picker-new-folder');
  await start.click(); const name = picker.getByLabel('New folder name');
  await expect(name).toBeFocused(); await name.fill('Cancelled draft');
  await picker.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(picker).toBeVisible(); await expect(start).toBeFocused(); expect(created).toEqual([]);
  await start.click(); await name.fill('Also cancelled'); await name.press('Escape');
  await expect(picker).toBeVisible(); await expect(start).toBeFocused(); expect(created).toEqual([]);
  await start.click(); await name.fill('../invalid'); await name.press('Enter');
  await expect(picker.getByRole('alert')).toContainText('without slashes'); expect(created).toEqual([]);
  await name.fill('New project');
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      await expect(page.getByTestId('file-picker-create')).toBeVisible();
      expect(await picker.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
      await picker.screenshot({ path: `/tmp/lumo-folder-create-${width}-${colorScheme}.png` });
    }
  }
  await page.getByTestId('file-picker-create').click();
  await expect(page.getByTestId('file-picker-entry-New project')).toHaveAttribute('aria-selected', 'true');
  expect(created).toEqual(['/home/user/New project']);
  await expect(page.getByTestId('file-picker-open')).toBeEnabled(); await page.getByTestId('file-picker-open').click();
  await expect(picker).toHaveCount(0);
  await expect.poll(() => fixture.starts.at(-1)?.project).toBe('/home/user/New project');
});

test('Failed folder creation retains the name and pending creation blocks duplicate requests', async ({ page }) => {
  await piPage(page);
  let release!: () => void; let calls = 0;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/v1/files/**', async (route) => {
    if (new URL(route.request().url()).pathname.endsWith('/create')) {
      calls++; await gate;
      return route.fulfill({ status: 409, json: { ok: false, error: { code: 'conflict', message: 'A file or folder with this name already exists.' } } });
    }
    return route.fulfill({ json: { ok: true, data: { path: '/home/user', entries: [] } } });
  });
  await page.goto('http://localhost:5200'); await page.getByTestId('dock-app-pi').click();
  await expect(page.getByTestId('pi-prompt')).toBeEnabled();
  await page.getByTestId('pi-project').click(); await page.getByRole('option', { name: 'Choose another folder…' }).click();
  await page.getByTestId('file-picker-new-folder').click();
  const picker = page.getByTestId('file-picker'); const name = picker.getByLabel('New folder name');
  await name.fill('Existing'); await name.press('Enter');
  try {
    await expect.poll(() => calls).toBe(1); await expect(name).toBeDisabled();
    await expect(picker.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape'); await expect(picker).toBeVisible();
    await expect(page.getByTestId('file-picker-create')).toBeDisabled();
  } finally { release(); }
  await expect(picker.getByRole('alert')).toContainText('already exists');
  await expect(name).toHaveValue('Existing'); await expect(name).toBeEnabled();
  await picker.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(picker).toBeVisible(); expect(calls).toBe(1);
});
