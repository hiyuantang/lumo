// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test, type Page } from '@playwright/test';

async function login(page: Page) {
  await page.goto('/');
  await page.getByTestId('login-username').fill('demo');
  await page.getByTestId('login-password').fill('demo');
  await page.getByTestId('login-submit').click();
}

test('terminal tabs have stable names and reorder without replacing their sessions', async ({ page }) => {
  await login(page);
  await page.getByTestId('dock-app-terminal').click();
  const app = page.getByTestId('app-terminal');
  const tabs = app.getByRole('tab');
  const firstId = await tabs.first().getAttribute('data-testid');
  const firstName = await tabs.first().getAttribute('aria-label');
  await page.getByTestId('terminal-input').fill('echo FIRST_SESSION');
  await page.getByTestId('terminal-input').press('Enter');
  await page.getByTestId('terminal-new-tab').click();
  const secondId = await tabs.last().getAttribute('data-testid');
  const secondName = await tabs.last().getAttribute('aria-label');
  expect(firstName).not.toMatch(/shell|opencode|\d/);
  expect(secondName).not.toBe(firstName);
  await page.getByTestId(secondId!).dragTo(page.getByTestId(firstId!));
  await expect(tabs.first()).toHaveAttribute('data-testid', secondId!);
  await expect(page.getByTestId(secondId!)).toHaveAttribute('aria-selected', 'true');
  await page.getByTestId(firstId!).getByRole('button', { name: firstName!, exact: true }).click();
  await expect(app.locator('.terminal-pane:not(.hidden)')).toContainText('FIRST_SESSION');
  await page.getByTestId(firstId!).getByRole('button', { name: firstName!, exact: true }).press('Alt+ArrowLeft');
  await expect(tabs.first()).toHaveAttribute('data-testid', firstId!);
  await expect(tabs.first()).toHaveAttribute('aria-label', firstName!);
  await expect(app.locator('.terminal-tab.active')).toHaveCSS('background-color', await app.evaluate((node) => getComputedStyle(node).backgroundColor));
  await expect(app.locator('.terminal-tabs')).toHaveCSS('border-bottom-width', '0px');
  await expect(app.locator('.terminal-tab.active')).toHaveCSS('border-top-left-radius', '12px');
});

test('pinned folders reorder by drag and keyboard and keep the new order after reload', async ({ page }) => {
  await login(page);
  await page.getByTestId('dock-app-files').click();
  for (const name of ['Documents', 'Pictures']) {
    await page.getByTestId(`file-row-${name}`).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Pin Folder', exact: true }).click();
  }
  const pins = page.locator('[data-testid^="files-pin-"]');
  await expect(pins).toHaveCount(2);
  await pins.last().dragTo(pins.first());
  await expect(pins.first()).toHaveAttribute('aria-label', 'Pictures');
  await pins.first().focus();
  await page.keyboard.press('Alt+ArrowDown');
  await expect(pins.first()).toHaveAttribute('aria-label', 'Documents');
  await expect(pins.last()).toBeFocused();
  await pins.last().dragTo(pins.first());
  await page.reload();
  await page.getByTestId('dock-app-files').click();
  await expect(pins.first()).toHaveAttribute('aria-label', 'Pictures');
  await pins.first().click();
  await expect(page.getByTestId('files-absolute-path')).toContainText('/home/user/Pictures');
});

async function holdDrag(page: Page, from: import('@playwright/test').Locator, to: import('@playwright/test').Locator) {
  const start = (await from.boundingBox())!;
  const end = (await to.boundingBox())!;
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(start.x + start.width / 2 + 8, start.y + start.height / 2, { steps: 3 });
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 8 });
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2);
  return end;
}

test('neighbors slide aside before dropping tabs, Dock icons, and pinned folders; cancellation restores them', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await login(page);
  await expect(page.getByTestId('dock-app-websites')).toBeVisible();
  await expect.poll(() => page.getByTestId('dock-surface').evaluate((node) => node.getAnimations().length)).toBe(0);
  const files = page.getByTestId('dock-app-files');
  const monitor = page.getByTestId('dock-app-home');
  const oldDock = await holdDrag(page, files, monitor);
  await expect.poll(async () => (await monitor.boundingBox())!.x).toBeGreaterThan(oldDock.x + 15);
  expect(await monitor.evaluate((node) => node.getAnimations().some((motion) => Number(motion.effect?.getTiming().duration) > 0))).toBe(true);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect.poll(async () => Math.abs((await monitor.boundingBox())!.x - oldDock.x)).toBeLessThan(1);
  await files.click();
  for (const name of ['Documents', 'Pictures']) {
    await page.getByTestId(`file-row-${name}`).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Pin Folder', exact: true }).click();
  }
  const documents = page.getByTestId('files-pin-user/Documents');
  const pictures = page.getByTestId('files-pin-user/Pictures');
  const oldPin = await holdDrag(page, pictures, documents);
  await expect.poll(async () => (await documents.boundingBox())!.y).toBeGreaterThan(oldPin.y + 10);
  await page.mouse.up();
  await expect(page.locator('[data-testid^="files-pin-"]').first()).toHaveAttribute('aria-label', 'Pictures');
  await page.getByTestId('dock-app-terminal').click();
  const first = page.getByRole('tab').first();
  const firstId = (await first.getAttribute('data-testid'))!;
  await page.getByTestId('terminal-new-tab').click();
  const secondId = (await page.getByRole('tab').last().getAttribute('data-testid'))!;
  const before = await holdDrag(page, page.getByTestId(secondId), page.getByTestId(firstId));
  await expect.poll(async () => (await page.getByTestId(firstId).boundingBox())!.x).toBeGreaterThan(before.x + 15);
  await page.mouse.up();
  await expect(page.getByRole('tab').first()).toHaveAttribute('data-testid', secondId);
  await expect.poll(() => page.getByTestId(firstId).evaluate((node) => node.getAnimations().length)).toBe(0);
  expect((await page.getByRole('tablist', { name: 'Terminal tabs' }).boundingBox())!.height).toBeLessThanOrEqual(30);
});

test('reordering honors reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await login(page);
  await page.getByTestId('dock-app-terminal').click();
  const id = (await page.getByRole('tab').first().getAttribute('data-testid'))!;
  await page.getByTestId('terminal-new-tab').click();
  const last = page.getByRole('tab').last();
  await holdDrag(page, last, page.getByTestId(id));
  const timings = await page.getByTestId(id).evaluate((node) => node.getAnimations().map((motion) => motion.effect?.getTiming().duration));
  expect(timings.length).toBeGreaterThan(0);
  expect(timings.every((duration) => duration === 0)).toBe(true);
  await page.mouse.up();
});
