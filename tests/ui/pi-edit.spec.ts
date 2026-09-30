// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '../offline';
import { piPage } from './pi-fixture';
import { piAction } from './pi-actions';

async function openPi(page: import('@playwright/test').Page) {
  await page.goto('http://localhost:5200'); await page.getByTestId('dock-app-pi').click();
  await expect(page.getByTestId('pi-prompt')).toBeEnabled();
}

test('Pi stacks follow-ups, edits and deletes individually, sends now, and switches the composer icon', async ({ page }) => {
  const fixture = await piPage(page); await openPi(page);
  const prompt = page.getByTestId('pi-prompt'); const send = page.getByTestId('pi-send');
  await prompt.fill('Start working'); await send.click();
  await expect(send).toHaveAttribute('aria-label', 'Stop');
  for (const text of ['First follow-up', 'Second follow-up', 'Third follow-up']) {
    await prompt.fill(text); await expect(send).toHaveAttribute('aria-label', 'Send'); await send.click();
  }
  const cards = page.getByTestId('pi-queued-message');
  await expect(cards).toHaveCount(3);
  await expect(cards.locator('.pi-queued-content>p')).toHaveText(['First follow-up', 'Second follow-up', 'Third follow-up']);
  await expect(page.getByRole('combobox', { name: 'Send behavior' })).toHaveCount(0);
  await prompt.fill('Keep this draft');
  await cards.nth(1).getByRole('button', { name: 'Queued message options' }).click();
  await page.getByRole('menu', { name: 'Queued message options' }).getByRole('menuitem', { name: 'Edit', exact: true }).click();
  await expect(prompt).toHaveText('Second follow-up');
  await expect(cards.locator('.pi-queued-content>p')).toHaveText(['First follow-up', 'Third follow-up']);
  await prompt.fill('Revised second follow-up');
  await page.locator('.pi-compose').screenshot({ path: '/tmp/lumo-pi-queued-edit.png', animations: 'disabled' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.locator('.pi-compose').screenshot({ path: '/tmp/lumo-pi-queued-edit-dark.png', animations: 'disabled' });
  await page.setViewportSize({ width: 600, height: 800 });
  await expect(page.getByRole('button', { name: 'Cancel edit' })).toBeVisible();
  await page.locator('.pi-compose').screenshot({ path: '/tmp/lumo-pi-queued-edit-narrow.png', animations: 'disabled' });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.emulateMedia({ colorScheme: 'light' });
  await send.click();
  await expect(cards.locator('.pi-queued-content>p')).toHaveText(['First follow-up', 'Revised second follow-up', 'Third follow-up']);
  await expect(prompt).toHaveText('Keep this draft');
  await cards.first().getByRole('button', { name: 'Queued message options' }).click();
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  await expect(cards).toHaveCount(2);
  await cards.last().getByRole('button', { name: 'Send now' }).click();
  await expect(cards.locator('.pi-queued-content>p')).toHaveText(['Revised second follow-up', 'Third follow-up']);
  await cards.first().getByRole('button', { name: 'Queued message options' }).click();
  await page.getByRole('menu', { name: 'Queued message options' }).getByRole('menuitem', { name: 'Edit', exact: true }).click();
  await expect(prompt).toHaveText('Revised second follow-up');
  await send.click();
  await expect(cards.locator('.pi-queued-content>p')).toHaveText(['Revised second follow-up', 'Third follow-up']);
  expect(fixture.commands).toContainEqual({ type: 'steer', message: 'Third follow-up' });
  await page.screenshot({ path: '/tmp/lumo-pi-queue-light.png', animations: 'disabled' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: '/tmp/lumo-pi-queue-dark.png', animations: 'disabled' });
  await page.setViewportSize({ width: 600, height: 800 });
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(cards.first().getByRole('button', { name: 'Send now' })).toBeVisible();
    expect(await page.getByTestId('app-pi').evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.screenshot({ path: `/tmp/lumo-pi-queue-narrow-${theme}.png`, animations: 'disabled' });
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  expect(fixture.consumeQueued()?.message).toBe('Third follow-up');
  await expect(cards).toHaveCount(1);
  await expect(page.getByTestId('pi-messages')).toContainText('Third follow-up');
  await prompt.fill(''); await expect(send).toHaveAttribute('aria-label', 'Stop'); await send.click();
  await expect(prompt).toHaveText('Revised second follow-up');
  await expect(cards).toHaveCount(0);
  await expect(send).toHaveAttribute('aria-label', 'Send');
  expect(fixture.commands.filter((item) => item.type === 'abort')).toHaveLength(1);
});

test('Editing uses the composer while later queued messages continue, then restores the nearest original position', async ({ page }) => {
  const fixture = await piPage(page); await openPi(page);
  const prompt = page.getByTestId('pi-prompt'), send = page.getByTestId('pi-send');
  const cards = page.getByTestId('pi-queued-message');
  await prompt.fill('Start'); await send.click();
  for (const text of ['First', 'Second', 'Third']) { await prompt.fill(text); await send.click(); }
  await prompt.fill('My unsent draft');
  await cards.first().getByRole('button', { name: 'Queued message options' }).click();
  await page.getByRole('menu', { name: 'Queued message options' }).getByRole('menuitem', { name: 'Edit', exact: true }).click();
  await expect(prompt).toHaveText('First');
  await expect(cards.locator('.pi-queued-content>p')).toHaveText(['Second', 'Third']);
  expect(fixture.consumeQueued()?.message).toBe('Second');
  await expect(cards).toHaveCount(1);
  await prompt.fill('Revised first'); await send.click();
  await expect(cards.locator('.pi-queued-content>p')).toHaveText(['Revised first', 'Third']);
  await expect(prompt).toHaveText('My unsent draft');
  expect(fixture.consumeQueued()?.message).toBe('Revised first');
  expect(fixture.consumeQueued()?.message).toBe('Third');
  expect(fixture.consumeQueued()).toBeUndefined();
  expect(fixture.commands.some((command) => command.type === 'abort')).toBe(false);
});

for (const scenario of [
  { name: 'middle with earlier messages consumed', messages: ['First', 'Second', 'Third', 'Fourth'], edit: 1, consume: 1, expected: ['Revised', 'Third', 'Fourth'] },
  { name: 'last with several earlier messages consumed', messages: ['First', 'Second', 'Third', 'Fourth'], edit: 3, consume: 2, expected: ['Third', 'Revised'] },
  { name: 'identical messages retain separate positions', messages: ['Same', 'Same', 'Last'], edit: 1, consume: 0, expected: ['Same', 'Revised', 'Last'] },
]) test(`Edited queue order: ${scenario.name}`, async ({ page }) => {
  const fixture = await piPage(page); await openPi(page);
  const prompt = page.getByTestId('pi-prompt'), send = page.getByTestId('pi-send');
  const cards = page.getByTestId('pi-queued-message');
  await prompt.fill('Start'); await send.click();
  for (const text of scenario.messages) { await prompt.fill(text); await send.click(); }
  await cards.nth(scenario.edit).getByRole('button', { name: 'Queued message options' }).click();
  await page.getByRole('menu', { name: 'Queued message options' }).getByRole('menuitem', { name: 'Edit', exact: true }).click();
  await expect(prompt).toHaveText(scenario.messages[scenario.edit]);
  await expect(send).toBeEnabled();
  for (let i = 0; i < scenario.consume; i++) expect(fixture.consumeQueued()).toBeDefined();
  await expect(cards).toHaveCount(scenario.messages.length - 1 - scenario.consume);
  await prompt.fill('Revised'); await send.click();
  await expect(cards.locator('.pi-queued-content>p')).toHaveText(scenario.expected);
  await expect(send).toBeEnabled();
  for (const text of scenario.expected) expect(fixture.consumeQueued()?.message).toBe(text);
  expect(fixture.consumeQueued()).toBeUndefined();
});

test('Queue edit remains safe when the agent finishes during take-back and consumes the remaining messages', async ({ page }) => {
  const fixture = await piPage(page); await openPi(page);
  const prompt = page.getByTestId('pi-prompt'), send = page.getByTestId('pi-send');
  const cards = page.getByTestId('pi-queued-message');
  await prompt.fill('Start'); await send.click();
  for (const text of ['First', 'Second', 'Third']) { await prompt.fill(text); await send.click(); }
  let finishOnClear = true;
  await page.route('**/api/v1/pi/command', (route) => {
    if (route.request().postDataJSON().command.type === 'clear_queue' && finishOnClear) { finishOnClear = false; fixture.finish(); }
    return route.fallback();
  });
  await cards.first().getByRole('button', { name: 'Queued message options' }).click();
  await page.getByRole('menu', { name: 'Queued message options' }).getByRole('menuitem', { name: 'Edit', exact: true }).click();
  await expect(prompt).toHaveText('First');
  await expect(page.getByRole('article', { name: 'Your message' }).last()).toContainText('Second');
  await expect(cards.locator('.pi-queued-content>p')).toHaveText(['Third']);
  expect(fixture.consumeQueued()?.message).toBe('Third');
  await expect(cards).toHaveCount(0);
  fixture.finish();
  await expect(page.getByTestId('pi-chat-working')).toHaveCount(0);
  await prompt.fill('Revised first'); await send.click();
  await expect(page.getByRole('article', { name: 'Your message' }).last()).toContainText('Revised first');
  await expect(cards).toHaveCount(0);
  expect(fixture.consumeQueued()).toBeUndefined();
});

test('An edited message starts normally after the agent finishes and preserves its attachments and previous draft', async ({ page }) => {
  const fixture = await piPage(page); await openPi(page);
  const prompt = page.getByTestId('pi-prompt'), send = page.getByTestId('pi-send');
  await prompt.fill('Start'); await send.click();
  const chat = page.getByRole('navigation', { name: 'Pi projects', exact: true }).getByRole('button', { name: 'Earlier work', exact: true });
  await expect(send).toHaveAttribute('aria-label', 'Stop');
  await expect(send).toBeEnabled();
  const transfer = await page.evaluateHandle(() => new DataTransfer());
  await chat.dispatchEvent('dragstart', { dataTransfer: transfer });
  await prompt.dispatchEvent('dragover', { dataTransfer: transfer });
  await prompt.dispatchEvent('drop', { dataTransfer: transfer });
  await chat.dispatchEvent('dragend', { dataTransfer: transfer });
  await transfer.dispose();
  await expect(page.locator('.pi-compose form').getByTestId('pi-conversation-reference')).toHaveText('Earlier work');
  await prompt.fill('Read attached chat'); await send.click();
  await prompt.fill('Preserved draft');
  await page.getByTestId('pi-queued-message').getByRole('button', { name: 'Queued message options' }).click();
  await page.getByRole('menu', { name: 'Queued message options' }).getByRole('menuitem', { name: 'Edit', exact: true }).click();
  await expect(prompt).toHaveText('Read attached chat');
  await expect(page.locator('.pi-compose form').getByTestId('pi-conversation-reference')).toHaveText('Earlier work');
  expect(fixture.consumeQueued()).toBeUndefined();
  fixture.finish();
  await expect(page.getByTestId('pi-chat-working')).toHaveCount(0);
  await prompt.fill('Revised attached chat'); await send.click();
  await expect(page.getByTestId('pi-queued-message')).toHaveCount(0);
  await expect(page.getByTestId('pi-queue-editing')).toHaveCount(0);
  await expect(prompt).toHaveText('Preserved draft');
  await expect(page.getByRole('article', { name: 'Your message' }).last()).toContainText('Revised attached chat');
  await expect(page.getByRole('article', { name: 'Your message' }).last().getByTestId('pi-conversation-reference')).toHaveText('Earlier work');
});

test('Cancel restores the original queue entry and a rejected edit remains in the composer', async ({ page }) => {
  const fixture = await piPage(page); await openPi(page);
  const prompt = page.getByTestId('pi-prompt'), send = page.getByTestId('pi-send');
  const cards = page.getByTestId('pi-queued-message');
  await prompt.fill('Start'); await send.click();
  for (const text of ['First', 'Second']) { await prompt.fill(text); await send.click(); }
  await prompt.fill('Saved draft');
  await cards.first().getByRole('button', { name: 'Queued message options' }).click();
  await page.getByRole('menu', { name: 'Queued message options' }).getByRole('menuitem', { name: 'Edit', exact: true }).click();
  await prompt.fill('Discard this revision');
  await page.getByRole('button', { name: 'Cancel edit' }).click();
  await expect(cards.locator('.pi-queued-content>p')).toHaveText(['First', 'Second']);
  await expect(prompt).toHaveText('Saved draft');
  await cards.last().getByRole('button', { name: 'Queued message options' }).click();
  await page.getByRole('menu', { name: 'Queued message options' }).getByRole('menuitem', { name: 'Edit', exact: true }).click();
  await prompt.fill('Keep this revision');
  await page.route('**/api/v1/pi/command', (route) => {
    const command = route.request().postDataJSON().command;
    return command.type === 'prompt' && command.message === 'Keep this revision' ? route.fulfill({ json: { ok: true, data: { success: false, error: 'Cannot send yet' } } }) : route.fallback();
  });
  await send.click();
  await expect(page.getByRole('alert')).toContainText('Cannot send yet');
  await expect(prompt).toHaveText('Keep this revision');
  await expect(page.getByTestId('pi-queue-editing')).toBeVisible();
  await expect(cards.locator('.pi-queued-content>p')).toHaveText(['First']);
  await page.unroute('**/api/v1/pi/command');
  await send.click();
  await expect(cards.locator('.pi-queued-content>p')).toHaveText(['First', 'Keep this revision']);
  await expect(prompt).toHaveText('Saved draft');
  expect(fixture.consumeQueued()?.message).toBe('First');
  expect(fixture.consumeQueued()?.message).toBe('Keep this revision');
  expect(fixture.consumeQueued()).toBeUndefined();
});

test('Taking back an edit preserves other queued messages when requeueing fails', async ({ page }) => {
  const fixture = await piPage(page); await openPi(page);
  const prompt = page.getByTestId('pi-prompt'), send = page.getByTestId('pi-send');
  await prompt.fill('Start'); await send.click();
  for (const text of ['First', 'Second']) { await prompt.fill(text); await send.click(); }
  await prompt.fill('Saved draft');
  await page.route('**/api/v1/pi/command', (route) => {
    const command = route.request().postDataJSON().command;
    return command.type === 'prompt' && command.message === 'Second' ? route.fulfill({ json: { ok: true, data: { success: false, error: 'Queue unavailable' } } }) : route.fallback();
  });
  await page.getByTestId('pi-queued-message').first().getByRole('button', { name: 'Queued message options' }).click();
  await page.getByRole('menu', { name: 'Queued message options' }).getByRole('menuitem', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('saved with your draft');
  await expect(prompt).toHaveText('First');
  await expect(page.getByTestId('pi-queued-message')).toHaveCount(0);
  await page.unroute('**/api/v1/pi/command');
  await send.click();
  await expect(prompt).toHaveText('Saved draft\n\nSecond');
  expect(fixture.consumeQueued()?.message).toBe('First');
  expect(fixture.consumeQueued()).toBeUndefined();
});

test('Pi edits by stable message ID, keeps the original, and streams only the new chat after resend', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  const fixture = await piPage(page); await openPi(page);
  for (let i = 0; i < 2; i++) {
    await page.getByTestId('pi-prompt').fill('Same prompt'); await page.getByTestId('pi-send').click();
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
    fixture.finish(); await expect(page.getByTestId('pi-send')).toHaveAttribute('aria-label', 'Send');
  }
  await page.getByTestId('pi-prompt').fill('Keep my other draft');
  await piAction(page, 'undo');
  await expect(page.getByRole('textbox', { name: 'Edited message', exact: true })).toHaveValue('Same prompt');
  await expect(page.getByRole('combobox', { name: 'Earlier message', exact: true })).toContainText('2. Same prompt');
  await page.getByRole('combobox', { name: 'Earlier message', exact: true }).click();
  await page.getByRole('option', { name: '1. Same prompt', exact: true }).click();
  await page.getByRole('textbox', { name: 'Edited message', exact: true }).fill('Revised starting point');
  await page.screenshot({ path: '/tmp/lumo-pi-edit-message.png', animations: 'disabled' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: '/tmp/lumo-pi-edit-message-dark.png', animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '/tmp/lumo-pi-edit-message-narrow.png', animations: 'disabled' });
  await expect(page.getByRole('button', { name: 'Resend', exact: true })).toBeInViewport();
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole('button', { name: 'Resend', exact: true }).click();
  await expect(page.getByTestId('server-app-confirm')).toHaveCount(0);
  await expect(page.getByTestId('pi-messages')).toContainText('Revised starting point');
  await expect(page.getByTestId('pi-messages')).not.toContainText('Same prompt');
  expect(fixture.commands).toContainEqual({ type: 'fork', entryId: 'entry-0' });
  expect(fixture.commands.filter((item) => item.type === 'prompt' && item.message === 'Revised starting point')).toHaveLength(1);
  expect(fixture.originals.get('first.jsonl')?.filter((item) => item.role === 'user')).toHaveLength(2);
  await expect(page.getByTestId('pi-prompt')).toHaveText('Keep my other draft');
  fixture.finish(); await expect(page.getByTestId('pi-send')).toHaveAttribute('aria-label', 'Send');
  await page.getByTestId('pi-prompt').fill('');
  await page.getByRole('navigation', { name: 'Pi projects', exact: true }).getByRole('button', { name: 'Original chat', exact: true }).click();
  await expect(page.getByTestId('pi-messages')).toContainText('Same prompt');
  await expect(page.getByTestId('pi-messages')).not.toContainText('Revised starting point');
  expect(errors).toEqual([]);
});

test('Pi preserves an edited message if the provider rejects resend', async ({ page }) => {
  const fixture = await piPage(page); await openPi(page);
  await page.getByTestId('pi-prompt').fill('Original message'); await page.getByTestId('pi-send').click();
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
  fixture.finish(); await expect(page.getByTestId('pi-send')).toHaveAttribute('aria-label', 'Send');
  await page.route('**/api/v1/pi/command', (route) => route.request().postDataJSON().command.type === 'prompt'
    ? route.fulfill({ json: { ok: true, data: { success: false, error: 'Provider is unavailable.' } } }) : route.fallback());
  await piAction(page, 'undo');
  await page.getByRole('textbox', { name: 'Edited message', exact: true }).fill('Keep my revision');
  await page.getByRole('button', { name: 'Resend', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Provider is unavailable.');
  await expect(page.getByTestId('pi-prompt')).toHaveText('Keep my revision');
  await expect(page.getByTestId('pi-send')).toBeEnabled();
});

test('Pi does not restore a queued message that has already been consumed', async ({ page }) => {
  await piPage(page); await openPi(page);
  await page.getByTestId('pi-prompt').fill('Start'); await page.getByTestId('pi-send').click();
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
  await page.getByTestId('pi-prompt').fill('Already consumed'); await page.getByTestId('pi-send').click();
  await page.route('**/api/v1/pi/command', (route) => route.request().postDataJSON().command.type === 'clear_queue'
    ? route.fulfill({ json: { ok: true, data: { success: true, data: { steering: [], followUp: [] } } } }) : route.fallback());
  await page.getByTestId('pi-queued-message').getByRole('button', { name: 'Send now' }).click();
  await expect(page.getByTestId('pi-prompt')).toHaveText('');
  await expect(page.getByRole('alert')).toContainText('already started');
});

test('Pi retains unsent queue entries if requeueing fails and accepts native empty acknowledgements', async ({ page }) => {
  const fixture = await piPage(page); await openPi(page);
  const prompt = page.getByTestId('pi-prompt'); const send = page.getByTestId('pi-send');
  await prompt.fill('Start'); await send.click();
  fixture.emptyQueueReplies();
  for (const text of ['First', 'Second']) { await prompt.fill(text); await send.click(); }
  const cards = page.getByTestId('pi-queued-message'); await expect(cards).toHaveCount(2);
  await page.route('**/api/v1/pi/command', (route) => route.request().postDataJSON().command.type === 'follow_up'
    ? route.fulfill({ json: { ok: true, data: { success: false, error: 'Queue unavailable' } } }) : route.fallback());
  await cards.first().getByRole('button', { name: 'Queued message options' }).click();
  await page.getByRole('menu', { name: 'Queued message options' }).getByRole('menuitem', { name: 'Delete' }).click();
  await expect(prompt).toHaveText('Second');
  await expect(cards).toHaveCount(0);
  await expect(page.getByRole('alert')).toContainText('Unsent messages were returned');
  expect(fixture.commands.filter((command) => command.type === 'abort')).toHaveLength(0);
});
