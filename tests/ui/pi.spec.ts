// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '../offline';
import { piPage } from './pi-fixture';

test('Pi streams native chat and tools, queues work, changes models, and resumes saved sessions', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (err) => errors.push(err.message));
  const fixture = await piPage(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('http://localhost:5200');
  await expect(page).toHaveTitle(/Lumo/);
  await page.getByTestId('dock-app-pi').click();

  await expect(page.getByTestId('pi-prompt')).toBeEnabled();
  const sidebar = await page.getByTestId('pi-sidebar').boundingBox(); const main = await page.locator('.pi-main').boundingBox();
  expect(main!.x).toBeGreaterThanOrEqual(sidebar!.x + sidebar!.width);
  await page.getByTestId('pi-prompt').fill('Explain this project');
  await page.getByTestId('pi-send').click();
  await expect(page.getByTestId('pi-messages')).toContainText('Inspecting your project…');
  await expect(page.getByTestId('pi-tool')).toContainText('Running');
  await expect(page.locator('.pi-compose .pi-status')).toHaveCount(0);
  await page.getByTestId('pi-prompt').fill('Focus on the backend');
  await page.getByTestId('pi-send').click();
  await expect(page.getByTestId('app-pi')).toContainText('1 queued');
  expect(fixture.commands).toContainEqual({ type: 'steer', message: 'Focus on the backend' });
  fixture.finish();
  await expect(page.getByTestId('pi-messages')).toContainText('React and Go');
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0);
  await page.getByTestId('pi-tool').locator('summary').click();
  await expect(page.getByTestId('pi-tool')).toContainText('README.md');
  await expect(page.getByTestId('pi-tool')).toContainText('React frontend and Go server.');
  await page.screenshot({ animations: 'disabled', path: '/tmp/lumo-pi-light.png' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByTestId('pi-new')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await page.screenshot({ animations: 'disabled', path: '/tmp/lumo-pi-dark.png' });
  await page.getByTestId('pi-model').click();
  await page.getByRole('slider', { name: 'Effort', exact: true }).press('End');
  await expect(page.getByTestId('pi-model')).toContainText('High');
  expect(fixture.commands).toContainEqual({ type: 'set_thinking_level', level: 'high' });
  await page.getByRole('button', { name: 'Choose model', exact: true }).click();
  await page.getByRole('option', { name: 'Fast · Fixture', exact: true }).click();
  await expect(page.getByRole('slider', { name: 'Effort', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Choose model', exact: true }).press('Escape');
  expect(fixture.commands).toContainEqual({ type: 'set_model', modelId: 'fast', provider: 'Fixture' });
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await page.getByRole('textbox', { name: 'Conversation name' }).fill('Backend review');
  await page.getByTestId('server-app-confirm-ok').click();
  await expect(page.getByTestId('pi-sidebar')).toContainText('Backend review');
  await page.getByRole('navigation', { name: 'Pi projects', exact: true }).getByRole('button', { name: 'Earlier work', exact: true }).click();
  await expect(page.getByTestId('pi-messages')).toContainText('Earlier saved conversation.');
  expect(fixture.starts.at(-1)).toMatchObject({ session: 'second.jsonl', project: '/home/user' });
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click();
  await expect(page.getByTestId('pi-sidebar')).toHaveClass(/is-collapsed/);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ animations: 'disabled', path: '/tmp/lumo-pi-narrow.png' });
  await expect(page.getByTestId('pi-send')).toBeVisible();
  expect(errors).toEqual([]);
});

test('Pi stop clears queued work and closing a running task needs confirmation', async ({ page }) => {
  const fixture = await piPage(page);
  await page.goto('http://localhost:5200'); await page.getByTestId('dock-app-pi').click();
  await expect(page.getByTestId('pi-prompt')).toBeEnabled();
  await page.getByTestId('pi-prompt').fill('Long task'); await page.getByTestId('pi-send').click();
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
  await page.getByTestId('window-close-pi').click();
  await expect(page.getByTestId('server-app-confirm')).toContainText('stops the current task');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0);
  expect(fixture.commands.map((item) => item.type)).toContain('clear_queue');
  expect(fixture.commands.map((item) => item.type)).toContain('abort');
  await page.getByTestId('window-close-pi').click(); await expect(page.getByTestId('app-pi')).toHaveCount(0);
});

test('App Library installs Pi directly and updates it without APT', async ({ page }) => {
  let version = '';
  let operation = 'install';
  let polls = 0;
  let completed = false;
  let history: unknown[] = [];
  const commands: string[] = [];
  const plan = () => ({ id: 'pi_plan', appId: 'pi', operation, packages: version === '1.2.1' ? [] : [{ name: 'pi', fromVersion: version, toVersion: operation === 'install' ? '1.2.0' : '1.2.1', security: false, downloadBytes: 0, installedDeltaBytes: 0 }], downloadBytes: 0, installedDeltaBytes: 0, securityCount: 0, rebootRequired: false, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 900000).toISOString() });
  await page.routeWebSocket(/\/api\/v1\/ws/, () => {});
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    const data = (value: unknown) => route.fulfill({ json: { ok: true, data: value } });
    if (path.endsWith('/auth/session')) return data({ user: { name: 'demo', uid: 1000, gid: 1000, home: '/home/user' } });
    if (path.endsWith('/apps')) return data({ canInstall: false, apps: [{ id: 'pi', installed: Boolean(version), canInstall: true, canUpdate: Boolean(version), canUninstall: true }] });
    if (path.endsWith('/apps/pi/plan')) { operation = route.request().postDataJSON().operation; return data({ plan: plan() }); }
    if (path.endsWith('/apps/pi/apply')) { commands.push(operation); polls = 0; completed = false; return data({ requestId: `pi_${operation}` }); }
    if (path.endsWith('/apps/pi/progress')) {
      if (++polls >= 2 && !completed) {
        completed = true;
        if (operation === 'update') history = [{ requestId: 'pi_update', appId: 'pi', completedAt: new Date().toISOString(), success: true, packages: plan().packages }];
        version = operation === 'install' ? '1.2.0' : '1.2.1';
      }
      return data({ requestId: `pi_${operation}`, planId: 'pi_plan', phase: completed ? 'complete' : 'installing', percent: completed ? 100 : 20, message: 'Installing Pi…', done: completed, success: completed, updatedAt: new Date().toISOString() });
    }
    if (path.endsWith('/apps/update-history')) return data({ entries: history });
    if (path.endsWith('/updates/refresh')) throw new Error('Pi must not require APT');
    return data({});
  });
  await page.goto('http://localhost:5200');
  await page.getByTestId('dock-app-library').click();
  await page.getByTestId('library-pi').click();
  await page.getByTestId('library-primary').click();
  await expect(page.getByTestId('library-progress')).toHaveAttribute('aria-valuenow', '20');
  await expect(page.getByTestId('server-app-confirm')).toHaveCount(0);
  await expect(page.getByTestId('library-plan')).toHaveCount(0);
  await expect(page.getByTestId('library-primary')).toHaveText('Uninstall');
  await expect(page.getByTestId('library-progress')).toHaveCount(0);
  await expect(page.getByTestId('dock-app-pi')).toBeVisible();
  await page.getByTestId('library-updates').click();
  await expect(page.getByTestId('library-update-pi')).toContainText('1.2.0 → 1.2.1');
  await page.getByTestId('library-update-all').click();
  await page.getByTestId('window-close-library').click();
  await page.getByTestId('dock-app-library').click();
  await page.getByTestId('library-updates').click();
  await expect(page.getByTestId('library-update-pi')).toHaveCount(0);
  await expect(page.getByTestId('library-history')).toContainText('1.2.0 → 1.2.1');
  await expect(page.getByText('Package management unavailable.', { exact: false })).toHaveCount(0);
  await page.screenshot({ animations: 'disabled', path: '/tmp/lumo-pi-update-history.png' });
  expect(commands).toEqual(['install', 'update']);
});


test('Pi native provider settings connect with an API key and resume the same chat', async ({ page }) => {
  const fixture = await piPage(page);
  await page.goto('http://localhost:5200'); await page.getByTestId('dock-app-pi').click();
  await expect(page.getByTestId('pi-prompt')).toBeEnabled();
  await page.getByTestId('pi-prompt').fill('Preserve my draft');
  await page.getByTestId('pi-settings-button').click();
  await page.getByRole('button', { name: 'Connect provider', exact: true }).click();
  await page.getByRole('combobox', { name: 'Provider', exact: true }).click();
  await page.getByRole('option', { name: 'Fixture', exact: true }).click();
  await page.getByRole('combobox', { name: 'Sign-in method', exact: true }).click();
  await page.getByRole('option', { name: 'API key', exact: true }).click();
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByTestId('pi-auth-answer')).toHaveAttribute('type', 'password');
  await page.getByTestId('pi-auth-answer').fill('offline-fixture-key');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByText('API key saved', { exact: true })).toBeVisible();
  await expect(page.getByTestId('pi-terminal')).toHaveCount(0);
  await page.screenshot({ path: '/tmp/lumo-pi-providers-light.png', animations: 'disabled' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: '/tmp/lumo-pi-providers-dark.png', animations: 'disabled' });
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByTestId('pi-home-button').click();
  await expect(page.getByTestId('pi-prompt')).toBeEnabled();
  await expect(page.getByTestId('pi-prompt')).toHaveValue('Preserve my draft');
  expect(fixture.starts.at(-1)).toMatchObject({ session: 'first.jsonl' });
});

test('Pi preserves rejected messages and protects drafts during session navigation', async ({ page }) => {
  await piPage(page);
  await page.route('**/api/v1/pi/command', (route) => {
    if (route.request().postDataJSON().command.type !== 'prompt') return route.fallback();
    return route.fulfill({ json: { ok: true, data: { type: 'response', command: 'prompt', success: false, error: 'Choose a connected provider first.' } } });
  });
  await page.goto('http://localhost:5200'); await page.getByTestId('dock-app-pi').click();
  await expect(page.getByTestId('pi-prompt')).toBeEnabled();
  await page.getByTestId('pi-prompt').fill('Keep this draft'); await page.getByTestId('pi-send').click();
  await expect(page.getByRole('alert')).toContainText('Choose a connected provider first.');
  await expect(page.getByTestId('pi-prompt')).toHaveValue('Keep this draft');
  await page.getByRole('navigation', { name: 'Pi projects', exact: true }).getByRole('button', { name: 'Earlier work', exact: true }).click();
  await expect(page.getByTestId('server-app-confirm')).toContainText('Leave conversation?');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByTestId('pi-prompt')).toHaveValue('Keep this draft');
});


test('Pi waits for the old process to stop before resuming another session', async ({ page }) => {
  await piPage(page);
  let stopping = false; let overlapped = false;
  await page.route('**/api/v1/pi/stop', async (route) => { stopping = true; await new Promise((resolve) => setTimeout(resolve, 250)); stopping = false; return route.fallback(); });
  await page.route('**/api/v1/pi/start', (route) => { if (stopping) overlapped = true; return route.fallback(); });
  await page.goto('http://localhost:5200'); await page.getByTestId('dock-app-pi').click();
  await expect(page.getByTestId('pi-prompt')).toBeEnabled();
  await page.getByRole('navigation', { name: 'Pi projects', exact: true }).getByRole('button', { name: 'Earlier work', exact: true }).click();
  await expect(page.getByTestId('pi-messages')).toContainText('Earlier saved conversation.');
  expect(overlapped).toBe(false);
});
