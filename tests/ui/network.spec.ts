// SPDX-License-Identifier: AGPL-3.0-only
import { nativeAppRoute } from './native-app-fixture';
import { expect, test, type Page } from '../offline';
import type { NetworkSnapshot } from '../../src/api/source';

async function signIn(page: Page) {
  await page.goto('/');
  await page.getByTestId('login-username').fill('demo');
  await page.getByTestId('login-password').fill('demo');
  await page.getByTestId('login-submit').click();
}

for (const width of [1440, 390]) {
  test(`Network shows copyable read-only details at ${width}px`, async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (['error', 'warning'].includes(message.type())) errors.push(message.text()); });
    await signIn(page);
    await expect(page).toHaveTitle('Lumo');
    await page.getByTestId('dock-app-settings').click();
    await page.getByTestId('settings-section-network').click();
    const network = page.getByTestId('app-network');
    await expect(network.getByTestId('network-interface-eth0')).toContainText('Up');
    await expect(network.getByTestId('network-detail-ipv4')).toContainText('192.0.2.10/24');
    await expect(network.getByTestId('network-detail-ipv6')).toContainText('2001:db8::10/64');
    await expect(network.getByTestId('network-detail-gateway')).toContainText('192.0.2.1');
    await expect(network.getByTestId('network-detail-dns')).toContainText('192.0.2.53');
    await expect(network.getByTestId('network-detail-mac')).toContainText('02:42:ac:11:00:02');
    for (const [value, copied] of [['192.0.2.10/24', '192.0.2.10'], ['2001:db8::10/64', '2001:db8::10'], ['192.0.2.1', '192.0.2.1'], ['192.0.2.53', '192.0.2.53'], ['02:42:ac:11:00:02', '02:42:ac:11:00:02']]) {
      await network.getByRole('button', { name: `Copy ${value}`, exact: true }).click();
      await expect(network.getByRole('status')).toContainText('copied');
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(copied);
    }
    await expect(network.locator('input')).toHaveCount(0);
    await expect(network.getByTestId('network-apply')).toHaveCount(0);
    await expect(network.getByTestId('network-mode-static')).toHaveCount(0);
    await network.getByTestId('network-refresh').click();
    await expect(network.getByTestId('network-refresh')).toHaveAccessibleName('Refresh');
    await expect(network.getByTestId('network-refresh').locator('svg')).toBeVisible();
    await network.getByTestId('network-refresh').scrollIntoViewIfNeeded();
    expect(await network.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(false);
    await expect(page.locator('vite-error-overlay')).toHaveCount(0);
    await page.screenshot({ path: `/tmp/lumo-network-readonly-${width}.png`, animations: 'disabled' });
    expect(errors).toEqual([]);
  });
}

test('Command Center opens the read-only Network overview in Settings', async ({ page }) => {
  await signIn(page);
  await page.keyboard.press('Control+k');
  await page.getByLabel('Search actions').fill('network');
  const command = page.getByRole('option', { name: /Open Network Settings/ });
  await expect(command).toHaveCount(1);
  await command.click();
  await expect(page.getByTestId('network-details')).toBeVisible();
  await page.getByTestId('settings-section-time').click();
  await page.keyboard.press('Control+k');
  await page.getByLabel('Search actions').fill('network');
  await command.click();
  await expect(page.getByTestId('network-details')).toBeVisible();
  await expect(page.getByTestId('window-settings')).toHaveCount(1);
  await expect(page.getByTestId('window-network')).toHaveCount(0);
});

test('previous Network windows migrate into the existing Settings window', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const window = { x: 100, y: 70, w: 840, h: 610, z: 2, minimized: false, maximized: false, snapped: null, restore: null };
    localStorage.setItem('lumo.windows.v1', JSON.stringify({ windows: { settings: { ...window, appId: 'settings', minimized: true }, network: { ...window, appId: 'network', z: 3 } }, focused: 'network', zTop: 3 }));
  });
  await signIn(page);
  await expect(page.getByTestId('window-settings')).toHaveCount(1);
  await expect(page.getByTestId('window-settings')).toBeVisible();
  await expect(page.getByTestId('window-network')).toHaveCount(0);
  await expect(page.getByTestId('app-network')).toBeVisible();
  await expect(page.getByTestId('dock-app-network')).toHaveCount(0);
  expect(errors).toEqual([]);
});


test('live overview separates loading, failures, empty data and external changes without writing', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  let network: NetworkSnapshot = { interfaces: [], dnsServers: null };
  let failed = true;
  let delay = true;
  const writes: string[] = [];
  await page.routeWebSocket(/\/api\/v1\/ws/, () => {});
  await page.route('**/api/v1/**', async (route) => {
    if (await nativeAppRoute(route)) return;
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith('/api/v1/network') && route.request().method() !== 'GET') writes.push(path);
    const data = (value: unknown) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, data: value }) });
    if (path === '/api/v1/auth/session') return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'unauthorized', message: 'Sign in', details: {} } }) });
    if (path === '/api/v1/auth/login') return data({ user: { name: 'demo', uid: 1000, home: '/home/demo' }, csrf: 'test-csrf' });
    if (path === '/api/v1/apps') return data({ canInstall: false, apps: [] });
    if (path === '/api/v1/system/identity') return data({ hostname: 'server-one', os: { prettyName: 'Ubuntu', kernel: 'test' }, architecture: 'aarch64', serverTime: new Date().toISOString() });
    if (path === '/api/v1/system/overview') return data({ uptimeSeconds: 86400, memoryUsedBytes: 1024, memoryTotalBytes: 4096, failedUnits: 0, updatesPending: 0, securityUpdatesPending: 0 });
    if (path === '/api/v1/system/metrics') return data({ cpu: { usagePercent: 5 }, network: [], disks: [] });
    if (path === '/api/v1/system/settings') return data({ hostname: 'server-one', runtimeHostname: 'server-one', timezone: 'Etc/UTC', ntp: true, canNtp: true, revision: 'test', serverTime: new Date().toISOString() });
    if (path === '/api/v1/system/timezones') return data({ timezones: ['Etc/UTC'] });
    if (path === '/api/v1/network') {
      if (delay) await new Promise((resolve) => setTimeout(resolve, 700));
      if (failed) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'unavailable', message: 'Network details unavailable.', details: {} } }) });
      return data(network);
    }
    return data({});
  });
  await page.goto('http://localhost:5200');
  await page.getByTestId('login-username').fill('demo');
  await page.getByTestId('login-password').fill('demo');
  await page.getByTestId('login-submit').click();
  await page.getByTestId('dock-app-settings').click();
  await page.getByTestId('settings-section-network').click();
  const overview = page.getByTestId('app-network');
  await expect(overview).toContainText('Loading network details');
  await expect(overview.getByRole('alert')).toContainText('Could not refresh');
  await expect(overview).not.toContainText('No network interfaces');
  await expect(overview.getByRole('region', { name: 'Network interfaces' })).toHaveCount(0);
  delay = false;
  failed = false;
  await overview.getByTestId('network-refresh').click();
  await expect(overview).toContainText('No network interfaces found');
  network = { dnsServers: ['127.0.0.53'], dnsSource: 'resolv.conf', interfaces: [
    { name: 'lo', loopback: true, up: true, addresses: ['127.0.0.1/8'], gateways: [], dnsServers: null },
    { name: 'eth0', loopback: false, up: true, addresses: ['192.0.2.20/24'], gateways: null, dnsServers: null },
    { name: 'eth1', loopback: false, up: false, addresses: [], gateways: [], dnsServers: null },
  ] };
  await overview.getByTestId('network-refresh').click();
  await expect(overview.getByTestId('network-interface-eth0')).toHaveAttribute('aria-current', 'page');
  await expect(overview.getByTestId('network-detail-gateway')).toContainText('Unavailable');
  await expect(overview.getByTestId('network-detail-dns')).toContainText('System DNS servers');
  await expect(overview.getByTestId('network-detail-dns')).toContainText('127.0.0.53');
  await overview.getByTestId('network-interface-eth1').click();
  await expect(overview.getByTestId('network-detail-ipv4')).toContainText('None assigned');
  await expect(overview.getByTestId('network-detail-gateway')).toContainText('None reported');
  await overview.getByTestId('network-refresh').click();
  await expect(overview.getByTestId('network-interface-eth1')).toHaveAttribute('aria-current', 'page');
  failed = true;
  await overview.getByTestId('network-refresh').click();
  await expect(overview.getByRole('alert')).toContainText('Showing the last available information');
  failed = false;
  network.interfaces = network.interfaces.filter((item) => item.name !== 'eth1');
  network.interfaces[1].addresses = ['192.0.2.99/24'];
  await overview.getByTestId('network-refresh').click();
  await expect(overview.getByTestId('network-interface-eth0')).toHaveAttribute('aria-current', 'page');
  await expect(overview.getByTestId('network-detail-ipv4')).toContainText('192.0.2.99/24');
  await expect(overview.getByRole('alert')).toHaveCount(0);
  await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw new Error('denied'); }; });
  await overview.getByRole('button', { name: 'Copy 192.0.2.99/24', exact: true }).click();
  await expect(overview.getByRole('status')).toContainText('Could not copy');
  expect(writes).toEqual([]);
});
