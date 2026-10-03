// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from '../offline';
import { piPage } from './pi-fixture';
import type { AppNotification } from '../../src/api/notifications';

test('Background inbox persists read and dismissed state with no app window', async ({ page }) => {
  await piPage(page);
  let inbox: AppNotification[] = [];
  await page.route('**/api/v1/notifications', (route) => route.fulfill({ json: { ok: true, data: inbox.filter((item) => !item.dismissed) } }));
  await page.route('**/api/v1/notifications/action', async (route) => {
    const { action, ids } = route.request().postDataJSON();
    inbox = inbox.map((item) => ids.includes(item.id) ? { ...item, read: action === 'read' || item.read, dismissed: action === 'dismiss' || item.dismissed } : item);
    await route.fulfill({ json: { ok: true, data: { ok: true } } });
  });
  await page.goto('http://localhost:5200');
  await expect(page.getByTestId('notifications-badge')).toHaveCount(0);
  inbox.push({ id: 'notice-1', appId: 'plugin:exporter', appName: 'Exporter', requestId: 'export-001', title: 'Export ready', body: '<script>text only</script>', createdAt: Date.now(), read: false, dismissed: false });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByTestId('notification-banner')).toContainText('Export ready');
  await expect(page.getByTestId('notification-banner')).toContainText('Exporter');
  await expect(page.getByTestId('notifications-badge')).toHaveText('1');
  await page.getByTestId('notifications-button').click();
  await expect(page.getByTestId('notification-item')).toContainText('<script>text only</script>');
  await expect.poll(() => inbox[0].read).toBe(true);
  for (const width of [1440, 390]) for (const colorScheme of ['light', 'dark'] as const) {
    await page.setViewportSize({ width, height: 900 }); await page.emulateMedia({ colorScheme });
    await expect(page.getByTestId('notification-item')).toBeVisible();
    expect(await page.getByTestId('notification-center').evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.screenshot({ path: `/tmp/lumo-app-notifications-${width}-${colorScheme}.png`, animations: 'disabled' });
  }
  await page.reload();
  await expect(page.getByTestId('notifications-button')).toBeVisible();
  await expect(page.getByTestId('notification-banner')).toHaveCount(0);
  await page.getByTestId('notifications-button').click();
  await expect(page.getByTestId('notification-item')).toContainText('Export ready');
  await page.getByTestId('notification-item').hover();
  await page.getByTestId('notification-close').click();
  await expect.poll(() => inbox[0].dismissed).toBe(true);
  await page.reload();
  await page.getByTestId('notifications-button').click();
  await expect(page.getByTestId('notification-item')).toHaveCount(0);
});
