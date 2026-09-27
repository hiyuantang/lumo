// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '@playwright/test';

test('Skills presents searchable descriptions and rendered or raw instructions', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('login-username').fill('demo');
  await page.getByTestId('login-password').fill('demo');
  await page.getByTestId('login-submit').click();
  await page.getByTestId('dock-app-skills').click();
  const app = page.getByTestId('app-skills');
  await app.getByRole('button', { name: /server-health/ }).click();
  await expect(app.getByRole('heading', { name: 'What to check' })).toBeVisible();
  await app.getByRole('button', { name: 'Raw', exact: true }).click();
  await expect(app.getByTestId('skill-document')).toContainText('name: server-health');
  await app.getByRole('button', { name: 'Read', exact: true }).click();
  await app.getByRole('searchbox', { name: 'Search skills' }).fill('release');
  await expect(app.getByRole('navigation', { name: 'Installed skills' }).getByRole('button')).toHaveCount(1);
  await expect(app.getByRole('heading', { name: 'Writing guide' })).toBeVisible();
  await app.getByRole('searchbox', { name: 'Search skills' }).fill('no-match');
  await expect(app.getByRole('heading', { name: 'No matching skills' })).toBeVisible();
  await app.getByRole('button', { name: 'Clear search' }).click();
  await page.setViewportSize({ width: 390, height: 780 });
  await expect(app.getByRole('button', { name: 'Refresh skills' })).toBeVisible();
  expect(await app.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await expect(app.getByRole('group', { name: 'Skill view' })).toBeVisible();
});

test('App Library refresh is compact and belongs to the sidebar', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('login-username').fill('demo');
  await page.getByTestId('login-password').fill('demo');
  await page.getByTestId('login-submit').click();
  await page.getByTestId('dock-app-library').click();
  const sidebar = page.getByRole('complementary', { name: 'Available apps' });
  const refresh = sidebar.getByRole('button', { name: 'Refresh', exact: true });
  await expect(refresh).toBeVisible();
  expect((await refresh.boundingBox())!.width).toBeLessThan(45);
  await refresh.click();
  await page.setViewportSize({ width: 390, height: 780 });
  await expect(refresh).toBeVisible();
  await expect(page.getByTestId('library-opencode')).toBeVisible();
});
