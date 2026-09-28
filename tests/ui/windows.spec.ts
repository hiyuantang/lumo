// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test, type Page } from '../offline';

async function rect(page: Page, app: string) {
  await expect(page.getByTestId(`window-${app}`)).toHaveCSS('transform', 'none');
  await page.getByTestId(`window-${app}`).evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished.catch(() => {}))));
  const bounds = await page.getByTestId(`window-${app}`).boundingBox();
  expect(bounds).not.toBeNull();
  return bounds!;
}

async function startDrag(page: Page, app: string, x: number, y: number) {
  await rect(page, app);
  const title = await page.getByTestId(`window-titlebar-${app}`).boundingBox();
  expect(title).not.toBeNull();
  await page.mouse.move(title!.x + title!.width * 0.6, title!.y + title!.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 12 });
}

async function resize(page: Page, direction: string, x: number, y: number) {
  const handle = await page.getByTestId(`window-resize-files-${direction}`).boundingBox();
  expect(handle).not.toBeNull();
  await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 10 });
  await page.mouse.up();
}

async function expectDockClear(page: Page, app: string) {
  await expect.poll(async () => {
    const window = await rect(page, app);
    const dock = await page.getByTestId('dock').boundingBox();
    expect(dock).not.toBeNull();
    return dock!.y - window.y - window.height;
  }).toBeGreaterThanOrEqual(-0.02);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByTestId('login-username').fill('demo');
  await page.getByTestId('login-password').fill('demo');
  await page.getByTestId('login-submit').click();
  await page.getByTestId('dock-app-files').click();
  await page.getByTestId('window-titlebar-files').click();
});

test('slim title bars animate both maximizing and restoring', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const window = page.getByTestId('window-files');
  const original = await rect(page, 'files');
  expect((await page.getByTestId('window-titlebar-files').boundingBox())!.height).toBe(28);
  for (const placement of ['maximized', 'floating']) {
    await page.getByTestId('window-maximize-files').click();
    const motion = await window.evaluate((element) => {
      const animation = element.getAnimations().find((item) => (item.effect as KeyframeEffect).getKeyframes().some((frame) => frame.width));
      if (!animation) return null;
      animation.pause();
      animation.currentTime = 100;
      const frames = (animation.effect as KeyframeEffect).getKeyframes();
      const width = element.getBoundingClientRect().width;
      animation.finish();
      return { width, start: parseFloat(String(frames[0].width)), end: parseFloat(String(frames[frames.length - 1].width)) };
    });
    expect(motion).not.toBeNull();
    expect(motion!.width).toBeGreaterThan(Math.min(motion!.start, motion!.end));
    expect(motion!.width).toBeLessThan(Math.max(motion!.start, motion!.end));
    await expect(window).toHaveAttribute('data-window-placement', placement);
    await rect(page, 'files');
  }
  expect(await rect(page, 'files')).toEqual(original);
  await page.screenshot({ animations: 'disabled', path: '/tmp/lumo-titlebar-light.png' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ animations: 'disabled', path: '/tmp/lumo-titlebar-dark.png' });
});

test('controls have the expected order; maximizing clears the dock and dragging restores the saved size', async ({ page }) => {
  const window = page.getByTestId('window-files');
  const original = await rect(page, 'files');
  const close = await page.getByTestId('window-close-files').boundingBox();
  const minimize = await page.getByTestId('window-minimize-files').boundingBox();
  const maximize = await page.getByTestId('window-maximize-files').boundingBox();
  expect(close!.x).toBeLessThan(minimize!.x);
  expect(minimize!.x).toBeLessThan(maximize!.x);

  await page.getByTestId('window-maximize-files').click();
  await expect(window).toHaveAttribute('data-window-placement', 'maximized');
  await expectDockClear(page, 'files');
  const maximizedBounds = await rect(page, 'files');
  const dockBounds = await page.getByTestId('dock').boundingBox();
  expect(maximizedBounds.y + maximizedBounds.height).toBeCloseTo(dockBounds!.y, 1);
  await page.getByTestId('window-titlebar-files').click();
  await expect(window).toHaveAttribute('data-window-placement', 'maximized');

  await startDrag(page, 'files', 900, 110);
  await page.mouse.up();
  await expect(window).toHaveAttribute('data-window-placement', 'floating');
  const restored = await rect(page, 'files');
  expect(restored.width).toBe(original.width);
  expect(restored.height).toBe(original.height);
  expect(restored.y).toBeGreaterThan(original.y);
  expect(restored.x).toBeGreaterThan(original.x);
  await expectDockClear(page, 'files');

  await page.getByTestId('window-titlebar-files').dblclick();
  await expect(window).toHaveAttribute('data-window-placement', 'maximized');
  await page.getByTestId('window-titlebar-files').dblclick();
  await expect(window).toHaveAttribute('data-window-placement', 'floating');
  expect(await rect(page, 'files')).toEqual(restored);
});

test('edge previews match two tiled windows and the layout survives a reload', async ({ page }) => {
  await startDrag(page, 'files', 8, 210);
  const preview = page.getByTestId('window-snap-preview');
  await expect(preview).toHaveAttribute('data-snap-target', 'left');
  const target = await preview.boundingBox();
  await page.mouse.up();
  await expect(preview).toBeHidden();
  await expect(page.getByTestId('window-files')).toHaveAttribute('data-window-placement', 'left');
  const left = await rect(page, 'files');
  expect(left).toEqual(target);
  await expectDockClear(page, 'files');

  await page.getByTestId('dock-app-terminal').click();
  await page.getByTestId('window-titlebar-terminal').click();
  await startDrag(page, 'terminal', 1432, 210);
  await expect(preview).toHaveAttribute('data-snap-target', 'right');
  await page.mouse.up();
  await expect(page.getByTestId('window-terminal')).toHaveAttribute('data-window-placement', 'right');
  const right = await rect(page, 'terminal');
  expect(right.x - (left.x + left.width)).toBe(8);
  expect(right.width).toBe(left.width);
  await expectDockClear(page, 'terminal');

  await page.reload();
  await expect(page.getByTestId('window-files')).toHaveAttribute('data-window-placement', 'left');
  await expect(page.getByTestId('window-terminal')).toHaveAttribute('data-window-placement', 'right');
  await page.getByTestId('window-titlebar-terminal').click();
  expect(await rect(page, 'terminal')).toEqual(right);
});

test('top snapping preserves the floating size and Escape cancels an in-progress move', async ({ page }) => {
  const original = await rect(page, 'files');
  await startDrag(page, 'files', 8, 210);
  await page.mouse.up();
  await expect(page.getByTestId('window-files')).toHaveAttribute('data-window-placement', 'left');
  await startDrag(page, 'files', 720, 38);
  await expect(page.getByTestId('window-snap-preview')).toHaveAttribute('data-snap-target', 'maximize');
  await page.mouse.up();
  await expect(page.getByTestId('window-files')).toHaveAttribute('data-window-placement', 'maximized');
  const maximized = await rect(page, 'files');

  await startDrag(page, 'files', 1432, 190);
  await expect(page.getByTestId('window-snap-preview')).toHaveAttribute('data-snap-target', 'right');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.getByTestId('window-snap-preview')).toBeHidden();
  await expect(page.getByTestId('window-files')).toHaveAttribute('data-window-placement', 'maximized');
  expect(await rect(page, 'files')).toEqual(maximized);

  await startDrag(page, 'files', 900, 110);
  await page.mouse.up();
  await expect(page.getByTestId('window-files')).toHaveAttribute('data-window-placement', 'floating');
  const floating = await rect(page, 'files');
  expect(floating.width).toBe(original.width);
  expect(floating.height).toBe(original.height);
  await expectDockClear(page, 'files');
});

test('resizing respects the work area and keeps the opposite edge anchored at the minimum size', async ({ page }) => {
  await resize(page, 'se', 1438, 895);
  const large = await rect(page, 'files');
  expect(large.x + large.width).toBeLessThanOrEqual(1440);
  await expectDockClear(page, 'files');
  await resize(page, 'w', 1400, large.y + large.height / 2);
  const narrow = await rect(page, 'files');
  expect(narrow.width).toBe(440);
  expect(narrow.x + narrow.width).toBe(large.x + large.width);

  await resize(page, 'n', narrow.x + narrow.width / 2, 750);
  const short = await rect(page, 'files');
  expect(short.height).toBe(340);
  expect(short.y + short.height).toBe(narrow.y + narrow.height);
  await expectDockClear(page, 'files');
});

test('the Window menu supports tiling and restore, while compact windows keep the dock clear', async ({ page }) => {
  const original = await rect(page, 'files');
  await page.getByRole('menuitem', { name: 'Window', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Tile Window Right', exact: true }).click();
  await expect(page.getByTestId('window-files')).toHaveAttribute('data-window-placement', 'right');
  await page.getByRole('menuitem', { name: 'Window', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Restore Window', exact: true }).click();
  expect(await rect(page, 'files')).toEqual(original);

  await page.getByTestId('window-maximize-files').click();
  await page.setViewportSize({ width: 860, height: 700 });
  await expectDockClear(page, 'files');
  await page.getByTestId('window-maximize-files').click();
  const restored = await rect(page, 'files');
  expect(restored.x + restored.width).toBeLessThanOrEqual(860);
  await expectDockClear(page, 'files');
  await page.getByRole('menuitem', { name: 'Window', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Tile Window Left', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menuitem', { name: 'Window', exact: true })).toHaveAttribute('aria-expanded', 'false');

  await page.getByTestId('window-maximize-files').click();
  await page.setViewportSize({ width: 800, height: 700 });
  await expect.poll(async () => {
    const mediumBounds = await rect(page, 'files');
    const mediumDock = await page.getByTestId('dock').boundingBox();
    return mediumBounds.y + mediumBounds.height - mediumDock!.y;
  }).toBeCloseTo(0, 1);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId('window-maximize-files')).toBeDisabled();
  await expectDockClear(page, 'files');
  const compactBounds = await rect(page, 'files');
  const compactDock = await page.getByTestId('dock').boundingBox();
  expect(compactBounds.y + compactBounds.height).toBeCloseTo(compactDock!.y, 1);
  await page.getByTestId('window-minimize-files').click();
  await expect(page.getByTestId('window-files')).toBeHidden();
  await page.getByTestId('dock-app-files').click();
  await expect(page.getByTestId('window-files')).toBeVisible();
  await expectDockClear(page, 'files');
});

test('collapsed saved windows recover usable sizes when reopened', async ({ page }) => {
  await page.getByTestId('dock-app-websites').click();
  await expect(page.getByTestId('window-websites')).toBeVisible();
  await page.evaluate(() => {
    const key = 'lumo.windows.v1:demo';
    const saved = JSON.parse(localStorage.getItem(key)!);
    for (const id of ['files', 'websites']) saved.windows[id] = { ...saved.windows[id], x: 0, y: 32, w: 1, h: 0 };
    localStorage.setItem(key, JSON.stringify(saved));
  });
  await page.reload();
  for (const app of ['websites', 'files']) {
    await page.getByTestId(`dock-app-${app}`).click();
    const recovered = await rect(page, app);
    expect(recovered.width).toBeGreaterThanOrEqual(900);
    expect(recovered.height).toBeGreaterThanOrEqual(600);
    await expectDockClear(page, app);
  }
  await expect(page.getByTestId('file-row-notes.txt')).toBeVisible();
  await page.getByTestId('window-close-files').click();
  await page.getByTestId('dock-app-files').click();
  expect((await rect(page, 'files')).width).toBeGreaterThanOrEqual(900);
  await expect(page.getByTestId('file-row-notes.txt')).toBeVisible();
});

test('temporary empty viewports do not overwrite usable window sizes', async ({ page }) => {
  const original = await rect(page, 'files');
  await page.setViewportSize({ width: 1, height: 1 });
  await page.waitForFunction(() => window.innerWidth === 1 && window.innerHeight === 1);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByTestId('dock-app-files').click();
  expect(await rect(page, 'files')).toEqual(original);
  await page.reload();
  expect(await rect(page, 'files')).toEqual(original);
});

test('windows regain their minimum size after a very small viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 240 });
  await expect.poll(async () => (await page.getByTestId('window-files').boundingBox())!.width).toBeLessThanOrEqual(320);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByTestId('dock-app-files').click();
  const recovered = await rect(page, 'files');
  expect(recovered.width).toBeGreaterThanOrEqual(440);
  expect(recovered.height).toBeGreaterThanOrEqual(340);
  await expect(page.getByTestId('file-row-notes.txt')).toBeVisible();
  await expectDockClear(page, 'files');
});

test('floating windows can leave the desktop on three sides and keep a draggable title bar', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const original = await rect(page, 'files');
  await startDrag(page, 'files', 90, 160);
  await page.mouse.up();
  const left = await rect(page, 'files');
  expect(left.x).toBeLessThan(0);
  expect(left.x + left.width).toBeGreaterThan(100);
  expect(left.width).toBe(original.width);
  await page.reload();
  expect((await rect(page, 'files')).x).toBe(left.x);
  await page.mouse.move(180, left.y + 18);
  await page.mouse.down();
  await page.mouse.move(1300, 200, { steps: 12 });
  await page.mouse.up();
  const right = await rect(page, 'files');
  expect(right.x + right.width).toBeGreaterThan(1440);
  expect(right.x + 120).toBeLessThan(1440);
  await page.mouse.move(right.x + 150, right.y + 18);
  await page.mouse.down();
  await page.mouse.move(800, 880, { steps: 12 });
  await page.mouse.up();
  const down = await rect(page, 'files');
  expect(down.y + down.height).toBeGreaterThan(900);
  const dock = (await page.getByTestId('dock').boundingBox())!;
  expect(down.y + 20).toBeLessThan(dock.y);
  await page.screenshot({ animations: 'disabled', path: '/tmp/lumo-window-below-desktop.png' });
  await page.getByTestId('dock-overview').click();
  await expect(page.getByTestId('overview-window-files')).toBeInViewport();
  await page.getByTestId('overview-window-files').click();
  expect(await rect(page, 'files')).toEqual(down);
  await page.mouse.move(800, down.y + 18);
  await page.mouse.down();
  await page.mouse.move(600, 230, { steps: 12 });
  await page.mouse.up();
  const recovered = await rect(page, 'files');
  expect(recovered.y).toBeLessThan(300);
  await page.mouse.move(600, recovered.y + 30);
  await page.mouse.down();
  await page.mouse.move(600, 54, { steps: 12 });
  await page.mouse.up();
  expect((await rect(page, 'files')).y).toBe(32);
  await expect(page.getByTestId('window-files')).toHaveAttribute('data-window-placement', 'floating');
});
