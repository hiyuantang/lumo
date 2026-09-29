// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '../offline';
import { piPage } from './pi-fixture';
import { piAction } from './pi-actions';
import { attachmentPrompt, splitAttachmentPrompt, fileAttachmentKey, conversationAttachmentKey } from '../../src/apps/piAttachments';

test('Conversation references round trip without exposing lookup instructions in visible text', () => {
  const reference = { project: "/home/user/it's a project", session: 'chat.jsonl', name: 'Earlier work', path: "/home/user/it's a project/chat.jsonl", reader: '/usr/local/bin/lumod' };
  const prompt = attachmentPrompt('Find the previous decision', ['/home/user/a b.md'], [reference]);
  expect(prompt).toContain("it'\\''s a project/chat.jsonl");
  expect(splitAttachmentPrompt(prompt)).toEqual({ text: 'Find the previous decision', paths: ['/home/user/a b.md'], references: [reference] });
  expect(splitAttachmentPrompt('[Lumo conversation references]\ninvalid')).toEqual({ text: '[Lumo conversation references]\ninvalid', paths: [], references: [] });
});

test('Mixed context order survives serialization and removal without leaking metadata', () => {
  const first = { project: '/home/user', session: 'first.jsonl', name: 'First', path: '/sessions/first.jsonl', reader: '/usr/local/bin/lumod' };
  const second = { ...first, session: 'second.jsonl', name: 'Second', path: '/sessions/second.jsonl' };
  const paths = ['/home/user/a.txt', '/home/user/folder/'];
  const order = [fileAttachmentKey(paths[0]), conversationAttachmentKey(first), fileAttachmentKey(paths[1]), conversationAttachmentKey(second)];
  const prompt = attachmentPrompt('Review these', paths, [second, first], order);
  expect(splitAttachmentPrompt(prompt)).toEqual({ text: 'Review these', paths, references: [second, first], order });
  const removed = splitAttachmentPrompt(attachmentPrompt('Review these', paths.slice(1), [first], order));
  expect(removed.order).toEqual([conversationAttachmentKey(first), fileAttachmentKey(paths[1])]);
  expect(splitAttachmentPrompt(prompt.replace('"attachmentIndex":3', '"attachmentIndex":1')).order).toBeUndefined();
  expect(splitAttachmentPrompt(prompt.replace('"attachmentIndex":3', '"attachmentIndex":999999')).order).toBeUndefined();
});

test('Pi supports removable dragged chat references, compact context usage and working indicators', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  const fixture = await piPage(page);
  await page.goto('http://localhost:5200'); await page.getByTestId('dock-app-pi').click();
  const input = page.getByTestId('pi-prompt');
  await expect(input).toBeEnabled();
  await expect(page.getByTestId('pi-context-meter')).toHaveCount(0);
  const chat = page.getByRole('navigation', { name: 'Pi projects', exact: true }).getByRole('button', { name: 'Earlier work', exact: true });
  await chat.dragTo(input);
  const composer = page.locator('.pi-compose form');
  await expect(composer.getByTestId('pi-conversation-reference')).toHaveText('Earlier work');
  await composer.getByRole('button', { name: 'Remove conversation Earlier work' }).click();
  await expect(composer.getByTestId('pi-conversation-reference')).toHaveCount(0);
  await chat.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Reference in message' }).click();
  await expect(composer.getByTestId('pi-conversation-reference')).toHaveCount(1);
  await chat.dragTo(input);
  await expect(composer.getByTestId('pi-conversation-reference')).toHaveCount(1);
  await input.fill('Find the earlier design decision');
  await page.getByTestId('pi-send').click();
  await expect(page.getByTestId('pi-context-meter')).toHaveAttribute('aria-label', '8.8% of compaction budget used');
  await expect(page.getByTestId('pi-chat-working').first()).toBeVisible();
  expect(fixture.commands.find((command) => command.type === 'prompt')).toMatchObject({ message: expect.stringContaining("'/usr/local/bin/lumod' pi-history --file") });
  await expect(page.getByTestId('pi-messages')).not.toContainText('Never use cat');
  await expect(composer.getByTestId('pi-conversation-reference')).toHaveCount(0);
  const spinner = page.getByTestId('pi-chat-working').first();
  const archive = spinner.locator('..').getByRole('button', { name: /^Archive / });
  await expect(archive).toBeDisabled();
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await input.hover();
    await expect(spinner).toHaveCSS('visibility', 'visible');
    await expect(archive).toHaveCSS('opacity', '0');
    await expect(archive).toHaveCSS('pointer-events', 'none');
    await expect(spinner.locator('span')).toHaveCSS('animation-name', 'pi-working-turn');
    await page.getByTestId('pi-sidebar').screenshot({ path: `/tmp/lumo-pi-working-${theme}.png` });
    await spinner.locator('..').hover();
    await expect(spinner).toHaveCSS('visibility', 'hidden');
    await expect(archive).toHaveCSS('opacity', '0.5');
    await input.hover();
    await expect(archive).toHaveCSS('opacity', '0');
    await expect(spinner).toHaveCSS('visibility', 'visible');
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(spinner.locator('span')).toHaveCSS('animation-name', 'none');
  fixture.finish();
  await expect(page.getByTestId('pi-chat-working')).toHaveCount(0);
  await expect(page.getByTestId('pi-send')).toBeDisabled();
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.getByTestId('pi-context-meter').hover();
    await expect(page.getByRole('tooltip')).toContainText('Compact at: 160,000 tokens');
    await expect(page.getByRole('tooltip')).not.toContainText('Maximum context');
    await expect(page.getByRole('tooltip')).toContainText('14,000 tokens used');
    await page.screenshot({ path: `/tmp/lumo-pi-references-${theme}.png`, animations: 'disabled' });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId('pi-context-meter').focus();
  const tooltip = await page.getByRole('tooltip').boundingBox();
  expect(tooltip!.x).toBeGreaterThanOrEqual(0); expect(tooltip!.x + tooltip!.width).toBeLessThanOrEqual(390);
  expect(await page.getByTestId('app-pi').evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/lumo-pi-references-narrow.png', animations: 'disabled' });
  expect(errors).toEqual([]);
});

test('References survive queue take-back and edit/resend while unavailable references keep the draft', async ({ page }) => {
  const fixture = await piPage(page);
  await page.goto('http://localhost:5200'); await page.getByTestId('dock-app-pi').click();
  const input = page.getByTestId('pi-prompt'); const composer = page.locator('.pi-compose form');
  await input.fill('Start'); await page.getByTestId('pi-send').click();
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeEnabled();
  await expect(page.getByTestId('pi-tool')).toContainText('read README.md');
  const chat = page.getByRole('navigation', { name: 'Pi projects', exact: true }).getByRole('button', { name: 'Earlier work', exact: true });
  await chat.dragTo(input);
  await expect(composer.getByTestId('pi-conversation-reference')).toHaveCount(1);
  await input.fill('Compare this chat'); await page.getByTestId('pi-send').click();
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(input).toHaveText('Compare this chat');
  await expect(composer.getByTestId('pi-conversation-reference')).toHaveCount(1);
  fixture.finish(); await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0);
  await page.route('**/api/v1/pi/reference**', (route) => route.fulfill({ status: 404, json: { ok: false, error: { code: 'not_found', message: 'This saved conversation is unavailable.' } } }));
  await page.getByTestId('pi-send').click();
  await expect(page.getByRole('alert')).toContainText('unavailable');
  await expect(input).toHaveText('Compare this chat');
  await expect(composer.getByTestId('pi-conversation-reference')).toHaveCount(1);
  await page.unroute('**/api/v1/pi/reference**');
  await page.getByTestId('pi-send').click();
  await expect(input).toHaveText(''); fixture.finish();
  await expect(page.getByTestId('pi-send')).toHaveAttribute('aria-label', 'Send');
  await piAction(page, 'undo');
  const dialog = page.getByRole('alertdialog');
  await expect(dialog.getByLabel('Edited message')).toHaveValue('Compare this chat');
  await expect(dialog.getByTestId('pi-conversation-reference')).toHaveText('Earlier work');
  await dialog.getByRole('button', { name: 'Remove conversation Earlier work' }).click();
  await expect(dialog.getByTestId('pi-conversation-reference')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await piAction(page, 'undo');
  await page.route('**/api/v1/pi/command', (route) => route.request().postDataJSON().command.type === 'prompt' ? route.fulfill({ json: { ok: true, data: { success: false, error: 'Provider unavailable' } } }) : route.fallback());
  await dialog.getByRole('button', { name: 'Resend', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Provider unavailable');
  await expect(input).toHaveText('Compare this chat');
  await expect(composer.getByTestId('pi-conversation-reference')).toHaveText('Earlier work');
  await page.unroute('**/api/v1/pi/command');
  await input.fill(''); await page.getByTestId('pi-send').click();
  await expect(page.getByRole('article', { name: 'Your message' }).last().getByTestId('pi-conversation-reference')).toHaveText('Earlier work');
});
