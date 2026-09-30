// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '../offline';
import { piPage } from './pi-fixture';
import { piAction } from './pi-actions';
import { attachmentPrompt, splitAttachmentPrompt, fileAttachmentKey, conversationAttachmentKey } from '../../src/apps/piAttachments';

test('Conversation references round trip without exposing lookup instructions in visible text', () => {
  const reference = { project: "/home/user/it's a project", session: 'chat.jsonl', name: 'Earlier work', path: "/home/user/it's a project/chat.jsonl", reader: '/usr/local/bin/lumod' };
  const prompt = attachmentPrompt('Find the previous decision', ['/home/user/a b.md'], [reference]);
  expect(prompt).toContain(JSON.stringify(reference.path));
  expect(splitAttachmentPrompt(prompt)).toEqual({ text: 'Find the previous decision', paths: ['/home/user/a b.md'], references: [reference], order: [conversationAttachmentKey(reference), fileAttachmentKey('/home/user/a b.md')] });
  expect(splitAttachmentPrompt('[Lumo conversation references]\ninvalid')).toEqual({ text: '[Lumo conversation references]\ninvalid', paths: [], references: [] });
});

test('Mixed context order survives serialization and removal without leaking metadata', () => {
  const first = { project: '/home/user', session: 'first.jsonl', name: 'First', path: '/sessions/first.jsonl', reader: '/usr/local/bin/lumod' };
  const second = { ...first, session: 'second.jsonl', name: 'Second', path: '/sessions/second.jsonl' };
  const paths = ['/home/user/a.txt', '/home/user/folder/'];
  const order = [fileAttachmentKey(paths[0]), conversationAttachmentKey(first), fileAttachmentKey(paths[1]), conversationAttachmentKey(second)];
  const prompt = attachmentPrompt('Review these', paths, [second, first], order);
  expect(splitAttachmentPrompt(prompt)).toEqual({ text: 'Review these', paths, references: [first, second], order });
  const removed = splitAttachmentPrompt(attachmentPrompt('Review these', paths.slice(1), [first], order));
  expect(removed.order).toEqual([conversationAttachmentKey(first), fileAttachmentKey(paths[1])]);
});

test('Multiple chats, files and folders share guidance and preserve one ordered entry each', () => {
  const first = { project: '/home/user', session: 'one.jsonl', name: 'One', path: '/sessions/one.jsonl', reader: '/usr/local/bin/lumod' };
  const second = { ...first, session: 'two.jsonl', name: 'Two', path: '/sessions/two.jsonl' };
  const paths = ['/home/user/report.md', '/home/user/assets/'];
  const order = [fileAttachmentKey(paths[0]), conversationAttachmentKey(first), fileAttachmentKey(paths[1]), conversationAttachmentKey(second)];
  const prompt = attachmentPrompt('Compare these', [...paths, paths[0]], [first, second, first], order);
  expect(prompt.match(/pi-history --file/g)).toHaveLength(1);
  expect(prompt.match(/Never read or paste an entire chat history file at once/g)).toHaveLength(1);
  for (const path of [...paths, first.path, second.path, first.reader]) expect(prompt.split(path)).toHaveLength(2);
  expect(splitAttachmentPrompt(prompt)).toEqual({ text: 'Compare these', paths, references: [first, second], order });
  const filesOnly = attachmentPrompt('', paths);
  expect(filesOnly).not.toContain('pi-history');
  expect(filesOnly).not.toContain('Chats are');
  expect(splitAttachmentPrompt(filesOnly)).toEqual({ text: '', paths, references: [], order: paths.map(fileAttachmentKey) });
  expect(attachmentPrompt('  Just text  ', [])).toBe('Just text');
});

test('Legacy attachment messages remain editable and malformed new metadata remains visible', () => {
  const reference = { project: '/home/user', session: 'one.jsonl', name: 'One', path: '/sessions/one.jsonl', reader: '/usr/local/bin/lumod' };
  const legacy = `[Lumo conversation references]\n${JSON.stringify([{ ...reference, attachmentIndex: 1 }])}\nOld lookup guidance\n[/Lumo conversation references]\n\nread: "/home/user/a.txt"\n\nOriginal message`;
  const parts = splitAttachmentPrompt(legacy);
  expect(parts).toEqual({ text: 'Original message', paths: ['/home/user/a.txt'], references: [reference], order: [fileAttachmentKey('/home/user/a.txt'), conversationAttachmentKey(reference)] });
  expect(splitAttachmentPrompt(attachmentPrompt(parts.text, parts.paths, parts.references, parts.order))).toEqual(parts);
  expect(splitAttachmentPrompt(legacy.replace('"attachmentIndex":1', '"attachmentIndex":999999')).order).toBeUndefined();
  expect(splitAttachmentPrompt('read: "/home/user/a.txt"\n\nOld file')).toEqual({ text: 'Old file', paths: ['/home/user/a.txt'], references: [] });
  for (const metadata of ['invalid', '{"items":[{"type":"file","path":3}]}', '{"items":[{"type":"conversation","path":"/chat.jsonl"}]}']) {
    const text = `[Lumo attachments]\n${metadata}\n[/Lumo attachments]\n\nKeep me`;
    expect(splitAttachmentPrompt(text)).toEqual({ text, paths: [], references: [] });
  }
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
  await expect(page.getByRole('menuitem', { name: 'Reference in message' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await chat.dragTo(input);
  await expect(composer.getByTestId('pi-conversation-reference')).toHaveCount(1);
  await chat.dragTo(input);
  await expect(composer.getByTestId('pi-conversation-reference')).toHaveCount(1);
  await input.fill('Find the earlier design decision');
  await page.getByTestId('pi-send').click();
  await expect(page.getByTestId('pi-context-meter')).toHaveAttribute('aria-label', '8.8% of compaction budget used');
  await expect(page.getByTestId('pi-chat-working').first()).toBeVisible();
  expect(fixture.commands.find((command) => command.type === 'prompt')).toMatchObject({ message: expect.stringContaining('<reader> pi-history --file <path> --limit 8') });
  await expect(page.getByTestId('pi-messages')).not.toContainText('Never read or paste');
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
  await expect(page.getByTestId('pi-tool')).toContainText('Read README.md');
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
