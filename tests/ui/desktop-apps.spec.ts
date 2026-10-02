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
    await page.getByTestId('dock-app-library').click();
    const counterCard = page.getByTestId('desktop-card-local.counter');
    await expect(counterCard).toContainText('save this app’s data');
    await counterCard.getByRole('button', { name: 'Preview', exact: true }).click();
    const counterFrames = page.getByTestId('desktop-app-frame');
    const previewCounter = counterFrames.last().contentFrame();
    await expect(previewCounter.locator('#count')).toHaveText('0');
    await previewCounter.getByRole('button', { name: 'Add one', exact: true }).click();
    await expect(previewCounter.locator('#count')).toHaveText('1');
    await page.getByTestId('dock-app-library').click();
    await counterCard.getByRole('button', { name: 'Install', exact: true }).click();
    await counterCard.getByRole('button', { name: 'Open', exact: true }).click();
    const counter = page.getByTestId('window-app:local.counter');
    const counterFrame = counter.frameLocator('iframe');
    await expect(counterFrame.locator('#count')).toHaveText('0');
    await counterFrame.getByRole('button', { name: 'Add one', exact: true }).click();
    await expect(counterFrame.locator('#count')).toHaveText('1');
    await page.reload();
    await expect(counterFrame.locator('#count')).toHaveText('1');
    await page.getByTestId('dock-app-app:local.counter').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'New Window', exact: true }).click();
    const second = page.locator('[data-testid^="window-app:local.counter:"]').frameLocator('iframe');
    await expect(second.locator('#count')).toHaveText('1');
    await second.getByRole('button', { name: 'Add one', exact: true }).click();
    await expect(second.locator('#count')).toHaveText('2');
    await page.getByTestId('window-minimize-' + (await page.locator('[data-testid^="window-app:local.counter:"]').getAttribute('data-testid'))!.slice('window-'.length)).click();
    await counterFrame.getByRole('button', { name: 'Add one', exact: true }).click();
    await expect(counterFrame.locator('#status')).toContainText('Changed in another window');
    await expect(counterFrame.locator('#count')).toHaveText('1');
    await counterFrame.getByRole('button', { name: 'Reload saved count', exact: true }).click();
    await expect(counterFrame.locator('#count')).toHaveText('2');
    for (const colorScheme of ['light', 'dark'] as const) for (const width of [1440, 390]) {
      await page.emulateMedia({ colorScheme }); await page.setViewportSize({ width, height: 900 });
      await expect(counterFrame.getByRole('button', { name: 'Add one', exact: true })).toBeVisible();
      await counter.screenshot({ path: `/tmp/lumo-counter-${colorScheme}-${width}.png` });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByTestId('dock-app-library').click();
    const notesCard = page.getByTestId('desktop-card-local.notes');
    await notesCard.getByRole('button', { name: 'Install', exact: true }).click();
    await notesCard.getByRole('button', { name: 'Open', exact: true }).click();
    const notes = page.getByTestId('window-app:local.notes');
    const editor = notes.frameLocator('iframe').getByRole('textbox', { name: 'Note', exact: true });
    await editor.fill('Keep this draft');
    await expect(notes.frameLocator('iframe').getByRole('status')).toHaveText('Unsaved changes');
    await page.getByTestId('window-close-app:local.notes').click();
    const discard = page.getByRole('alertdialog', { name: 'Discard unsaved app changes?' });
    await expect(discard).toBeVisible();
    await discard.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(editor).toHaveValue('Keep this draft');
    let finishSave!: () => void;
    const saveGate = new Promise<void>((resolve) => { finishSave = resolve; });
    await page.route('**/api/v1/desktop-apps/call', async (route) => { if (route.request().postDataJSON().method === 'app.storage.set') await saveGate; await route.continue(); });
    await notes.frameLocator('iframe').getByRole('button', { name: 'Save', exact: true }).click();
    await expect(notes.frameLocator('iframe').getByRole('status')).toHaveText('Saving');
    await page.getByTestId('window-close-app:local.notes').click();
    await expect(discard.getByText('Wait for the current save to finish.')).toBeVisible();
    await expect(discard.getByTestId('server-app-confirm-ok')).toBeDisabled();
    finishSave();
    await expect(notes).toHaveCount(0);
    await page.unroute('**/api/v1/desktop-apps/call');
    await page.getByTestId('dock-app-app:local.notes').click();
    await expect(editor).toHaveValue('Keep this draft');
    await editor.fill('Unsaved during disable');
    await page.getByTestId('dock-app-library').click();
    await notesCard.getByRole('button', { name: 'Disable', exact: true }).click();
    await expect(discard).toBeVisible();
    await discard.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(editor).toHaveValue('Unsaved during disable');
    await expect(page.getByTestId('dock-app-app:local.notes')).toBeVisible();
    await page.getByTestId('dock-app-library').click();
    await notesCard.getByRole('button', { name: 'Disable', exact: true }).click();
    await discard.getByRole('button', { name: 'Discard changes', exact: true }).click();
    await expect(page.getByTestId('dock-app-app:local.notes')).toHaveCount(0);
    await page.getByTestId('dock-app-library').click();
    await notesCard.getByRole('button', { name: 'Enable', exact: true }).click();
    await notesCard.getByRole('button', { name: 'Open', exact: true }).click();
    await expect(editor).toHaveValue('Keep this draft');
    await editor.fill('Keep across an external change');
    const catalogReply = await page.request.get(url + '/api/v1/desktop-apps');
    const activeNote = (await catalogReply.json()).data.apps.find((item: { manifest: { id: string } }) => item.manifest.id === 'local.notes');
    const csrf = (await page.context().cookies()).find((cookie) => cookie.name === 'lumo_csrf')!.value;
    const disabled = await page.request.post(url + '/api/v1/desktop-apps/action', { headers: { 'X-Lumo-CSRF': csrf }, data: { requestId: crypto.randomUUID(), action: 'disable', id: 'local.notes', revision: activeNote.revision } });
    expect(disabled.ok()).toBeTruthy();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(notes.getByText('This app changed elsewhere. Copy your unsaved work before reloading.')).toBeVisible();
    await expect(editor).toHaveValue('Keep across an external change');
    await notes.getByRole('button', { name: 'Reload app', exact: true }).click();
    await expect(discard).toBeVisible();
    for (const colorScheme of ['light', 'dark'] as const) for (const width of [1440, 390]) {
      await page.emulateMedia({ colorScheme }); await page.setViewportSize({ width, height: 900 });
      await notes.screenshot({ path: `/tmp/lumo-notes-guard-${colorScheme}-${width}.png` });
    }
    await discard.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(editor).toHaveValue('Keep across an external change');
    await notes.getByRole('button', { name: 'Reload app', exact: true }).click();
    await discard.getByRole('button', { name: 'Discard changes', exact: true }).click();
    await expect(notes.getByText('This app is disabled, removed, or still loading.')).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    const home = output.match(/LUMO_DESKTOP_FIXTURE_HOME=([^\n]+)/)?.[1];
    if (home) { await writeFile(path.join(home.trim(), 'finish'), '').catch(() => {}); await new Promise<void>((resolve) => { const timer = setTimeout(resolve, 2500); child.once('exit', () => { clearTimeout(timer); resolve(); }); }); }
    if (child.pid && child.exitCode === null) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} }
  }
});
