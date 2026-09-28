// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '../offline';
import { piPage } from './pi-fixture';

async function openPi(page: import('@playwright/test').Page) {
  await page.goto('http://localhost:5200'); await page.getByTestId('dock-app-pi').click();
  await expect(page.getByTestId('pi-prompt')).toBeEnabled();
}

test('Pi takes back queued messages and stop preserves queued text alongside the composer draft', async ({ page }) => {
  const fixture = await piPage(page); await openPi(page);
  const prompt = page.getByTestId('pi-prompt');
  await prompt.fill('Start working'); await page.getByTestId('pi-send').click();
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
  await prompt.fill('Queued instruction'); await page.getByTestId('pi-send').click();
  await prompt.fill('Unsent draft');
  await page.getByRole('button', { name: 'Take back', exact: true }).click();
  await expect(prompt).toHaveValue('Unsent draft\n\nQueued instruction');
  await expect(page.getByRole('button', { name: 'Take back', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
  await page.getByTestId('pi-send').click();
  await expect(page.getByRole('button', { name: 'Take back', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(prompt).toHaveValue('Unsent draft\n\nQueued instruction');
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0);
  expect(fixture.commands.filter((item) => item.type === 'clear_queue' || item.type === 'abort').map((item) => item.type)).toEqual(['clear_queue', 'clear_queue', 'abort']);
});

test('Pi edits by stable message ID, keeps the original, and streams only the new chat after resend', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  const fixture = await piPage(page); await openPi(page);
  for (let i = 0; i < 2; i++) {
    await page.getByTestId('pi-prompt').fill('Same prompt'); await page.getByTestId('pi-send').click();
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
    fixture.finish(); await expect(page.getByRole('button', { name: 'Edit & resend', exact: true })).toBeEnabled();
  }
  await page.getByTestId('pi-prompt').fill('Keep my other draft');
  await page.getByRole('button', { name: 'Edit & resend', exact: true }).click();
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
  await expect(page.getByTestId('pi-prompt')).toHaveValue('Keep my other draft');
  fixture.finish(); await expect(page.getByRole('button', { name: 'Edit & resend', exact: true })).toBeEnabled();
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
  fixture.finish(); await expect(page.getByRole('button', { name: 'Edit & resend', exact: true })).toBeEnabled();
  await page.route('**/api/v1/pi/command', (route) => route.request().postDataJSON().command.type === 'prompt'
    ? route.fulfill({ json: { ok: true, data: { success: false, error: 'Provider is unavailable.' } } }) : route.fallback());
  await page.getByRole('button', { name: 'Edit & resend', exact: true }).click();
  await page.getByRole('textbox', { name: 'Edited message', exact: true }).fill('Keep my revision');
  await page.getByRole('button', { name: 'Resend', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Provider is unavailable.');
  await expect(page.getByTestId('pi-prompt')).toHaveValue('Keep my revision');
  await expect(page.getByTestId('pi-send')).toBeEnabled();
});

test('Pi does not restore a queued message that has already been consumed', async ({ page }) => {
  await piPage(page); await openPi(page);
  await page.getByTestId('pi-prompt').fill('Start'); await page.getByTestId('pi-send').click();
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
  await page.getByTestId('pi-prompt').fill('Already consumed'); await page.getByTestId('pi-send').click();
  await page.route('**/api/v1/pi/command', (route) => route.request().postDataJSON().command.type === 'clear_queue'
    ? route.fulfill({ json: { ok: true, data: { success: true, data: { steering: [], followUp: [] } } } }) : route.fallback());
  await page.getByRole('button', { name: 'Take back', exact: true }).click();
  await expect(page.getByTestId('pi-prompt')).toHaveValue('');
  await expect(page.getByRole('alert')).toContainText('already started');
});
