// SPDX-License-Identifier: AGPL-3.0-only
import { spawn } from 'node:child_process';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { test, expect, type Page } from '../offline';
test.use({ serviceWorkers: 'allow' });
async function login(page: Page) {
  await page.goto('/'); await page.getByTestId('login-username').fill('demo'); await page.getByTestId('login-password').fill('demo'); await page.getByTestId('login-submit').click();
  await page.getByTestId('dock-app-library').click();
}
test('Desktop app preview, install, update, rollback and removal', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  await login(page); const card = page.getByTestId('desktop-card-local.server-pulse');
  await card.getByRole('combobox').selectOption('1'.repeat(64));
  await card.getByRole('button', { name: 'Preview', exact: true }).click();
  const preview = page.getByTestId(`window-app:preview.${'1'.repeat(64)}`);
  await expect(preview).toBeVisible();
  const previewFrame = preview.frameLocator('iframe'); await expect(previewFrame.locator('#cpu')).toHaveText('21.5%');
  await previewFrame.getByRole('button', { name: 'Refresh', exact: true }).click(); await expect(previewFrame.locator('#status')).toHaveText('Updated');
  expect(await previewFrame.locator('body').evaluate(() => { try { return parent.document.title; } catch { return 'blocked'; } })).toBe('blocked');
  await page.getByTestId('dock-app-library').click(); await card.getByRole('button', { name: 'Install', exact: true }).click();
  await expect(page.getByTestId('dock-app-app:local.server-pulse')).toBeVisible();
  await card.getByRole('button', { name: 'Open', exact: true }).click();
  const app = page.getByTestId('window-app:local.server-pulse'); await expect(app.frameLocator('iframe').locator('#cpu')).toHaveText('21.5%');
  await page.reload(); await expect(app.frameLocator('iframe').locator('#cpu')).toHaveText('21.5%');
  await page.getByTestId('dock-app-library').click(); await card.getByRole('combobox').selectOption('2'.repeat(64)); await card.getByRole('button', { name: 'Update', exact: true }).click();
  await expect(card).toContainText('0.2.0 · Installed'); await card.getByRole('button', { name: 'Open', exact: true }).click(); await expect(app.frameLocator('iframe').getByRole('heading', { name: 'History' })).toBeVisible();
  await page.getByTestId('dock-app-library').click(); await card.getByRole('button', { name: 'Restore previous version', exact: true }).click(); await expect(card).toContainText('0.1.0 · Installed');
  await card.getByRole('button', { name: 'Disable', exact: true }).click(); await expect(page.getByTestId('dock-app-app:local.server-pulse')).toHaveCount(0);
  await card.getByRole('button', { name: 'Enable', exact: true }).click(); await expect(page.getByTestId('dock-app-app:local.server-pulse')).toBeVisible();
  await card.getByRole('button', { name: 'Uninstall', exact: true }).click();
  await page.getByText('Also move settings and app data to Trash', { exact: true }).click(); await expect(page.getByRole('checkbox', { name: 'Clean uninstall' })).not.toBeChecked();
  await page.getByTestId('server-app-confirm-ok').click(); await expect(page.getByTestId('dock-app-app:local.server-pulse')).toHaveCount(0);
  expect(errors).toEqual([]);
});
test('Desktop apps render in both themes and narrow windows', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  await login(page); const card = page.getByTestId('desktop-card-local.server-pulse'); await card.getByRole('button', { name: 'Install', exact: true }).click();
  for (const colorScheme of ['light', 'dark'] as const) for (const width of [1440, 390]) {
    await page.emulateMedia({ colorScheme }); await page.setViewportSize({ width, height: 900 });
    await page.getByTestId('dock-app-library').click();
    if (width === 1440 && await page.getByTestId('window-library').getAttribute('data-window-placement') !== 'maximized') await page.getByTestId('window-maximize-library').click();
    await expect(card.getByRole('button', { name: 'Open', exact: true })).toBeVisible();
    await page.getByTestId('app-library').screenshot({ path: `/tmp/lumo-app-library-${colorScheme}-${width}.png` });
    await card.getByRole('button', { name: 'Open', exact: true }).click();
    const app = page.getByTestId('window-app:local.server-pulse'); await expect(app.frameLocator('iframe').locator('#cpu')).toHaveText('21.5%');
    if (width === 1440 && await app.getAttribute('data-window-placement') !== 'maximized') await page.getByTestId('window-maximize-app:local.server-pulse').click();
    await app.screenshot({ path: `/tmp/lumo-desktop-app-${colorScheme}-${width}.png` });
  }
  expect(errors).toEqual([]);
});

test('Installed apps support app search, independent windows and recovery startup', async ({ page }) => {
  await login(page);
  const card = page.getByTestId('desktop-card-local.server-pulse');
  await card.getByRole('button', { name: 'Install', exact: true }).click();
  await page.keyboard.press('ControlOrMeta+k');
  const search = page.getByTestId('command-center');
  await search.getByPlaceholder('Search…').fill('Server Pulse');
  await search.getByText('Open Server Pulse', { exact: true }).click();
  await expect(page.getByTestId('desktop-app-frame')).toHaveCount(1);
  await page.getByTestId('dock-app-app:local.server-pulse').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'New Window', exact: true }).click();
  await expect(page.getByTestId('desktop-app-frame')).toHaveCount(2);
  await page.reload();
  await expect(page.getByTestId('desktop-app-frame')).toHaveCount(2);
  for (const iframe of await page.getByTestId('desktop-app-frame').all()) await expect(iframe.contentFrame().locator('#cpu')).toHaveText('21.5%');
  await page.goto('/?recovery=1');
  await expect(page.getByTestId('dock-app-app:local.server-pulse')).toBeVisible();
  await expect(page.getByTestId('desktop-app-frame')).toHaveCount(0);
  await page.getByTestId('dock-app-library').click();
  await card.getByRole('button', { name: 'Disable', exact: true }).click();
  await expect(page.getByTestId('dock-app-app:local.server-pulse')).toHaveCount(0);
});

test('Production gateway hosts real app artifacts with isolated metrics access', async ({ page }) => {
  test.setTimeout(90000);
  const root = process.cwd();
  const child = spawn(path.join(root, '.tools/go/bin/go'), ['test', './internal/gateway', '-run', '^TestDesktopAppBrowserFixture$', '-count=1', '-v'], { cwd: path.join(root, 'server'), env: { ...process.env, LUMO_DESKTOP_BROWSER_FIXTURE: '1', GOPROXY: 'off', GOSUMDB: 'off', GOTOOLCHAIN: 'local', GOMODCACHE: path.join(root, '.tools/gomodcache'), GOCACHE: path.join(root, '.tools/gocache'), GOPATH: path.join(root, '.tools/gopath') }, detached: true });
  let output = ''; child.stdout.on('data', (chunk) => { output += chunk; }); child.stderr.on('data', (chunk) => { output += chunk; });
  try {
    await expect.poll(() => { if (child.exitCode !== null) throw new Error(output); return output.match(/LUMO_DESKTOP_FIXTURE_URL=(http:\/\/[^\s]+)/)?.[1]; }, { timeout: 40000 }).toBeTruthy();
    const url = output.match(/LUMO_DESKTOP_FIXTURE_URL=(http:\/\/[^\s]+)/)![1];
    const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(url); await expect(page).toHaveTitle(/Lumo/i);
    await page.getByTestId('login-username').fill('demo'); await page.getByTestId('login-password').fill('demo'); await page.getByTestId('login-submit').click();
    await page.getByTestId('dock-app-library').click(); const card = page.getByTestId('desktop-card-local.server-pulse');
    await card.getByRole('button', { name: 'Preview', exact: true }).click();
    const iframe = page.getByTestId('desktop-app-frame'); const content = iframe.contentFrame();
    await expect(content.locator('#cpu')).toHaveText(/\d+\.\d%/); await expect(content.locator('#status')).toContainText('Updated');
    expect(await content.locator('body').evaluate(() => { try { return parent.document.cookie; } catch { return 'blocked'; } })).toBe('blocked');
    expect(await content.locator('body').evaluate(async () => { try { await (globalThis as unknown as { lumo: { call(method: string): Promise<unknown> } }).lumo.call('files.read'); return 'allowed'; } catch { return 'blocked'; } })).toBe('blocked');
    expect(await content.locator('body').evaluate(() => new Promise<string>((resolve) => {
      const script = document.createElement('script');
      script.nonce = document.querySelector<HTMLScriptElement>('script[nonce]')!.nonce;
      script.src = 'https://app-external.invalid/probe';
      script.onload = () => resolve('allowed'); script.onerror = () => resolve('blocked');
      document.body.append(script);
    }))).toBe('blocked');
    const frameURL = await iframe.getAttribute('src');
    const response = await page.request.get(url + frameURL!); expect(response.headers()['content-security-policy']).toContain("connect-src 'none'"); expect(response.headers()['x-frame-options']).toBe('SAMEORIGIN');
    await page.screenshot({ path: '/tmp/lumo-app-production.png', animations: 'disabled' });
    await page.getByTestId('dock-app-library').click(); await card.getByRole('button', { name: 'Install', exact: true }).click();
    await expect(page.getByTestId('dock-app-app:local.server-pulse')).toBeVisible();
    await page.getByTestId('dock-app-app:local.server-pulse').click();
    await expect(page.getByTestId('window-app:local.server-pulse').frameLocator('iframe').locator('#cpu')).toHaveText(/\d+\.\d%/);
    await page.reload(); await expect(page.getByTestId('window-app:local.server-pulse').frameLocator('iframe').locator('#cpu')).toHaveText(/\d+\.\d%/);
    expect(errors).toEqual([]);
  } finally {
    const home = output.match(/LUMO_DESKTOP_FIXTURE_HOME=([^\n]+)/)?.[1];
    if (home) { await writeFile(path.join(home.trim(), 'finish'), '').catch(() => {}); await new Promise<void>((resolve) => { const timer = setTimeout(resolve, 2500); child.once('exit', () => { clearTimeout(timer); resolve(); }); }); }
    if (child.pid && child.exitCode === null) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} }
  }
});
