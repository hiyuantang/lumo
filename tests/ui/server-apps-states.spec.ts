// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test, type Page } from '@playwright/test';

async function fixture(page: Page, installApp: 'docker' | 'nginx' | null = null) {
  let authenticated = false;
  let installed = false;
  let mode = 'success';
  let applies = 0;
  let finished = false;
  let progressSink: (() => void) | null = null;
  let container = { id: 'a'.repeat(64), name: 'test-web', image: 'nginx:stable', state: 'running', status: 'Up 1 hour', project: 'test', revision: `sha256:${'a'.repeat(64)}`, created: '', startedAt: '', exitCode: 0, ports: [], mounts: [] };
  let site = { id: 'notes', name: 'notes.example.com', path: '/etc/nginx/conf.d/lumo-notes.conf', source: 'server {}', managed: true, revision: `sha256:${'a'.repeat(64)}`, definition: { domain: 'notes.example.com', kind: 'proxy', port: 3000, root: '', enabled: true } };
  await page.routeWebSocket(/\/api\/v1\/ws/, (ws) => {
    ws.onMessage((raw) => {
      const frame = JSON.parse(String(raw));
      if (frame.type !== 'subscribe') return;
      ws.send(JSON.stringify({ type: 'subscribed', channel: frame.channel }));
      if (frame.capability === 'updates.progress') {
        if (mode === 'lost-progress') {
          ws.send(JSON.stringify({ type: 'error', channel: frame.channel, error: { code: 'not_found', message: 'Progress is no longer available.' } }));
          return;
        }
        let seq = 1;
        progressSink = () => ws.send(JSON.stringify({ type: 'event', channel: frame.channel, seq: seq++, data: { requestId: 'install-job', planId: 'pln_test', phase: finished ? 'complete' : 'installing', percent: finished ? 100 : 30, message: finished ? 'Packages installed' : `Installing ${installApp}`, done: finished, success: finished, updatedAt: new Date().toISOString() } }));
        progressSink();
      }
    });
  });
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    const data = (value: unknown) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, data: value }) });
    const failure = (status: number, code: string, message: string, details = {}) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code, message, details } }) });
    if (path === '/api/v1/auth/session') return failure(401, 'unauthorized', 'Sign in');
    if (path === '/api/v1/auth/login') return data({ user: { name: 'demo', uid: 1000, home: '/home/demo' }, csrf: 'test-csrf' });
    if (path === '/api/v1/auth/reauth') { authenticated = true; return data({}); }
    if (path === '/api/v1/system/identity') return data({ hostname: 'test-vps', os: { prettyName: 'Ubuntu test', kernel: 'test' }, architecture: 'aarch64', serverTime: new Date().toISOString() });
    if (path === '/api/v1/system/overview') return data({ uptimeSeconds: 1000, memoryUsedBytes: 0, memoryTotalBytes: 4096, failedUnits: 0, updatesPending: 0, securityUpdatesPending: 0 });
    if (path === '/api/v1/system/metrics') return data({ cpu: { usagePercent: 0 }, network: [], disks: [] });
    if (path === '/api/v1/containers') return data({ status: mode === 'permission' ? 'permission-denied' : 'ready', message: 'This Linux user does not have Docker access.', version: '27.5.1', containers: mode === 'permission' ? [] : [container] });
    if (path === '/api/v1/containers/detail') return data(container);
    if (path === '/api/v1/containers/logs') return failure(400, 'validation_failed', 'This container uses a logging driver that does not support reading logs.');
    if (path === '/api/v1/containers/action') {
      const body = route.request().postDataJSON();
      if (mode === 'denied') return failure(403, 'forbidden', 'Denied by policy');
      if (!authenticated) return failure(403, 'forbidden', 'Confirm your password', { reauthRequired: true });
      if (body.expectedRevision !== container.revision) return failure(409, 'stale_revision', 'Container changed through SSH. Refresh its state.');
      container = { ...container, state: body.action === 'stop' ? 'exited' : 'running', revision: `sha256:${'b'.repeat(64)}` };
      return data(container);
    }
    if (path === '/api/v1/websites') return data({ installed: true, sites: [site], warnings: [] });
    if (path === '/api/v1/websites/save') {
      const body = route.request().postDataJSON();
      if (mode === 'invalid') return failure(400, 'validation_failed', 'Nginx validation failed; previous file restored');
      if (body.expectedRevision !== site.revision) return failure(409, 'stale_revision', 'The website changed on disk.');
      site = { ...site, definition: body.definition, revision: `sha256:${'b'.repeat(64)}` };
      return data({ site, reloaded: true, rollbackRef: 'backup-test' });
    }
    if (path === '/api/v1/apps') return data({ canInstall: true, apps: ['docker', 'nginx'].map((id) => ({ id, installed: id === installApp ? installed : true })) });
    if (path === '/api/v1/apps/plan') {
      return data({ plan: { id: 'pln_test', appId: installApp, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 600000).toISOString(), packages: [{ name: installApp === 'docker' ? 'docker.io' : 'nginx', fromVersion: '', toVersion: '1.24.0', security: false, downloadBytes: 200000, installedDeltaBytes: 300000 }], securityCount: 0, downloadBytes: 200000, installedDeltaBytes: 300000, rebootRequired: false } });
    }
    if (path === '/api/v1/updates/apply') {
      applies++;
      if (!authenticated) return failure(403, 'forbidden', 'Confirm your password', { reauthRequired: true });
      return data({ requestId: 'install-job' });
    }
    if (method === 'GET') return data({});
    return failure(400, 'validation_failed', 'Unexpected operation');
  });
  await page.goto('http://localhost:5200');
  await page.getByTestId('login-username').fill('demo');
  await page.getByTestId('login-password').fill('demo');
  await page.getByTestId('login-submit').click();
  return {
    applies: () => applies,
    mode: (next: string) => { mode = next; },
    complete: () => { finished = true; installed = true; progressSink?.(); },
    changeSite: () => { site = { ...site, revision: `sha256:${'c'.repeat(64)}`, definition: { ...site.definition, port: 8080 } }; },
    changeContainer: () => { container = { ...container, revision: `sha256:${'c'.repeat(64)}` }; },
  };
}

for (const app of ['docker', 'nginx'] as const) {
test(`App Library reviews ${app} installation, reauthenticates, resumes progress and shows installed app details`, async ({ page }) => {
  const server = await fixture(page, app);
  await expect(page.getByTestId(app === 'docker' ? 'dock-app-containers' : 'dock-app-websites')).toHaveCount(0);
  await page.getByTestId('dock-app-library').click();
  await page.getByTestId(`library-${app}`).click();
  await expect(page.getByTestId('library-primary')).toHaveText('Install…');
  await page.getByTestId('library-primary').click();
  await expect(page.getByTestId('library-plan')).toContainText('1.24.0');
  expect(server.applies()).toBe(0);
  await page.getByTestId('library-install-confirm').click();
  await page.getByTestId('server-app-confirm-ok').click();
  await expect(page.getByTestId('reauth-sheet')).toBeVisible();
  await page.getByTestId('reauth-password').fill('demo');
  await page.getByTestId('reauth-submit').click();
  await expect(page.getByTestId('library-progress')).toContainText(`Installing ${app}`);
  await page.getByRole('button', { name: 'Close App Library', exact: true }).click();
  await page.getByTestId('dock-app-library').click();
  await expect(page.getByTestId(`library-${app}`)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('library-progress')).toContainText(`Installing ${app}`);
  expect(server.applies()).toBe(2);
  server.complete();
  await expect(page.getByTestId('library-primary')).toHaveText('Uninstall…');
  await expect(page.getByTestId(app === 'docker' ? 'dock-app-containers' : 'dock-app-websites')).toBeVisible();
  await page.getByTestId(`library-${app}`).click();
  await expect(page.getByTestId(app === 'docker' ? 'app-containers' : 'app-websites')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('lumo-app-install'))).toBeNull();
});
}

test('App Library can recover from expired progress without retrying installation', async ({ page }) => {
  const server = await fixture(page, 'nginx');
  server.mode('lost-progress');
  await page.evaluate(() => localStorage.setItem('lumo-app-install', JSON.stringify({ app: 'nginx', requestId: 'old-job' })));
  await page.getByTestId('dock-app-library').click();
  await expect(page.getByRole('alert')).toContainText('Progress is no longer available');
  await page.getByRole('button', { name: 'Check installed apps' }).click();
  await expect(page.getByTestId('library-primary')).toBeEnabled();
  await expect(page.getByTestId('library-primary')).toHaveText('Install…');
  expect(server.applies()).toBe(0);
  expect(await page.evaluate(() => localStorage.getItem('lumo-app-install'))).toBeNull();
});

test('Container permission denial, reauthentication and stale state stay visible', async ({ page }) => {
  const server = await fixture(page);
  server.mode('permission');
  await page.getByTestId('dock-app-containers').click();
  await expect(page.getByTestId('app-containers')).toContainText('Docker access required');
  server.mode('success');
  await page.getByTestId('containers-refresh').click();
  await expect(page.getByTestId('container-stop')).toBeEnabled();
  server.changeContainer();
  await page.getByTestId('container-stop').click();
  await page.getByTestId('server-app-confirm-ok').click();
  await page.getByTestId('reauth-password').fill('demo');
  await page.getByTestId('reauth-submit').click();
  await expect(page.getByRole('alert')).toContainText('Container changed through SSH');
  await page.getByTestId('app-containers').getByRole('alert').getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.getByTestId('container-stop').click();
  await page.getByTestId('server-app-confirm-ok').click();
  await expect(page.getByTestId('container-start')).toBeEnabled();
  server.mode('denied');
  await page.getByTestId('container-start').click();
  await expect(page.getByRole('alert')).toContainText('Denied by policy');
  await page.getByRole('tab', { name: 'Logs', exact: true }).click();
  await expect(page.getByTestId('app-containers')).toContainText('logging driver');
});

test('Website validation failures and SSH edits preserve the draft', async ({ page }) => {
  const server = await fixture(page);
  await page.getByTestId('dock-app-websites').click();
  await page.getByLabel('Application port').fill('4000');
  server.mode('invalid');
  await page.getByTestId('website-save').click();
  await page.getByTestId('server-app-confirm-ok').click();
  await expect(page.getByRole('alert')).toContainText('previous file restored');
  await expect(page.getByLabel('Application port')).toHaveValue('4000');
  server.changeSite();
  await page.getByTestId('websites-refresh').click();
  await expect(page.getByRole('alert')).toContainText('Changed on the server');
  await expect(page.getByTestId('website-save')).toBeDisabled();
  await expect(page.getByLabel('Application port')).toHaveValue('4000');
  await page.getByRole('button', { name: 'Discard draft' }).click();
  await expect(page.getByLabel('Application port')).toHaveValue('8080');
});
