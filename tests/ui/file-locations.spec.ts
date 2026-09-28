// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '../offline';

test('existing standard folders navigate, accept drops, and stay distinct from pins', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('login-username').fill('demo');
  await page.getByTestId('login-password').fill('demo');
  await page.getByTestId('login-submit').click();
  await page.getByTestId('dock-app-files').click();
  const docs = page.getByTestId('files-location-documents');
  await expect(docs).toBeVisible();
  await expect(page.getByTestId('files-location-pictures')).toBeVisible();
  await expect(page.getByTestId('files-location-download')).toHaveCount(0);
  await page.getByTestId('file-row-notes.txt').dragTo(docs);
  await expect(page.getByTestId('file-row-notes.txt')).toHaveCount(0);
  await docs.click();
  await expect(docs).toHaveAttribute('aria-current', 'location');
  await expect(page.getByTestId('file-row-notes.txt')).toBeVisible();
  await docs.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Pin Folder', exact: true }).click();
  const pin = page.getByTestId('files-pin-user/Documents');
  await expect(pin).toBeVisible();
  await expect(docs).toHaveCount(0);
  await pin.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Unpin Folder', exact: true }).click();
  await expect(docs).toBeVisible();
  await expect(pin).toHaveCount(0);
  await page.getByTestId('files-location-home').click();
  await page.getByTestId('file-row-Pictures').dragTo(page.getByTestId('files-location-trash'));
  await expect(page.getByTestId('files-location-pictures')).toHaveCount(0);
  await page.getByTestId('files-sidebar-toggle').click();
  await expect(docs).toHaveAttribute('title', /Documents.*\/home\/user\/Documents/);
  await docs.click();
  await expect(page.getByTestId('files-current-folder')).toHaveText('Documents');
});

test('live locations use custom absolute paths and tolerate servers with no standard folders', async ({ page }) => {
  let available = true;
  const paths: string[] = [];
  const mutations: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.routeWebSocket(/\/api\/v1\/ws/, () => {});
  await page.route('**/api/v1/**', (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== 'GET') mutations.push(url.pathname);
    if (url.pathname.endsWith('/files/list')) paths.push(url.searchParams.get('path')!);
    const data = url.pathname.endsWith('/auth/session') ? { user: { name: 'demo', uid: 1000, gid: 1000, home: '/home/demo' } }
      : url.pathname.endsWith('/system/identity') ? { hostname: 'test', os: { prettyName: 'Ubuntu' }, user: { home: '/home/demo' } }
      : url.pathname.endsWith('/apps') ? { canInstall: false, apps: [] }
      : url.pathname.endsWith('/files/locations') ? { locations: available ? [{ id: 'documents', name: 'Documents', path: '/srv/文档 shared' }] : [] }
      : url.pathname.endsWith('/files/list') ? { path: url.searchParams.get('path'), entries: [] } : {};
    return route.fulfill({ json: { ok: true, data } });
  });
  await page.goto('http://localhost:5200');
  await page.getByTestId('dock-app-files').click();
  await page.getByTestId('files-location-documents').click();
  await expect.poll(() => paths.at(-1)).toBe('/srv/文档 shared');
  await expect(page.getByTestId('files-current-folder')).toHaveText('文档 shared');
  available = false;
  await page.reload();
  await expect(page.getByTestId('files-location-home')).toBeVisible();
  await expect(page.getByTestId('files-location-trash')).toBeVisible();
  await expect(page.getByTestId('files-location-documents')).toHaveCount(0);
  expect(mutations).toEqual([]);
  expect(errors).toEqual([]);
});
