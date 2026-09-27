// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test, type Page } from '@playwright/test';

async function openTerminal(page: Page) {
  await page.getByTestId('dock-app-terminal').click();
  await expect(page.getByTestId('window-terminal')).toHaveCSS('transform', 'none');
  return page.getByTestId('window-terminal');
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  await page.getByTestId('login-username').fill('demo');
  await page.getByTestId('login-password').fill('demo');
  await page.getByTestId('login-submit').click();
});

test('minimize preserves a draft and restores its window, placement and keyboard focus', async ({ page }) => {
  await page.getByTestId('dock-app-home').click();
  const terminal = await openTerminal(page);
  const original = await terminal.boundingBox();
  const input = page.getByTestId('terminal-input');
  await input.fill('echo keep this unfinished command');
  await expect(terminal).toContainText('echo keep this unfinished command');
  await page.getByTestId('window-minimize-terminal').click();
  await expect(terminal).toBeHidden();
  await expect(page.getByTestId('window-home')).toBeFocused();
  await expect(page.getByTestId('dock-minimized-terminal')).toBeVisible();
  await expect(page.getByTestId('dock-minimized-terminal')).toHaveAttribute('title', 'Restore Terminal');
  await expect(terminal).toContainText('echo keep this unfinished command');

  await page.getByTestId('dock-app-terminal').focus();
  await page.keyboard.press('Enter');
  await expect(terminal).toHaveAttribute('data-window-visibility', 'visible');
  await expect(input).toBeFocused();
  await expect(terminal).toContainText('echo keep this unfinished command');
  await page.keyboard.press('Enter');
  await expect(terminal).toContainText(/echo keep this unfinished command\s*keep this unfinished command/);
  expect(await terminal.boundingBox()).toEqual(original);
  await expect(page.getByTestId('dock-minimized-terminal')).toHaveCount(0);

  await page.getByTestId('dock-app-terminal').click();
  await page.getByTestId('dock-app-terminal').click();
  await expect(terminal).toBeVisible();
  await expect(terminal).toHaveAttribute('data-window-visibility', 'visible');
});

test('the window travels to the windows section of the Dock and can restore before minimizing finishes', async ({ page }) => {
  const terminal = await openTerminal(page);
  const original = await terminal.boundingBox();
  await page.getByTestId('window-minimize-terminal').click();
  await terminal.evaluate((element) => {
    const animation = element.getAnimations()[0];
    if (!animation) throw new Error('Expected an active minimize animation');
    animation.pause();
    animation.currentTime = Number(animation.effect!.getTiming().duration) * 0.95;
  });
  const approaching = await terminal.boundingBox();
  const icon = await page.getByTestId('dock-minimized-terminal').locator('.dock-icon').boundingBox();
  expect(approaching!.width).toBeLessThan(100);
  expect(Math.abs(approaching!.x + approaching!.width / 2 - icon!.x - icon!.width / 2)).toBeLessThan(6);
  expect(Math.abs(approaching!.y + approaching!.height / 2 - icon!.y - icon!.height / 2)).toBeLessThan(6);

  await page.getByTestId('dock-app-terminal').click();
  await expect(terminal).toHaveAttribute('data-window-visibility', 'visible');
  expect(await terminal.boundingBox()).toEqual(original);
  await expect(terminal).not.toHaveAttribute('inert');
  await expect.poll(() => terminal.evaluate((element) => element.getAnimations().length)).toBe(0);
  await page.getByTestId('terminal-input').fill('still usable');
});

test('minimizing keeps maximized and tiled geometry, including across reloads', async ({ page }) => {
  const terminal = await openTerminal(page);
  await page.getByTestId('window-maximize-terminal').click();
  await terminal.evaluate((node) => Promise.all(node.getAnimations().map((motion) => motion.finished.catch(() => {}))));
  const maximized = await terminal.boundingBox();
  await page.getByTestId('window-minimize-terminal').click();
  await expect(terminal).toBeHidden();
  await page.getByTestId('dock-app-terminal').click();
  await expect(terminal).toHaveAttribute('data-window-visibility', 'visible');
  await expect(terminal).toHaveAttribute('data-window-placement', 'maximized');
  expect(await terminal.boundingBox()).toEqual(maximized);

  await page.getByRole('menuitem', { name: 'View', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Tile Window Right', exact: true }).click();
  await terminal.evaluate((node) => Promise.all(node.getAnimations().map((motion) => motion.finished.catch(() => {}))));
  const tiled = await terminal.boundingBox();
  await page.getByTestId('window-minimize-terminal').click();
  await expect(terminal).toBeHidden();
  await page.reload();
  await expect(terminal).toBeHidden();
  await expect(page.getByTestId('dock-minimized-terminal')).toBeVisible();
  await page.getByTestId('dock-app-terminal').click();
  await expect(terminal).toHaveAttribute('data-window-visibility', 'visible');
  await expect(terminal).toHaveAttribute('data-window-placement', 'right');
  expect(await terminal.boundingBox()).toEqual(tiled);
});

test('reduced motion and viewport changes settle transitions without blocking the window', async ({ page }) => {
  const terminal = await openTerminal(page);
  await page.getByTestId('window-minimize-terminal').click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(terminal).toHaveAttribute('data-window-visibility', 'minimized');
  await expect(terminal).toBeHidden();
  await page.getByTestId('dock-app-terminal').click();
  await expect(terminal).toHaveAttribute('data-window-visibility', 'visible');
  expect(await terminal.evaluate((element) => element.getAnimations().length)).toBe(0);
  await page.getByTestId('window-minimize-terminal').click();
  await expect(terminal).toBeHidden();
  expect(await terminal.evaluate((element) => element.getAnimations().length)).toBe(0);

  await page.getByTestId('dock-app-terminal').click();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.getByTestId('window-minimize-terminal').click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(terminal).toBeHidden();
  await page.getByTestId('dock-app-terminal').click();
  await expect(terminal).toHaveAttribute('data-window-visibility', 'visible');
  await expect(terminal).not.toHaveAttribute('inert');
  const window = await terminal.boundingBox();
  const dock = await page.getByTestId('dock').boundingBox();
  expect(window!.y + window!.height).toBeCloseTo(dock!.y, 1);
  await page.getByTestId('terminal-input').fill('compact window works');
});

test('Dock snapshots show the current document with its original proportions and app badge', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('html')).toHaveClass(/motion-reduced/);
  await page.getByTestId('dock-app-files').click();
  await page.getByTestId('file-row-notes.txt').dblclick();
  const win = page.getByTestId('window-preview');
  await win.getByTestId('preview-edit').click();
  await win.getByTestId('editor-input').fill('A document full of visible text.\n'.repeat(30));
  const bounds = (await win.boundingBox())!;
  await page.getByTestId('window-minimize-preview').click();
  await expect(win).toBeHidden();
  const tile = page.getByTestId('dock-minimized-preview');
  const snapshot = tile.locator('[data-window-thumbnail]');
  const miniature = (await snapshot.boundingBox())!;
  expect(miniature.width / miniature.height).toBeCloseTo(bounds.width / bounds.height, 1);
  await expect(tile.locator('.dock-window-badge')).toBeVisible();
  await page.mouse.move(0, 0);
  const textImage = await snapshot.screenshot();
  await tile.click();
  await expect(win).toBeVisible();
  await win.getByTestId('editor-input').fill('Short draft.');
  await page.getByTestId('window-minimize-preview').click();
  await expect(win).toBeHidden();
  await page.mouse.move(0, 0);
  expect(await snapshot.screenshot()).not.toEqual(textImage);
  await tile.click();
  await expect(win.getByTestId('editor-input')).toHaveValue('Short draft.');
});
