// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from '../offline';
import { overviewLayout } from '../../src/shell/overviewLayout';

for (const width of [1440, 390]) {
  test(`Overview shows all windows and restores the chosen session at ${width}px`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: width === 390 ? 'dark' : 'light', reducedMotion: 'reduce' });
    await page.goto('/');
    await page.getByTestId('login-username').fill('demo');
    await page.getByTestId('login-password').fill('demo');
    await page.getByTestId('login-submit').click();
    await page.getByTestId('dock-overview').click();
    await expect(page.getByTestId('window-overview')).toContainText('Your open windows will appear here.');
    await page.keyboard.press('Escape');
    await page.getByTestId('dock-app-terminal').click();
    await page.getByTestId('terminal-input').fill('echo KEEP_OVERVIEW');
    await page.getByTestId('window-minimize-terminal').click();
    await page.getByTestId('dock-app-files').click();
    await page.getByTestId('dock-app-library').click();
    await page.getByTestId('dock-overview').click();
    await expect(page.getByTestId('window-overview').locator('[data-overview-window]')).toHaveCount(3);
    await expect(page.getByTestId('overview-window-terminal')).toHaveAccessibleName('Terminal, minimized');
    for (const thumbnail of await page.getByTestId('window-overview').locator('[data-window-thumbnail]').all()) {
      await expect.poll(async () => (await thumbnail.boundingBox())?.width ?? 0).toBeGreaterThan(40);
    }
    await expect(page.getByTestId('window-overview')).toBeFocused();
    for (const preview of await page.locator('.overview-preview').all()) {
      await expect(preview).toHaveCSS('outline-color', 'rgba(0, 0, 0, 0)');
    }
    await page.getByTestId('overview-window-terminal').hover();
    await expect(page.getByTestId('overview-window-terminal').locator('.overview-preview')).toHaveCSS('outline-color', 'rgb(82, 155, 255)');
    await page.mouse.move(0, 0);
    await expect(page.getByTestId('overview-close-terminal')).toHaveCSS('opacity', '0');
    await expect(page.getByTestId('overview-window-terminal').locator('.overview-preview')).toHaveCSS('outline-color', 'rgba(0, 0, 0, 0)');
    await page.screenshot({ path: `/tmp/lumo-overview-${width}.png` });
    await page.getByTestId('overview-window-terminal').click();
    await expect(page.getByTestId('window-overview')).toHaveCount(0);
    await expect(page.getByTestId('window-terminal')).toBeVisible();
    await expect(page.getByTestId('app-terminal')).toContainText('echo KEEP_OVERVIEW');
    await page.getByTestId('dock-overview').click();
    await expect(page.getByTestId('window-overview')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('[data-overview-select]').first()).toBeFocused();
    await expect(page.locator('.overview-preview').first()).toHaveCSS('outline-color', 'rgb(82, 155, 255)');
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('window-overview')).toHaveCount(0);
    expect(errors).toEqual([]);
    expect(await page.getByTestId('dock').evaluate((node) => node.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('Overview spreads windows without overlap and animates between desktop positions', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  await page.getByTestId('login-username').fill('demo');
  await page.getByTestId('login-password').fill('demo');
  await page.getByTestId('login-submit').click();
  for (const app of ['files', 'terminal', 'library', 'settings', 'home']) await page.getByTestId(`dock-app-${app}`).click();
  await expect(page.getByTestId('window-home')).toHaveCSS('transform', 'none');
  const original = await page.getByTestId('window-home').boundingBox();
  await page.getByTestId('dock-overview').click();
  const preview = page.getByTestId('overview-window-home');
  await preview.evaluate((node) => {
    const animation = node.getAnimations()[0];
    if (!animation) throw new Error('Missing window movement');
    animation.pause();
    animation.currentTime = 0;
  });
  const start = await preview.boundingBox();
  expect(start!.x).toBeCloseTo(original!.x, 0);
  expect(start!.y).toBeCloseTo(original!.y, 0);
  expect(start!.width).toBeCloseTo(original!.width, 0);
  await preview.evaluate((node) => node.getAnimations().forEach((animation) => animation.finish()));
  await expect.poll(() => page.getByTestId('window-overview').evaluate((node) => node.getAnimations({ subtree: true }).filter((animation) => animation.playState === 'running').length)).toBe(0);
  const boxes = await page.locator('[data-overview-window]').evaluateAll((nodes) => nodes.map((node) => {
    const rect = node.getBoundingClientRect();
    return { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
  }));
  const dockTop = (await page.getByTestId('dock').boundingBox())!.y;
  for (let i = 0; i < boxes.length; i++) {
    const box = boxes[i];
    expect(box.x).toBeGreaterThanOrEqual(16);
    expect(box.y).toBeGreaterThanOrEqual(48);
    expect(box.x + box.w).toBeLessThanOrEqual(1424);
    expect(box.y + box.h + 32).toBeLessThanOrEqual(dockTop - 16);
    for (const other of boxes.slice(i + 1)) expect(box.x + box.w <= other.x || other.x + other.w <= box.x || box.y + box.h + 32 <= other.y || other.y + other.h + 32 <= box.y).toBe(true);
  }
  expect(Math.max(...boxes.map((box) => box.w))).toBeGreaterThan(350);
  await expect(page.getByTestId('dock')).toHaveCSS('opacity', '1');
  await expect(page.locator('.menubar')).toHaveCSS('opacity', '1');
  await page.screenshot({ path: '/tmp/lumo-overview-spread-desktop.png' });
  await page.setViewportSize({ width: 800, height: 700 });
  await expect.poll(() => preview.evaluate((node) => node.getAnimations().filter((animation) => animation.playState === 'running').length)).toBe(0);
  for (const window of await page.locator('[data-overview-window]').all()) {
    await expect.poll(async () => {
      const box = await window.boundingBox();
      const thumbnail = await window.locator('[data-window-thumbnail]').boundingBox();
      return Math.abs(box!.height - thumbnail!.height) + Math.abs(box!.width - thumbnail!.width);
    }).toBeLessThan(2);
  }
  await page.screenshot({ path: '/tmp/lumo-overview-spread-800.png' });
  await preview.click();
  await expect(page.getByTestId('window-overview')).toHaveAttribute('data-closing', 'true');
  await expect(page.getByTestId('window-overview')).toHaveCount(0);
  await expect(page.getByTestId('window-home')).toBeVisible();
  await expect(page.getByTestId('window-home')).toHaveClass(/focused/);
  await page.getByTestId('dock-overview').click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('window-overview')).toHaveCount(0);
  await expect(page.getByTestId('window-home')).toBeVisible();
});


test('Overview layout fits varied window proportions and counts', () => {
  for (const width of [358, 704, 1344, 2464]) {
    for (const count of [1, 2, 3, 7, 15, 30]) {
      const area = { x: 16, y: 82, w: width, h: 650 };
      const windows = Array.from({ length: count }, (_, index) => ({ x: 0, y: 0, w: [900, 460, 1200][index % 3], h: [500, 800, 400][index % 3] }));
      const result = overviewLayout(windows, area);
      result.forEach((box, index) => {
        expect(box.w).toBeGreaterThan(0);
        expect(box.w / box.h).toBeCloseTo(windows[index].w / windows[index].h, 5);
        expect(box.w).toBeLessThan(windows[index].w);
        expect(box.x).toBeGreaterThanOrEqual(area.x);
        expect(box.y).toBeGreaterThanOrEqual(area.y);
        expect(box.x + box.w).toBeLessThanOrEqual(area.x + area.w + .01);
        expect(box.y + box.h + 32).toBeLessThanOrEqual(area.y + area.h + .01);
        for (const other of result.slice(index + 1)) expect(box.x + box.w <= other.x || other.x + other.w <= box.x || box.y + box.h + 32 <= other.y || other.y + other.h + 32 <= box.y).toBe(true);
      });
    }
  }
});

test('Overview closes hovered, minimized and last windows without selecting them', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
  await page.goto('/');
  await page.getByTestId('login-username').fill('demo');
  await page.getByTestId('login-password').fill('demo');
  await page.getByTestId('login-submit').click();
  await page.getByTestId('dock-app-files').click();
  await page.getByTestId('dock-app-terminal').click();
  await page.getByTestId('window-minimize-terminal').click();
  await page.getByTestId('dock-overview').click();
  await page.getByTestId('overview-window-terminal').hover();
  await expect(page.getByTestId('overview-close-terminal')).toHaveCSS('opacity', '1');
  await page.screenshot({ animations: 'disabled', path: '/tmp/lumo-overview-close.png' });
  await page.getByTestId('overview-close-terminal').click();
  await expect(page.getByTestId('overview-window-terminal')).toHaveCount(0);
  await expect(page.getByTestId('window-terminal')).toHaveCount(0);
  await expect(page.getByTestId('window-overview')).toBeVisible();
  await expect(page.getByTestId('overview-window-files').getByRole('button', { name: 'Show Files' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('overview-close-files')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('window-files')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Close overview' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('window-overview')).toHaveCount(0);
});

test('closing a dirty Preview from Overview returns to the unsaved changes prompt', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.getByTestId('login-username').fill('demo');
  await page.getByTestId('login-password').fill('demo');
  await page.getByTestId('login-submit').click();
  await page.getByTestId('dock-app-files').click();
  await page.getByTestId('file-row-notes.txt').dblclick();
  await page.getByTestId('editor-input').fill('Keep this draft');
  await page.getByTestId('dock-overview').click();
  await page.getByTestId('overview-window-preview').hover();
  await page.getByTestId('overview-close-preview').click();
  await expect(page.getByTestId('window-overview')).toHaveCount(0);
  await expect(page.getByTestId('preview-unsaved-dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(page.getByTestId('editor-input')).toHaveValue('Keep this draft');
  await page.getByTestId('dock-overview').click();
  await page.getByTestId('overview-window-preview').hover();
  await page.getByTestId('overview-close-preview').click();
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(page.getByTestId('window-preview')).toHaveCount(0);
});
