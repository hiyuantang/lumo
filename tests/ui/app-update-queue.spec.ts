// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test, type Page } from '../offline';

type App = 'docker' | 'nginx';
async function fixture(page: Page, requirePassword = false) {
  let authenticated = !requirePassword;
  const applied: App[] = [];
  const updated = new Set<App>();
  const finished = new Map<string, boolean>();
  const sinks = new Map<string, () => void>();
  const planCounts = { docker: 0, nginx: 0 };
  await page.routeWebSocket(/\/api\/v1\/ws/, (ws) => {
    ws.onMessage((raw) => {
      const frame = JSON.parse(String(raw));
      if (frame.type !== 'subscribe') return;
      ws.send(JSON.stringify({ type: 'subscribed', channel: frame.channel }));
      if (frame.capability !== 'updates.progress') return;
      const requestId = frame.params.requestId as string;
      let seq = 1;
      const send = () => ws.send(JSON.stringify({ type: 'event', channel: frame.channel, seq: seq++, data: { requestId, planId: requestId, phase: finished.has(requestId) ? 'complete' : 'installing', percent: finished.has(requestId) ? 100 : 35, message: 'Installing packages', done: finished.has(requestId), success: finished.get(requestId) ?? false, error: finished.get(requestId) === false ? 'Package installation failed' : undefined, updatedAt: new Date().toISOString() } }));
      sinks.set(requestId, send);
      send();
    });
  });
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    const data = (value: unknown) => route.fulfill({ json: { ok: true, data: value } });
    if (path.endsWith('/auth/session')) return data({ user: { name: 'demo', uid: 1000, gid: 1000, home: '/home/demo' }, csrf: 'test-csrf' });
    if (path.endsWith('/auth/reauth')) { authenticated = true; return data({}); }
    if (path.endsWith('/apps')) return data({ canInstall: true, apps: ['docker', 'nginx'].map((id) => ({ id, installed: true })) });
    if (path.endsWith('/apps/update-history')) return data({ entries: [] });
    if (path.endsWith('/updates/refresh')) return data({ refreshedAt: new Date().toISOString() });
    if (path.endsWith('/apps/plan')) {
      const body = route.request().postDataJSON();
      const app = body.appId as App;
      planCounts[app]++;
      return data({ plan: { appId: app, operation: body.operation, id: `plan-${app}`, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 600000).toISOString(), packages: updated.has(app) ? [] : [{ name: app, fromVersion: '1.0', toVersion: '1.1', downloadBytes: 200000, installedDeltaBytes: 0, security: false }], securityCount: 0, downloadBytes: 200000, installedDeltaBytes: 0, rebootRequired: false } });
    }
    if (path.endsWith('/updates/apply')) {
      if (!authenticated) return route.fulfill({ status: 403, json: { ok: false, error: { code: 'forbidden', message: 'Confirm password', details: { reauthRequired: true } } } });
      const app = route.request().postDataJSON().planId.replace('plan-', '') as App;
      applied.push(app);
      return data({ requestId: `job-${app}` });
    }
    return data({});
  });
  await page.goto('http://localhost:5200');
  await page.getByTestId('dock-app-library').click();
  await page.getByTestId('library-updates').click();
  await expect(page.getByTestId('library-update-all')).toBeEnabled();
  return {
    applied, planCounts,
    externallyUpdate: (app: App) => updated.add(app),
    complete: (app: App, success = true) => {
      if (success) updated.add(app);
      finished.set(`job-${app}`, success);
      sinks.get(`job-${app}`)?.();
    },
  };
}

test('Update all resumes after password cancellation and reload without duplicate application', async ({ page }) => {
  const server = await fixture(page, true);
  await page.getByTestId('library-update-all').click();
  await expect(page.getByTestId('reauth-sheet')).toBeVisible();
  await page.getByTestId('reauth-cancel').click();
  expect(server.applied).toEqual([]);
  await page.getByTestId('library-update-docker').getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByTestId('reauth-password').fill('demo');
  await page.getByTestId('reauth-submit').click();
  await expect(page.getByTestId('library-update-docker')).toContainText('Installing packages');
  expect(server.applied).toEqual(['docker']);
  await page.reload();
  await expect(page.getByTestId('library-update-docker')).toContainText('Installing packages');
  expect(server.applied).toEqual(['docker']);
  server.complete('docker');
  await expect(page.getByTestId('library-update-nginx')).toContainText('Installing packages');
  expect(server.applied).toEqual(['docker', 'nginx']);
  server.complete('nginx');
  await expect(page.getByTestId('library-update-docker')).toHaveCount(0);
  await expect(page.getByTestId('library-update-nginx')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('lumo-app-updates:live:demo'))).toBeNull();
});

test('A failed update stops the queue and leaves remaining apps available to update', async ({ page }) => {
  const server = await fixture(page);
  await page.getByTestId('library-update-all').click();
  await expect(page.getByTestId('library-update-docker')).toContainText('Installing packages');
  server.complete('docker', false);
  await expect(page.getByTestId('library-update-docker').getByRole('alert')).toContainText('Package installation failed');
  await expect(page.getByTestId('library-update-nginx').getByRole('button', { name: 'Update', exact: true })).toBeEnabled();
  await expect(page.getByTestId('library-update-all')).toBeEnabled();
  expect(server.applied).toEqual(['docker']);
  await expect(page.getByTestId('app-library')).not.toContainText('Your managed apps are up to date.');
});

test('Update all rechecks each app and skips an app already updated elsewhere', async ({ page }) => {
  const server = await fixture(page);
  server.externallyUpdate('docker');
  await page.getByTestId('library-update-all').click();
  await expect(page.getByTestId('library-update-nginx')).toContainText('Installing packages');
  await expect(page.getByTestId('library-update-docker')).toHaveCount(0);
  expect(server.applied).toEqual(['nginx']);
  expect(server.planCounts).toEqual({ docker: 2, nginx: 2 });
  server.complete('nginx');
  await expect(page.getByTestId('library-update-nginx')).toHaveCount(0);
});
