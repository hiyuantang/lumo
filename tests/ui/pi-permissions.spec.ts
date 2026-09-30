// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '../offline';
import { piPage } from './pi-fixture';

async function openPi(page: import('@playwright/test').Page) {
  const fixture = await piPage(page);
  await page.goto('http://localhost:5200');
  await page.getByTestId('dock-app-pi').click();
  await expect(page.getByTestId('pi-prompt')).toBeEnabled();
  return fixture;
}

test('Permission selector sits right of Attach, applies modes and retains the draft and chat on reopen', async ({ page }) => {
  const fixture = await openPi(page);
  const mode = page.getByTestId('pi-permission-mode');
  await expect(mode).toHaveText('Ask for approval');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      await mode.click();
      const selected = page.getByRole('option', { name: 'Ask for approval', exact: true });
      const label = (await selected.locator(':scope > span:first-child').boundingBox())!;
      const check = (await selected.locator('.dropdown-menu-check').boundingBox())!;
      expect(check.x).toBeGreaterThan(label.x + label.width);
      expect(check.x + check.width).toBeLessThanOrEqual(width);
      await expect(selected).toHaveAttribute('aria-selected', 'true');
      await page.screenshot({ path: `/tmp/lumo-selection-right-${width}-${colorScheme}.png`, animations: 'disabled' });
      await page.keyboard.press('Escape');
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  const attachBox = await page.getByRole('button', { name: 'Attach file path' }).boundingBox();
  const modeBox = await mode.boundingBox();
  expect(modeBox!.x).toBeGreaterThanOrEqual(attachBox!.x + attachBox!.width);
  expect(Math.abs(modeBox!.y - attachBox!.y)).toBeLessThan(5);
  await page.getByTestId('pi-prompt').fill('Keep this draft');
  for (const [label, value] of [['Read only', 'read-only'], ['Approve for me', 'auto'], ['Ask for approval', 'ask']]) {
    await mode.click();
    await page.getByRole('option', { name: label, exact: true }).click();
    await expect(mode).toBeEnabled();
    await expect(page.getByTestId('pi-prompt')).toBeEnabled();
    await expect(mode).toHaveText(label);
    await expect(page.getByTestId('pi-prompt')).toHaveText('Keep this draft');
    expect(fixture.starts.at(-1)?.permissionMode).toBe(value);
    expect(fixture.starts.at(-1)?.session).toBe('first.jsonl');
  }
  await mode.click();
  await page.getByRole('option', { name: 'Read only', exact: true }).click();
  await expect(mode).toBeEnabled();
  await page.getByTestId('pi-prompt').fill('');
  await page.reload();
  await expect(mode).toHaveText('Read only');
  await expect(page.getByTestId('pi-prompt')).toBeEnabled();
  expect(fixture.starts.at(-1)?.permissionMode).toBe('read-only');
  await mode.click();
  await page.getByRole('option', { name: 'Ask for approval', exact: true }).click();
  await expect(mode).toBeEnabled();
  await page.getByTestId('pi-prompt').fill('Inspect the project');
  await page.getByTestId('pi-send').click();
  await expect(mode).toBeDisabled();
  fixture.finish();
  await expect(mode).toBeEnabled();
});

test('Approval cards show the exact action and require an explicit approve or reject', async ({ page }) => {
  const fixture = await openPi(page);
  await page.getByTestId('pi-prompt').fill('Make a change');
  await page.getByTestId('pi-send').click();
  fixture.ask({ id: 'approve-write', method: 'confirm', title: 'Write this file?', message: JSON.stringify({ path: 'notes.md', content: '# Proposed notes\n\nNothing has been written yet.' }, null, 2) });
  const card = page.getByTestId('pi-question');
  await expect(card.getByLabel('Proposed action')).toContainText('# Proposed notes');
  await expect(card.getByRole('button', { name: 'Approve', exact: true })).toBeEnabled();
  await expect(page.locator('.pi-compose').getByTestId('pi-question')).toHaveCount(1);
  await expect(page.getByTestId('pi-prompt')).toBeHidden();
  expect(fixture.answers).toHaveLength(0);
  for (const width of [1280, 600]) {
    await page.setViewportSize({ width, height: 900 });
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      await expect(card.getByRole('button', { name: 'Approve', exact: true })).toBeVisible();
      const title = (await card.getByRole('heading').boundingBox())!;
      const approve = (await card.getByRole('button', { name: 'Approve', exact: true }).boundingBox())!;
      expect(approve.x).toBeGreaterThan(title.x + title.width);
      expect(Math.abs(approve.y + approve.height / 2 - title.y - title.height / 2)).toBeLessThan(2);
      expect((await card.boundingBox())!.height).toBeLessThan(160);
      expect(await page.getByTestId('app-pi').evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
      await page.getByTestId('app-pi').screenshot({ path: `/tmp/lumo-pi-permissions-${width}-${colorScheme}.png`, animations: 'disabled' });
    }
  }
  await card.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(card).toHaveCount(0);
  expect(fixture.answers[0]).toMatchObject({ questionId: 'approve-write', confirmed: true });
  fixture.ask({ id: 'reject-shell', method: 'confirm', title: 'Run this command?', message: JSON.stringify({ command: 'rm notes.md' }, null, 2) });
  await card.getByRole('button', { name: 'Reject', exact: true }).click();
  await expect(card).toHaveCount(0);
  expect(fixture.answers[1]).toMatchObject({ questionId: 'reject-shell', confirmed: false });
  fixture.ask({ id: 'desktop', method: 'confirm', title: 'Use Lumo?', message: JSON.stringify({ action: 'click', target: 'b22fc062-9d63-4f15-bf00-452abe14adce:32', label: 'Settings' }, null, 2) });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('button', { name: 'Maximize Pi', exact: true }).click();
  for (const width of [1280, 600, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      await expect(card.getByRole('button', { name: 'Approve', exact: true })).toBeVisible();
      await expect(page.getByTestId('pi-send')).toBeVisible();
      expect(await card.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
      await page.getByTestId('app-pi').screenshot({ path: `/tmp/lumo-pi-compact-approval-${width}-${colorScheme}.png`, animations: 'disabled' });
    }
  }
});

test('Composer approvals preserve drafts, block sending, retry safely and keep Stop available', async ({ page }) => {
  const fixture = await openPi(page);
  const prompt = page.getByTestId('pi-prompt');
  await prompt.fill('Inspect the desktop');
  await page.getByTestId('pi-send').click();
  await prompt.fill('Keep my next message');
  const message = JSON.stringify({ action: 'click', target: 'b22fc062-9d63-4f15-bf00-452abe14adce:32', label: 'Settings', details: 'Review this action.\n'.repeat(80) }, null, 2);
  fixture.ask({ id: 'first', method: 'confirm', title: 'Use Lumo?', message });
  fixture.ask({ id: 'second', method: 'confirm', title: 'Run this command?', message: '{"command":"pwd"}' });
  const cards = page.locator('.pi-compose').getByTestId('pi-question');
  await expect(cards).toHaveCount(2);
  await expect(prompt).toBeHidden();
  await expect(page.getByTestId('pi-send')).toHaveAttribute('aria-label', 'Stop');
  await expect(page.getByTestId('pi-send')).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Attach file path' })).toBeHidden();
  const details = cards.first().getByLabel('Proposed action');
  await expect(details).toHaveText(message);
  expect(await details.evaluate((node) => node.scrollHeight > node.clientHeight && node.clientHeight <= 100)).toBe(true);
  await details.press('Enter');
  expect(fixture.answers).toHaveLength(0);
  const ids: string[] = [];
  await page.route('**/api/v1/pi/answer', (route) => {
    ids.push(route.request().postDataJSON().requestId);
    if (ids.length === 1) return route.fulfill({ status: 503, json: { ok: false, error: { message: 'Try again' } } });
    return route.fallback();
  });
  await cards.first().getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(cards.first().getByRole('alert')).toBeVisible();
  await cards.first().getByRole('button', { name: 'Approve', exact: true }).press('Enter');
  await expect(cards).toHaveCount(1);
  expect(ids).toHaveLength(2);
  expect(ids[1]).toBe(ids[0]);
  await expect(prompt).toBeHidden();
  await cards.getByRole('button', { name: 'Reject', exact: true }).click();
  await expect(cards).toHaveCount(0);
  await expect(prompt).toBeVisible();
  await expect(prompt).toHaveText('Keep my next message');
  expect(fixture.commands.filter((command) => command.type === 'prompt' || command.type === 'follow_up')).toHaveLength(1);
  fixture.ask({ id: 'stop', method: 'confirm', title: 'Use Lumo?', message: '{"action":"click","label":"Settings"}' });
  await expect(cards).toHaveCount(1);
  await page.getByTestId('pi-send').click();
  await expect(cards).toHaveCount(0);
  await expect(prompt).toHaveText('Keep my next message');
  expect(fixture.commands.some((command) => command.type === 'abort')).toBe(true);
});

test('Unconfirmed permission modes leave the composer disabled', async ({ page }) => {
  await piPage(page);
  await page.route('**/api/v1/pi/start', (route) => route.fulfill({ json: { ok: true, data: { id: 'wrong-mode', project: '/home/user', permissionMode: 'unknown' } } }));
  await page.goto('http://localhost:5200');
  await page.getByTestId('dock-app-pi').click();
  await expect(page.getByRole('alert')).toContainText('could not confirm the selected permission mode');
  await expect(page.getByTestId('pi-prompt')).toBeDisabled();
});


test('Changing permissions keeps the conversation mounted, scroll and disclosures intact, and draft editable', async ({ page }) => {
  const fixture = await openPi(page);
  const prompt = page.getByTestId('pi-prompt');
  await prompt.fill(Array.from({ length: 60 }, (_, i) => `Inspect item ${i}`).join('\n'));
  await page.getByTestId('pi-send').click();
  fixture.finish();
  const mode = page.getByTestId('pi-permission-mode');
  await expect(mode).toBeEnabled();
  const disclosure = page.getByTestId('pi-work-summary').getByRole('button');
  await disclosure.click();
  await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
  await prompt.fill('Keep editing this draft');
  const transcript = await page.getByTestId('pi-messages').elementHandle();
  await transcript!.evaluate((node) => { node.scrollTop = 120; });
  await expect.poll(() => transcript!.evaluate((node) => node.scrollTop)).toBe(120);
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  let starting = false;
  await page.route('**/api/v1/pi/start', async (route) => { starting = true; await waiting; await route.fallback(); });
  try {
    await mode.click();
    await page.getByRole('option', { name: 'Read only', exact: true }).click();
    await expect.poll(() => starting).toBe(true);
    expect(await transcript!.evaluate((node) => node.isConnected)).toBe(true);
    expect(await transcript!.evaluate((node) => node.scrollTop)).toBe(120);
    await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    await expect(prompt).toBeEnabled();
    await prompt.fill('Continue typing while permissions apply');
    await expect(page.getByTestId('pi-send')).toBeDisabled();
    const sent = fixture.commands.filter((command) => command.type === 'prompt').length;
    await prompt.press('Enter');
    expect(fixture.commands.filter((command) => command.type === 'prompt')).toHaveLength(sent);
  } finally { release(); }
  await expect(mode).toBeEnabled();
  expect(await transcript!.evaluate((node) => node.isConnected)).toBe(true);
  expect(await transcript!.evaluate((node) => node.scrollTop)).toBe(120);
  await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
  await expect(prompt).toHaveText('Continue typing while permissions apply');
  await expect(page.getByTestId('pi-send')).toBeEnabled();
});


test('Changing modes in a new unsaved chat retains the draft without reopening a phantom session', async ({ page }) => {
  const fixture = await piPage(page);
  await page.route('**/api/v1/pi/command', (route) => route.request().postDataJSON().command.type === 'get_state' ? route.fulfill({ json: { ok: true, data: { success: true, data: { thinkingLevel: 'medium', isStreaming: false } } } }) : route.fallback());
  await page.goto('http://localhost:5200'); await page.getByTestId('dock-app-pi').click();
  const input = page.getByTestId('pi-prompt'); await expect(input).toBeEnabled();
  await input.fill('Unsent draft stays here');
  for (const label of ['Read only', 'Approve for me', 'Ask for approval']) {
    await page.getByTestId('pi-permission-mode').click();
    await page.getByRole('option', { name: label, exact: true }).click();
    await expect(page.getByTestId('pi-permission-mode')).toBeEnabled();
    await expect(input).toHaveText('Unsent draft stays here');
    await expect(page.getByTestId('pi-send')).toBeEnabled();
    expect(fixture.starts.at(-1)?.session).toBeFalsy();
  }
  await input.fill(''); await page.reload(); await expect(input).toBeEnabled();
  expect(fixture.starts.at(-1)?.session).toBeFalsy();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('Approval mode remembers the last explicit choice for new chats and reopening Pi', async ({ page }) => {
  const fixture = await openPi(page);
  const mode = page.getByTestId('pi-permission-mode');
  const choose = async (label: string) => {
    await mode.click(); await page.getByRole('option', { name: label, exact: true }).click();
    await expect(mode).toBeEnabled(); await expect(mode).toHaveText(label);
  };
  await choose('Approve for me');
  expect(fixture.starts.at(-1)).toMatchObject({ permissionMode: 'auto', rememberPermissionMode: true });
  await page.getByTestId('pi-new').click(); await expect(mode).toBeEnabled();
  await expect(mode).toHaveText('Approve for me');
  expect(fixture.starts.at(-1)?.rememberPermissionMode).toBe(false);
  await choose('Read only');
  await page.getByTestId('window-close-pi').click(); await page.getByTestId('dock-app-pi').click();
  await expect(mode).toBeEnabled(); await expect(mode).toHaveText('Read only');
  expect(fixture.starts.at(-1)?.rememberPermissionMode).toBe(false);
  await page.getByTestId('pi-new').click(); await expect(mode).toBeEnabled(); await expect(mode).toHaveText('Read only');
  expect(fixture.starts.at(-1)?.rememberPermissionMode).toBe(false);
});
