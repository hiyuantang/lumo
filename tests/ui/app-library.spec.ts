// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect, type Page } from '../offline';
async function open(page: Page) {
  await page.goto('/');
  await page.getByTestId('login-username').fill('demo');
  await page.getByTestId('login-password').fill('demo');
  await page.getByTestId('login-submit').click();
  await page.getByTestId('dock-app-library').click();
}

test('All Apps uses adaptive cards and keeps details separate from launch', async ({ page }) => {
  await open(page);
  await expect(page.getByRole('heading', { name: 'Lumo Apps', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Custom Apps', exact: true })).toBeVisible();
  const cards = page.locator('.library-discovery-grid');
  await expect(cards.getByRole('button')).toHaveCount(7);
  const columns = () => cards.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
  expect(await columns()).toBe(2);
  await page.getByTestId('library-nginx').click();
  await expect(page.getByRole('region', { name: 'Nginx details' })).toBeVisible();
  await expect(page.getByTestId('app-websites')).toHaveCount(0);
  await expect(cards).toHaveCount(0);
  await page.getByTestId('library-back').click();
  await page.getByRole('button', { name: 'Maximize App Library' }).click();
  await expect.poll(columns).toBeGreaterThan(2);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(columns).toBe(1);
  expect(await page.getByTestId('app-library').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
});

test('Updates checks installed apps and records one-click updates in history', async ({ page }) => {
  await open(page);
  await page.getByTestId('library-updates').click();
  await expect(page.getByTestId('library-update-docker')).toContainText('27.5.1 → 27.5.2');
  await expect(page.getByTestId('library-update-nginx')).toContainText('1.24.0 → 1.24.1');
  await expect(page.getByTestId('library-history')).toContainText('No updates recorded yet.');
  await page.getByTestId('library-update-docker').getByRole('button', { name: 'Update', exact: true }).click();
  await expect(page.getByTestId('library-plan')).toHaveCount(0);
  await expect(page.getByTestId('server-app-confirm')).toHaveCount(0);
  await expect(page.getByTestId('library-update-docker').getByRole('progressbar')).toBeVisible();
  await expect(page.getByTestId('library-update-docker')).toHaveCount(0);
  await expect(page.getByTestId('library-history')).toContainText('Docker updated');
  await expect(page.getByTestId('library-update-nginx').getByRole('button', { name: 'Update', exact: true })).toBeEnabled();
  await page.getByTestId('library-check-updates').click();
  await expect(page.getByTestId('library-update-nginx')).toBeVisible();
  await expect(page.getByTestId('library-update-docker')).toHaveCount(0);
  await expect(page.getByTestId('library-history').locator('details, summary')).toHaveCount(0);
  await expect(page.getByTestId('library-history')).not.toContainText('Completed');
  await expect(page.getByTestId('library-history').getByText('27.5.1 → 27.5.2', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.getByTestId('library-history').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.getByRole('button', { name: 'Close App Library' }).click();
  await page.getByTestId('dock-app-library').click();
  await page.getByTestId('library-updates').click();
  await expect(page.getByTestId('library-history')).toContainText('Docker updated');
});

test('Unavailable checks and history never appear as up to date or empty history', async ({ page }) => {
  await page.routeWebSocket(/\/api\/v1\/ws/, () => {});
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/apps/plan') || path.endsWith('/apps/update-history')) return route.fulfill({ status: 503, json: { ok: false, error: { code: 'unavailable', message: 'Test service unavailable' } } });
    const data = path.endsWith('/auth/session') ? { user: { name: 'demo', uid: 1000, gid: 1000, home: '/home/user' } }
      : path.endsWith('/apps') ? { canInstall: true, apps: [{ id: 'docker', installed: true }] }
      : path.endsWith('/updates/refresh') ? { refreshedAt: new Date().toISOString() } : {};
    return route.fulfill({ json: { ok: true, data } });
  });
  await page.goto('http://localhost:5200');
  await page.getByTestId('dock-app-library').click();
  await page.getByTestId('library-updates').click();
  await expect(page.getByTestId('library-update-docker')).toContainText('Could not check for updates');
  await expect(page.getByTestId('app-library')).not.toContainText('Your managed apps are up to date.');
  await expect(page.getByTestId('library-history').getByRole('alert')).toBeVisible();
  await expect(page.getByTestId('library-history')).not.toContainText('No updates recorded yet.');
});

test('App details have independent back and forward history', async ({ page }) => {
  await open(page);
  await expect(page.getByTestId('library-description')).toHaveCount(0);
  await expect(page.getByTestId('library-back')).toBeDisabled();
  await expect(page.getByTestId('library-forward')).toBeDisabled();
  await page.getByTestId('library-docker').click();
  await expect(page.getByRole('region', { name: 'Docker details' })).toBeVisible();
  await expect(page.locator('.library-discovery-grid')).toHaveCount(0);
  await page.getByTestId('library-back').click();
  await expect(page.getByRole('heading', { name: 'All Apps', exact: true })).toBeVisible();
  await page.getByTestId('library-forward').click();
  await expect(page.getByRole('region', { name: 'Docker details' })).toBeVisible();
  await page.getByTestId('library-discovery').click();
  await page.getByTestId('library-nginx').click();
  await expect(page.getByRole('region', { name: 'Nginx details' })).toBeVisible();
  await page.getByTestId('library-back').click();
  await page.getByTestId('library-pi').click();
  await expect(page.getByRole('region', { name: 'Pi details' })).toBeVisible();
  await expect(page.getByTestId('library-forward')).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId('library-back')).toBeInViewport();
  await page.getByTestId('library-back').click();
  await expect(page.getByTestId('library-pi')).toBeVisible();
  await page.getByTestId('library-forward').click();
  await expect(page.getByRole('region', { name: 'Pi details' })).toBeVisible();
});

test('Update all runs apps in order and continues while the window is closed', async ({ page }) => {
  await open(page);
  await page.getByTestId('library-updates').click();
  await expect(page.getByTestId('library-update-all')).toBeEnabled();
  await page.getByTestId('library-update-all').click();
  await expect(page.getByTestId('library-update-docker')).toContainText('Updating…');
  await expect(page.getByTestId('library-update-nginx')).toContainText('Waiting…');
  await expect(page.getByTestId('library-update-all')).toBeDisabled();
  await expect(page.getByTestId('server-app-confirm')).toHaveCount(0);
  await page.getByRole('button', { name: 'Close App Library' }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('lumo-app-updates:mock:demo'))).toBeNull();
  await page.getByTestId('dock-app-library').click();
  await page.getByTestId('library-updates').click();
  await expect(page.getByTestId('library-history')).toContainText('Docker updated');
  await expect(page.getByTestId('library-history')).toContainText('Nginx updated');
  await expect(page.getByTestId('library-update-docker')).toHaveCount(0);
  await expect(page.getByTestId('library-update-nginx')).toHaveCount(0);
  await expect(page.getByTestId('library-update-all')).toBeDisabled();
  await expect(page.getByTestId('app-library')).toContainText('Your managed apps are up to date.');
});

test('Update controls fit a compact screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await page.getByTestId('library-updates').click();
  await expect(page.getByTestId('library-update-all')).toBeInViewport();
  await expect(page.getByTestId('library-update-docker').getByRole('button', { name: 'Update', exact: true })).toBeInViewport();
  expect(await page.getByTestId('app-library').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
});

for (const width of [1440, 390]) {
  test(`App Library sidebar collapses and preserves navigation at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: width === 390 ? 'dark' : 'light' });
    await open(page);
    const toggle = page.getByTestId('library-sidebar-toggle');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId('library-discovery')).toBeInViewport();
    await expect(page.getByTestId('library-updates')).toBeInViewport();
    await page.getByTestId('library-check-updates').click();
    await expect(page.getByTestId('library-update-docker')).toBeVisible();
    await page.getByTestId('library-back').click();
    await page.getByTestId('library-nginx').click();
    await expect(page.getByRole('region', { name: 'Nginx details' })).toBeVisible();
    await page.getByTestId('library-back').click();
    await page.screenshot({ path: `/tmp/lumo-library-collapsed-${width}.png`, animations: 'disabled' });
    await page.getByTestId('window-close-library').click();
    await page.getByTestId('dock-app-library').click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(await page.getByTestId('app-library').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: `/tmp/lumo-library-expanded-${width}.png`, animations: 'disabled' });
  });
}

test('all six shipped apps appear once, report their active version and open from details', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await open(page);
  for (const [id, appId, name] of [
    ['calendar', 'calendar', 'Calendar'], ['skills', 'skills', 'Skills'], ['monitor', 'home', 'Monitor'],
    ['git', 'git', 'Git'], ['docker', 'containers', 'Docker'], ['nginx', 'websites', 'Nginx'],
  ]) {
    const card = page.getByTestId(`library-${id}`);
    await expect(card).toHaveCount(1);
    await expect(card).toContainText('Installed · 1.0.0');
    await card.click();
    await expect(page.getByRole('region', { name: `${name} details`, exact: true })).toContainText('App version1.0.0');
    await expect(page.getByTestId(`window-${appId}`)).toHaveCount(0);
    await page.getByTestId('library-open').click();
    await expect(page.getByTestId(`window-${appId}`)).toBeVisible();
    await page.getByTestId(`window-close-${appId}`).click();
    await page.getByTestId('library-back').click();
  }
  for (const width of [1440,390]) for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await page.setViewportSize({ width, height: 1000 });
    await expect(page.locator('html')).toHaveAttribute('data-theme', colorScheme);
    await page.screenshot({ path: `/tmp/lumo-library-plugins-${width}-${colorScheme}.png`, animations: 'disabled' });
    expect(await page.getByTestId('app-library').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  }
  expect(errors).toEqual([]);
});

test('App Library reads deployed versions and recovers a failed manifest through Refresh', async ({ page }) => {
  let unavailable = true;
  await page.route('**/plugins/skills/manifest.json', async (route) => {
    if (unavailable) { await route.fulfill({ status: 503, body: 'Unavailable' }); return; }
    const response = await route.fetch();
    await route.fulfill({ json: { ...await response.json(), version: '2.3.4' } });
  });
  await open(page);
  await expect(page.getByTestId('library-skills')).toContainText('App unavailable');
  await page.getByTestId('library-skills').click();
  await expect(page.getByTestId('library-open')).toBeDisabled();
  await expect(page.getByTestId('app-library').getByRole('alert')).toContainText('View → Refresh');
  unavailable = false;
  await page.getByRole('menuitem', { name: 'View', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Refresh', exact: true }).click();
  await expect(page.getByTestId('app-library')).toContainText('2.3.4');
  await expect(page.getByTestId('library-open')).toBeEnabled();
  await page.getByTestId('library-back').click();
  await expect(page.getByTestId('library-skills')).toContainText('Installed · 2.3.4');
});
