// SPDX-License-Identifier: AGPL-3.0-only
import { nativeAppRoute } from './native-app-fixture';
import { expect, test } from '../offline';

test('updates interface: refresh, review and apply a saved plan', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('login-username').fill('demo');
  await page.getByTestId('login-password').fill('demo');
  await page.getByTestId('login-submit').click();
  await page.getByTestId('dock-app-settings').click();
  await page.getByTestId('settings-section-updates').click();

  const updates = page.getByTestId('app-updates');
  await expect(updates.getByTestId('installed-package-docker-ce')).toBeVisible();
  await expect(updates.getByRole('region', { name: 'Security available updates' })).toContainText('openssl');
  await expect(updates.getByRole('region', { name: 'System available updates' })).toContainText('systemd');
  expect(await updates.getByTestId('updates-needed').evaluate((node) => Boolean(node.compareDocumentPosition(document.querySelector('[data-testid="updates-installed"]')!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  const search = updates.getByRole('searchbox', { name: 'Search installed packages' });
  await search.fill('Docker');
  await expect(updates.getByTestId('updates-installed').locator('.updates-package-row')).toHaveCount(1);
  await expect(updates.getByTestId('installed-package-docker-ce')).toBeVisible();
  await search.clear();
  await expect(updates.getByTestId('updates-installed').locator('.updates-package-row')).toHaveCount(3);
  await expect(updates.getByTestId('installed-package-openssl')).toHaveCount(0);
  await expect(updates.locator('.updates-package-row')).toHaveCount(5);
  const filter = updates.getByRole('combobox', { name: 'Filter installed packages' });
  await filter.click();
  await page.getByRole('option', { name: 'Third-party', exact: true }).click();
  await expect(updates.getByTestId('updates-installed').locator('.updates-package-row')).toHaveCount(1);
  await expect(updates.getByTestId('installed-package-docker-ce')).toBeVisible();
  await search.fill('missing');
  await expect(updates.getByTestId('updates-installed')).toContainText('No matching packages.');
  await expect(updates.getByTestId('updates-needed').locator('.updates-package-row')).toHaveCount(2);
  await search.clear();
  await filter.click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Enter');
  await expect(filter).toHaveText('All packages');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: width === 1440 ? 'light' : 'dark', reducedMotion: 'reduce' });
    await page.locator('.settings-content').evaluate((node) => { node.scrollTop = 0; });
    const header = updates.locator('.updates-header');
    await expect(header.getByTestId('updates-refresh')).toBeVisible();
    await expect(header.getByTestId('updates-plan')).toBeVisible();
    expect(await updates.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    if (width === 1440) {
      const heading = (await header.getByRole('heading', { name: 'Software Updates' }).boundingBox())!;
      const button = (await header.getByTestId('updates-plan').boundingBox())!;
      expect(Math.abs(heading.y + heading.height / 2 - button.y - button.height / 2)).toBeLessThan(2);
    }
    await page.screenshot({ path: `/tmp/lumo-updates-heading-${width}.png` });
    await filter.click();
    await expect(page.getByRole('listbox', { name: 'Filter installed packages' })).toBeVisible();
    await page.screenshot({ path: `/tmp/lumo-updates-filter-${width}.png` });
    await page.keyboard.press('Escape');
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await updates.getByTestId('updates-refresh').click();
  await updates.getByTestId('updates-plan').click();
  await expect(updates.getByTestId('updates-plan-summary')).toContainText('2');
  await expect(updates.getByRole('region', { name: 'Security available updates' })).toContainText('openssl');
  await expect(updates).toContainText('Refreshed');
  await expect(updates.getByTestId('updates-needed').getByRole('heading', { name: 'Needs updates 2' })).toBeVisible();
  await updates.getByTestId('updates-apply').click();
  await expect(page.getByTestId('updates-confirm')).toBeVisible();
  await expect(page.getByTestId('updates-confirm')).toContainText('cannot be undone automatically');
  await page.getByTestId('updates-confirm-apply').click();
  await expect(updates.getByTestId('updates-progress')).toContainText('Updates installed', { timeout: 5_000 });
  await expect(updates.getByTestId('updates-progress')).toContainText('100%');
  await expect(updates.getByTestId('updates-needed')).toContainText('No updates in the saved package information.');
  await expect(updates.getByTestId('installed-package-openssl')).toContainText('3.0.13-0ubuntu3.5');
  await expect(updates.getByTestId('update-package-openssl')).toHaveCount(0);
});

test('package catalog stays local, separates sources and paginates large inventories', async ({ page }) => {
  const requests: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let fail = true;
  const packages = Array.from({ length: 125 }, (_, index) => ({ name: `system-${index}`, version: '1.0', architecture: 'amd64', summary: 'System package', group: 'system', origin: 'Ubuntu', held: false, security: false }));
  const catalog = { checkedAt: '2026-09-28T04:00:00Z', rebootRequired: false, packages: [...packages,
    { name: 'vendor-agent', version: '2.0', updateVersion: '2.1', architecture: 'amd64', summary: 'Vendor agent', group: 'third-party', updateGroup: 'third-party', origin: 'Vendor', updateOrigin: 'Vendor', held: false, security: true },
    { name: 'local-tool', version: '1.0', architecture: 'all', summary: 'Locally installed tool', group: 'unknown', origin: '', held: true, security: false },
  ] };
  await page.routeWebSocket(/\/api\/v1\/ws/, () => {});
  await page.route('**/api/v1/**', async (route) => {
    if (await nativeAppRoute(route)) return;
    const path = new URL(route.request().url()).pathname;
    requests.push(`${route.request().method()} ${path}`);
    if (path.endsWith('/updates/packages') && fail) return route.fulfill({ status: 503, json: { ok: false, error: { code: 'unavailable', message: 'Package catalog unavailable.' } } });
    const data = path.endsWith('/auth/session') ? { user: { name: 'demo', uid: 1000, gid: 1000, home: '/home/demo' } }
      : path.endsWith('/updates/packages') ? catalog
      : path.endsWith('/apps') ? { canInstall: false, apps: [] }
      : path.endsWith('/system/settings') ? { timezone: 'Etc/UTC', serverTime: '2026-09-28T04:00:00Z', revision: 'r1', runtimeHostname: 'test', canEdit: true, available: true, ntpSynchronized: true }
      : path.endsWith('/system/timezones') ? { timezones: ['Etc/UTC'] }
      : path.endsWith('/system/identity') ? { hostname: 'test', os: { prettyName: 'Ubuntu' }, architecture: 'x86_64' }
      : path.endsWith('/files/locations') ? { locations: [] } : {};
    return route.fulfill({ json: { ok: true, data } });
  });
  await page.goto('http://localhost:5200');
  await page.getByTestId('dock-app-settings').click();
  await page.getByTestId('settings-section-updates').click();
  await expect(page.getByRole('alert')).toContainText('Package catalog unavailable');
  fail = false;
  await page.getByTestId('updates-refresh').click();
  await expect(page.getByRole('region', { name: 'Security available updates' })).toContainText('vendor-agent');
  await expect(page.getByTestId('installed-package-local-tool')).toContainText('Held');
  const filter = page.getByRole('combobox', { name: 'Filter installed packages' });
  await filter.click();
  await page.getByRole('option', { name: 'System', exact: true }).click();
  const system = page.getByRole('region', { name: 'Installed package list' });
  await expect(system.locator('.updates-package-row')).toHaveCount(50);
  await system.getByRole('button', { name: 'Show more (75)' }).click();
  await expect(system.locator('.updates-package-row')).toHaveCount(100);
  await filter.click();
  await page.getByRole('option', { name: 'Other / unknown', exact: true }).click();
  await expect(system.locator('.updates-package-row')).toHaveCount(1);
  await filter.click();
  await page.getByRole('option', { name: 'System', exact: true }).click();
  await expect(system.locator('.updates-package-row')).toHaveCount(50);
  await page.getByRole('searchbox', { name: 'Search installed packages' }).fill('system-124');
  await expect(page.getByTestId('updates-installed').locator('.updates-package-row')).toHaveCount(1);
  await expect(page.getByTestId('installed-package-system-124')).toBeVisible();
  expect(requests.every((request) => request.startsWith('GET '))).toBe(true);
  expect(errors).toEqual([]);
});
