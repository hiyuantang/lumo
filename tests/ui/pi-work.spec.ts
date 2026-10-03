// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '../offline';
import type { PiMessage } from '../../src/api/pi';
import { messagePreview, workGroups, workDuration } from '../../apps/pi/src/piWorkGroups';
import { piPage } from './pi-fixture';

const user = (text: string, timestamp = 1000): PiMessage => ({ role: 'user', timestamp, content: text });
const answer = (text: string, timestamp = 62000): PiMessage => ({ role: 'assistant', timestamp, stopReason: 'stop', content: [{ type: 'thinking', thinking: 'Private work detail' }, { type: 'text', text }] });
const step: PiMessage = { role: 'assistant', stopReason: 'toolUse', content: [{ type: 'text', text: 'Checking the source' }, { type: 'toolCall', id: 'tool-1', name: 'read' }] };
const tool: PiMessage = { role: 'toolResult', toolName: 'read', toolCallId: 'tool-1', content: 'Source content' };

test('Work groups distinguish final answers, steering, streaming, interrupted work and missing timestamps', () => {
  const call: PiMessage = { role: 'assistant', content: [{ type: 'toolCall', id: 'tool-1', name: 'read', arguments: { path: '/project/src/notes.txt' } }] };
  expect(workGroups([user('Read'), call, tool, answer('Done')], false)[0].steps[0].args).toEqual({ path: '/project/src/notes.txt' });
  const messages = [user('First'), step, tool, user('Also check this'), answer('Finished'), user('Second', 70000), { ...answer('Partial', 71000), stopReason: 'aborted' }];
  const groups = workGroups(messages, false);
  expect(messagePreview(answer('**Done**: see [notes](https://example.test).'))).toBe('Done: see notes.');
  expect(groups).toHaveLength(2); expect(groups[0].users).toHaveLength(2);
  expect(groups[0].segments.map((segment) => segment.user?.content)).toEqual(['First', 'Also check this']);
  expect(groups[0].segments[0].steps).toEqual([step, tool]);
  expect(groups[0].segments[1].steps[0].content).toEqual([{ type: 'thinking', thinking: 'Private work detail' }]);
  expect(groups[0].duration).toBe(61000); expect(workDuration(groups[0].duration!)).toBe('1m 1s');
  expect(groups[0].final?.content).toEqual([{ type: 'text', text: 'Finished' }]);
  expect(groups[0].steps).toHaveLength(3);
  expect(groups[1].final).toBeUndefined(); expect(groups[1].interrupted).toBe(true);
  expect(workGroups([user('First'), step, tool], false)[0].final).toBeUndefined();
  expect(workGroups([user('First'), { ...answer('Streaming'), streaming: true }], true)[0].final).toBeUndefined();
  expect(workGroups([{ role: 'user', content: 'No date' }, answer('Done')], false)[0].duration).toBeUndefined();
  expect(workGroups([user('First'), answer('Done'), user('Second'), step], true).map((group) => group.working)).toEqual([false, true]);
  expect(workGroups([user('First'), answer('Done'), { ...user('Steer at the next opportunity'), delivery: 'steer' }, step], true)).toHaveLength(1);
});

test('Finished work collapses automatically and only final assistant answers expose Copy', async ({ page }) => {
  const fixture = await piPage(page);
  await page.goto('http://localhost:5200'); await page.getByTestId('dock-app-pi').click();
  await page.getByTestId('pi-prompt').fill('Review the project'); await page.getByTestId('pi-send').click();
  const summary = page.getByTestId('pi-work-summary');
  await expect(summary.getByRole('button', { name: /^Working for / })).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('pi-tool')).toBeVisible();
  await expect(page.locator('.pi-message-assistant').getByRole('button', { name: 'Copy message' })).toHaveCount(0);
  expect(await page.locator('.pi-work-steps .pi-message-actions').count()).toBe(0);
  fixture.finish();
  const disclosure = summary.getByRole('button', { name: /Worked/ });
  await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
  expect(await disclosure.evaluate((node) => { const label = node.querySelector('.disclosure-label')!.getBoundingClientRect(); const arrow = node.querySelector('svg')!.getBoundingClientRect(); return arrow.left >= label.right && arrow.left - label.right <= 9; })).toBe(true);
  await expect(summary).toHaveCSS('border-bottom-width', '1px');
  expect((await summary.boundingBox())!.height).toBeGreaterThan((await disclosure.boundingBox())!.height);
  await expect(page.getByTestId('pi-tool')).not.toBeVisible();
  await expect(page.getByRole('article', { name: 'Your message' })).toContainText('Review the project');
  await expect(page.getByRole('article', { name: 'Pi response' })).toContainText('React and Go');
  await expect(page.locator('.pi-message-assistant').getByRole('button', { name: 'Copy message' })).toHaveCount(1);
  expect(await page.getByTestId('pi-work').evaluate((node) => Boolean(node.querySelector('.pi-message-user')!.compareDocumentPosition(node.querySelector('.pi-work-summary')!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  await disclosure.click(); await expect(page.getByTestId('pi-tool')).toBeVisible();
  await expect(page.locator('.pi-message-assistant').getByRole('button', { name: 'Copy message' })).toHaveCount(1);
  await expect(summary.locator('.pi-message-actions')).toHaveCount(0);
  await disclosure.click(); await expect(page.getByTestId('pi-tool')).not.toBeVisible();
});

test('Turn markers preview clamped messages and jump within the chat in both themes and a narrow window', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  await piPage(page);
  const history = Array.from({ length: 8 }, (_, index) => [user(`Request ${index + 1}: ${'Review the design and explain the changes. '.repeat(4)}`, 1000 + index * 100000), step, { ...tool, toolCallId: `tool-${index}` }, answer(`Answer ${index + 1}. ${'Here is a readable explanation of what changed and how it was verified. '.repeat(8)}`, 62000 + index * 100000)]).flat();
  await page.route('**/api/v1/pi/command', (route) => route.request().postDataJSON().command.type === 'get_messages' ? route.fulfill({ json: { ok: true, data: { success: true, eventCursor: 0, data: { messages: history } } } }) : route.fallback());
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('http://localhost:5200'); await page.getByTestId('dock-app-pi').click();
  const marks = page.getByRole('navigation', { name: 'Conversation turns' }).getByRole('button');
  await expect(marks).toHaveCount(8);
  await expect(page.getByTestId('pi-work-summary').first().getByRole('button', { name: 'Worked for 1m 1s' })).toHaveAttribute('aria-expanded', 'false');
  await marks.first().hover(); const preview = page.getByTestId('pi-turn-preview');
  await expect(preview).toContainText('Request 1:'); await expect(preview).toContainText('Answer 1.');
  await expect(preview.locator('.pi-turn-preview-user>span')).toHaveCSS('text-overflow', 'ellipsis');
  await expect(preview.locator('p')).toHaveCSS('-webkit-line-clamp', '3');
  await marks.first().click();
  await expect.poll(() => page.getByTestId('pi-messages').evaluate((node) => Math.abs(node.querySelector('[data-message-anchor]')!.getBoundingClientRect().top - node.getBoundingClientRect().top - 16))).toBeLessThan(2);
  await expect(page.getByTestId('pi-work-segment').first()).toBeFocused();
  await marks.nth(3).focus(); await expect(preview).toContainText('Request 4:');
  await marks.nth(3).press('Enter'); await expect(page.getByTestId('pi-work-segment').nth(3)).toBeFocused();
  await expect.poll(() => page.getByTestId('pi-messages').evaluate((node) => Math.abs(node.querySelectorAll('[data-message-anchor]')[3].getBoundingClientRect().top - node.getBoundingClientRect().top - 16))).toBeLessThan(2);
  await marks.nth(3).hover();
  await page.screenshot({ path: '/tmp/lumo-pi-work-light.png', animations: 'disabled' });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.screenshot({ path: '/tmp/lumo-pi-work-dark.png', animations: 'disabled' });
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click(); await page.setViewportSize({ width: 390, height: 844 });
  await marks.first().hover(); await expect(preview).toBeVisible();
  const bounds = (await preview.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: '/tmp/lumo-pi-work-narrow.png', animations: 'disabled' });
  expect(await page.getByTestId('pi-messages').evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('A steer message keeps its chronological position inside the running work', async ({ page }) => {
  const fixture = await piPage(page);
  await page.goto('http://localhost:5200'); await page.getByTestId('dock-app-pi').click();
  const prompt = page.getByTestId('pi-prompt');
  await prompt.fill('Inspect this project'); await page.getByTestId('pi-send').click();
  await expect(page.getByTestId('pi-tool')).toBeVisible();
  await prompt.fill('Focus on the API'); await page.getByTestId('pi-send').click();
  await page.getByTestId('pi-queued-message').getByRole('button', { name: 'Send now' }).click();
  await expect(page.getByTestId('pi-queued-message').getByRole('button', { name: 'Queued message options' })).toBeEnabled();
  expect(fixture.consumeQueued()).toMatchObject({ type: 'steer', message: 'Focus on the API' });
  const segments = page.getByTestId('pi-work-segment');
  await expect(segments).toHaveCount(2);
  await expect(page.getByTestId('pi-work')).toHaveCount(1);
  await expect(segments.first().locator('.pi-message-user')).toContainText('Inspect this project');
  await expect(segments.first().getByTestId('pi-tool')).toBeVisible();
  await expect(segments.last().locator('.pi-message-user')).toContainText('Focus on the API');
  fixture.finish();
  await expect(page.locator('.pi-message-assistant').getByRole('button', { name: 'Copy message' })).toHaveCount(1);
  await expect(segments.first().getByTestId('pi-tool')).not.toBeVisible();
  const header = page.getByTestId('pi-work-summary');
  await expect(header).toHaveCount(1);
  await expect(header.getByRole('button')).toHaveAttribute('aria-expanded', 'false');
  await expect(segments.first().locator('.pi-message-user')).toBeVisible();
  await expect(segments.last().locator('.pi-message-user')).toBeVisible();
  await header.getByRole('button').click();
  await expect(segments.first().getByTestId('pi-tool')).toBeVisible();
  const order = await page.getByTestId('pi-work').evaluate((node) => [...node.querySelectorAll('.pi-message-user,.pi-tool,.pi-message-assistant:not(.pi-message-activity)')].map((item) => item.classList.contains('pi-tool') ? 'tool' : item.textContent));
  expect(order[0]).toContain('Inspect this project'); expect(order[1]).toBe('tool'); expect(order[2]).toContain('Focus on the API'); expect(order[3]).toContain('React and Go');
  await expect(page.getByRole('navigation', { name: 'Conversation turns' }).getByRole('button')).toHaveCount(2);
});

test('Compact markers represent each steer and share work colors with a local hover wave', async ({ page }) => {
  await piPage(page);
  const history = [...Array.from({ length: 4 }, (_, index) => [user(`Earlier request ${index}`), answer('Earlier final answer. '.repeat(30))]).flat(), user('Latest request'), step, user('First steer'), step, user('Second steer'), step, user('Third steer'), answer('Latest final answer. '.repeat(30))];
  await page.route('**/api/v1/pi/command', (route) => route.request().postDataJSON().command.type === 'get_messages' ? route.fulfill({ json: { ok: true, data: { success: true, eventCursor: 0, data: { messages: history } } } }) : route.fallback());
  await page.goto('http://localhost:5200'); await page.getByTestId('dock-app-pi').click();
  const marks = page.locator('.pi-turn-markers button');
  await expect(marks).toHaveCount(8);
  await expect(page.locator('.pi-turn-markers .is-current-work')).toHaveCount(4);
  const latest = page.getByTestId('pi-work').last();
  await expect(latest.getByTestId('pi-work-summary')).toHaveCount(1);
  await expect(latest.getByRole('article', { name: 'Your message' })).toHaveCount(4);
  await expect(latest.getByRole('article', { name: 'Pi response' })).toHaveCount(1);
  expect(await latest.evaluate((node) => node.querySelector('.pi-work-users')?.nextElementSibling?.classList.contains('pi-work-summary'))).toBe(true);
  const colors = await marks.evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node.firstElementChild!).backgroundColor));
  expect(new Set(colors.slice(4)).size).toBe(1); expect(colors[0]).not.toBe(colors[4]);
  await expect(marks.last().locator('span')).toHaveCSS('width', '8px');
  await expect(marks.first()).toHaveCSS('height', '12px');
  await marks.nth(3).hover();
  await expect.poll(() => marks.locator('span').evaluateAll((nodes) => nodes.filter((node) => node.getBoundingClientRect().width > 8.1).length)).toBe(7);
  await page.mouse.move(900, 100);
  await expect(marks.nth(3).locator('span')).toHaveCSS('width', '8px');
  await marks.nth(6).hover();
  await expect(page.getByTestId('pi-turn-preview')).toContainText('Second steer');
  await marks.nth(6).click();
  await expect(page.getByTestId('pi-work-segment').nth(6)).toBeFocused();
  await expect.poll(() => page.getByTestId('pi-messages').evaluate((node) => Math.abs(node.scrollTop - Math.min(node.scrollHeight - node.clientHeight, node.scrollTop + node.querySelectorAll('[data-message-anchor]')[6].getBoundingClientRect().top - node.getBoundingClientRect().top - 16)))).toBeLessThan(2);
  await marks.nth(5).hover();
  await page.screenshot({ path: '/tmp/lumo-pi-rail-wave.png', animations: 'disabled' });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
  await marks.nth(3).hover();
  await expect(marks.nth(3).locator('span')).toHaveCSS('width', '8px');
});


test('Running work shows a live elapsed timer and freezes it when complete', async ({ page }) => {
  const fixture = await piPage(page);
  await page.clock.install();
  await page.goto('http://localhost:5200'); await page.getByTestId('dock-app-pi').click();
  await page.getByTestId('pi-prompt').fill('Review the project'); await page.getByTestId('pi-send').click();
  const header = page.getByTestId('pi-work-summary').getByRole('button');
  await expect(header).toHaveText(/^Working for /);
  await page.clock.fastForward(272000);
  await expect(header).toHaveText(/Working for 4m 3\ds/);
  fixture.finish();
  await expect(header).toHaveText(/^Worked for /);
  await expect(header).toHaveAttribute('aria-expanded', 'false');
  const finished = await header.textContent();
  await page.clock.fastForward(10000);
  await expect(header).toHaveText(finished!);
});

test('Work with no visible steps has a plain label and no expandable empty content', async ({ page }) => {
  await piPage(page);
  const blank: PiMessage = { role: 'assistant', content: [{ type: 'thinking', thinking: '   ' }, { type: 'toolCall', id: 'metadata', name: 'read' }] };
  const plain = { ...answer('Final answer'), content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'Final answer' }] };
  const history = [user('Direct answer'), plain, user('Empty work'), blank, plain, user('Real work'), tool, answer('With steps')];
  expect(workGroups(history, false).map((group) => group.steps.length)).toEqual([0, 0, 2]);
  await page.route('**/api/v1/pi/command', (route) => route.request().postDataJSON().command.type === 'get_messages' ? route.fulfill({ json: { ok: true, data: { success: true, eventCursor: 0, data: { messages: history } } } }) : route.fallback());
  await page.goto('http://localhost:5200'); await page.getByTestId('dock-app-pi').click();
  const groups = page.getByTestId('pi-work');
  await expect(groups).toHaveCount(3);
  for (const group of [groups.nth(0), groups.nth(1)]) {
    await expect(group.locator('.pi-work-heading')).toContainText('Worked for');
    await expect(group.locator('.pi-work-summary,.disclosure-body')).toHaveCount(0);
  }
  await groups.last().getByRole('button', { name: /Worked for/ }).click();
  await expect(groups.last().getByTestId('pi-tool')).toBeVisible();
});

test('Expanding long work keeps the composer and app controls fixed', async ({ page }) => {
  await piPage(page);
  const history = [user('Review this project'), ...Array.from({ length: 45 }, (_, index) => [{ role: 'assistant', content: [{ type: 'thinking', thinking: 'Reviewing details. '.repeat(80) }] } as PiMessage, { ...tool, toolCallId: `long-${index}`, content: 'Output line\n'.repeat(100) }]), answer('The review is complete.')].flat();
  await page.route('**/api/v1/pi/command', (route) => route.request().postDataJSON().command.type === 'get_messages' ? route.fulfill({ json: { ok: true, data: { success: true, eventCursor: 0, data: { messages: history } } } }) : route.fallback());
  await page.goto('http://localhost:5200'); await page.getByTestId('dock-app-pi').click();
  const header = page.getByTestId('pi-work-summary').getByRole('button');
  for (const narrow of [false, true]) {
    if (narrow) { await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click(); await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ colorScheme: 'dark' }); }
    await expect(header).toHaveAttribute('aria-expanded', 'false');
    await page.getByTestId('app-pi').evaluate(async (node) => { await Promise.all(node.closest('.window')!.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => {}))); });
    const before = await page.locator('.pi-compose,.pi-session-actions,.pi-app-rail,.pi-sidebar,.pi-transcript-layout').evaluateAll((nodes) => nodes.map((node) => { const { x, y, width, height } = node.getBoundingClientRect(); return { x, y, width, height }; }));
    await header.click();
    await expect(page.getByTestId('pi-tool').first()).toBeVisible();
    await page.getByTestId('pi-tool').first().getByRole('button').click();
    await expect(page.getByTestId('pi-tool').first().locator('pre')).toBeVisible();
    const after = await page.locator('.pi-compose,.pi-session-actions,.pi-app-rail,.pi-sidebar,.pi-transcript-layout').evaluateAll((nodes) => nodes.map((node) => { const { x, y, width, height } = node.getBoundingClientRect(); return { x, y, width, height }; }));
    expect(after).toEqual(before);
    expect(await page.getByTestId('pi-messages').evaluate((node) => node.scrollHeight > node.clientHeight * 2)).toBe(true);
    await page.screenshot({ path: `/tmp/lumo-pi-fixed-controls-${narrow ? 'narrow' : 'normal'}.png`, animations: 'disabled' });
    await header.click(); await expect(header).toHaveAttribute('aria-expanded', 'false');
  }
});
