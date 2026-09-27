// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '@playwright/test';

test('Monitor combines resources, processes and logs; Updates belongs to Settings', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByTestId('login-username').fill('demo');
  await page.getByTestId('login-password').fill('demo');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('dock-app-logs')).toHaveCount(0);
  await expect(page.getByTestId('dock-app-updates')).toHaveCount(0);
  await page.getByTestId('dock-app-home').click();
  await expect(page.getByTestId('window-home')).toHaveAccessibleName('Monitor');
  await page.getByTestId('monitor-section-cpu').click();
  await expect(page.locator('[data-testid^="cpu-core-"]')).toHaveCount(8);
  await page.screenshot({ path: '/tmp/lumo-monitor-cpu.png', animations: 'disabled' });
  await page.getByTestId('monitor-section-activity').click();
  await page.getByRole('textbox', { name: 'Filter processes' }).fill('nginx');
  await expect(page.getByTestId('monitor-activity')).toContainText('www-data');
  await expect(page.getByTestId('process-482')).toHaveCount(0);
  await page.getByTestId('monitor-section-logs').click();
  await expect(page.getByTestId('app-logs')).toBeVisible();
  await page.getByTestId('dock-app-settings').click();
  await page.getByTestId('settings-section-updates').click();
  await expect(page.getByTestId('app-updates')).toBeVisible();
  await page.getByTestId('dock-app-home').click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId('monitor-section-cpu').click();
  await expect(page.getByTestId('cpu-core-0')).toBeVisible();
  await page.screenshot({ path: '/tmp/lumo-monitor-compact.png', animations: 'disabled' });
  expect(errors).toEqual([]);
});

test('Dock menus sit above icons and Trash offers confirmed emptying', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('login-username').fill('demo');
  await page.getByTestId('login-password').fill('demo');
  await page.getByTestId('login-submit').click();
  const icon = page.getByTestId('dock-app-files');
  await icon.click({ button: 'right' });
  const menu = page.getByTestId('context-menu');
  await expect(menu.getByRole('menuitem', { name: /Move (Left|Right)/ })).toHaveCount(0);
  const anchor = await icon.boundingBox();
  const bounds = await menu.boundingBox();
  expect(bounds!.y + bounds!.height).toBeLessThan(anchor!.y);
  await page.keyboard.press('Escape');
  await icon.click();
  await page.getByTestId('file-row-notes.txt').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Move to Trash', exact: true }).click();
  await page.getByTestId('delete-confirm-button').click();
  await page.getByTestId('dock-app-trash').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Empty Trash…', exact: true }).click();
  await expect(page.getByTestId('server-app-confirm')).toContainText('cannot be undone');
  await page.getByTestId('server-app-confirm').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId('app-trash')).toContainText('notes.txt');
});

test('Files remembers dotfile visibility and opens each folder as an OpenCode workspace', async ({ page }) => {
  const workspaces: string[] = [];
  await page.routeWebSocket(/\/api\/v1\/ws/, (socket) => socket.onMessage((raw) => {
    const frame = JSON.parse(String(raw));
    if (frame.type === 'subscribe' && frame.capability === 'terminal.open') workspaces.push(frame.params.directory);
  }));
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    const data = path.endsWith('/auth/session') ? { user: { name: 'demo', uid: 1000, gid: 1000, home: '/home/user' } }
      : path.endsWith('/apps') ? { canInstall: false, apps: [{ id: 'opencode', installed: true }] }
      : path.endsWith('/files/list') ? { path: '/home/user', entries: ['workspace one', 'workspace two', '.config', '.profile'].map((name) => ({ name, type: name === '.profile' ? 'file' : 'directory', sizeBytes: 0, modifiedAt: '2026-09-26T12:00:00Z' })) } : {};
    return route.fulfill({ json: { ok: true, data } });
  });
  await page.goto('http://localhost:5200');
  await page.getByTestId('dock-app-files').click();
  await expect(page.getByTestId('file-row-workspace one')).toBeVisible();
  await expect(page.getByTestId('file-row-.config')).toHaveCount(0);
  await page.getByTestId('files-view').click();
  await page.getByRole('menuitem', { name: 'Show Hidden Files', exact: true }).click();
  await expect(page.getByTestId('file-row-.config')).toBeVisible();
  await expect(page.getByTestId('file-row-.profile')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('file-row-.profile')).toBeVisible();
  await page.getByTestId('file-row-.profile').press('ControlOrMeta+Shift+h');
  await expect(page.getByTestId('file-row-.profile')).toHaveCount(0);
  for (const name of ['workspace one', 'workspace two']) {
    await page.getByTestId('dock-app-files').click();
    await page.getByTestId(`file-row-${name}`).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Open in OpenCode', exact: true }).click();
  }
  await expect(page.getByTestId('app-opencode')).toHaveCount(2);
  await expect.poll(() => [...new Set(workspaces)]).toEqual(['/home/user/workspace one', '/home/user/workspace two']);
  const subscriptions = workspaces.length;
  await page.getByTestId('dock-app-files').click();
  await page.getByTestId('file-row-workspace one').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Open in OpenCode', exact: true }).click();
  await expect(page.getByTestId('app-opencode')).toHaveCount(2);
  expect(workspaces.length).toBe(subscriptions);
});

for (const legacy of ['logs', 'updates', 'services']) {
  test(`saved ${legacy} windows migrate into their new parent app`, async ({ page }) => {
    await page.goto('/');
    await page.evaluate((appId) => {
      localStorage.setItem('lumo.session.v1', JSON.stringify({ user: 'demo' }));
      localStorage.setItem('lumo.windows.v1:demo', JSON.stringify({ windows: { [appId]: { appId, x: 100, y: 70, w: 850, h: 540, z: 4, minimized: false, maximized: false, snapped: null, restore: null } }, zTop: 4, focused: appId }));
    }, legacy);
    await page.reload();
    await expect(page.getByTestId(`app-${legacy}`)).toBeVisible();
    await expect(page.getByTestId(legacy === 'updates' ? 'window-settings' : 'window-home')).toBeVisible();
    await expect(page.getByTestId(`window-${legacy}`)).toHaveCount(0);
  });
}
