// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '../offline';
import { piPage } from './pi-fixture';

async function toggleAssistant(page: import('@playwright/test').Page) {
  await page.getByTestId('pi-tray-button').click();
  await page.getByTestId('pi-tray-toggle').click();
}

async function open(page: import('@playwright/test').Page) {
  const fixture = await piPage(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('http://localhost:5200');
  await toggleAssistant(page);
  await expect(page.getByTestId('pi-compact-prompt')).toBeEnabled();
  return fixture;
}

test('Pi tray opens a keyboard-accessible menu and highlights only on hover or while open', async ({ page }) => {
  const fixture = await piPage(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('http://localhost:5200');
  const tray = page.getByTestId('pi-tray-button');
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await page.mouse.move(20, 100);
    await expect(tray).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await tray.hover();
    await expect(tray).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await tray.click();
    await expect(page.getByTestId('pi-tray-button-menu')).toBeVisible();
    await expect(page.getByTestId('pi-assistant')).toHaveCount(0);
    await page.mouse.move(20, 100);
    await expect(tray).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await page.mouse.click(20, 100);
    await expect(page.getByTestId('pi-tray-button-menu')).toBeHidden();
    await expect(tray).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  }
  expect(fixture.starts).toHaveLength(0);
  await tray.focus(); await tray.press('ArrowDown');
  await expect(page.getByTestId('pi-tray-toggle')).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.getByTestId('pi-tray-workspace')).toBeFocused();
  await page.keyboard.press('Escape'); await expect(tray).toBeFocused();
  await tray.press('Enter'); await page.getByTestId('pi-tray-toggle').click();
  await expect(page.getByTestId('pi-compact-prompt')).toBeEnabled();
  await page.mouse.move(20, 100);
  await expect(tray).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
});

test('Tray workspace selection uses server folders and new conversations retain the chosen workspace', async ({ page }) => {
  const fixture = await open(page);
  await page.route('**/api/v1/files/list*', (route) => route.fulfill({ json: { ok: true, data: { path: '/home/user', entries: [{ name: 'Projects', type: 'directory', sizeBytes: 0, mode: '0755', modifiedAt: '' }] } } }));
  await page.getByTestId('pi-tray-button').click();
  await page.getByTestId('pi-tray-workspace').click();
  const picker = page.getByTestId('file-picker');
  await expect(picker).toBeVisible();
  const bounds = (await picker.boundingBox())!;
  expect(bounds.height).toBeGreaterThan(350);
  await page.getByTestId('file-picker-entry-Projects').click();
  await page.getByTestId('file-picker-open').click();
  await expect(picker).toBeHidden();
  await expect.poll(() => fixture.starts.at(-1)?.project).toBe('/home/user/Projects');
  await expect(page.getByTestId('pi-compact-prompt')).toBeEnabled();
  await page.getByTestId('pi-compact-prompt').fill('Check this workspace');
  await page.getByTestId('pi-compact-prompt').press('Enter'); fixture.finish();
  await expect(page.getByTestId('pi-compact-worked')).toBeVisible();
  const previousStarts = fixture.starts.length;
  await page.getByTestId('pi-tray-button').click();
  await page.getByTestId('pi-tray-new').click();
  await expect.poll(() => fixture.starts.length).toBe(previousStarts + 1);
  expect(fixture.starts.at(-1)).toMatchObject({ project: '/home/user/Projects' });
  await expect(page.getByTestId('pi-compact-prompt')).toBeEnabled();
  await expect(page.getByTestId('pi-compact-prompt')).toBeFocused();
  await expect(page.getByTestId('pi-compact-messages')).toHaveText('');
  await expect(picker).toBeHidden();
  const approval = page.getByRole('combobox', { name: 'Approval mode' });
  const label = (await approval.locator(':scope > span').boundingBox())!;
  const arrow = (await approval.locator(':scope > svg').boundingBox())!;
  expect(arrow.x - label.x - label.width).toBeLessThanOrEqual(8);
  await page.getByTestId('pi-tray-button').click(); await page.getByTestId('pi-tray-workspace').click();
  await expect(picker).toContainText('/home/user/Projects');
  await picker.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(picker).toBeHidden();
  await page.getByTestId('pi-tray-button').click();
  await page.screenshot({ path: '/tmp/lumo-pi-tray-menu.png', animations: 'disabled' });
});

test('Workspace picker preserves the assistant input position and draft', async ({ page }) => {
  const fixture = await open(page);
  await page.route('**/api/v1/files/list*', (route) => route.fulfill({ json: { ok: true, data: { path: '/home/user', entries: [] } } }));
  const assistant = page.getByTestId('pi-assistant');
  const prompt = page.getByTestId('pi-compact-prompt');
  const picker = page.getByTestId('file-picker');
  for (const conversation of [false, true]) {
    if (conversation) {
      await prompt.fill('Help me'); await prompt.press('Enter'); fixture.finish('Ready.');
      await expect(assistant.getByRole('article', { name: 'Pi response' })).toContainText('Ready.');
    }
    await prompt.fill('Keep this draft');
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
        await page.setViewportSize(viewport);
        await expect.poll(async () => (await assistant.boundingBox())!.width).toBe(Math.min(420, viewport.width - 24));
        const before = (await prompt.boundingBox())!;
        const assistantBefore = (await assistant.boundingBox())!;
        await page.getByTestId('pi-tray-button').click(); await page.getByTestId('pi-tray-workspace').click();
        await expect(picker).toBeVisible();
        await expect.poll(async () => Math.abs((await prompt.boundingBox())!.y - before.y)).toBeLessThan(2);
        expect((await assistant.boundingBox())!.height).toBeCloseTo(assistantBefore.height, 0);
        const bounds = (await picker.boundingBox())!;
        expect(bounds.height).toBeGreaterThan(350);
        expect(bounds.y).toBeGreaterThanOrEqual(32);
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
        await expect(assistant.locator('.window-body')).toHaveAttribute('inert', '');
        await picker.getByRole('button', { name: 'Cancel', exact: true }).click();
        await expect(picker).toBeHidden();
        expect((await prompt.boundingBox())!.y).toBeCloseTo(before.y, 0);
        await expect(prompt).toHaveValue('Keep this draft');
      }
    }
  }
});

test('Tray assistant replaces actions, completes without disclosures and preserves hidden work and drafts', async ({ page }) => {
  const fixture = await open(page);
  const tray = page.getByTestId('pi-tray-button');
  const assistant = page.getByTestId('pi-assistant');
  await expect(tray).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('app-pi')).toHaveCount(0);
  const messages = page.getByTestId('pi-compact-messages');
  await expect(messages).toHaveText('');
  await expect(messages).toHaveCSS('mask-image', 'none');
  const empty = (await assistant.boundingBox())!;
  expect(empty.height).toBeLessThan(220);
  await page.getByTestId('pi-compact-prompt').fill('Review Lumo');
  await page.getByTestId('pi-compact-prompt').press('Enter');
  await expect(page.getByTestId('pi-compact-action')).toHaveText('Read · README.md…');
  await expect(page.getByTestId('pi-compact-messages')).toContainText('Review Lumo');
  const pending = (await assistant.boundingBox())!;
  expect(pending.height).toBeGreaterThan(empty.height);
  fixture.emit({ type: 'tool_execution_start', toolCallId: 'bash-2', toolName: 'bash', args: { command: 'pwd' } });
  await expect(page.getByTestId('pi-compact-action')).toHaveText('Bash…');
  await expect(page.getByTestId('pi-compact-action')).not.toContainText('Read');
  await expect(assistant.locator('.pi-tool,.pi-thinking,.disclosure-body')).toHaveCount(0);
  await toggleAssistant(page); await expect(assistant).toBeHidden();
  fixture.finish(); await toggleAssistant(page);
  await expect(assistant.getByRole('article', { name: 'Pi response' })).toContainText('React and Go');
  await expect(page.getByTestId('pi-compact-worked')).toHaveText(/^Worked/);
  await expect(page.getByTestId('pi-compact-worked').locator('button')).toHaveCount(0);
  await expect(page.getByTestId('pi-compact-action')).toBeEmpty();
  await expect(messages).toHaveCSS('mask-image', 'none');
  await expect.poll(async () => {
    const list = (await messages.boundingBox())!;
    const reply = (await assistant.getByRole('article', { name: 'Pi response' }).boundingBox())!;
    return Math.abs(list.y + list.height - reply.y - reply.height - 8);
  }).toBeLessThan(2);
  const completed = (await assistant.boundingBox())!;
  expect(completed.height).toBeGreaterThan(pending.height);
  expect(completed.height).toBeLessThan(470);
  expect(Math.abs(completed.y + completed.height - empty.y - empty.height)).toBeLessThan(2);
  const first = (await assistant.getByRole('article', { name: 'Your message' }).boundingBox())!;
  const closeBounds = (await page.getByTestId('pi-assistant-close').boundingBox())!;
  expect(first.y - closeBounds.y - closeBounds.height).toBeLessThan(8);
  expect(fixture.starts).toHaveLength(1);
  await page.getByTestId('pi-compact-prompt').fill('Keep my draft');
  await page.getByTestId('pi-assistant-close-region').hover();
  await page.getByRole('button', { name: 'Hide Pi assistant' }).click();
  await expect(tray).toBeFocused(); await tray.press('Enter'); await page.getByTestId('pi-tray-toggle').click();
  await expect(page.getByTestId('pi-compact-prompt')).toHaveValue('Keep my draft');
  await page.getByTestId('pi-compact-prompt').press('Escape'); await expect(assistant).toBeHidden();
});

test('Compact controls change effort, model and confirmed approval mode', async ({ page }) => {
  const fixture = await open(page);
  await page.getByTestId('pi-model').click();
  await page.getByRole('slider', { name: 'Effort' }).focus();
  await page.getByRole('slider', { name: 'Effort' }).press('End');
  await expect(page.getByRole('slider', { name: 'Effort' })).toHaveAttribute('aria-valuetext', 'High');
  expect(fixture.commands).toContainEqual({ type: 'set_thinking_level', level: 'high' });
  await page.getByRole('button', { name: 'Choose model' }).click();
  await page.getByRole('option', { name: 'Fast · Fixture' }).click();
  await expect(page.getByTestId('pi-model')).toContainText('Fast');
  await page.getByTestId('pi-model').click();
  await page.getByRole('combobox', { name: 'Approval mode' }).click();
  await page.getByRole('option', { name: 'Read only' }).click();
  await expect(page.getByTestId('pi-compact-prompt')).toBeEnabled();
  expect(fixture.starts.at(-1)).toMatchObject({ permissionMode: 'read-only', rememberPermissionMode: true });
  await expect(page.getByRole('combobox', { name: 'Approval mode' })).toContainText('Read only');
});

test('Dragging a short assistant keeps its input anchored as messages grow and approvals resize', async ({ page }) => {
  const fixture = await open(page);
  const assistant = page.getByTestId('pi-assistant');
  const handle = page.getByTestId('pi-assistant-drag-handle');
  const bounds = (await handle.boundingBox())!;
  await page.mouse.move(bounds.x + 100, bounds.y + 12); await page.mouse.down();
  await page.mouse.move(bounds.x - 50, bounds.y - 68); await page.mouse.up();
  const anchored = (await assistant.boundingBox())!;
  await page.getByTestId('pi-compact-prompt').fill('Help me');
  await page.getByTestId('pi-compact-prompt').press('Enter');
  fixture.ask({ id: 'resize-approval', method: 'confirm', title: 'Continue?', message: 'Please approve this operation.' });
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toBeVisible();
  const pending = (await assistant.boundingBox())!;
  expect(pending.height).toBeGreaterThan(anchored.height);
  expect(Math.abs(pending.y + pending.height - anchored.y - anchored.height)).toBeLessThan(2);
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByTestId('pi-compact-prompt')).toBeVisible();
  await expect.poll(async () => (await assistant.boundingBox())!.height).toBeLessThan(pending.height);
  fixture.finish('Done.');
  await expect(assistant.getByRole('article', { name: 'Pi response' })).toContainText('Done.');
  await expect.poll(async () => { const box = (await assistant.boundingBox())!; return Math.abs(box.y + box.height - anchored.y - anchored.height); }).toBeLessThan(2);
  await assistant.hover();
  await page.screenshot({ path: '/tmp/lumo-pi-assistant-dynamic.png', animations: 'disabled' });
});

test('Hidden assistant reopens for approvals and can stop work without dropping a draft', async ({ page }) => {
  const fixture = await open(page);
  await page.getByTestId('pi-compact-prompt').fill('Help with my desktop');
  await page.getByTestId('pi-compact-send').click();
  await expect(page.getByTestId('pi-compact-action')).toContainText('Read');
  await toggleAssistant(page);
  fixture.ask({ id: 'approval-1', method: 'confirm', title: 'Allow this change?', message: 'Update the selected setting.' });
  await expect(page.getByTestId('pi-assistant')).toBeVisible();
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect.poll(() => fixture.answers.some((answer) => answer.questionId === 'approval-1' && 'confirmed' in answer && answer.confirmed)).toBe(true);
  await page.getByTestId('pi-compact-prompt').fill('Next task');
  await page.getByTestId('pi-compact-prompt').press('Enter');
  expect(fixture.commands.filter((command) => command.type === 'prompt')).toHaveLength(1);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.getByTestId('pi-compact-send')).toHaveAttribute('aria-label', 'Send');
  await expect(page.getByTestId('pi-compact-prompt')).toHaveValue('Next task');
  expect(fixture.commands).toContainEqual({ type: 'abort' });
});

test('Compact Lumo Use operates the desktop and protects assistant controls', async ({ page }) => {
  const fixture = await open(page);
  await page.getByTestId('pi-compact-prompt').fill('Private assistant draft');
  const observed = fixture.requestDesktop({ action: 'observe' });
  await expect.poll(() => fixture.desktopResults.some((result) => result.desktopId === observed)).toBe(true);
  const result = fixture.desktopResults.find((item) => item.desktopId === observed)!;
  expect(result.error).toBe(false);
  expect(result.text).not.toContain('Private assistant draft');
  const records = result.text.split('\n').filter((line) => line.startsWith('{')).map((line) => JSON.parse(line));
  expect(records.some((record) => record.label === 'Pi assistant')).toBe(false);
  expect(result.text).not.toContain('"label":"Approval mode"');
  const files = result.text.split('\n').filter((line) => line.startsWith('{')).map((line) => JSON.parse(line)).find((control) => control.label === 'Files' && control.role === 'button');
  expect(files).toBeTruthy();
  const clicked = fixture.requestDesktop({ action: 'click', target: files.target, label: files.label });
  await expect.poll(() => fixture.desktopResults.find((item) => item.desktopId === clicked)?.error).toBe(false);
  await expect(page.getByTestId('app-files')).toBeVisible();
});

test('Transparent conversation caps its height, fades overflow, stays reachable and fits both themes and narrow screens', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  const fixture = await piPage(page);
  await page.route('**/api/v1/system/settings', (route) => route.fulfill({ json: { ok: true, data: { serverTime: '2026-09-30T14:30:00Z', timezone: 'America/New_York' } } }));
  fixture.setHistory(Array.from({ length: 10 }, (_, index) => [
    { role: 'user', content: `Request ${index + 1}: Help me use Lumo.`, timestamp: 1000 + index * 100000 },
    { role: 'assistant', content: `Reply ${index + 1}. ${'Your desktop is ready. '.repeat(8)}`, timestamp: 62000 + index * 100000, stopReason: 'stop' },
  ]).flat());
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('http://localhost:5200'); await toggleAssistant(page);
  const assistant = page.getByTestId('pi-assistant'); const messages = page.getByTestId('pi-compact-messages');
  await expect(messages).toContainText('Reply 10.');
  await expect(messages).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(assistant).toHaveCSS('box-shadow', 'none');
  await expect(assistant).toHaveCSS('border-top-width', '0px');
  await expect(assistant).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  expect(await messages.evaluate((node) => getComputedStyle(node).maskImage)).toContain('linear-gradient');
  expect(await messages.evaluate((node) => node.scrollHeight > node.clientHeight && node.scrollWidth <= node.clientWidth)).toBe(true);
  await expect.poll(() => messages.evaluate((node) => node.scrollHeight - node.scrollTop - node.clientHeight)).toBeLessThan(2);
  expect((await assistant.boundingBox())!.x).toBeGreaterThan(900);
  await expect(assistant.locator('.window-titlebar')).toHaveCount(0);
  const close = page.getByTestId('pi-assistant-close');
  await page.getByTestId('pi-tray-button').hover();
  await expect(close).toHaveCSS('opacity', '0');
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await assistant.hover();
      await expect(close).toHaveCSS('opacity', '0');
      await page.getByTestId('pi-compact-prompt').hover();
      await expect(close).toHaveCSS('opacity', '0');
      const bounds = (await close.boundingBox())!;
      await page.mouse.move(bounds.x + bounds.width + 4, bounds.y + bounds.height / 2);
      await expect(close).toHaveCSS('opacity', '1');
      await close.hover();
      await expect(close).toHaveCSS('opacity', '1');
      await page.mouse.move(bounds.x + bounds.width + 20, bounds.y + bounds.height / 2);
      await expect(close).toHaveCSS('opacity', '0');
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.getByTestId('pi-assistant-close-region').hover();
  await assistant.screenshot({ path: '/tmp/lumo-pi-assistant-hover.png', animations: 'disabled' });
  await page.getByTestId('pi-tray-button').hover();
  await expect(close).toHaveCSS('opacity', '0');
  await close.focus();
  await close.press('Tab');
  await messages.press('Shift+Tab');
  await expect(close).toBeFocused();
  await expect(close).toHaveCSS('opacity', '1');
  await page.getByTestId('pi-compact-prompt').focus();
  await expect(close).toHaveCSS('opacity', '0');
  const approval = (await assistant.getByRole('combobox', { name: 'Approval mode' }).boundingBox())!;
  const model = (await assistant.getByTestId('pi-model').boundingBox())!;
  expect(approval.x + approval.width).toBeLessThanOrEqual(model.x);
  await page.screenshot({ path: '/tmp/lumo-pi-assistant-light.png', animations: 'disabled' });
  await assistant.screenshot({ path: '/tmp/lumo-pi-assistant-detail.png', animations: 'disabled' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(assistant).toHaveCSS('box-shadow', 'none');
  await page.screenshot({ path: '/tmp/lumo-pi-assistant-dark.png', animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => { const bounds = (await assistant.boundingBox())!; return bounds.x + bounds.width; }).toBeLessThanOrEqual(390);
  await expect.poll(() => messages.evaluate((node) => node.scrollHeight - node.scrollTop - node.clientHeight)).toBeLessThan(2);
  const narrow = (await assistant.boundingBox())!;
  expect(narrow.x).toBeGreaterThanOrEqual(0); expect(narrow.x + narrow.width).toBeLessThanOrEqual(390); expect(narrow.y).toBeGreaterThanOrEqual(32); expect(narrow.height).toBe(470); expect(narrow.width).toBe(366);
  const tray = (await page.getByTestId('pi-tray-button').boundingBox())!;
  expect(tray.x).toBeGreaterThanOrEqual(0); expect(tray.x + tray.width).toBeLessThanOrEqual(390);
  const clock = (await page.getByTestId('server-menubar-clock').boundingBox())!;
  expect(tray.x + tray.width).toBeLessThanOrEqual(clock.x);
  await expect(page.getByTestId('server-menubar-clock')).toContainText('10:30');
  await page.screenshot({ path: '/tmp/lumo-pi-assistant-narrow.png', animations: 'disabled' });
  const handle = page.getByTestId('pi-assistant-drag-handle'); const bounds = (await handle.boundingBox())!;
  const composer = (await assistant.locator('.pi-compact-composer').boundingBox())!;
  expect(bounds.y - composer.y).toBeLessThan(12);
  const beforeDrag = (await assistant.boundingBox())!;
  await page.mouse.move(bounds.x + 100, bounds.y + 12); await page.mouse.down(); await page.mouse.move(bounds.x + 80, bounds.y - 28); await page.mouse.up();
  await expect.poll(async () => (await assistant.boundingBox())!.y).toBeCloseTo(beforeDrag.y - 40, 0);
  const moved = (await handle.boundingBox())!;
  await page.mouse.move(moved.x + 100, moved.y + 12); await page.mouse.down(); await page.mouse.move(150, -30); await page.mouse.up();
  expect((await assistant.boundingBox())!.y).toBeGreaterThanOrEqual(32);
  expect(errors).toEqual([]); expect(await page.title()).toBe('Lumo');
  expect(await page.locator('vite-error-overlay').count()).toBe(0);
});


test('Logging out with a hidden assistant draft reveals the discard confirmation', async ({ page }) => {
  await open(page);
  await page.getByTestId('pi-compact-prompt').fill('Unsaved assistant message');
  await toggleAssistant(page);
  const logout = async () => {
    await page.keyboard.press('Control+k');
    await page.getByTestId('command-center').getByRole('combobox').fill('Log Out');
    await page.getByTestId('command-center').getByRole('option', { name: 'Log Out Shell' }).click();
  };
  await logout();
  await expect(page.getByTestId('pi-assistant')).toBeVisible();
  const modal = page.getByTestId('app-modal-overlay');
  await expect(modal).toContainText('Your unsent message will be discarded.');
  await modal.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByTestId('pi-compact-prompt')).toHaveValue('Unsaved assistant message');
  await logout();
  await modal.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByTestId('login-screen')).toBeVisible();
});
