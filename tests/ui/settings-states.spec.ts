// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test, type Page } from '../offline';

async function openSettings(page: Page) {
  let settings = { hostname: 'server-one', runtimeHostname: 'server-one', timezone: 'Etc/UTC', ntp: true, canNtp: true, ntpSynchronized: true, serverTime: new Date().toISOString(), revision: `sha256:${'0'.repeat(64)}` };
  let mode: 'success' | 'denied' | 'reauth' = 'success';
  let unavailable = false;
  let authenticated = false;
  let writes = 0;
  await page.routeWebSocket(/\/api\/v1\/ws/, () => {});
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    const data = (value: unknown) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, data: value }) });
    const failure = (status: number, code: string, message: string, details = {}) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code, message, details } }) });
    if (path === '/api/v1/auth/session') return failure(401, 'unauthorized', 'Sign in');
    if (path === '/api/v1/auth/login') return data({ user: { name: 'demo', uid: 1000, home: '/home/demo' }, csrf: 'test-csrf' });
    if (path === '/api/v1/auth/reauth') { authenticated = true; return data({}); }
    if (path === '/api/v1/system/identity') return data({ hostname: settings.hostname, os: { prettyName: 'Ubuntu test', kernel: 'test-kernel' }, architecture: 'aarch64', serverTime: settings.serverTime });
    if (path === '/api/v1/system/overview') return data({ uptimeSeconds: 86400, memoryUsedBytes: 1073741824, memoryTotalBytes: 4294967296, failedUnits: 0, updatesPending: 3, securityUpdatesPending: 1 });
    if (path === '/api/v1/system/metrics') return data({ cpu: { usagePercent: 5 }, network: [], disks: [{ mount: '/', usedBytes: 1073741824, totalBytes: 10737418240 }] });
    if (path === '/api/v1/system/timezones') return data({ timezones: ['Etc/UTC', 'America/New_York', 'Europe/London'] });
    if (path === '/api/v1/system/settings' && method === 'GET') return unavailable ? failure(503, 'unavailable', 'System settings unavailable') : data(settings);
    if (path === '/api/v1/system/settings' && method === 'POST') {
      writes++;
      const body = route.request().postDataJSON();
      if (mode === 'denied') return failure(403, 'forbidden', 'Denied by policy');
      if (mode === 'reauth' && !authenticated) return failure(403, 'forbidden', 'Confirm your password', { reauthRequired: true });
      if (body.expectedRevision !== settings.revision) return failure(409, 'stale_revision', 'Changed through SSH');
      settings = { ...settings, ...body.change, revision: `sha256:${'1'.repeat(64)}` };
      return data(settings);
    }
    return data({});
  });
  await page.goto('http://localhost:5200');
  await page.getByTestId('login-username').fill('demo');
  await page.getByTestId('login-password').fill('demo');
  await page.getByTestId('login-submit').click();
  await page.getByTestId('dock-app-settings').click();
  await expect(page.getByTestId('settings-hostname')).toHaveText('server-one');
  await expect(page.getByTestId('settings-editor-hostname')).toHaveCount(0);
  await page.getByTestId('settings-section-time').click();
  await expect(page.getByRole('switch', { name: 'Set time automatically' })).toHaveCount(0);
  return {
    writes: () => writes,
    changeExternally: () => { settings = { ...settings, timezone: 'Europe/London', revision: `sha256:${'2'.repeat(64)}` }; },
    renameExternally: () => { settings = { ...settings, hostname: 'changed-over-ssh', runtimeHostname: 'changed-over-ssh' }; },
    setMode: (value: typeof mode) => { mode = value; },
    setUnavailable: (value: boolean) => { unavailable = value; },
    disableNtp: () => { settings = { ...settings, canNtp: false }; },
  };
}

test('hostname stays read-only and external renames do not conflict with time edits', async ({ page }) => {
  const server = await openSettings(page);
  await page.getByTestId('settings-timezone').click();
  await page.getByRole('option', { name: 'America/New York', exact: true }).click();
  server.renameExternally();
  await page.getByTestId('settings-refresh').click();
  await page.getByTestId('settings-section-system').click();
  await expect(page.getByTestId('settings-hostname')).toHaveText('changed-over-ssh');
  await expect(page.getByTestId('settings-editor-hostname')).toHaveCount(0);
  await expect(page.getByRole('banner')).not.toContainText('changed-over-ssh');
  expect(server.writes()).toBe(0);
  await page.getByTestId('settings-section-time').click();
  await expect(page.getByTestId('settings-timezone')).toHaveAttribute('value', 'America/New_York');
  await page.getByTestId('settings-save-timezone').click();
  await expect(page.getByTestId('settings-editor-timezone')).toContainText('Saved');
});

test('settings show a password prompt before displaying success', async ({ page }) => {
  const server = await openSettings(page);
  server.setMode('reauth');
  await page.getByTestId('settings-timezone').click();
  await page.getByRole('option', { name: 'America/New York', exact: true }).click();
  await page.getByTestId('settings-save-timezone').click();
  await expect(page.getByTestId('reauth-sheet')).toBeVisible();
  await page.getByTestId('reauth-password').fill('demo');
  await page.getByTestId('reauth-submit').click();
  await expect(page.getByTestId('settings-editor-timezone')).toContainText('Saved');
  expect(server.writes()).toBe(2);
});

test('settings preserve conflicting edits and recover without overwriting SSH changes', async ({ page }) => {
  const server = await openSettings(page);
  await page.getByTestId('settings-timezone').click();
  await page.getByRole('option', { name: 'America/New York', exact: true }).click();
  server.changeExternally();
  await page.getByTestId('settings-save-timezone').click();
  await expect(page.getByTestId('settings-editor-timezone')).toContainText('Your draft is kept');
  await expect(page.getByTestId('settings-timezone')).toHaveAttribute('value', 'America/New_York');
  await expect(page.getByTestId('settings-save-timezone')).toBeDisabled();
  server.setUnavailable(true);
  await page.getByTestId('settings-reload-timezone').click();
  await expect(page.getByRole('alert').filter({ hasText: 'Settings unavailable' })).toBeVisible();
  await expect(page.getByTestId('settings-timezone')).toHaveAttribute('value', 'America/New_York');
  server.setUnavailable(false);
  await page.getByTestId('settings-refresh').click();
  await expect(page.getByTestId('settings-reload-timezone')).toBeEnabled();
  await page.getByTestId('settings-reload-timezone').click();
  await expect(page.getByTestId('settings-timezone')).toHaveAttribute('value', 'Europe/London');
  expect(server.writes()).toBe(1);
  await page.getByTestId('settings-timezone').click();
  await page.getByRole('option', { name: 'America/New York', exact: true }).click();
  await page.getByTestId('settings-save-timezone').click();
  await expect(page.getByTestId('settings-editor-timezone')).toContainText('Saved');
});

test('denied writes retain drafts and automatic time controls stay absent', async ({ page }) => {
  const server = await openSettings(page);
  server.setMode('denied');
  await page.getByTestId('settings-timezone').click();
  await page.getByRole('option', { name: 'America/New York', exact: true }).click();
  await page.getByTestId('settings-save-timezone').click();
  await expect(page.getByTestId('settings-editor-timezone')).toContainText('Action not permitted');
  await expect(page.getByTestId('settings-timezone')).toHaveAttribute('value', 'America/New_York');
  server.disableNtp();
  await page.getByTestId('settings-refresh').click();
  await page.getByTestId('settings-section-time').click();
  await expect(page.getByTestId('settings-ntp')).toHaveCount(0);
});
