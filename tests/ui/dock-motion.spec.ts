// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test, type Locator } from '../offline';

async function sampleMotion(surface: Locator, expanding: boolean) {
  const sample = await surface.evaluate((element) => {
    const animation = element.getAnimations()[0];
    if (!animation) return null;
    animation.pause();
    animation.currentTime = 120;
    const frames = (animation.effect as KeyframeEffect).getKeyframes();
    const result = { start: parseFloat(String(frames[0].width)), end: parseFloat(String(frames[frames.length - 1].width)), current: element.getBoundingClientRect().width };
    animation.finish();
    return result;
  });
  expect(sample).not.toBeNull();
  expect(sample!.end > sample!.start).toBe(expanding);
  expect(sample!.current).toBeGreaterThan(Math.min(sample!.start, sample!.end));
  expect(sample!.current).toBeLessThan(Math.max(sample!.start, sample!.end));
}

test('Dock expands and contracts smoothly as snapshots arrive and leave', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  await page.getByTestId('login-username').fill('demo');
  await page.getByTestId('login-password').fill('demo');
  await page.getByTestId('login-submit').click();
  await page.getByTestId('dock-app-files').click();
  const surface = page.getByTestId('dock-surface');
  await expect(page.getByTestId('dock-app-websites')).toBeVisible();
  await surface.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished.catch(() => {}))));
  const original = (await surface.boundingBox())!.width;
  await page.getByTestId('window-minimize-files').click();
  await expect(page.getByTestId('dock-minimized-files')).toBeVisible();
  await sampleMotion(surface, true);
  await expect(page.getByTestId('window-files')).toBeHidden();
  await page.screenshot({ path: '/tmp/lumo-dock-expanded.png' });
  await page.getByTestId('dock-minimized-files').click();
  await expect(page.getByTestId('dock-minimized-files')).toHaveCount(0);
  await sampleMotion(surface, false);
  await expect.poll(async () => (await surface.boundingBox())!.width).toBeCloseTo(original, 1);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByTestId('window-minimize-files').click();
  await expect(page.getByTestId('window-files')).toBeHidden();
  expect(await surface.evaluate((element) => element.getAnimations().length)).toBe(0);
  await page.getByTestId('dock-minimized-files').click();
  await expect(page.getByTestId('dock-minimized-files')).toHaveCount(0);
  expect(await surface.evaluate((element) => element.getAnimations().length)).toBe(0);
});

for (const width of [1440, 390]) {
  test(`Dock fits more minimized windows and keeps overflow reachable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: width === 390 ? 'dark' : 'light' });
    await page.goto('/');
    await page.getByTestId('login-username').fill('demo');
    await page.getByTestId('login-password').fill('demo');
    await page.getByTestId('login-submit').click();
    for (const app of ['files', 'terminal', 'library', 'settings', 'home', 'skills']) {
      await page.getByTestId(`dock-app-${app}`).click();
      await page.getByTestId(`window-minimize-${app}`).click();
      await expect(page.getByTestId(`dock-minimized-${app}`)).toBeVisible();
    }
    const tray = (await page.locator('.dock-tray').boundingBox())!;
    expect(tray.x).toBeGreaterThanOrEqual(0);
    expect(tray.x + tray.width).toBeLessThanOrEqual(width);
    const windows = page.getByTestId('dock-windows');
    await expect(windows.getByRole('button')).toHaveCount(6);
    if (width === 1440) expect((await windows.boundingBox())!.width).toBeGreaterThan(286);
    await page.getByTestId('dock-app-trash').focus();
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByTestId('dock-minimized-skills')).toBeFocused();
    await expect(page.getByTestId('dock-minimized-skills')).toBeInViewport();
    await page.screenshot({ path: `/tmp/lumo-dock-capacity-${width}.png`, animations: 'disabled' });
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('window-skills')).toBeVisible();
    await expect(page.getByTestId('dock-minimized-skills')).toHaveCount(0);
  });
}
