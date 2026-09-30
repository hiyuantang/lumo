// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from '../offline';
import { piPage } from './pi-fixture';
import type { PiEvent, PiMessage } from '../../src/api/pi';

test('Pi keeps two chats running independently with drafts, queues and background completion', async ({ page }) => {
  await piPage(page);
  const sessions = new Map(['first', 'second'].map((name) => [`${name}.jsonl`, { name, busy: false, messages: [] as PiMessage[], events: [] as PiEvent[] }]));
  const stopped: string[] = [];
  let next = 0;
  const runs = new Map<string, string>();
  const calls: { id: string; type: string; message?: string }[] = [];
  await page.route('**/api/v1/pi/**', async (route) => {
    const request = route.request(); const url = new URL(request.url()); const path = url.pathname;
    const reply = (data: unknown) => route.fulfill({ json: { ok: true, data } });
    if (path.endsWith('/sessions')) return reply({ sessions: [...sessions].map(([id, value]) => ({ id, name: value.name, modified: '2026-09-28T12:00:00Z' })) });
    if (path.endsWith('/start')) {
      const body = request.postDataJSON();
      if (body.resume && runs.has(body.resume)) return reply({ id: body.resume, project: '/home/user', permissionMode: body.permissionMode ?? 'ask' });
      const id = `run-${++next}`; runs.set(id, body.session || 'first.jsonl'); return reply({ id, project: '/home/user', permissionMode: body.permissionMode ?? 'ask' });
    }
    if (path.endsWith('/stop')) { const { id } = request.postDataJSON(); stopped.push(id); runs.delete(id); return reply({ closed: true }); }
    if (path.endsWith('/events')) {
      const session = sessions.get(runs.get(url.searchParams.get('id')!)!)!;
      await new Promise((resolve) => setTimeout(resolve, 80));
      return reply({ events: session?.events.slice(Number(url.searchParams.get('after'))) ?? [], cursor: session?.events.length ?? 0, closed: !session });
    }
    if (!path.endsWith('/command')) return route.fallback();
    const { id, command } = request.postDataJSON(); const file = runs.get(id)!; const session = sessions.get(file)!;
    calls.push({ id, ...command });
    let data: unknown = {};
    if (command.type === 'get_state') data = { sessionFile: `/sessions/${file}`, sessionName: session.name, isStreaming: session.busy };
    if (command.type === 'get_messages') return reply({ success: true, data: { messages: session.messages }, eventCursor: session.events.length });
    if (command.type === 'prompt') {
      session.busy = true;
      const message: PiMessage = { role: 'user', content: command.message }; session.messages.push(message);
      session.events.push({ type: 'agent_start' }, { type: 'message_start', message }, { type: 'message_end', message }); data = { disposition: 'started' };
    }
    if (command.type === 'follow_up') data = { disposition: 'queued' };
    if (command.type === 'abort') { session.busy = false; session.events.push({ type: 'agent_settled' }); }
    return reply({ success: true, data });
  });
  await page.goto('http://localhost:5200'); await page.getByTestId('dock-app-pi').click();
  const input = page.getByTestId('pi-prompt'); const sidebar = page.getByRole('navigation', { name: 'Pi projects', exact: true });
  await expect(input).toBeEnabled(); await input.fill('First task'); await page.getByTestId('pi-send').click();
  await expect(page.getByTestId('pi-send')).toHaveAttribute('aria-label', 'Stop');
  await input.fill('First follow-up'); await page.getByTestId('pi-send').click();
  await expect(page.getByLabel('Queued messages')).toContainText('First follow-up');
  await input.fill('Unsent first draft');
  await sidebar.getByRole('button', { name: 'second', exact: true }).click();
  await expect(input).toHaveText(''); await expect(input).toBeEnabled();
  await input.fill('Second task'); await page.getByTestId('pi-send').click();
  await expect(sidebar.getByTestId('pi-chat-working')).toHaveCount(2);
  await expect(page.getByTestId('desktop-pet')).toHaveAttribute('data-mood', 'working');
  expect(stopped).toEqual([]);
  await page.screenshot({ path: '/tmp/lumo-pi-concurrent-running.png', animations: 'disabled' });
  await input.fill('Unsent second draft');
  const started = next;
  await page.getByTestId('pi-settings-button').click(); await page.getByRole('tab', { name: 'Extensions', exact: true }).click();
  const extensions = page.getByTestId('pi-lumo-use');
  await expect(extensions).toBeEnabled(); await extensions.click(); await expect(extensions).not.toBeChecked();
  await expect(extensions).toBeEnabled(); await extensions.click(); await expect(extensions).toBeChecked();
  await expect(extensions).toBeEnabled(); expect(next).toBe(started); expect(stopped).toEqual([]);
  await page.getByTestId('pi-home-button').click(); await expect(input).toHaveText('Unsent second draft');
  await sidebar.getByRole('button', { name: 'first', exact: true }).click();
  await expect(input).toHaveText('Unsent first draft');
  await expect(page.getByLabel('Queued messages')).toContainText('First follow-up');
  await expect(page.getByTestId('pi-messages')).toContainText('First task');
  await expect(page.getByTestId('pi-messages')).not.toContainText('Second task');
  await sidebar.getByRole('button', { name: 'second', exact: true }).click();
  await expect(input).toHaveText('Unsent second draft');
  await input.fill(''); await page.getByTestId('pi-send').click();
  await expect(sidebar.getByTestId('pi-chat-working')).toHaveCount(1);
  await expect(page.getByTestId('desktop-pet')).toHaveAttribute('data-mood', 'working');
  expect(calls.filter((call) => call.type === 'abort').map((call) => call.id)).toEqual(['run-2']);
  await page.getByTestId('window-close-pi').click();
  await expect(page.getByRole('alertdialog')).toContainText('other running chats');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  const first = sessions.get('first.jsonl')!; first.busy = false;
  const message: PiMessage = { role: 'assistant', content: 'First completed in the background', stopReason: 'stop' }; first.messages.push(message);
  first.events.push({ type: 'message_start', message }, { type: 'message_end', message }, { type: 'agent_settled' });
  await expect(sidebar.getByTestId('pi-chat-working')).toHaveCount(0);
  await expect(page.getByTestId('desktop-pet')).toHaveAttribute('data-mood', 'done');
  await expect(page.getByTestId('pet-bubble')).toContainText('Work done');
  await expect.poll(() => stopped.includes('run-1')).toBe(true);
  await sidebar.getByRole('button', { name: 'first', exact: true }).click();
  await expect(input).toHaveText('Unsent first draft');
  await expect(page.getByTestId('pi-messages')).toContainText('First completed in the background');
  await expect(page.getByLabel('Queued messages')).toHaveCount(0);
  await page.getByTestId('notifications-button').click();
  await expect(page.getByTestId('notification-item')).toHaveCount(2);
  await expect(page.getByTestId('notification-item').first()).toContainText('Pi finished');
  await expect(page.getByTestId('notification-item').first()).toContainText('first');
  await expect(page.getByTestId('notification-item').last()).toContainText('Pi stopped');
  await expect(page.getByTestId('notification-item').last()).toContainText('second');
  await page.keyboard.press('Escape');
  await page.screenshot({ path: '/tmp/lumo-pi-independent-chats.png', animations: 'disabled' });
});

test('Conversation navigation stays available while another chat is loading', async ({ page }) => {
  await piPage(page);
  await page.route('**/api/v1/pi/sessions?**', (route) => route.fulfill({ json: { ok: true, data: { sessions: [{ id: 'first.jsonl', name: 'Project notes', modified: '' }, { id: 'second.jsonl', name: 'Earlier work', modified: '' }] } } }));
  let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
  let loading = false;
  await page.route('**/api/v1/pi/start', async (route) => {
    if (route.request().postDataJSON().session === 'second.jsonl') { loading = true; await gate; }
    return route.fallback();
  });
  await page.goto('http://localhost:5200'); await page.getByTestId('dock-app-pi').click();
  const input = page.getByTestId('pi-prompt');
  const sidebar = page.getByRole('navigation', { name: 'Pi projects', exact: true });
  await expect(input).toBeEnabled(); await input.fill('Keep this draft');
  await sidebar.getByRole('button', { name: 'Earlier work', exact: true }).click();
  await expect.poll(() => loading).toBe(true);
  const spinner = page.getByTestId('pi-conversation-loading');
  await expect(spinner).toBeVisible();
  await expect(input).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'What should we work on?' })).toHaveCount(0);
  const expectCentered = async () => {
    await expect.poll(() => spinner.evaluate((element) => {
      const panel = element.closest('.pi-main')!.getBoundingClientRect();
      const circle = element.querySelector('.spinner')!.getBoundingClientRect();
      return Math.max(Math.abs(circle.x + circle.width / 2 - panel.x - panel.width / 2), Math.abs(circle.y + circle.height / 2 - panel.y - panel.height / 2));
    })).toBeLessThan(1);
  };
  await expectCentered();
  await expect(sidebar.getByRole('button', { name: 'Earlier work', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(sidebar.getByRole('button', { name: 'Project notes', exact: true })).toBeEnabled();
  await expect(page.getByTestId('pi-new')).toBeEnabled();
  await expect(sidebar).not.toContainText('Loading chats');
  await expect(spinner.locator('.spinner')).toHaveCSS('animation-name', 'app-spin');
  await page.screenshot({ path: '/tmp/lumo-pi-navigation-loading.png', animations: 'disabled' });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await expect(spinner.locator('.spinner')).toHaveCSS('animation-name', 'none');
  await page.setViewportSize({ width: 900, height: 700 });
  await expectCentered();
  await page.screenshot({ path: '/tmp/lumo-pi-loading-dark.png', animations: 'disabled' });
  await sidebar.getByRole('button', { name: 'Project notes', exact: true }).click();
  await expect(spinner).toBeVisible();
  await expect(sidebar.getByRole('button', { name: 'Project notes', exact: true })).toHaveAttribute('aria-current', 'page');
  release();
  await expect(input).toBeEnabled();
  await expect(spinner).toHaveCount(0);
  await expect(input).toHaveText('Keep this draft');
  await expect(page.getByTestId('app-pi')).not.toContainText('Earlier saved conversation.');
});
