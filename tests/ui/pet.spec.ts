// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test, type Page } from '../offline';
import { piPage } from './pi-fixture';

async function open(page: Page) {
  const fixture = await piPage(page);
  await page.route('**/api/v1/system/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    const data = path.endsWith('/settings') ? { hostname: 'lumo-test', runtimeHostname: 'lumo-test', timezone: 'Etc/UTC', ntp: true, canNtp: true, ntpSynchronized: true, serverTime: '2026-09-30T12:00:00Z', revision: 'initial' }
      : path.endsWith('/identity') ? { hostname: 'lumo-test', os: { prettyName: 'Ubuntu test', kernel: 'test' }, architecture: 'aarch64' }
      : path.endsWith('/overview') ? { uptimeSeconds: 86400, memoryUsedBytes: 1073741824, memoryTotalBytes: 4294967296, failedUnits: 0, updatesPending: 0, securityUpdatesPending: 0 }
      : { cpu: { usagePercent: 5, cores: 4 }, memory: { usedBytes: 1073741824, totalBytes: 4294967296 }, network: [], disks: [{ mount: '/', usedBytes: 1073741824, totalBytes: 10737418240 }] };
    return route.fulfill({ json: { ok: true, data } });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('http://localhost:5200');
  await expect(page.getByTestId('desktop-pet')).toHaveAttribute('data-mood', 'idle');
  return fixture;
}
async function settings(page: Page) {
  await page.getByTestId('dock-app-pi').click();
  await page.getByTestId('pi-settings-button').click();
  await page.getByRole('tab', { name: 'Pet', exact: true }).click();
  await expect(page.getByTestId('settings-pet')).toBeVisible();
}
async function start(page: Page) {
  await page.getByTestId('dock-app-pi').click();
  await page.getByTestId('pi-home-button').click();
  await expect(page.getByTestId('pi-prompt')).toBeEnabled();
  await page.getByTestId('pi-prompt').fill('Work on the project');
  await page.getByTestId('pi-send').click();
  await expect(page.getByTestId('desktop-pet')).toHaveAttribute('data-mood', 'working');
}

test('Pet choices, dragging, keyboard movement, hiding and reset persist', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  await open(page); await settings(page);
  const pet = page.getByTestId('desktop-pet'); const handle = page.getByTestId('pet-handle');
  for (const [value, name] of [['fox', 'Fox'], ['robot', 'Robot'], ['cat', 'Cat']]) {
    await page.getByTestId('settings-pet-character').click();
    await page.getByRole('option', { name, exact: true }).click();
    await expect(pet).toHaveAttribute('data-kind', value);
  }
  await page.getByText('Drag to move. Use arrow keys when focused.', { exact: true }).click();
  await expect(page.getByTestId('settings-pet-enabled')).toBeChecked();
  const before = await handle.boundingBox();
  await page.mouse.move(before!.x + 42, before!.y + 42); await page.mouse.down();
  await page.mouse.move(before!.x - 210 + 42, before!.y - 130 + 42, { steps: 6 }); await page.mouse.up();
  await expect.poll(async () => Math.round((await handle.boundingBox())!.x - before!.x)).toBe(-210);
  const moved = await handle.boundingBox();
  expect(Math.round(moved!.x - before!.x)).toBe(-210); expect(Math.round(moved!.y - before!.y)).toBe(-130);
  await expect(pet).toHaveAttribute('data-mood', 'idle');
  await handle.focus(); await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => Math.round((await handle.boundingBox())!.x)).toBe(Math.round(moved!.x - 10));
  const saved = await handle.boundingBox();
  await page.reload(); await expect(handle).toBeVisible();
  const restored = await handle.boundingBox();
  expect(restored!.x).toBeCloseTo(saved!.x, 1); expect(restored!.y).toBeCloseTo(saved!.y, 1);
  await settings(page);
  await page.getByTestId('settings-pet-enabled').click(); await expect(pet).toHaveCount(0);
  await page.reload(); await expect(pet).toHaveCount(0);
  await settings(page);
  await page.getByTestId('settings-pet-enabled').click(); await expect(pet).toBeVisible();
  await page.getByTestId('settings-pet-reset').click();
  await expect.poll(async () => (await handle.boundingBox())!.x).toBeCloseTo(before!.x, 1);
  const reset = await handle.boundingBox(); expect(reset!.x).toBeCloseTo(before!.x, 1); expect(reset!.y).toBeCloseTo(before!.y, 1);
  expect(errors).toEqual([]);
});

test('Pet works while minimized, celebrates once on completion and returns to idle', async ({ page }) => {
  await page.clock.install();
  const fixture = await open(page); await start(page);
  await page.getByRole('button', { name: 'Minimize Pi', exact: true }).click();
  await expect(page.getByTestId('desktop-pet')).toHaveAttribute('data-mood', 'working');
  fixture.setRetry({ attempt: 1, maxAttempts: 3, retryAt: Date.now() + 10000, errorMessage: 'Connection error.', source: 'response' });
  await expect(page.getByTestId('pet-bubble')).toHaveCount(0);
  fixture.finish();
  await expect(page.getByTestId('pet-bubble')).toContainText('Work done');
  await expect(page.getByTestId('desktop-pet')).toHaveAttribute('data-mood', 'done');
  fixture.emit({ type: 'agent_settled' });
  await expect(page.getByTestId('pet-bubble')).toHaveCount(1);
  await expect(page.getByTestId('notifications-badge')).toHaveText('1');
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    const bounds = await page.getByTestId('desktop-pet').boundingBox();
    await page.screenshot({ path: `/tmp/lumo-pet-done-${colorScheme}.png`, clip: { x: bounds!.x - 160, y: bounds!.y - 115, width: 310, height: 215 } });
  }
  await page.clock.fastForward(8100);
  await expect(page.getByTestId('pet-bubble')).toHaveCount(0);
  await expect(page.getByTestId('desktop-pet')).toHaveAttribute('data-mood', 'idle');
});

test('Pet distinguishes stop and error, and honors disabled completion bubbles', async ({ page }) => {
  const fixture = await open(page); await start(page);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.getByTestId('pet-bubble')).toContainText('Stopped');
  await expect(page.getByTestId('desktop-pet')).toHaveAttribute('data-mood', 'idle');
  await page.getByRole('button', { name: 'Dismiss pet bubble' }).click();
  await start(page); fixture.finish('', 'error', 'Provider unavailable.');
  await expect(page.getByTestId('pet-bubble')).toContainText('Needs attention');
  await expect(page.getByTestId('desktop-pet')).toHaveAttribute('data-mood', 'idle');
  await settings(page); await page.getByTestId('settings-pet-bubbles').click();
  await expect(page.getByTestId('pet-bubble')).toHaveCount(0);
  await start(page); fixture.finish();
  await expect(page.getByTestId('desktop-pet')).toHaveAttribute('data-mood', 'done');
  await expect(page.getByTestId('pet-bubble')).toHaveCount(0);
  await page.reload(); await settings(page); await expect(page.getByTestId('settings-pet-bubbles')).not.toBeChecked();
});

test('Pet and settings stay reachable in both themes and narrow layouts with reduced motion', async ({ page }) => {
  await open(page); await settings(page);
  for (const width of [1440, 390]) for (const colorScheme of ['light', 'dark'] as const) {
    await page.setViewportSize({ width, height: 900 }); await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await expect(page.getByTestId('desktop-pet')).toBeVisible();
    await expect.poll(async () => { const box = await page.getByTestId('desktop-pet').boundingBox(); return box!.y + box!.height; }).toBeLessThan(900);
    await expect.poll(async () => { const box = await page.getByTestId('desktop-pet').boundingBox(); return box!.x + box!.width; }).toBeLessThanOrEqual(width);
    const bounds = await page.getByTestId('desktop-pet').boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    expect(bounds!.y).toBeGreaterThanOrEqual(32); expect(bounds!.y + bounds!.height).toBeLessThan(900);
    await expect(page.getByTestId('pet-handle').locator('.pet-sprite')).toHaveCSS('animation-name', 'none');
    const group = page.getByTestId('settings-pet'); await group.scrollIntoViewIfNeeded();
    expect(await group.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    const preview = group.locator('.pi-pet-character .pet-sprite');
    await expect(preview).toHaveCSS('width','54px'); await expect(preview).toHaveCSS('height','54px');
    const label = group.getByText('Character', {exact:true});
    const labelBounds = (await label.boundingBox())!;
    expect(labelBounds.height).toBeLessThan(20);
    expect(labelBounds.x).toBe((await group.getByText('Desktop pet', {exact:true}).boundingBox())!.x);
    expect(labelBounds.x + labelBounds.width).toBeLessThan((await preview.boundingBox())!.x);
    expect((await group.locator('.pi-extension-list').boundingBox())!.height).toBeLessThan(350);
    await page.screenshot({ path: `/tmp/lumo-pet-settings-${width}-${colorScheme}.png`, animations: 'disabled' });
  }
});


test('Pet settings shortcut opens Pi and replaces system Appearance controls', async ({ page }) => {
  await open(page);
  await page.getByTestId('pet-handle').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Pet settings', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Pet', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('settings-pet')).toBeVisible();
  await page.getByRole('tab', { name: 'Providers', exact: true }).click();
  await page.getByRole('button', { name: 'Minimize Pi', exact: true }).click();
  await page.getByTestId('pet-handle').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Pet settings', exact: true }).click();
  await expect(page.getByTestId('settings-pet')).toBeVisible();
  await page.getByTestId('dock-app-settings').click();
  await page.getByTestId('settings-section-appearance').click();
  await expect(page.getByTestId('window-settings').getByTestId('settings-pet')).toHaveCount(0);
});


test('SVG pets animate separate parts smoothly, pause while dragged and honor reduced motion', async ({ page }) => {
  const fixture = await open(page); await page.emulateMedia({ reducedMotion: 'no-preference' });
  const pet = page.getByTestId('desktop-pet'); const svg = pet.locator('svg.pet-sprite');
  await expect(svg).toBeVisible(); await expect(pet.locator('img')).toHaveCount(0);
  const tail = svg.locator('.pet-tail'); const initial = await tail.evaluate((node) => getComputedStyle(node).transform);
  await expect.poll(() => tail.evaluate((node) => getComputedStyle(node).transform)).not.toBe(initial);
  const animations = await svg.evaluate((node) => node.getAnimations({subtree:true}).map((animation) => ({state:animation.playState,easing:animation.effect?.getTiming().easing})));
  expect(animations.length).toBeGreaterThan(4); expect(animations.every((animation) => animation.state === 'running')).toBe(true);
  expect(animations.every((animation) => !animation.easing?.includes('steps'))).toBe(true);
  const handle = page.getByTestId('pet-handle'); const bounds = (await handle.boundingBox())!;
  await page.mouse.move(bounds.x+42,bounds.y+42); await page.mouse.down();
  await page.mouse.move(bounds.x+12,bounds.y+12);
  await expect.poll(() => svg.evaluate((node) => node.getAnimations({subtree:true}).every((animation) => animation.playState === 'paused'))).toBe(true);
  await page.mouse.up();
  await expect.poll(() => svg.evaluate((node) => node.getAnimations({subtree:true}).every((animation) => animation.playState === 'running'))).toBe(true);
  await start(page);
  await expect(pet).toHaveAttribute('data-mood','working');
  await expect(svg.locator('.pet-work-prop')).toHaveCSS('opacity','1');
  const writing = await svg.locator('.pet-arm-right').evaluate((node) => getComputedStyle(node).transform);
  await expect.poll(() => svg.locator('.pet-arm-right').evaluate((node) => getComputedStyle(node).transform)).not.toBe(writing);
  await page.emulateMedia({ reducedMotion:'reduce' });
  await expect.poll(() => svg.evaluate((node) => node.getAnimations({subtree:true}).length)).toBe(0);
  fixture.finish(); await expect(pet).toHaveAttribute('data-mood','done');
  await expect(svg.locator('.pet-mouth-happy')).toHaveCSS('opacity','1');
  await expect(svg.locator('.pet-arm-right')).not.toHaveCSS('transform','none');
  await settings(page);
  for (const [value,name] of [['cat','Cat'],['fox','Fox'],['robot','Robot']]) {
    await page.getByTestId('settings-pet-character').click(); await page.getByRole('option',{name,exact:true}).click();
    await expect(pet).toHaveAttribute('data-kind',value);
    await expect(svg).toBeVisible();
    if (await page.getByTestId('pet-bubble').count()) await page.getByRole('button',{name:'Dismiss pet bubble'}).click();
    await handle.screenshot({path:`/tmp/lumo-svg-pet-${value}.png`});
  }
});


test('Enabling completion bubbles previews Hello without creating a task notification', async ({page}) => {
  await page.clock.install(); await open(page); await settings(page);
  const checkbox=page.getByTestId('settings-pet-bubbles'); const bubble=page.getByTestId('pet-bubble');
  await checkbox.click(); await expect(checkbox).not.toBeChecked();
  await expect(bubble).toHaveCount(0);
  await checkbox.click(); await expect(checkbox).toBeChecked();
  await expect(bubble).toContainText('Hello!');
  await expect(page.getByTestId('notifications-badge')).toHaveCount(0);
  await expect(page.getByTestId('pi-notification')).toHaveCount(0);
  await page.clock.fastForward(8100); await expect(bubble).toHaveCount(0);
  await checkbox.click(); await checkbox.click(); await expect(bubble).toContainText('Hello!');
  await page.getByRole('button',{name:'Dismiss pet bubble'}).click(); await expect(bubble).toHaveCount(0);
  await expect(checkbox).toBeChecked();
  await checkbox.click(); await checkbox.click(); await expect(bubble).toBeVisible();
  await checkbox.click(); await expect(bubble).toHaveCount(0);
});


test('The Pi pet stays absent on a desktop where Pi is not installed', async ({page}) => {
  await page.goto('/'); await page.getByTestId('login-username').fill('demo');
  await page.getByTestId('login-password').fill('demo'); await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('dock-app-files')).toBeVisible();
  await expect(page.getByTestId('desktop-pet')).toHaveCount(0);
});

test('The pet lets a native conversation drag pass through and restores interaction afterward', async ({page}) => {
  await open(page); await page.getByTestId('dock-app-pi').click();
  await expect(page.getByTestId('pi-prompt')).toBeEnabled();
  const row=page.locator('.pi-chat-item').first(); const bounds=(await row.boundingBox())!;
  await page.mouse.move(bounds.x+50,bounds.y+bounds.height/2); await page.mouse.down();
  await page.mouse.move(bounds.x+90,bounds.y+bounds.height/2,{steps:4});
  await expect(page.getByTestId('pet-handle')).toHaveCSS('pointer-events','none');
  const pet=(await page.getByTestId('pet-handle').boundingBox())!;
  await page.mouse.move(pet.x+42,pet.y+42,{steps:6}); await page.mouse.up();
  await expect(page.getByTestId('pet-handle')).toHaveCSS('pointer-events','auto');
});
