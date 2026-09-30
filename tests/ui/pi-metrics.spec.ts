// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '../offline';
import { piPage } from './pi-fixture';

test('Conversation metrics share the mode and model controls row and stay specific to each reopened chat', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const fixture = await piPage(page);
  fixture.setMetrics('first.jsonl', { inputTokens: 1000, cachedTokens: 820, outputTokens: 354, responseMs: 10000, timedResponses: 3 });
  fixture.setMetrics('second.jsonl', { inputTokens: 200, cachedTokens: 0, outputTokens: 80, responseMs: 4000, timedResponses: 2 });
  await page.route('**/api/v1/pi/sessions?**', (route) => route.fulfill({ json: { ok: true, data: { sessions: [{ id: 'first.jsonl', name: 'Project notes', modified: '' }, { id: 'second.jsonl', name: 'Earlier work', modified: '' }] } } }));
  await page.goto('http://localhost:5200');
  await page.getByTestId('dock-app-pi').click();
  const metrics = page.getByTestId('pi-session-metrics');
  await expect(metrics).toHaveText('Cache 82%·35.4 tok/s');
  await expect(metrics).toHaveCSS('font-size', '10px');
  const statsBox = await metrics.boundingBox();
  for (const control of [page.getByTestId('pi-permission-mode'), page.locator('.pi-model-trigger'), page.getByTestId('pi-send')]) {
    const box = (await control.boundingBox())!;
    expect(Math.abs(statsBox!.y + statsBox!.height / 2 - box.y - box.height / 2)).toBeLessThan(2);
  }
  expect(await metrics.evaluate((node) => Boolean(node.closest('.pi-composer-box')))).toBe(true);
  const sidebar = page.getByRole('navigation', { name: 'Pi projects', exact: true });
  await sidebar.getByRole('button', { name: 'Earlier work', exact: true }).click();
  await expect(metrics).toHaveText('Cache 0%·20.0 tok/s');
  await sidebar.getByRole('button', { name: 'Project notes', exact: true }).click();
  await expect(metrics).toHaveText('Cache 82%·35.4 tok/s');
  await page.reload();
  await expect(metrics).toHaveText('Cache 82%·35.4 tok/s');
  for (const width of [1280, 600, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      await expect(metrics).toBeVisible();
      expect(await page.getByTestId('app-pi').evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
      await page.getByTestId('app-pi').screenshot({ path: `/tmp/lumo-pi-metrics-${width}-${colorScheme}.png`, animations: 'disabled' });
    }
  }
  expect(errors).toEqual([]);
});

test('Missing historical timing stays unavailable while reported cache data still appears', async ({ page }) => {
  const fixture = await piPage(page);
  await page.goto('http://localhost:5200');
  await page.getByTestId('dock-app-pi').click();
  const metrics = page.getByTestId('pi-session-metrics');
  await expect(metrics).toHaveText('Cache —·— tok/s');
  fixture.setMetrics('first.jsonl', { inputTokens: 100, cachedTokens: 50, outputTokens: 0, responseMs: 0, timedResponses: 0 });
  await page.getByTestId('pi-prompt').fill('Inspect');
  await page.getByTestId('pi-send').click();
  fixture.finish();
  await expect(metrics).toHaveText('Cache 50%·— tok/s');
  await expect(page.getByTestId('pi-permission-mode')).toBeEnabled();
  await page.getByTestId('pi-permission-mode').click();
  await page.getByRole('option', { name: 'Read only', exact: true }).click();
  await expect(page.getByTestId('pi-permission-mode')).toBeEnabled();
  await expect(metrics).toHaveText('Cache 50%·— tok/s');
});
