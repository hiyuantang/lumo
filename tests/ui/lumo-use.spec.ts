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
  const id = fixture.requestDesktop({ action: 'click', ...control(snapshot.text, 'Files') });
  const cursor = page.getByTestId('lumo-use-cursor');
  await expect(cursor).toHaveAttribute('data-phase', 'move');
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
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
