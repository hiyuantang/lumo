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
  await expect(page.getByRole('combobox', { name: 'Send behavior' })).toHaveCount(0);
  await prompt.fill('Keep this draft');
  await cards.nth(1).getByRole('button', { name: 'Queued message options' }).click();
  await page.getByRole('menu', { name: 'Queued message options' }).getByRole('menuitem', { name: 'Edit', exact: true }).click();
  await cards.nth(1).getByRole('textbox').fill('Revised second follow-up');
  await cards.nth(1).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(cards.nth(1)).toContainText('Revised second follow-up');
  await expect(prompt).toHaveText('Keep this draft');
  await cards.first().getByRole('button', { name: 'Queued message options' }).click();
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  await expect(cards).toHaveCount(2);
  await cards.last().getByRole('button', { name: 'Send now' }).click();
  await expect(cards.first()).toContainText('Third follow-up');
  expect(fixture.commands).toContainEqual({ type: 'steer', message: 'Third follow-up' });
  await page.screenshot({ path: '/tmp/lumo-pi-queue-light.png', animations: 'disabled' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: '/tmp/lumo-pi-queue-dark.png', animations: 'disabled' });
  expect(fixture.consumeQueued()?.message).toBe('Third follow-up');
  await expect(cards).toHaveCount(1);
  await expect(page.getByTestId('pi-messages')).toContainText('Third follow-up');
  await prompt.fill(''); await expect(send).toHaveAttribute('aria-label', 'Stop'); await send.click();
  await expect(prompt).toHaveText('Revised second follow-up');
  await expect(cards).toHaveCount(0);
  await expect(send).toHaveAttribute('aria-label', 'Send');
  expect(fixture.commands.filter((item) => item.type === 'abort')).toHaveLength(1);
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
