// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '../offline';
import { piPage } from './pi-fixture';
import { piAction } from './pi-actions';
import type { PiCompactionChange, PiContextBudget } from '../../src/api/pi';

test('Pi shares ratio or token budgets across models, preserves drafts and validates saves', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  const fixture = await piPage(page);
  let settings = { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000, revision: 'original', usageBudget: undefined as PiContextBudget | undefined };
  const changes: PiCompactionChange[] = [];
  let conflict = false;
  await page.route('**/api/v1/pi/compaction**', (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as PiCompactionChange;
      if (conflict) return route.fulfill({ status: 409, json: { ok: false, error: { code: 'conflict', message: 'Pi settings changed on the server. Reload before saving.' } } });
      changes.push(body); settings = { ...settings, ...body, revision: String(changes.length) };
    }
    return route.fulfill({ json: { ok: true, data: { ...settings, model: '', defaultReserveTokens: settings.reserveTokens, defaultKeepRecentTokens: settings.keepRecentTokens, customized: false } } });
  });
  await page.goto('http://localhost:5200'); await page.getByTestId('dock-app-pi').click();
  await page.getByTestId('pi-prompt').fill('Keep my chat draft');
  await page.getByTestId('pi-settings-button').click(); await page.getByRole('tab', { name: 'Context & compaction' }).click();
  const panel = page.getByTestId('pi-compaction-settings'); const catalog = page.getByTestId('pi-context-catalog');
  await expect(page.getByRole('combobox', { name: 'Compaction budgets for' })).toHaveCount(0);
  await expect(catalog).toContainText('200,000 tokens max'); await expect(catalog).toContainText('128,000 tokens max');
  await expect(catalog).toContainText('Compact at 160,000 (80%)'); await expect(catalog).toContainText('Compact at 102,400 (80%)');
  await page.getByRole('searchbox', { name: 'Search model context windows' }).fill('fast');
  await expect(catalog).not.toContainText('200,000 tokens');
  await page.getByRole('searchbox', { name: 'Search model context windows' }).fill('');
  await panel.getByText('Automatic compaction', { exact: true }).click(); await expect(page.getByTestId('pi-auto-compaction')).toBeChecked();
  await page.getByTestId('pi-auto-compaction').press('Space'); await expect(page.getByTestId('pi-auto-compaction')).not.toBeChecked();
  await expect(catalog).toContainText('Auto compaction off'); await expect(page.getByTestId('pi-compaction-usage')).toBeDisabled(); await expect(page.getByTestId('pi-compaction-recent')).toBeDisabled(); await expect(page.getByRole('combobox', { name: 'Context budget unit' })).toBeDisabled(); await expect(panel.locator('.pi-context-fields')).toHaveCSS('opacity', '0.45'); await page.getByTestId('pi-auto-compaction').check();
  const input = page.getByTestId('pi-compaction-usage');
  await input.fill('100'); await expect(page.getByTestId('pi-compaction-save')).toBeDisabled();
  await input.fill('75'); await page.getByTestId('pi-compaction-recent').fill('12000');
  await expect(catalog).toContainText('Compact at 150,000 (75%)');
  await page.getByRole('tab', { name: 'Providers', exact: true }).click(); await page.getByRole('tab', { name: 'Context & compaction' }).click(); await expect(input).toHaveValue('75');
  await page.getByTestId('window-close-pi').click(); await expect(page.getByTestId('server-app-confirm')).toContainText('unsaved settings');
  await page.getByTestId('server-app-confirm').getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByTestId('pi-compaction-save').click(); await expect(panel.getByRole('status')).toContainText('Saved');
  expect(changes[0]).toMatchObject({ model: '', usageBudget: { mode: 'percent', value: 75 }, keepRecentTokens: 12000 });
  await page.getByRole('combobox', { name: 'Context budget unit' }).click(); await page.getByRole('option', { name: 'Tokens', exact: true }).click();
  await input.fill('150000'); await expect(catalog).toContainText('Compact at 150,000 (75%)'); await expect(catalog).toContainText('Compact at 111,616');
  conflict = true; await page.getByTestId('pi-compaction-save').click(); await expect(panel.getByRole('alert')).toContainText('changed on the server'); await expect(input).toHaveValue('150000');
  conflict = false; await page.getByTestId('pi-compaction-save').click(); await expect(panel.getByRole('status')).toContainText('Saved');
  expect(changes[1]).toMatchObject({ model: '', usageBudget: { mode: 'tokens', value: 150000 } });
  expect(fixture.commands.filter((command) => command.type === 'set_model')).toEqual([]);
  for (const theme of ['light', 'dark'] as const) { await page.emulateMedia({ colorScheme: theme }); await panel.evaluate((node) => { node.scrollTop = 0; }); await page.screenshot({ path: `/tmp/lumo-pi-context-${theme}.png`, animations: 'disabled' }); await catalog.scrollIntoViewIfNeeded(); await page.screenshot({ path: `/tmp/lumo-pi-catalog-${theme}.png`, animations: 'disabled' }); }
  await page.setViewportSize({ width: 390, height: 844 }); await input.scrollIntoViewIfNeeded();
  expect(await panel.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/lumo-pi-context-narrow.png', animations: 'disabled' });
  await page.getByTestId('pi-home-button').click(); await expect(page.getByTestId('pi-prompt')).toHaveText('Keep my chat draft');
  await page.reload(); await page.getByTestId('pi-settings-button').click(); await page.getByRole('tab', { name: 'Context & compaction' }).click();
  await expect(input).toHaveValue('150000'); await expect(page.getByRole('combobox', { name: 'Context budget unit' })).toHaveText('Tokens');
  expect(errors).toEqual([]);
});

test('Saving compaction refreshes the circle and preserves the conversation, waiting for active replies', async ({ page }) => {
  const fixture = await piPage(page);
  let settings = { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000, revision: 'initial', usageBudget: { mode: 'tokens', value: 160000 } };
  let revision = 0;
  await page.route('**/api/v1/pi/compaction**', (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      if (body.revision !== settings.revision) return route.fulfill({ status: 409, json: { ok: false, error: { code: 'conflict', message: 'Stale settings revision' } } });
      settings = { ...settings, ...body, revision: String(++revision) };
      fixture.setCompaction({ enabled: settings.enabled, threshold: settings.usageBudget.value });
    }
    return route.fulfill({ json: { ok: true, data: { ...settings, model: '', defaultReserveTokens: 16384, defaultKeepRecentTokens: 20000, customized: false } } });
  });
  await page.route('**/api/v1/pi/start', async (route) => { settings.revision = String(++revision); await route.fallback(); });
  await page.goto('http://localhost:5200'); await page.getByTestId('dock-app-pi').click();
  const prompt = page.getByTestId('pi-prompt');
  await prompt.fill('A saved conversation'); await page.getByTestId('pi-send').click(); fixture.finish();
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0);
  await prompt.fill('Keep this draft');
  await page.getByTestId('pi-settings-button').click(); await page.getByRole('tab', { name: 'Context & compaction' }).click();
  await page.getByTestId('pi-compaction-usage').fill('100000'); await page.getByTestId('pi-compaction-save').click();
  await expect.poll(() => fixture.starts.length).toBe(2);
  await expect(page.getByTestId('pi-compaction-usage')).toBeEnabled();
  expect(fixture.starts[1].session).toBe('first.jsonl');
  await page.getByTestId('pi-home-button').click(); await expect(prompt).toHaveText('Keep this draft');
  await expect(page.getByTestId('pi-messages')).toContainText('A saved conversation');
  await page.getByTestId('pi-context-meter').hover(); await expect(page.getByRole('tooltip')).toContainText('Compact at: 100,000 tokens');
  await expect(page.getByTestId('pi-context-meter')).toHaveAttribute('aria-label', '14% of compaction budget used');
  await prompt.fill('Continue the conversation'); await page.getByTestId('pi-send').click();
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible(); await prompt.fill('Another unsent draft');
  await page.getByTestId('pi-settings-button').click(); await page.getByTestId('pi-compaction-usage').fill('75000');
  await page.getByTestId('pi-compaction-save').click();
  await expect(page.getByTestId('pi-compaction-settings').getByRole('status')).toHaveText('Applying when Pi is idle…');
  expect(fixture.starts).toHaveLength(2); expect(fixture.commands.some((command) => command.type === 'abort')).toBe(false);
  fixture.finish(); await expect.poll(() => fixture.starts.length).toBe(3);
  await expect(page.getByTestId('pi-compaction-usage')).toBeEnabled();
  await page.getByTestId('pi-home-button').click(); await expect(prompt).toHaveText('Another unsent draft');
  await page.getByTestId('pi-context-meter').hover(); await expect(page.getByRole('tooltip')).toContainText('Compact at: 75,000 tokens');
  await page.getByTestId('pi-settings-button').click(); await page.getByTestId('pi-auto-compaction').uncheck();
  for (const theme of ['light','dark'] as const) { await page.emulateMedia({ colorScheme: theme }); await page.screenshot({ path: `/tmp/lumo-compaction-off-${theme}.png` }); }
  await page.getByTestId('pi-compaction-save').click(); await expect.poll(() => fixture.starts.length).toBe(4);
  await expect(page.getByTestId('pi-auto-compaction')).toBeEnabled();
  await expect(page.getByTestId('pi-compaction-usage')).toBeDisabled();
  await page.getByTestId('pi-home-button').click(); await page.getByTestId('pi-context-meter').hover();
  await expect(page.getByRole('tooltip')).toContainText('Automatic compaction off');
});

test('Nothing to compact uses one temporary app capsule while real errors remain visible', async ({ page }) => {
  await piPage(page);
  await page.route('**/api/v1/pi/command', (route) => route.request().postDataJSON().command.type === 'get_messages' ? route.fulfill({ json: { ok: true, data: { success: true, eventCursor: 0, data: { messages: [{ role: 'user', content: 'Hello' }, { role: 'assistant', content: 'Hello there.', stopReason: 'stop' }] } } } }) : route.fallback());
  let message = 'Nothing to compact (session too small)';
  await page.route('**/api/v1/pi/command', (route) => route.request().postDataJSON().command.type === 'compact' ? route.fulfill({ json: { ok: true, data: { success: false, error: message } } }) : route.fallback());
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('http://localhost:5200'); await page.getByTestId('dock-app-pi').click();
  await expect(page.getByTestId('pi-prompt')).toBeEnabled();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const prompt = page.getByTestId('pi-prompt');
  await prompt.fill('Keep my draft');
  const before = await prompt.boundingBox();
  await piAction(page, 'compact');
  const notice = page.getByTestId('pi-notification');
  await expect(notice).toHaveText('Nothing to compact yet');
  await expect(notice).toHaveAttribute('role', 'status');
  await expect(notice).toHaveCSS('pointer-events', 'none');
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(await prompt.boundingBox()).toEqual(before);
  await expect(prompt).toHaveText('Keep my draft');
  await piAction(page, 'compact'); await expect(notice).toHaveCount(1);
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await page.screenshot({ path: `/tmp/lumo-pi-capsule-${colorScheme}.png`, animations: 'disabled' });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '/tmp/lumo-pi-capsule-narrow.png', animations: 'disabled' });
  const appBox = (await page.getByTestId('app-pi').boundingBox())!; const noticeBox = (await notice.boundingBox())!;
  expect(noticeBox.x).toBeGreaterThanOrEqual(appBox.x); expect(noticeBox.x + noticeBox.width).toBeLessThanOrEqual(appBox.x + appBox.width);
  await expect(notice).toHaveCount(0, { timeout: 5000 });
  message = 'Compaction provider unavailable';
  await piAction(page, 'compact');
  await expect(page.getByRole('alert')).toHaveText(message);
  await expect(notice).toHaveCount(0);
  expect(errors).toEqual([]);
});
