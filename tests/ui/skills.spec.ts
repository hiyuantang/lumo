// SPDX-License-Identifier: AGPL-3.0-only
import { clickPreviewTool } from '../preview-tools';
import { expect, test } from '../offline';

test('Skills presents compact descriptions and rendered instructions with a single Edit action', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('login-username').fill('demo');
  await page.getByTestId('login-password').fill('demo');
  await page.getByTestId('login-submit').click();
  await page.getByTestId('dock-app-skills').click();
  const app = page.getByTestId('app-skills');
  await app.getByRole('button', { name: /server-health/ }).click();
  await expect(app.getByRole('heading', { name: 'What to check' })).toBeVisible();
  await expect(app.getByRole('heading', { name: 'Server health', exact: true })).toHaveCount(1);
  await expect(app.getByRole('heading', { name: 'Instructions', exact: true })).toHaveCount(0);
  await expect(app.locator('.skills-hero').getByTestId('skill-edit')).toBeVisible();
  await expect(app.getByTestId('skill-document')).toContainText('Review the current state of the server');
  await expect(app.getByRole('button', { name: 'Raw', exact: true })).toHaveCount(0);
  await expect(app.getByRole('button', { name: 'Rendered', exact: true })).toHaveCount(0);
  await expect(app.getByTestId('skill-edit')).toBeVisible();
  await expect(app.locator('.skills-file-path')).toHaveCount(0);
  await page.getByTestId('skill-server-health').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Reveal in Files', exact: true }).click();
  await expect(page.getByTestId('app-files')).toContainText('server-health');
  await page.getByTestId('dock-app-skills').click();
  await app.getByRole('searchbox', { name: 'Search skills' }).fill('release');
  await expect(app.getByRole('navigation', { name: 'Installed skills' }).getByRole('button')).toHaveCount(1);
  await expect(app.getByRole('heading', { name: 'Writing guide' })).toBeVisible();
  await app.getByRole('searchbox', { name: 'Search skills' }).fill('no-match');
  await expect(app.getByRole('heading', { name: 'No matching skills' })).toBeVisible();
  await app.getByRole('button', { name: 'Clear search' }).click();
  await page.setViewportSize({ width: 390, height: 780 });
  await expect(app.getByRole('button', { name: 'Refresh skills' })).toBeVisible();
  expect(await app.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await expect(app.getByTestId('skill-edit')).toBeVisible();
});

test('App Library keeps refresh in the View menu', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('login-username').fill('demo');
  await page.getByTestId('login-password').fill('demo');
  await page.getByTestId('login-submit').click();
  await page.getByTestId('dock-app-library').click();
  const sidebar = page.getByRole('complementary', { name: 'App Library sections' });
  const refresh = sidebar.getByRole('button', { name: 'Refresh', exact: true });
  await expect(refresh).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'View', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Refresh', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 780 });
  await expect(refresh).toHaveCount(0);
  await expect(page.getByTestId('library-pi')).toBeVisible();
});


test('Skills edits open in Preview and saved changes refresh the skill', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('login-username').fill('demo');
  await page.getByTestId('login-password').fill('demo');
  await page.getByTestId('login-submit').click();
  await page.getByTestId('dock-app-skills').click();
  await page.getByTestId('skill-server-health').click();
  await page.getByTestId('skill-edit').click();
  const editor = page.getByTestId('editor-input');
  await expect(editor).toHaveValue(/name: server-health/);
  await expect(page.getByTestId('preview-mode-raw')).toHaveAttribute('aria-pressed', 'true');
  const original = await editor.inputValue();
  const description = 'Review the server and report its health, storage, failed services, backups, networking, and recent events. '.repeat(4).trim();
  const updated = original.replace(/^description:.*$/m, `description: ${description}`).replace('# Server health', '# Updated server health');
  await editor.fill(updated);
  await page.getByTestId('window-close-preview').click();
  await expect(page.getByTestId('preview-unsaved-dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(editor).toHaveValue(updated);
  await clickPreviewTool(page, 'editor-save');
  await expect(page.getByTestId('preview-save-status')).toHaveText('Saved');
  await page.getByTestId('dock-app-skills').click();
  await expect(page.getByTestId('app-skills').getByRole('heading', { name: 'Updated server health', exact: true })).toBeVisible();
  const card = page.getByTestId('skill-server-health');
  const layout = await card.evaluate((el) => {
    const description = el.querySelector('span')!;
    return { card: el.getBoundingClientRect().height, height: description.getBoundingClientRect().height, fullHeight: description.scrollHeight, clamp: getComputedStyle(description).webkitLineClamp };
  });
  expect(layout.card).toBeLessThanOrEqual(114);
  expect(layout.height).toBeLessThanOrEqual(36);
  expect(layout.fullHeight).toBeGreaterThan(layout.height);
  expect(layout.clamp).toBe('2');
  await page.getByTestId('skill-edit').click();
  await expect(editor).toHaveValue(updated);
  await expect(page.locator('.window[data-app-id="preview"]')).toHaveCount(1);
});
