// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '../offline';
import { piPage } from './pi-fixture';
import { expandTemplate, expandTemplateCommand, initialTemplate, templateCatalog, templateContent } from '../../apps/pi/src/piTemplates';
import { piMessages, piRetryMessage, type PiMessage } from '../../src/api/pi';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=';

test('Pi preserves the specific transport error when its process closes', async ({ page }) => {
  await piPage(page);
  const message = "This conversation exceeds Lumo's 64 MiB response limit. Your saved chat is intact.";
  await page.route('**/api/v1/pi/events**', (route) => route.fulfill({ json: { ok: true, data: { events: [{ type: 'error', error: message }], cursor: 1, closed: true } } }));
  await page.goto('http://localhost:5200');
  await page.getByTestId('dock-app-pi').click();
  await expect(page.getByTestId('app-pi').getByRole('alert')).toContainText(message);
  await expect(page.getByRole('button', { name: 'Reconnect', exact: true })).toBeVisible();
});

test('Templates expand quoted arguments and defaults without evaluating user text', () => {
  const template = { name: 'review', content: '---\ndescription: Review\n---\n$1 / $2 / ${3:-safe} / ${@:2:1} / $ARGUMENTS', revision: '', path: '' };
  expect(expandTemplate(template, '"API compatibility" tests')).toBe('API compatibility / tests / safe / tests / API compatibility tests');
  expect(expandTemplateCommand('/review "API compatibility" tests', [template])).toBe(expandTemplate(template, '"API compatibility" tests'));
  expect(expandTemplateCommand('Discuss /review', [template])).toBe('Discuss /review');
  expect(expandTemplate({ ...template, content: '$1' }, "'$(touch unsafe)'" )).toBe('$(touch unsafe)');
  expect(() => expandTemplate(template, '"unfinished')).toThrow('Close the quote');
  expect(templateCatalog([initialTemplate])).toHaveLength(1);
  expect(templateContent('---\ndescription: Before\nargument-hint: [focus]\n---\nOld', 'After', 'New')).toBe('---\ndescription: \"After\"\nargument-hint: [focus]\n---\nNew');
  expect(expandTemplate(initialTemplate)).toContain('if editing is unavailable, show a proposed draft');
});

test('Prompt templates save, insert editable drafts, expand arguments and delete', async ({ page }) => {
  const fixture = await piPage(page);
  await page.goto('http://localhost:5200'); await page.getByTestId('dock-app-pi').click();
  const input = page.getByTestId('pi-prompt'); await expect(input).toBeEnabled();
  await input.fill('/init'); await page.getByTestId('pi-slash-menu').getByRole('option').click();
  await expect(input).toContainText('Create or update a concise AGENTS.md');
  expect(fixture.commands.some((item) => item.type === 'prompt')).toBe(false);
  await input.fill(''); await page.getByTestId('pi-settings-button').click();
  await page.getByRole('tab', { name: 'Prompt templates', exact: true }).click();
  await page.getByRole('button', { name: 'New template', exact: true }).click();
  await page.getByLabel('Template name', { exact: true }).fill('review');
  await page.getByLabel('Template description').fill('Review compatibility');
  await page.getByLabel('Template prompt').fill('Review $1 for ${2:-regressions}.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.pi-template-list')).toContainText('/review');
  await expect(page.getByTestId('pi-notification')).toHaveText('Saved');
  for (const width of [1280, 600, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      expect(await page.getByTestId('app-pi').evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
      await page.getByTestId('app-pi').screenshot({ path: `/tmp/lumo-pi-templates-${width}-${colorScheme}.png` });
    }
  }
  await page.getByTestId('pi-home-button').click();
  await input.fill('/review'); await page.getByTestId('pi-slash-menu').getByRole('option').click();
  await expect(input).toHaveText('Review  for regressions.');
  await input.fill('/review "API compatibility" security'); await page.getByTestId('pi-send').click();
  await expect.poll(() => fixture.commands.some((item) => item.type === 'prompt' && item.message === 'Review API compatibility for security.')).toBe(true);
  fixture.finish(); await expect(page.getByTestId('pi-permission-mode')).toBeEnabled();
  await page.getByTestId('pi-settings-button').click();
  await page.locator('.pi-template-list section').filter({ hasText: '/review' }).getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('button', { name: 'Move to Trash', exact: true }).click();
  await expect(page.locator('.pi-template-list')).not.toContainText('/review');
  await expect(page.getByTestId('pi-notification')).toHaveText('Template moved to Trash');
});

test('Retry attempts sit among work steps, disclose errors and use the existing Stop button', async ({ page }) => {
  const fixture = await piPage(page);
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  const history: PiMessage[] = [
    { role: 'user', content: 'Review this project for potential issues.' },
    { role: 'assistant', stopReason: 'toolUse', content: [{ type: 'thinking', thinking: 'Inspect the image and apply the needed edit.' }] },
    { role: 'toolResult', toolCallId: 'read-image', toolName: 'read', args: { path: '/workspace/shot-wharf.png' }, content: [{ type: 'text', text: 'Image reviewed.' }] },
    { role: 'assistant', stopReason: 'toolUse', content: [{ type: 'thinking', thinking: 'The image has been checked.' }] },
    { role: 'toolResult', toolCallId: 'edit-file', toolName: 'edit', content: [{ type: 'text', text: 'Updated the file.' }] },
  ];
  fixture.setHistory(history);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('http://localhost:5200'); await page.getByTestId('dock-app-pi').click();
  await expect(page.getByTestId('pi-prompt')).toBeEnabled();
  fixture.setRetry({ attempt: 1, maxAttempts: 3, retryAt: Date.now() + 2000, source: 'response', errorMessage: 'Connection error.' });
  const transcript = page.getByTestId('pi-messages'); const attempts = transcript.getByTestId('pi-retry-notice');
  await expect(transcript.getByTestId('pi-tool').first().getByRole('button')).toHaveAccessibleName('Read shot-wharf.png Done');
  await expect(transcript.getByTestId('pi-tool').last().getByRole('button')).toHaveAccessibleName('Edit Done');
  await expect(attempts).toHaveCount(1);
  const trigger = attempts.first().getByRole('button', { name: 'Attempt 1 of 3', exact: true });
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(attempts.first().getByText('Connection error.', { exact: true })).not.toBeVisible();
  await expect(page.locator('.pi-compose').getByTestId('pi-retry-notice')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Cancel retry' })).toHaveCount(0);
  await expect(page.locator('.pi-notice')).toHaveCount(0);
  const stop = page.getByTestId('pi-send'); await expect(stop).toHaveAccessibleName('Stop'); await expect(stop).toBeEnabled();
  const editBox = (await transcript.getByTestId('pi-tool').last().boundingBox())!;
  const retryBox = (await attempts.first().boundingBox())!;
  expect(retryBox.y).toBeGreaterThanOrEqual(editBox.y + editBox.height);
  expect(retryBox.y - editBox.y - editBox.height).toBeLessThan(8);
  expect(Math.abs(retryBox.x - editBox.x)).toBeLessThan(1);
  expect(retryBox.height).toBeLessThanOrEqual(28);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme }); await expect(page.locator('html')).toHaveAttribute('data-theme', colorScheme);
      await expect(trigger).toBeVisible();
      expect(await transcript.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
      await page.mouse.move(0, 0);
      await page.getByTestId('app-pi').screenshot({ path: `/private/tmp/lumo-chat-retry-${width}-${colorScheme}.png`, animations: 'disabled' });
    }
  }
  await trigger.focus(); await trigger.press('Enter');
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(attempts.first().getByText('Connection error.', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ colorScheme: 'light' }); await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.mouse.move(0, 0);
  await page.getByTestId('app-pi').screenshot({ path: '/private/tmp/lumo-chat-retry-expanded.png', animations: 'disabled' });
  await trigger.press('Space'); await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  fixture.emit({ type: 'message_start', message: { role: 'assistant', content: [] } }, { type: 'message_end', message: { role: 'assistant', stopReason: 'toolUse', content: [{ type: 'thinking', thinking: 'Continue inspecting the project.' }] } });
  await expect(transcript.locator('.pi-thinking')).toHaveCount(4);
  const thinkingBox = (await transcript.locator('.pi-thinking').last().boundingBox())!;
  expect(thinkingBox.y).toBeGreaterThanOrEqual((await attempts.first().boundingBox())!.y + (await attempts.first().boundingBox())!.height);
  fixture.setRetry({ attempt: 2, maxAttempts: 3, retryAt: Date.now() + 2000, source: 'response', errorMessage: 'Connection error.' });
  await expect(attempts).toHaveCount(2);
  await expect(attempts.last().getByRole('button', { name: 'Attempt 2 of 3', exact: true })).toBeVisible();
  await stop.click(); await expect(attempts).toHaveCount(0); await expect(stop).toHaveAccessibleName('Send');
  expect(fixture.commands.some((item) => item.type === 'abort')).toBe(true);
  expect(fixture.commands.some((item) => item.type === 'abort_retry')).toBe(false);
  fixture.setRetry({ attempt: 1, maxAttempts: 3, retryAt: Date.now() + 2000, source: 'summary', errorMessage: 'Summary provider is temporarily busy.' });
  await expect(attempts).toHaveCount(1);
  fixture.setRetry(null); await expect(attempts).toHaveCount(0);
  fixture.setRetry({ attempt: 1, maxAttempts: 3, retryAt: Date.now() + 2000, source: 'response', errorMessage: 'Connection error.' });
  await expect(attempts).toHaveCount(1);
  fixture.finish(); await expect(attempts).toHaveCount(0); await expect(transcript).toContainText('The project uses React and Go.');
  await expect(stop).toHaveAccessibleName('Send');
  expect(errors).toEqual([]);
});

test('Retry projection removes native hidden failures and temporary steps without duplicating final errors', () => {
  const user: PiMessage = { role: 'user', content: 'Inspect this project.' };
  const failed: PiMessage = { role: 'assistant', content: [], stopReason: 'error', errorMessage: 'Connection error.' };
  const first = piMessages([user, failed], { type: 'auto_retry_start', attempt: 1, maxAttempts: 3, delayMs: 2000, errorMessage: failed.errorMessage });
  expect(first.map((message) => message.role)).toEqual(['user', 'retry']);
  const tool: PiMessage = { role: 'toolResult', toolName: 'read', toolCallId: 'read-1', content: 'File inspected.' };
  const second = piMessages([...first, tool, failed], { type: 'auto_retry_start', attempt: 2, maxAttempts: 3, errorMessage: failed.errorMessage });
  expect(second.map((message) => message.role)).toEqual(['user', 'retry', 'toolResult', 'retry']);
  expect(second.at(-1)?.retry?.attempt).toBe(2);
  expect(piMessages(second, { type: 'auto_retry_end' })).toEqual([user, tool]);
  expect(piMessages([...second, failed], { type: 'auto_retry_end', finalError: failed.errorMessage })).toEqual([user, tool, failed]);
  expect(piMessages(second, { type: 'auto_retry_end', finalError: failed.errorMessage }).at(-1)).toEqual(failed);
  const summary = piRetryMessage({ attempt: 1, maxAttempts: 3, retryAt: 1000, errorMessage: 'Summary failed.', source: 'summary' });
  expect(piMessages([...first, summary], { type: 'summarization_retry_finished' })).toEqual(first);
  expect(piMessages([...first, summary], { type: 'agent_settled' })).toEqual([user]);
});

test('Retry settings retain the chat preference without restarting Pi', async ({ page }) => {
  const fixture = await piPage(page);
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/v1/pi/compaction**', (route) => route.fulfill({ json: { ok: true, data: { enabled: true, defaultReserveTokens: 16384, keepRecentTokens: 20000, revision: 'one' } } }));
  await page.goto('http://localhost:5200'); await page.getByTestId('dock-app-pi').click();
  await expect(page.getByTestId('pi-prompt')).toBeEnabled();
  const starts = fixture.starts.length;
  await page.getByTestId('pi-settings-button').click(); await page.getByRole('tab', { name: 'Providers', exact: true }).click();
  const checkbox = page.getByRole('switch', { name: 'Automatically retry temporary errors' });
  await expect(checkbox).toBeChecked();
  await page.getByTestId('pi-retry-settings').getByText('Automatic retry', { exact: true }).click();
  await expect(checkbox).toBeChecked();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      await expect(page.locator('html')).toHaveAttribute('data-theme', colorScheme);
      await expect(checkbox).toBeVisible();
      await expect(checkbox).toHaveCSS('accent-color', colorScheme === 'dark' ? 'rgb(238, 238, 238)' : 'rgb(36, 36, 36)');
      expect(await page.getByTestId('pi-settings').evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
      const skin = await checkbox.evaluate((node) => { const style = getComputedStyle(node); return { accent: style.accentColor, width: style.width, height: style.height }; });
      await page.getByTestId('app-pi').screenshot({ path: `/private/tmp/lumo-retry-providers-${width}-${colorScheme}.png` });
      await page.getByRole('tab', { name: 'Context & compaction', exact: true }).click();
      await expect(page.getByRole('tabpanel', { name: 'Context & compaction', exact: true }).getByText('Automatic retry', { exact: true })).toHaveCount(0);
      const compaction = page.getByTestId('pi-auto-compaction');
      await expect(compaction).toHaveCSS('accent-color', skin.accent);
      await expect(compaction).toHaveCSS('width', skin.width); await expect(compaction).toHaveCSS('height', skin.height);
      await expect(page.locator('vite-error-overlay')).toHaveCount(0);
      await page.getByTestId('app-pi').screenshot({ path: `/private/tmp/lumo-compaction-layout-${width}-${colorScheme}.png` });
      await page.getByRole('tab', { name: 'Providers', exact: true }).click();
    }
  }
  await checkbox.press('Space'); await expect(checkbox).not.toBeChecked();
  await expect(page.getByTestId('pi-notification')).toHaveText('Saved');
  expect(fixture.starts).toHaveLength(starts);
  expect(fixture.commands.some((item) => item.type === 'set_auto_retry' && !item.enabled)).toBe(true);
  await page.getByTestId('pi-home-button').click(); await page.reload();
  await expect(page.getByTestId('pi-prompt')).toBeEnabled();
  expect(fixture.commands.filter((item) => item.type === 'set_auto_retry').at(-1)).toMatchObject({ enabled: false });
  expect(errors).toEqual([]);
});

test('Native images, local Markdown images and pasted attachments render without external image requests', async ({ page }) => {
  const fixture = await piPage(page); const errors: string[] = []; page.on('pageerror', (err) => errors.push(err.message));
  await page.route('**/api/v1/files/read?**', (route) => route.fulfill({ json: { ok: true, data: { content: png, encoding: 'binary', truncated: false } } }));
  await page.route('**/api/v1/pi/images', (route) => route.fulfill({ json: { ok: true, data: { path: '/home/user/.local/state/lumo/pi-attachments/image-test.png' } } }));
  await page.route('**/api/v1/pi/command', (route) => route.request().postDataJSON().command.type === 'get_messages' ? route.fulfill({ json: { ok: true, data: { success: true, eventCursor: 0, data: { messages: [
    { role: 'assistant', content: [{ type: 'image', mimeType: 'image/png', data: png }, { type: 'text', text: '![Local preview](./preview.png)\n\n![Remote preview](https://external.invalid/image.png)' }] },
    { role: 'toolResult', toolName: 'read', content: [{ type: 'image', mimeType: 'image/png', data: png }] },
  ] } } } }) : route.fallback());
  await page.goto('http://localhost:5200'); await page.getByTestId('dock-app-pi').click();
  await expect(page.getByRole('img', { name: 'Image 1', exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Local preview' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Image: Remote preview' })).toBeVisible();
  await page.getByTestId('pi-tool').getByRole('button').first().click();
  await expect(page.getByRole('img', { name: 'Read image 1' })).toBeVisible();
  const input = page.getByTestId('pi-prompt');
  await input.evaluate((node, png) => { const data = new DataTransfer(); data.items.add(new File([Uint8Array.from(atob(png), (c) => c.charCodeAt(0))], 'test.png', { type: 'image/png' })); node.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data })); }, png);
  const attachment = page.locator('form').getByTestId('pi-attachment'); await expect(attachment.getByRole('img')).toBeVisible();
  await input.fill('Inspect this image'); await page.getByTestId('pi-send').click();
  await expect.poll(() => fixture.commands.some((item) => item.type === 'prompt' && item.message.includes('/pi-attachments/image-test.png'))).toBe(true);
  expect(errors).toEqual([]);
});
