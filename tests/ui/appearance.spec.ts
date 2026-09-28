// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '../offline';

for (const width of [1440, 390]) {
  test(`terminal tabs follow theme changes without losing output at ${width}px`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/');
    await page.getByTestId('login-username').fill('demo');
    await page.getByTestId('login-password').fill('demo');
    await page.getByTestId('login-submit').click();
    await page.getByTestId('dock-app-terminal').click();
    const terminal = page.getByTestId('app-terminal');
    await page.getByTestId('terminal-input').fill('echo KEEP_THEME_SESSION');
    await page.getByTestId('terminal-input').press('Enter');
    await expect(terminal).toContainText(/echo KEEP_THEME_SESSION\s*KEEP_THEME_SESSION/);
    await page.getByTestId('terminal-new-tab').click();
    await expect(terminal.locator('.xterm')).toHaveCount(2);
    await page.getByTestId('dock-app-settings').click();
    await page.getByTestId('settings-section-appearance').click();
    for (const theme of ['dark', 'light', 'dark'] as const) {
      await page.getByTestId(`settings-theme-${theme}`).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(terminal.locator('.xterm-scrollable-element')).toHaveCount(2);
      for (const viewport of await terminal.locator('.xterm-scrollable-element').all()) {
        await expect(viewport).toHaveCSS('background-color', theme === 'dark' ? 'rgb(16, 16, 16)' : 'rgb(233, 233, 233)');
      }
    }
    await page.getByTestId('window-close-settings').click();
    await terminal.locator('.terminal-tab-label').first().click();
    await expect(terminal.locator('.terminal-pane:not(.hidden)')).toContainText(/echo KEEP_THEME_SESSION\s*KEEP_THEME_SESSION/);
    await page.getByTestId('terminal-new-tab').click();
    await expect(terminal.locator('.terminal-pane:not(.hidden) .xterm-scrollable-element')).toHaveCSS('background-color', 'rgb(16, 16, 16)');
    await page.reload();
    await expect(terminal.locator('.xterm-scrollable-element')).toHaveCSS('background-color', 'rgb(16, 16, 16)');
    await page.getByTestId('dock-app-settings').click();
    await page.getByTestId('settings-section-appearance').click();
    await page.getByTestId('settings-theme-auto').click();
    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await expect(terminal.locator('.xterm-scrollable-element')).toHaveCSS('background-color', theme === 'dark' ? 'rgb(16, 16, 16)' : 'rgb(233, 233, 233)');
    }
    await page.getByTestId('window-close-settings').click();
    await expect(terminal.locator('.xterm-rows span').first()).toHaveCSS('color', 'rgb(245, 245, 245)');
    await page.screenshot({ path: `/tmp/lumo-terminal-dark-${width}.png` });
    expect(errors).toEqual([]);
  });
}

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
