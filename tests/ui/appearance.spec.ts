// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '@playwright/test';

for (const theme of ['light', 'dark'] as const) {
  test(`${theme} surfaces and matte buttons keep readable contrast`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto('/');
    await page.getByTestId('login-username').fill('demo');
    await page.getByTestId('login-password').fill('demo');
    await page.getByTestId('login-submit').click();
    await page.getByTestId('dock-app-files').click();
    await expect(page.getByTestId('file-row-notes.txt')).toBeVisible();
    const results = await page.evaluate(() => {
      const color = (value: string) => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = value;
        ctx.fillRect(0, 0, 1, 1);
        return Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3);
      };
      const luminance = (rgb: number[]) => rgb.map((channel) => {
        const c = channel / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      }).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
      const contrast = (a: number[], b: number[]) => {
        const x = luminance(a), y = luminance(b);
        return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
      };
      const tokens = getComputedStyle(document.documentElement);
      const value = (name: string) => color(tokens.getPropertyValue(name).trim());
      const textRatios = ['--surface', '--surface-raised', '--surface-sunken'].flatMap((surface) =>
        ['--text', '--text-muted', '--text-faint'].map((text) => ({ name: `${text} on ${surface}`, ratio: contrast(value(text), value(surface)) })),
      );
      const buttons = ['.files-main .btn', '.files-main .btn-primary'].flatMap((selector) => {
        const style = getComputedStyle(document.querySelector(selector)!);
        return [{ name: selector, ratio: contrast(color(style.color), color(style.backgroundColor)), image: style.backgroundImage }];
      });
      return { textRatios, buttons };
    });
    expect(results.buttons).toHaveLength(2);
    for (const button of results.buttons) expect(button.image).toBe('none');
    for (const result of [...results.textRatios, ...results.buttons]) {
      expect(result.ratio, result.name).toBeGreaterThanOrEqual(4.5);
    }
    const controls = page.getByTestId('window-files').locator('.window-controls');
    const close = page.getByTestId('window-close-files');
    await expect(close).toHaveCSS('border-radius', '50%');
    const windowBounds = (await page.getByTestId('window-files').boundingBox())!;
    const controlsBounds = (await controls.boundingBox())!;
    expect(controlsBounds.x - windowBounds.x).toBeLessThan(24);
    expect(controlsBounds.y - windowBounds.y).toBeLessThan(24);
    await close.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(close).toBeFocused();
    await expect(close.locator('svg')).toHaveCSS('opacity', '1');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('window-files')).toHaveCount(0);
  });
}
