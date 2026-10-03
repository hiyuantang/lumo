// SPDX-License-Identifier: AGPL-3.0-only
import { nativeAppRoute } from './native-app-fixture';
import { expect, test } from '../offline';

test('individual folders move, remove to Trash, and can be added after restoring', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByTestId('login-username').fill('demo');
  await page.getByTestId('login-password').fill('demo');
  await page.getByTestId('login-submit').click();
  await page.getByTestId('dock-app-files').click();
  await page.getByTestId('dock-app-settings').click();
  await page.getByTestId('settings-section-folders').click();
  const location = page.getByTestId('settings-folder-path-documents');
  await expect(location).toHaveText('/home/user');
  await location.click();
  await expect(page.getByRole('option', { name: '/data', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await location.click();
  await page.getByRole('option', { name: 'Choose another folder…' }).click();
  const picker = page.getByTestId('file-picker');
  await picker.getByRole('button', { name: 'Filesystem root' }).click();
  await picker.getByTestId('file-picker-entry-tmp').click();
  await picker.getByTestId('file-picker-open').click();
  await expect(location).toHaveText('/tmp');
  await page.getByTestId('settings-folder-apply-documents').click();
  await expect(page.getByTestId('settings-folder-apply-documents')).toBeDisabled();
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    const widths = await page.locator('.settings-folder-controls > .custom-select').evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().width));
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(1);
    await page.screenshot({ path: `/tmp/lumo-settings-folders-individual-${theme}.png` });
  }
  await page.getByTestId('dock-app-files').click();
  await page.getByTestId('files-location-documents').click();
  await expect(page.getByTestId('files-absolute-path')).toContainText('tmp');
  await expect(page.getByTestId('file-row-server-notes.md')).toBeVisible();
  await page.getByTestId('files-location-pictures').click();
  await expect(page.getByTestId('files-absolute-path')).toContainText('home/user/Pictures');
  await expect(page.getByTestId('file-row-rack-photo.jpg')).toBeVisible();
  await expect(page.getByTestId('files-location-videos')).toHaveCount(0);
  await page.getByTestId('dock-app-settings').click();
  await page.getByTestId('settings-folder-remove-documents').click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByTestId('settings-folder-remove-documents')).toBeVisible();
  await page.getByTestId('settings-folder-remove-documents').click();
  await page.getByTestId('settings-folder-remove-confirm').click();
  await expect(page.getByTestId('settings-folder-documents')).toContainText('Not added');
  await page.getByTestId('dock-app-files').click();
  await expect(page.getByTestId('files-location-documents')).toHaveCount(0);
  await page.getByTestId('files-location-trash').click();
  const trashed = page.getByTestId('app-files').getByRole('option').filter({ hasText: '/tmp/Documents' });
  await expect(trashed).toBeVisible();
  await trashed.click();
  await page.getByTestId('app-files').getByRole('button', { name: 'Restore', exact: true }).click();
  await page.getByTestId('dock-app-settings').click();
  await location.click();
  await page.getByRole('option', { name: 'Choose another folder…' }).click();
  await picker.getByRole('button', { name: 'Filesystem root' }).click();
  await picker.getByTestId('file-picker-entry-tmp').click();
  await picker.getByTestId('file-picker-open').click();
  await page.getByTestId('settings-folder-apply-documents').click();
  await expect(page.getByTestId('settings-folder-remove-documents')).toBeVisible();
  await page.getByTestId('dock-app-files').click();
  await page.getByTestId('files-location-documents').click();
  await expect(page.getByTestId('file-row-server-notes.md')).toBeVisible();
  await page.getByTestId('dock-app-settings').click();
  await page.setViewportSize({ width: 390, height: 844 });
  const narrowWidths = await page.locator('.settings-folder-controls > .custom-select').evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().width));
  expect(Math.max(...narrowWidths) - Math.min(...narrowWidths)).toBeLessThan(1);
  await page.screenshot({ path: '/tmp/lumo-settings-folders-individual-narrow.png' });
  const controls = page.getByTestId('settings-folder-documents').locator('.settings-folder-controls');
  const controlsBounds = (await controls.boundingBox())!;
  const actionsBounds = (await controls.locator('.settings-folder-row-actions').boundingBox())!;
  expect(actionsBounds.x + actionsBounds.width).toBeCloseTo(controlsBounds.x + controlsBounds.width, 0);
  expect(await page.getByTestId('app-settings').evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(false);
  expect(errors).toEqual([]);
});

test('folder conflicts block Apply without issuing any mutation', async ({ page }) => {
  const mutations: string[] = [];
  await page.routeWebSocket(/\/api\/v1\/ws/, () => {});
  await page.route('**/api/v1/**', async (route) => {
    if (await nativeAppRoute(route)) return;
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== 'GET') mutations.push(path);
    if (path.endsWith('/files/locations/plan')) return route.fulfill({ status: 400, json: { ok: false, error: { code: 'validation_failed', message: 'notes.txt already exists. Nothing was moved.', details: {} } } });
    const data = path.endsWith('/auth/session') ? { user: { name: 'demo', uid: 1000, gid: 1000, home: '/home/demo' } }
      : path.endsWith('/apps') ? { canInstall: false, apps: [] }
      : path.endsWith('/system/settings') ? { timezone: 'Etc/UTC', serverTime: '2026-09-27T12:00:00Z', revision: 'r1', runtimeHostname: 'test', canEdit: true, available: true, ntpSynchronized: true }
      : path.endsWith('/system/timezones') ? { timezones: ['Etc/UTC'] }
      : path.endsWith('/system/identity') ? { hostname: 'test', os: { prettyName: 'Ubuntu' }, architecture: 'x86_64' }
      : path.endsWith('/files/locations/settings') ? { revision: 'r1', locations: [{ id: 'documents', name: 'Documents', path: '/home/demo/Documents', defaultPath: '/home/demo/Documents', exists: true, enabled: true }], choices: [{ id: 'home', name: 'Home', path: '/home/demo' }, { id: 'data', name: 'Data storage', path: '/data' }] } : {};
    return route.fulfill({ json: { ok: true, data } });
  });
  await page.goto('http://localhost:5200');
  await page.getByTestId('dock-app-settings').click();
  await page.getByTestId('settings-section-folders').click();
  await page.getByTestId('settings-folder-path-documents').click();
  await page.getByRole('option', { name: '/data' }).click();
  await expect(page.getByRole('alert')).toContainText('Nothing was moved');
  await expect(page.getByTestId('settings-folder-apply-documents')).toBeDisabled();
  expect(mutations).toEqual([]);
});

test('Add creates only the requested missing folder', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('login-username').fill('demo');
  await page.getByTestId('login-password').fill('demo');
  await page.getByTestId('login-submit').click();
  await page.getByTestId('dock-app-settings').click();
  await page.getByTestId('settings-section-folders').click();
  await expect(page.getByTestId('settings-folder-download')).toContainText('Not added');
  await page.getByTestId('settings-folder-apply-download').click();
  await expect(page.getByTestId('settings-folder-remove-download')).toBeVisible();
  await expect(page.getByTestId('settings-folder-videos')).toContainText('Not added');
  await page.getByTestId('dock-app-files').click();
  await expect(page.getByTestId('file-row-Downloads')).toBeVisible();
  await expect(page.getByTestId('file-row-Videos')).toHaveCount(0);
  await expect(page.getByTestId('files-location-download')).toBeVisible();
  await page.getByTestId('files-location-documents').click();
  await expect(page.getByTestId('file-row-server-notes.md')).toBeVisible();
});
