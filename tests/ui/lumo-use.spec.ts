// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '../offline';
import { piPage } from './pi-fixture';
import type { DesktopRequest } from '../../src/api/lumo-use';

type Fixture = Awaited<ReturnType<typeof piPage>>;
async function request(fixture: Fixture, params: Omit<DesktopRequest, 'id' | 'expiresAt'>) {
  const id = fixture.requestDesktop(params);
  await expect.poll(() => fixture.desktopResults.some((result) => result.desktopId === id)).toBe(true);
  return fixture.desktopResults.find((result) => result.desktopId === id)!;
}
function control(text: string, label: string, kind?: string) {
  const records = text.split('\n').filter((line) => line.startsWith('{')).map((line) => JSON.parse(line));
  const record = records.find((item) => item.label === label && (!kind || item.role === kind));
  expect(record, label).toBeTruthy();
  return { target: record.target as string, label: record.label as string };
}
async function open(page: import('@playwright/test').Page) {
  const fixture = await piPage(page);
  const entries = [{ name: 'Documents', type: 'directory', sizeBytes: 0, modifiedAt: '2026-09-29T00:00:00Z', mode: 493 }];
  await page.route('**/api/v1/files/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    const data = path.endsWith('/list') ? { path: '/home/user', entries } : path.endsWith('/pins') ? { paths: [] } : { home: '/home/user', locations: [], revision: 'initial' };
    return route.fulfill({ json: { ok: true, data } });
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('http://localhost:5200'); await page.getByTestId('dock-app-pi').click();
  await expect(page.getByTestId('pi-prompt')).toBeEnabled();
  return fixture;
}

test('Lumo Use observes text, opens Files, fills a dialog, cancels by key and rejects stale targets', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  const fixture = await open(page);
  await page.getByTestId('pi-prompt').fill('Private draft remains in Pi');
  let result = await request(fixture, { action: 'observe' });
  expect(result.error).toBe(false); expect(result.text).not.toContain('Private draft remains in Pi'); expect(result.text).not.toContain('Approve for me');
  for (const label of ['Approve', 'Send', 'Stop']) expect(result.text).not.toContain(`"label":"${label}"`);
  result = await request(fixture, { action: 'click', ...control(result.text, 'Files') });
  expect(result.error, result.text).toBe(false);
  await expect(page.getByTestId('app-files')).toBeVisible(); await expect(page.getByTestId('file-row-Documents')).toBeVisible();
  result = await request(fixture, { action: 'observe' });
  const old = control(result.text, 'Refresh folder');
  result = await request(fixture, { action: 'double_click', ...control(result.text, 'Documents') });
  expect(result.error, result.text).toBe(false);
  await expect(page.getByTestId('files-absolute-path')).toContainText('Documents');
  const stale = await request(fixture, { action: 'click', ...old }); expect(stale.error).toBe(true); expect(stale.text).toMatch(/stale/);
  result = await request(fixture, { action: 'observe' });
  result = await request(fixture, { action: 'click', ...control(result.text, 'New') });
  result = await request(fixture, { action: 'click', ...control(result.text, 'New Folder') });
  expect(result.error, result.text).toBe(false);
  await expect(page.getByTestId('files-create-dialog')).toBeVisible();
  result = await request(fixture, { action: 'fill', ...control(result.text, 'Name'), text: 'Agent folder draft' });
  expect(result.error, result.text).toBe(false); await expect(page.getByTestId('files-create-dialog').getByRole('textbox')).toHaveValue('Agent folder draft');
  result = await request(fixture, { action: 'press', ...control(result.text, 'Name'), key: 'End' });
  result = await request(fixture, { action: 'press', ...control(result.text, 'Name'), key: 'Backspace' });
  await expect(page.getByTestId('files-create-dialog').getByRole('textbox')).toHaveValue('Agent folder draf');
  result = await request(fixture, { action: 'press', ...control(result.text, 'Name'), key: 'Escape' });
  expect(result.error, result.text).toBe(false); await expect(page.getByTestId('files-create-dialog')).toHaveCount(0);
  await expect(page.getByTestId('pi-prompt')).toHaveText('Private draft remains in Pi');
  expect(errors).toEqual([]);
});

test('Lumo Use validates labels, rejects disabled controls and serializes window drag with observation', async ({ page }) => {
  const fixture = await open(page);
  let result = await request(fixture, { action: 'observe' });
  const files = control(result.text, 'Files');
  const mismatch = await request(fixture, { action: 'click', target: files.target, label: 'Approve' });
  expect(mismatch.error).toBe(true);
  expect(mismatch.text).toContain('Label mismatch: expected "Files", received "Approve"');
  expect(mismatch.text).toContain('No action was performed');
  result = await request(fixture, { action: 'click', ...files });
  result = await request(fixture, { action: 'click', ...control(result.text, 'Back') });
  expect(result.error).toBe(true); expect(result.text).toContain('unavailable');
  result = await request(fixture, { action: 'observe' });
  const before = await page.getByTestId('window-files').boundingBox();
  const title = await page.getByTestId('window-files').locator('.window-titlebar').boundingBox();
  result = await request(fixture, { action: 'drag', ...control(result.text, 'Files', 'window title'), deltaX: 70, deltaY: 40 });
  await expect(page.getByTestId('lumo-use-cursor')).toHaveAttribute('data-x', String(title!.x + title!.width / 2 + 70));
  await expect(page.getByTestId('lumo-use-cursor')).toHaveAttribute('data-y', String(title!.y + title!.height / 2 + 40));
  expect(result.error, result.text).toBe(false);
  const after = await page.getByTestId('window-files').boundingBox(); expect(after!.x - before!.x).toBe(70); expect(after!.y - before!.y).toBe(40);
});

test('Spatial observations let an assistant resize and place Settings clear of its protected floating panel', async ({ page }) => {
  const fixture = await piPage(page);
  await page.route('**/api/v1/system/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    const data = path.endsWith('/settings') ? { runtimeHostname: 'lumo-test', timezone: 'Etc/UTC', serverTime: '2026-09-29T12:00:00Z', revision: 'initial', available: true, canEdit: true }
      : path.endsWith('/identity') ? { hostname: 'lumo-test', os: { prettyName: 'Ubuntu test', kernel: 'test' }, architecture: 'aarch64' }
      : { cpu: { usagePercent: 5, cores: 4 }, network: [], disks: [] };
    return route.fulfill({ json: { ok: true, data } });
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('http://localhost:5200');
  await page.getByTestId('pi-tray-button').click(); await page.getByTestId('pi-tray-toggle').click();
  await expect(page.getByTestId('pi-compact-prompt')).toBeEnabled();
  await page.getByTestId('pi-compact-prompt').fill('Secret assistant draft');
  const geometry = (text: string) => JSON.parse(text.split('\n').find((line) => line.startsWith('Desktop geometry: '))!.slice('Desktop geometry: '.length));
  const windows = (text: string) => text.split('\n').filter((line) => line.startsWith('Window: ')).map((line) => JSON.parse(line.slice('Window: '.length)));
  let result = await request(fixture, { action: 'observe' });
  const desktop = geometry(result.text);
  expect(desktop.viewport).toEqual({ w: 1440, h: 1000 });
  expect(desktop.workArea.y).toBe(32);
  expect(desktop.workArea.y + desktop.workArea.h).toBeLessThan(1000);
  const assistant = windows(result.text).find((window) => window.label === 'Pi assistant');
  expect(assistant).toMatchObject({ protected: true, canDrag: false, canResize: false });
  const assistantBox = (await page.getByTestId('pi-assistant').boundingBox())!;
  expect(assistant.bounds.x).toBeCloseTo(assistantBox.x, 0);
  expect(assistant.bounds.h).toBeCloseTo(assistantBox.height, 0);
  expect(result.text).not.toContain('Secret assistant draft');
  expect(result.text).not.toContain('"label":"Approval mode"');
  result = await request(fixture, { action: 'click', ...control(result.text, 'Settings', 'button') });
  expect(result.error, result.text).toBe(false);
  let settings = windows(result.text).find((window) => window.id === 'settings');
  expect(settings, result.text).toMatchObject({ label: 'Settings', mode: 'floating', minSize: { w: 440, h: 340 }, canDrag: true, canResize: true });
  const titleRecord = result.text.split('\n').filter((line) => line.startsWith('{')).map((line) => JSON.parse(line)).find((item) => item.label === 'Settings' && item.role === 'window title');
  expect(titleRecord.window).toBe('settings'); expect(titleRecord.bounds.w).toBe(settings.bounds.w - 2);
  const layer = settings.z;
  result = await request(fixture, { action: 'resize', ...control(result.text, 'Settings', 'window title'), width: 560, height: 420 });
  expect(result.error, result.text).toBe(false);
  settings = windows(result.text).find((window) => window.id === 'settings');
  expect(settings.bounds).toMatchObject({ w: 560, h: 420 }); expect(settings.z).toBe(layer);
  result = await request(fixture, { action: 'drag', ...control(result.text, 'Settings', 'window title'), deltaX: 32 - settings.bounds.x, deltaY: 64 - settings.bounds.y });
  expect(result.error, result.text).toBe(false);
  settings = windows(result.text).find((window) => window.id === 'settings');
  expect(settings.bounds).toEqual({ x: 32, y: 64, w: 560, h: 420 });
  expect(settings.bounds.x + settings.bounds.w).toBeLessThan(assistant.bounds.x);
  result = await request(fixture, { action: 'resize', ...control(result.text, 'Settings', 'window title'), width: 1, height: 1 });
  expect(result.error, result.text).toBe(false);
  settings = windows(result.text).find((window) => window.id === 'settings');
  expect(settings.bounds).toMatchObject({ w: 440, h: 340 });
  result = await request(fixture, { action: 'resize', ...control(result.text, 'Settings', 'window title'), width: 8192, height: 8192 });
  expect(result.error, result.text).toBe(false);
  settings = windows(result.text).find((window) => window.id === 'settings');
  expect(settings.bounds.x).toBe(0); expect(settings.bounds.y).toBe(32);
  expect(settings.bounds.w).toBe(1440); expect(settings.bounds.h).toBeCloseTo(desktop.workArea.h, 0);
  const stale = control(result.text, 'Settings', 'window title');
  await page.getByTestId('pi-tray-button').click();
  const blocked = await request(fixture, { action: 'resize', ...stale, width: 560, height: 420 });
  expect(blocked.error).toBe(true); expect(blocked.text).toContain('geometry changed');
  await page.keyboard.press('Escape');
  result = await request(fixture, { action: 'observe' });
  const invalid = await request(fixture, { action: 'resize', ...control(result.text, 'Settings', 'window title'), width: -1, height: 420 });
  expect(invalid.error).toBe(true); expect(invalid.text).toContain('integer width and height');
  await page.setViewportSize({ width: 390, height: 844 });
  const changedViewport = await request(fixture, { action: 'resize', ...control(result.text, 'Settings', 'window title'), width: 560, height: 420 });
  expect(changedViewport.error).toBe(true); expect(changedViewport.text).toContain('geometry changed');
  result = await request(fixture, { action: 'observe' });
  settings = windows(result.text).find((window) => window.id === 'settings');
  expect(settings).toMatchObject({ mode: 'compact', canDrag: false, canResize: false });
  const compact = await request(fixture, { action: 'resize', ...control(result.text, 'Settings', 'window title'), width: 560, height: 420 });
  expect(compact.error).toBe(true); expect(compact.text).toContain('desktop-sized');
  await page.setViewportSize({ width: 1440, height: 1000 });
  result = await request(fixture, { action: 'observe' });
  result = await request(fixture, { action: 'click', ...control(result.text, 'Maximize Settings') });
  expect(result.error, result.text).toBe(false);
  settings = windows(result.text).find((window) => window.id === 'settings');
  expect(settings).toMatchObject({ mode: 'maximized', canDrag: false, canResize: false });
  const maximized = await request(fixture, { action: 'resize', ...control(result.text, 'Settings', 'window title'), width: 560, height: 420 });
  expect(maximized.error).toBe(true); expect(maximized.text).toContain('floating window');
});

test('Lumo Use rejects malformed targets with correction instructions and accepts only exact JSON fields', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  const fixture = await open(page);
  await page.route('**/api/v1/system/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    const data = path.endsWith('/settings') ? { runtimeHostname: 'lumo-test', timezone: 'Etc/UTC', serverTime: '2026-09-29T12:00:00Z', revision: 'initial', available: true, canEdit: true }
      : path.endsWith('/identity') ? { hostname: 'lumo-test', os: { prettyName: 'Ubuntu test', kernel: 'test' }, architecture: 'aarch64' }
      : path.endsWith('/overview') ? { uptimeSeconds: 86400, memoryUsedBytes: 1073741824, memoryTotalBytes: 4294967296, failedUnits: 0, updatesPending: 0, securityUpdatesPending: 0 }
      : { cpu: { usagePercent: 5, cores: 4 }, network: [], disks: [{ mount: '/', usedBytes: 1073741824, totalBytes: 10737418240 }] };
    return route.fulfill({ json: { ok: true, data } });
  });
  let result = await request(fixture, { action: 'observe' });
  expect(result.text).toContain('copy the target and label string values exactly');
  const settings = control(result.text, 'Settings', 'button');
  for (const target of [`[${settings.target}]`, `[[${settings.target}]]`, ` ${settings.target} `, `"${settings.target}"`, `${settings.target}:unknown`]) {
    const invalid = await request(fixture, { action: 'click', target, label: settings.label });
    expect(invalid.error).toBe(true);
    expect(invalid.text).toContain('Invalid target format');
    expect(invalid.text).toContain('Copy the target string value exactly');
    expect(invalid.text).toContain('No action was performed');
    await expect(page.getByTestId('app-settings')).toHaveCount(0);
  }
  const unknown = await request(fixture, { action: 'click', target: `${settings.target.split(':')[0]}:1000`, label: settings.label });
  expect(unknown.error).toBe(true);
  expect(unknown.text).toContain('absent from the latest observation');
  expect(unknown.text).toContain('Call lumo_observe');
  const mismatch = await request(fixture, { action: 'click', target: settings.target, label: 'Files' });
  expect(mismatch.error).toBe(true);
  expect(mismatch.text).toContain('Label mismatch: expected "Settings", received "Files"');
  await expect(page.getByTestId('app-settings')).toHaveCount(0);
  result = await request(fixture, { action: 'click', ...settings });
  expect(result.error, result.text).toBe(false);
  await expect(page.getByTestId('app-settings')).toBeVisible();
  const stale = await request(fixture, { action: 'click', ...settings });
  expect(stale.error).toBe(true);
  expect(stale.text).toContain('stale');
  const close = control(result.text, 'Close Settings');
  result = await request(fixture, { action: 'click', ...close });
  expect(result.error, result.text).toBe(false);
  await expect(page.getByTestId('app-settings')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Lumo Use reports changed values and expired observations so the model can observe and retry', async ({ page }) => {
  const fixture = await open(page);
  let result = await request(fixture, { action: 'observe' });
  result = await request(fixture, { action: 'click', ...control(result.text, 'Files') });
  result = await request(fixture, { action: 'click', ...control(result.text, 'New') });
  result = await request(fixture, { action: 'click', ...control(result.text, 'New Folder') });
  const field = control(result.text, 'Name');
  const input = page.getByTestId('files-create-dialog').getByRole('textbox');
  await input.fill('Changed by the user');
  const changed = await request(fixture, { action: 'fill', ...field, text: 'Model replacement' });
  expect(changed.error).toBe(true);
  expect(changed.text).toContain('Control value changed since observation');
  expect(changed.text).toContain('Call lumo_observe');
  await expect(input).toHaveValue('Changed by the user');
  result = await request(fixture, { action: 'observe' });
  result = await request(fixture, { action: 'fill', ...control(result.text, 'Name'), text: 'Corrected after observing' });
  expect(result.error, result.text).toBe(false);
  await expect(input).toHaveValue('Corrected after observing');
  const fresh = control(result.text, 'Name');
  await page.clock.setFixedTime(new Date(Date.now() + 61001));
  const expired = await request(fixture, { action: 'fill', ...fresh, text: 'Expired replacement' });
  expect(expired.error).toBe(true);
  expect(expired.text).toContain('Observation expired');
  expect(expired.text).toContain('Call lumo_observe');
  await expect(input).toHaveValue('Corrected after observing');
});

test('Extensions toggle is precise, persists and reloads an idle chat without losing its draft', async ({ page }) => {
  const fixture = await open(page);
  await page.getByTestId('pi-prompt').fill('Keep this draft');
  await page.getByTestId('pi-settings-button').click(); await page.getByRole('tab', { name: 'Extensions', exact: true }).click();
  const toggle = page.getByTestId('pi-lumo-use'); await expect(toggle).toBeChecked();
  await page.getByText('Let Pi observe and operate this desktop.', { exact: true }).click(); await expect(toggle).toBeChecked();
  const count = fixture.starts.length; await toggle.click();
  await expect(toggle).not.toBeChecked(); await expect.poll(() => fixture.starts.length).toBeGreaterThan(count);
  await expect(toggle).toBeEnabled(); await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  for (const width of [1440, 390]) for (const colorScheme of ['light', 'dark'] as const) {
    await page.setViewportSize({ width, height: 900 }); await page.emulateMedia({ colorScheme });
    await expect(toggle).toBeVisible();
    await page.getByTestId('app-pi').screenshot({ path: `/tmp/lumo-use-settings-${width}-${colorScheme}.png` });
  }
  await page.getByTestId('pi-home-button').click(); await expect(page.getByTestId('pi-prompt')).toHaveText('Keep this draft');
  await page.getByTestId('pi-settings-button').click(); await page.getByRole('tab', { name: 'Extensions', exact: true }).click();
  await expect(toggle).not.toBeChecked(); await toggle.click(); await expect(toggle).toBeChecked();
  await expect(toggle).toBeEnabled(); await page.getByTestId('pi-home-button').click();
  const result = await request(fixture, { action: 'observe' }); expect(result.error).toBe(false);
});


test('Stop prevents an action whose claim response arrives late', async ({ page }) => {
  const fixture = await open(page);
  await page.getByTestId('pi-prompt').fill('Use the desktop'); await page.getByTestId('pi-send').click();
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
  const snapshot = await request(fixture, { action: 'observe' });
  let release!: () => void; let claimed = false;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let actionId = '';
  await page.route('**/api/v1/pi/desktop/claim', async (route) => {
    const body = route.request().postDataJSON();
    claimed = true; await gate;
    return route.fulfill({ json: { ok: true, data: { id: body.desktopId, action: 'click', ...control(snapshot.text, 'Files'), expiresAt: Date.now() + 30000 } } });
  });
  actionId = fixture.requestDesktop({ action: 'click', ...control(snapshot.text, 'Files') });
  await expect.poll(() => claimed).toBe(true);
  try { await page.getByRole('button', { name: 'Stop', exact: true }).click(); await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0); }
  finally { release(); }
  await expect.poll(() => fixture.desktopResults.some((result) => result.desktopId === actionId)).toBe(true);
  expect(fixture.desktopResults.find((result) => result.desktopId === actionId)?.error).toBe(true);
  await expect(page.getByTestId('app-files')).toHaveCount(0);
});


test('Lumo Use discovers and scrolls a Files pane with many rows', async ({ page }) => {
  const fixture = await open(page);
  await page.route('**/api/v1/files/list*', (route) => route.fulfill({ json: { ok: true, data: { path: '/home/user', entries: Array.from({ length: 80 }, (_, index) => ({ name: `Folder ${index}`, type: 'directory', sizeBytes: 0, modifiedAt: '2026-09-29T00:00:00Z', mode: 493 })) } } }));
  let result = await request(fixture, { action: 'observe' });
  result = await request(fixture, { action: 'click', ...control(result.text, 'Files') });
  await expect(page.getByTestId('file-row-Folder 0')).toBeVisible();
  result = await request(fixture, { action: 'observe' });
  result = await request(fixture, { action: 'scroll', ...control(result.text, 'Files content', 'scroll region'), deltaY: 600 });
  expect(result.error, result.text).toBe(false);
  await expect.poll(() => page.locator('.files-table-scroll').evaluate((node) => node.scrollTop)).toBeGreaterThan(500);
});

test('Duplicated tabs get distinct desktop identities while reload keeps ownership', async ({ page, context }) => {
  await open(page);
  const firstId = await page.evaluate(() => sessionStorage.getItem('lumo.desktop.client'));
  expect(firstId).toBeTruthy();
  const clone = await context.newPage();
  try {
    await piPage(clone);
    await clone.addInitScript((id) => sessionStorage.setItem('lumo.desktop.client', id!), firstId);
    await clone.goto('http://localhost:5200'); await clone.getByTestId('dock-app-pi').click();
    await expect(clone.getByTestId('pi-prompt')).toBeEnabled();
    const secondId = await clone.evaluate(() => sessionStorage.getItem('lumo.desktop.client'));
    expect(secondId).not.toBe(firstId);
    await page.reload(); await expect(page.getByTestId('pi-prompt')).toBeEnabled();
    expect(await page.evaluate(() => sessionStorage.getItem('lumo.desktop.client'))).toBe(firstId);
  } finally { await clone.close(); }
});

test('Visual cursor follows actions, stays passive and uses pure theme colors', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  const fixture = await open(page);
  const cursor = page.getByTestId('lumo-use-cursor');
  let result = await request(fixture, { action: 'observe' });
  await expect(cursor).toBeHidden();
  const filesBox = await page.getByTestId('dock-app-files').boundingBox();
  result = await request(fixture, { action: 'click', ...control(result.text, 'Files') });
  expect(result.error, result.text).toBe(false);
  await expect(cursor).toBeVisible();
  await expect(cursor).toHaveAttribute('data-x', String(filesBox!.x + filesBox!.width / 2));
  await expect(cursor).toHaveAttribute('data-y', String(filesBox!.y + filesBox!.height / 2));
  await expect(cursor).toHaveCSS('pointer-events', 'none');
  await expect(cursor).toHaveAttribute('aria-hidden', 'true');
  expect(await cursor.evaluate((node) => parseFloat(getComputedStyle(node).transitionDuration))).toBeLessThan(0.001);
  expect(result.text).not.toContain('lumo-use-cursor');
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await expect(cursor).toHaveCSS('color', colorScheme === 'light' ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)');
    await expect(cursor.locator('path')).toHaveCSS('fill', colorScheme === 'light' ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)');
    await expect(cursor.locator('path')).toHaveCSS('stroke', colorScheme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(0, 0, 0)');
    result = await request(fixture, { action: 'observe' });
    result = await request(fixture, { action: 'click', ...control(result.text, 'New') });
    expect(result.error, result.text).toBe(false);
    await page.getByTestId('window-files').screenshot({ path: `/tmp/lumo-cursor-${colorScheme}.png` });
    const bounds = (await cursor.boundingBox())!;
    await page.screenshot({path: `/tmp/lumo-cursor-outline-${colorScheme}.png`, clip:{x:bounds.x-12,y:bounds.y-12,width:44,height:44}});
    await page.keyboard.press('Escape');
  }
  result = await request(fixture, { action: 'observe' });
  result = await request(fixture, { action: 'double_click', ...control(result.text, 'Documents') });
  expect(result.error, result.text).toBe(false);
  expect(await cursor.evaluate((node) => node.style.getPropertyValue('--cursor-clicks'))).toBe('2');
  await expect(page.getByTestId('files-absolute-path')).toContainText('Documents');
  await expect(cursor).toBeHidden({ timeout: 3000 });
  expect(errors).toEqual([]);
});

test('Stop cancels cursor movement before clicking and hides it immediately', async ({ page }) => {
  const fixture = await open(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.getByTestId('pi-prompt').fill('Use the desktop'); await page.getByTestId('pi-send').click();
  const snapshot = await request(fixture, { action: 'observe' });
  await page.getByRole('button', { name: 'Stop', exact: true }).focus();
  const id = fixture.requestDesktop({ action: 'click', ...control(snapshot.text, 'Files') });
  const cursor = page.getByTestId('lumo-use-cursor');
  await expect(cursor).toHaveAttribute('data-phase', 'move');
  await page.keyboard.press('Enter');
  await expect(cursor).toBeHidden();
  await expect.poll(() => fixture.desktopResults.some((result) => result.desktopId === id)).toBe(true);
  expect(fixture.desktopResults.find((result) => result.desktopId === id)?.error).toBe(true);
  await expect(page.getByTestId('app-files')).toHaveCount(0);
});

test('A target changed during cursor motion is rechecked before performing the action', async ({ page }) => {
  const fixture = await open(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const snapshot = await request(fixture, { action: 'observe' });
  const id = fixture.requestDesktop({ action: 'click', ...control(snapshot.text, 'Files') });
  await expect(page.getByTestId('lumo-use-cursor')).toHaveAttribute('data-phase', 'move');
  await page.getByTestId('dock-app-files').evaluate((node) => { (node as HTMLButtonElement).disabled = true; });
  await expect.poll(() => fixture.desktopResults.some((result) => result.desktopId === id)).toBe(true);
  const result = fixture.desktopResults.find((result) => result.desktopId === id)!;
  expect(result.error).toBe(true); expect(result.text).toContain('disabled');
  await expect(page.getByTestId('app-files')).toHaveCount(0);
});

test('Cursor click feedback renders with motion enabled in a narrow desktop', async ({ page }) => {
  const fixture = await open(page);
  await page.setViewportSize({ width: 390, height: 900 });
  await page.emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'dark' });
  const snapshot = await request(fixture, { action: 'observe' });
  const result = await request(fixture, { action: 'click', ...control(snapshot.text, 'Files') });
  expect(result.error, result.text).toBe(false);
  const cursor = page.getByTestId('lumo-use-cursor');
  await expect(cursor).toBeVisible();
  const bounds = await cursor.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x).toBeLessThan(390);
  await expect(cursor.locator('.lumo-use-cursor-shape')).toHaveCSS('animation-name', 'lumo-cursor-click');
  await expect(cursor.locator('.lumo-use-cursor-ripple')).toHaveCSS('animation-duration', '0.24s');
  await expect(cursor.locator('.lumo-use-cursor-shape')).toHaveCSS('animation-iteration-count', '1');
  await page.screenshot({ path: '/tmp/lumo-cursor-narrow.png' });
});

test('Window drag and resize share the cursor timeline and keep its held tip anchored to the moving handle', async ({ page }) => {
  const fixture = await open(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 1800, height: 1100 });
  let result = await request(fixture, { action: 'observe' });
  result = await request(fixture, { action: 'click', ...control(result.text, 'Files') });
  const window = page.getByTestId('window-files');
  const cursor = page.getByTestId('lumo-use-cursor');
  const before = (await window.boundingBox())!;
  const title = (await window.locator('.window-titlebar').boundingBox())!;
  for (const action of ['drag', 'resize'] as const) {
    const start = (await window.boundingBox())!;
    const anchor = action === 'drag' ? { x: title.width / 2 + 1, y: title.height / 2 + 1 } : undefined;
    await page.evaluate(({ action, anchor }) => {
      const records: { x: number; y: number; w: number; h: number; tipX: number; tipY: number; error: number }[] = [];
      (window as unknown as { gestureFrames: typeof records }).gestureFrames = records;
      const node = document.querySelector('[data-testid="window-files"]')!;
      const cursor = document.querySelector('[data-testid="lumo-use-cursor"]')!;
      let started = false;
      const sample = () => {
        if (cursor.classList.contains('is-pressed')) {
          started = true;
          const box = node.getBoundingClientRect(); const tip = cursor.getBoundingClientRect();
          const expectedX = action === 'drag' ? box.x + anchor!.x : box.right - 4;
          const expectedY = action === 'drag' ? box.y + anchor!.y : box.bottom - 4;
          records.push({ x: box.x, y: box.y, w: box.width, h: box.height, tipX: tip.x + 1.5, tipY: tip.y + 1.5, error: Math.hypot(tip.x + 1.5 - expectedX, tip.y + 1.5 - expectedY) });
        } else if (started) return;
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    }, { action, anchor });
    result = await request(fixture, { action, ...control(result.text, 'Files', 'window title'), ...(action === 'drag' ? { deltaX: 180, deltaY: 80 } : { width: start.width + 100, height: start.height + 60 }) });
    expect(result.error, result.text).toBe(false);
    const frames = await page.evaluate(() => (window as unknown as { gestureFrames: { x: number; w: number; error: number }[] }).gestureFrames);
    expect(frames.length).toBeGreaterThan(3);
    expect(Math.max(...frames.map((frame) => frame.error))).toBeLessThan(2);
    expect(frames.some((frame) => action === 'drag' ? frame.x > start.x + 10 && frame.x < start.x + 170 : frame.w > start.width + 5 && frame.w < start.width + 95)).toBe(true);
    await expect(cursor).not.toHaveClass(/is-pressed/);
  }
  const after = (await window.boundingBox())!;
  expect(after.x).toBe(before.x + 180); expect(after.y).toBe(before.y + 80);
  expect(after.width).toBe(before.width + 100); expect(after.height).toBe(before.height + 60);
  await page.screenshot({ path: '/tmp/lumo-coordinated-resize.png' });
});

test('Stopping a held window gesture releases the cursor and prevents further movement', async ({ page }) => {
  const fixture = await open(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.getByTestId('pi-prompt').fill('Use my desktop'); await page.getByTestId('pi-send').click();
  let result = await request(fixture, { action: 'observe' });
  result = await request(fixture, { action: 'click', ...control(result.text, 'Files') });
  const id = fixture.requestDesktop({ action: 'drag', ...control(result.text, 'Files', 'window title'), deltaX: -500, deltaY: 500 });
  const cursor = page.getByTestId('lumo-use-cursor');
  await expect(cursor).toHaveClass(/is-pressed/);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(cursor).toBeHidden();
  await expect.poll(() => fixture.desktopResults.some((item) => item.desktopId === id)).toBe(true);
  expect(fixture.desktopResults.find((item) => item.desktopId === id)?.error).toBe(true);
  const stopped = await page.getByTestId('window-files').boundingBox();
  await page.waitForTimeout(250);
  expect(await page.getByTestId('window-files').boundingBox()).toEqual(stopped);
  await expect(cursor).not.toHaveClass(/is-pressed/);
});
