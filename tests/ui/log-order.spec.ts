// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '@playwright/test';

test('Logs puts newest entries first and keeps older entries steady while streaming', async ({ page }) => {
  const now = Date.now();
  const entry = (index: number) => ({ cursor: `entry-${index}`, ts: new Date(now + index * 1000).toISOString(), priority: 'info', unit: 'example.service', message: `Event ${index}`, fields: {} });
  let emit: ((index: number) => void) | undefined;
  await page.routeWebSocket(/\/api\/v1\/ws/, (socket) => socket.onMessage((raw) => {
    const frame = JSON.parse(String(raw));
    if (frame.type !== 'subscribe') return;
    socket.send(JSON.stringify({ type: 'subscribed', channel: frame.channel }));
    if (frame.capability === 'journal.stream') {
      let seq = 0;
      emit = (index) => socket.send(JSON.stringify({ type: 'event', channel: frame.channel, seq: ++seq, data: entry(index) }));
    }
  }));
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    const data = path.endsWith('/auth/session') ? { user: { name: 'demo', uid: 1000, gid: 1000, home: '/home/user' } }
      : path.endsWith('/journal') ? { entries: Array.from({ length: 80 }, (_, index) => entry(index)), nextCursor: 'entry-79' }
      : path.endsWith('/apps') ? { apps: [] } : {};
    return route.fulfill({ json: { ok: true, data } });
  });
  await page.goto('http://localhost:5200');
  await page.getByTestId('dock-app-home').click();
  await page.getByTestId('monitor-section-logs').click();
  const rows = page.getByTestId('logs-row');
  const list = page.getByTestId('logs-list');
  await expect(rows).toHaveCount(80);
  await expect(rows.first()).toContainText('Event 79');
  await expect(rows.last()).toContainText('Event 0');
  await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBe(0);
  await expect.poll(() => !!emit).toBe(true);
  emit!(80);
  await expect(rows.first()).toContainText('Event 80');
  await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBe(0);
  await list.evaluate((el) => { el.scrollTop = 400; el.dispatchEvent(new Event('scroll')); });
  const anchor = rows.filter({ hasText: 'Event 60' });
  const before = (await anchor.boundingBox())!.y;
  emit!(81);
  await expect(rows.first()).toContainText('Event 81');
  await expect.poll(async () => (await anchor.boundingBox())!.y).toBeCloseTo(before, 0);
  emit!(40.5);
  await expect(rows).toHaveCount(83);
  const messages = await rows.locator('.logs-message').allTextContents();
  expect(messages.indexOf('Event 40.5')).toBe(messages.indexOf('Event 41') + 1);
  await page.screenshot({ path: '/tmp/lumo-logs-order-test.png' });
});
