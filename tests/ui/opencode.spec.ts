// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '@playwright/test';

test('OpenCode renders terminal output after application mode queries', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    const data = path.endsWith('/auth/session') ? { user: { name: 'demo', uid: 1000, gid: 1000, home: '/home/user' } }
      : path.endsWith('/apps') ? { canInstall: false, apps: [{ id: 'opencode', installed: true }] } : {};
    return route.fulfill({ json: { ok: true, data } });
  });
  await page.routeWebSocket(/\/api\/v1\/ws/, (socket) => {
    socket.onMessage((raw) => {
      const frame = JSON.parse(String(raw));
      if (frame.type !== 'subscribe' || frame.capability !== 'terminal.open') return;
      socket.send(JSON.stringify({ type: 'subscribed', channel: frame.channel, data: { session: 'terminal-render-check' } }));
      socket.send(JSON.stringify({ type: 'event', channel: frame.channel, seq: 1, data: { kind: 'stdout', data: Buffer.from('\x1b[?1016$p\x1b[?2027$p\x1b[?2031$p\x1b[?1004$p\x1b[?2004$p\x1b[?2026$p\x1b[?1049h\x1b[2J\x1b[HOpenCode terminal ready\r\nProject: /home/user').toString('base64') } }));
    });
  });
  await page.goto('http://localhost:5200');
  await page.getByTestId('dock-app-opencode').click();
  await page.getByTestId('opencode-start').click();
  await expect(page.getByTestId('opencode-terminal')).toContainText('OpenCode terminal ready');
  await page.getByTestId('window-close-opencode').click();
  await page.getByTestId('dock-app-opencode').click();
  await expect(page.getByTestId('opencode-project')).toHaveValue('~');
  await expect(page.getByTestId('opencode-terminal')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('OpenCode setup stays discoverable while the Dock only shows an installed CLI', async ({ page }) => {
  let installed = false;
  await page.routeWebSocket(/\/api\/v1\/ws/, () => {});
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    const data = path.endsWith('/auth/session') ? { user: { name: 'demo', uid: 1000, gid: 1000, home: '/home/user' } }
      : path.endsWith('/apps') ? { canInstall: false, apps: [{ id: 'opencode', installed }] } : {};
    return route.fulfill({ json: { ok: true, data } });
  });
  await page.goto('http://localhost:5200');
  await page.getByTestId('dock-app-library').click();
  await page.getByTestId('library-opencode').click();
  await expect(page.getByTestId('app-library')).toContainText('Install the CLI');
  await expect(page.getByTestId('app-opencode')).toHaveCount(0);
  await expect(page.getByTestId('dock-app-opencode')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Installation guide' })).toHaveAttribute('href', 'https://opencode.ai/docs/');
  installed = true;
  await page.getByRole('menuitem', { name: 'View', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Refresh', exact: true }).click();
  await expect(page.getByTestId('dock-app-opencode')).toBeVisible();
  await page.getByTestId('dock-app-opencode').click();
  await page.getByTestId('opencode-project').fill('relative/path');
  await page.getByTestId('opencode-start').click();
  await expect(page.getByTestId('app-opencode').getByRole('alert')).toContainText('absolute folder path');
  await page.getByTestId('opencode-project').fill('/home/user/my project');
  await page.getByTestId('opencode-start').click();
  await expect(page.getByTestId('opencode-terminal')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Change project', exact: true })).toHaveCount(0);
  await page.getByTestId('dock-app-opencode').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'New Window', exact: true }).click();
  await expect(page.getByTestId('app-opencode')).toHaveCount(2);
  await expect(page.getByTestId('opencode-terminal')).toBeVisible();
  await expect(page.getByTestId('opencode-project')).toHaveValue('~');
  await page.reload();
  await expect(page.getByTestId('app-opencode')).toHaveCount(2);
  await expect(page.getByTestId('opencode-project')).toHaveValue('~');
});
