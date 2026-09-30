// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test, type Locator } from '../offline';
import { piPage } from './pi-fixture';

async function checkControls(scope: Locator) {
  await scope.evaluate((node) => Promise.all([...(node.closest('.window')?.getAnimations() ?? []), ...node.getAnimations()].map((animation) => animation.finished.catch(() => {}))));
  const controls = await scope.locator('.btn, .custom-select, .app-search, .pi-model-trigger').evaluateAll((nodes) => nodes.flatMap((node) => {
    const box = node.getBoundingClientRect();
    if (!box.width || !box.height) return [];
    const style = getComputedStyle(node);
    const field = node.matches('.custom-select, .app-search');
    return [{ label: node.getAttribute('aria-label') || node.textContent?.trim(), height: box.height, width: box.width, expected: parseFloat(style.getPropertyValue(field ? '--field-height' : '--button-height')), icon: node.classList.contains('btn-icon') }];
  }));
  expect(controls.length).toBeGreaterThan(0);
  for (const control of controls) {
    expect(control.height, control.label).toBeCloseTo(control.expected, 1);
    if (control.icon) expect(control.width, control.label).toBeCloseTo(control.height, 1);
  }
}

for (const width of [1440, 390]) for (const colorScheme of ['light', 'dark'] as const) {
  test(`Shared controls stay aligned at ${width}px in ${colorScheme} mode`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await page.goto('/');
    await page.getByTestId('login-username').fill('demo');
    await page.getByTestId('login-password').fill('demo');
    await page.getByTestId('login-submit').click();
    for (const [id, name] of [['files', 'Files'], ['websites', 'Nginx'], ['containers', 'Docker'], ['skills', 'Skills'], ['library', 'App Library'], ['settings', 'Settings'], ['git', 'Git']] as const) {
      await page.getByTestId(`dock-app-${id}`).click();
      const app = page.getByTestId(`app-${id}`);
      await expect(app).toBeVisible();
      if (id === 'git') { await page.getByTestId('git-demo').click(); await expect(page.getByTestId('git-branch')).toBeVisible(); }
      if (id === 'settings') await page.getByTestId('settings-section-system').click();
      if (id === 'library') await page.getByTestId('library-docker').click();
      await checkControls(app);
      if (id === 'settings') for (const section of ['time', 'folders', 'network', 'updates']) {
        await page.getByTestId(`settings-section-${section}`).click();
        await checkControls(app);
      }
      if (id === 'files') {
        await page.getByTestId('file-row-notes.txt').dblclick();
        await expect(page.getByTestId('editor-input')).toBeVisible();
        await checkControls(page.getByTestId('app-preview'));
        await page.getByTestId('preview-open').click();
        const picker = page.getByTestId('file-picker');
        await expect(picker).toBeVisible();
        await checkControls(picker);
        await picker.getByRole('button', { name: 'Cancel', exact: true }).click();
        await page.getByRole('button', { name: 'Close Preview', exact: true }).click();
        await page.getByTestId('file-row-Documents').dblclick();
        await page.getByTestId('file-row-server-notes.md').dblclick();
        await expect(page.getByTestId('preview-rendered')).toBeVisible();
        await checkControls(page.getByTestId('app-preview'));
        expect((await page.locator('.preview-modes').boundingBox())!.height).toBe(32);
        await page.screenshot({ path: `/tmp/lumo-button-consistency-${width}-${colorScheme}.png`, animations: 'disabled' });
        await page.getByRole('button', { name: 'Close Preview', exact: true }).click();
      }
      await page.getByRole('button', { name: `Close ${name}`, exact: true }).click();
    }
    expect(errors).toEqual([]);
  });
}

test('Pi shares control heights in the composer and settings at both sizes', async ({ page }) => {
  await piPage(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('http://localhost:5200');
  await page.getByTestId('dock-app-pi').click();
  await expect(page.getByTestId('pi-prompt')).toBeEnabled();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await checkControls(page.locator('.pi-compose-controls'));
    const typography = await page.locator('.pi-permission-mode > span:first-child, .pi-model-name').evaluateAll((nodes) => nodes.map((node) => {
      const style = getComputedStyle(node);
      return { family: style.fontFamily, size: style.fontSize, weight: style.fontWeight, lineHeight: style.lineHeight };
    }));
    expect(typography).toHaveLength(2);
    expect(typography[0]).toEqual(typography[1]);
    await page.getByTestId('pi-settings-button').click();
    for (const name of ['Providers', 'Instructions', 'Prompt templates']) {
      await page.getByRole('tab', { name, exact: true }).click();
      await checkControls(page.getByTestId('pi-settings'));
    }
    await page.getByTestId('pi-home-button').click();
  }
});
