// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test, type Page } from '../offline';

async function openDocument(page: Page) {
  await page.goto('/');
  await page.getByTestId('login-username').fill('demo');
  await page.getByTestId('login-password').fill('demo');
  await page.getByTestId('login-submit').click();
  await page.getByTestId('dock-app-files').click();
  await page.getByTestId('file-row-Documents').dblclick();
  await page.getByTestId('file-row-server-notes.md').dblclick();
  await expect(page.getByTestId('preview-rendered')).toBeVisible();
  await page.getByTestId('window-preview').evaluate((node) => Promise.all(node.getAnimations().map((animation) => animation.finished.catch(() => {}))));
}

for (const width of [1440, 390]) for (const colorScheme of ['light', 'dark'] as const) {
  test(`Preview tools slide over content and hide after a cancellable delay at ${width}px in ${colorScheme}`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme, reducedMotion: 'no-preference' });
    await openDocument(page);
    const tools = page.getByTestId('preview-tools');
    const panel = page.getByTestId('preview-tools-panel');
    const trigger = page.getByTestId('preview-tools-toggle');
    const content = page.getByLabel('File content', { exact: true });
    await expect(panel).toBeHidden(); await expect(panel).toHaveAttribute('inert', '');
    const before = await content.boundingBox();
    const edge = (await trigger.boundingBox())!;
    const app = (await page.getByTestId('app-preview').boundingBox())!;
    expect(edge.width).toBe(20); expect(edge.x).toBeCloseTo(app.x, 0); expect(edge.y).toBeCloseTo(app.y + 12, 0);
    await trigger.hover();
    await expect(panel).toBeVisible(); await expect(panel).not.toHaveAttribute('inert');
    await panel.evaluate((node) => Promise.all(node.getAnimations().map((animation) => animation.finished.catch(() => {}))));
    expect(await content.boundingBox()).toEqual(before);
    const expanded = (await panel.boundingBox())!;
    expect(expanded.x).toBeGreaterThanOrEqual(edge.x + edge.width); expect(expanded.x + expanded.width).toBeLessThanOrEqual(app.x + app.width);
    expect(expanded.y).toBeCloseTo(app.y + 12, 0);
    await page.screenshot({ path: `/tmp/lumo-preview-tools-${width}-${colorScheme}.png` });
    await page.clock.install();
    const leave = () => page.mouse.move(before!.x + before!.width - 12, before!.y + before!.height - 12);
    await leave(); await page.clock.runFor(700); await expect(tools).toHaveAttribute('data-open', 'true');
    await trigger.hover(); await page.clock.runFor(500); await expect(tools).toHaveAttribute('data-open', 'true');
    await leave(); await page.clock.runFor(1100); await expect(tools).toHaveAttribute('data-open', 'false');
    await expect(panel).toHaveAttribute('inert', '');
    expect(await content.boundingBox()).toEqual(before); expect(errors).toEqual([]);
  });
}

test('Keyboard focus holds Preview tools open and Escape hides them without stranding focus', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openDocument(page);
  const trigger = page.getByTestId('preview-tools-toggle');
  const panel = page.getByTestId('preview-tools-panel');
  await trigger.focus(); await trigger.press('Enter');
  await expect(page.getByTestId('preview-mode-rendered')).toBeFocused();
  await page.clock.install(); await page.mouse.move(0, 0); await page.clock.runFor(1500);
  await expect(panel).toBeVisible(); expect(await panel.evaluate((node) => Math.max(...getComputedStyle(node).transitionDuration.split(',').map(parseFloat)))).toBeLessThan(.001);
  await page.keyboard.press('Tab'); await page.keyboard.press('Enter');
  await expect(page.getByTestId('editor-input')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toHaveAttribute('aria-hidden', 'true'); await expect(trigger).toBeFocused();
  await page.keyboard.press('Tab'); await expect(page.getByTestId('editor-input')).toBeFocused();
});

test.describe('Touch access', () => {
  test.use({ hasTouch: true });
  test('Tapping the edge reveals tools and keeps them open while the file picker is active', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openDocument(page);
    await page.getByTestId('preview-tools-toggle').tap();
    await expect(page.getByTestId('preview-tools-panel')).toBeVisible();
    await page.clock.install(); await page.clock.runFor(1500);
    await expect(page.getByTestId('preview-tools-panel')).toBeVisible();
    await page.getByTestId('preview-open').tap();
    await expect(page.getByTestId('file-picker')).toBeVisible();
    await page.clock.runFor(1500);
    await expect(page.getByTestId('preview-tools')).toHaveAttribute('data-open', 'true');
    await page.getByTestId('file-picker').getByRole('button', { name: 'Cancel', exact: true }).tap();
    const content = page.getByLabel('File content', { exact: true }); const box = (await content.boundingBox())!;
    await content.tap({ position: { x: box.width - 12, y: box.height - 12 } });
    await page.clock.runFor(1100);
    await expect(page.getByTestId('preview-tools')).toHaveAttribute('data-open', 'false');
  });
});
