// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '../offline';

test('settings confirms and schedules a restart', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('login-username').fill('demo');
  await page.getByTestId('login-password').fill('demo');
  await page.getByTestId('login-submit').click();

  await page.getByTestId('dock-app-settings').click();
  const settings = page.getByTestId('app-settings');
  await expect(settings).toBeVisible();
  await settings.getByTestId('settings-section-about').click();
  await expect(settings.getByRole('region', { name: 'Legal', exact: true })).toContainText('AGPL-3.0-only');
  await expect(settings.getByTestId('legal-source')).toHaveAttribute('href', 'https://github.com/hiyuantang/lumo');
  await settings.getByTestId('settings-section-system').click();
  await settings.getByTestId('settings-reboot').click();
  await expect(page.getByTestId('settings-power-confirm')).toContainText('Active sessions will disconnect');
  await page.getByTestId('settings-confirm-action').click();

  await expect(page.getByTestId('notifications-badge')).toHaveText('1');
  await page.getByTestId('notifications-button').click();
  await expect(page.getByTestId('notification-item').first()).toContainText('Restart scheduled');
});

test('settings displays hostname and saves time settings while preserving drafts', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByTestId('login-username').fill('demo');
  await page.getByTestId('login-password').fill('demo');
  await page.getByTestId('login-submit').click();
  await page.getByTestId('dock-app-settings').click();
  await expect(page.getByTestId('settings-hostname')).toHaveText('atlas.lan');
  await expect(page.getByTestId('app-settings').getByRole('textbox', { name: 'Hostname', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('settings-editor-hostname')).toHaveCount(0);
  await page.getByTestId('settings-section-time').click();
  await expect(page.getByRole('switch', { name: 'Set time automatically' })).toHaveCount(0);
  await expect(page.locator('select')).toHaveCount(0);
  await expect(page.getByTestId('settings-timezone')).toHaveText('UTC');
  await expect(page.getByTestId('settings-timezone')).toHaveAttribute('value', 'Etc/UTC');
  await expect(page.locator('.settings-clock small')).toHaveText('UTC');
  await expect(page.getByTestId('settings-timezone').locator('svg')).toBeVisible();
  await page.getByTestId('settings-timezone').click();
  await page.getByRole('option', { name: 'America/New York', exact: true }).click();
  await page.getByTestId('settings-section-system').click();
  await page.getByTestId('settings-section-time').click();
  await expect(page.getByTestId('settings-timezone')).toHaveAttribute('value', 'America/New_York');
  await page.getByTestId('settings-save-timezone').click();
  await expect(page.getByTestId('settings-editor-timezone')).toContainText('Saved');
  await page.getByRole('button', { name: 'Close Settings', exact: true }).click();
  await page.getByTestId('dock-app-settings').click();
  await expect(page.getByTestId('settings-hostname')).toHaveText('atlas.lan');
  await page.getByTestId('settings-section-time').click();
  await expect(page.getByTestId('settings-timezone')).toHaveAttribute('value', 'America/New_York');
  expect(errors).toEqual([]);
});

test('settings appearance persists and compact layout stays usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByTestId('login-username').fill('demo');
  await page.getByTestId('login-password').fill('demo');
  await page.getByTestId('login-submit').click();
  await page.getByTestId('dock-app-settings').click();
  await page.getByTestId('settings-section-appearance').click();
  await page.getByTestId('settings-theme-dark').click();
  await page.getByRole('combobox', { name: 'Window animations' }).click();
  await page.getByRole('option', { name: 'Reduced motion' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveClass(/motion-reduced/);
  await page.reload();
  await page.getByTestId('settings-section-appearance').click();
  await expect(page.getByTestId('settings-theme-dark')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('combobox', { name: 'Window animations' })).toHaveText('Reduced motion');
  const bounds = await page.getByTestId('app-settings').boundingBox();
  expect(bounds?.width).toBeLessThanOrEqual(390);
  const overflow = await page.getByTestId('app-settings').evaluate((element) => element.scrollWidth > element.clientWidth);
  expect(overflow).toBe(false);
  const sections = page.getByRole('navigation', { name: 'Settings sections' });
  await expect(sections.getByRole('button', { name: 'System', exact: true })).toBeVisible();
  await expect(sections.locator('.settings-nav-label').first()).toBeHidden();
  await expect(sections.getByRole('button', { name: 'Appearance', exact: true })).toHaveAttribute('title', 'Appearance');
  await page.getByRole('combobox', { name: 'Window animations' }).click();
  const menu = page.getByRole('listbox', { name: 'Window animations' });
  await expect(menu).toBeVisible();
  const menuBounds = await menu.boundingBox();
  expect(menuBounds!.x).toBeGreaterThanOrEqual(0);
  expect(menuBounds!.x + menuBounds!.width).toBeLessThanOrEqual(390);
  expect(menuBounds!.y + menuBounds!.height).toBeLessThanOrEqual(844);
  await expect(menu.getByRole('option', { name: 'Reduced motion' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('combobox', { name: 'Window animations' }).press('Escape');
  await expect(menu).toBeHidden();
  await page.getByTestId('settings-section-system').click();
  await expect(page.getByTestId('settings-hostname')).toHaveText('atlas.lan');
  await page.getByTestId('settings-section-time').click();
  await page.getByTestId('settings-timezone').click();
  await page.getByRole('option', { name: 'America/New York', exact: true }).click();
  await page.getByTestId('settings-save-timezone').click();
  await expect(page.getByTestId('settings-editor-timezone')).toContainText('Saved');
});

test('motion menu supports keyboard selection, dismissal, and compact window resizing', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByTestId('login-username').fill('demo');
  await page.getByTestId('login-password').fill('demo');
  await page.getByTestId('login-submit').click();
  await page.getByTestId('dock-app-settings').click();
  await page.getByTestId('settings-section-appearance').click();
  await expect(page.getByTestId('settings-section-system').locator('.settings-nav-label')).toBeVisible();
  const control = page.getByRole('combobox', { name: 'Window animations' });
  const menu = page.getByRole('listbox', { name: 'Window animations' });
  await control.press('Enter');
  await expect(menu).toBeVisible();
  await control.press('End');
  await control.press('Enter');
  await expect(menu).toBeHidden();
  await expect(control).toBeFocused();
  await expect(control).toHaveText('Reduced motion');
  await expect(page.locator('html')).toHaveClass(/motion-reduced/);
  await control.press('ArrowUp');
  await control.press('ArrowUp');
  await control.press('Escape');
  await expect(menu).toBeHidden();
  await expect(control).toHaveText('Reduced motion');
  await control.press('ArrowDown');
  await control.press('Home');
  await control.press('ArrowDown');
  await control.press('Enter');
  await expect(control).toHaveText('Full motion');
  await expect(page.locator('html')).not.toHaveClass(/motion-reduced/);
  await control.click();
  await page.getByRole('heading', { name: 'Theme' }).click();
  await expect(menu).toBeHidden();
  await control.press('Enter');
  await control.press('Tab');
  await expect(menu).toBeHidden();
  const window = await page.getByTestId('window-settings').boundingBox();
  const handle = await page.getByTestId('window-resize-settings-se').boundingBox();
  await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2);
  await page.mouse.down();
  await page.mouse.move(window!.x + 440, window!.y + 380, { steps: 10 });
  await page.mouse.up();
  await expect(page.getByTestId('settings-section-system').locator('.settings-nav-label')).toBeHidden();
  await control.click();
  await expect(menu).toBeVisible();
  const menuBounds = await menu.boundingBox();
  const body = await page.getByTestId('window-settings').locator('.window-body').boundingBox();
  expect(menuBounds!.y).toBeGreaterThanOrEqual(body!.y);
  expect(menuBounds!.y + menuBounds!.height).toBeLessThanOrEqual(body!.y + body!.height);
  await page.getByTestId('window-minimize-settings').click();
  await expect(menu).toBeHidden();
  expect(errors).toEqual([]);
});

test('menu bar and Settings share server time and follow saved time-zone changes', async ({ page }) => {
  let timezone = 'Etc/UTC';
  let changed: unknown;
  const snapshot = () => ({ timezone, serverTime: '2028-01-02T03:04:05Z', revision: timezone, runtimeHostname: 'clock-test', canEdit: true, available: true, ntpSynchronized: true });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.routeWebSocket(/\/api\/v1\/ws/, () => {});
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    const data = (value: unknown) => route.fulfill({ json: { ok: true, data: value } });
    if (path.endsWith('/auth/session')) return data({ user: { name: 'demo', uid: 1000, gid: 1000, home: '/home/user' } });
    if (path.endsWith('/system/settings')) {
      if (route.request().method() === 'POST') { changed = route.request().postDataJSON().change; timezone = (changed as { timezone: string }).timezone; }
      return data(snapshot());
    }
    if (path.endsWith('/system/timezones')) return data({ timezones: ['Etc/UTC', 'America/New_York'] });
    if (path.endsWith('/apps')) return data({ canInstall: false, apps: [] });
    return data({});
  });
  await page.goto('http://localhost:5200');
  await expect(page.getByTestId('server-menubar-clock')).toContainText('Jan 2');
  await expect(page.getByTestId('server-menubar-clock')).toContainText('03:04 AM');
  await page.getByTestId('dock-app-settings').click();
  await page.getByTestId('settings-section-time').click();
  await expect(page.locator('.settings-clock strong')).toContainText('03:04:');
  await expect(page.locator('.settings-clock small')).toHaveText('UTC');
  await page.screenshot({ path: '/tmp/lumo-server-clock-utc.png' });
  await page.getByTestId('settings-timezone').click();
  await page.getByRole('option', { name: 'America/New York', exact: true }).click();
  await page.getByTestId('settings-save-timezone').click();
  await expect(page.getByTestId('settings-editor-timezone')).toContainText('Saved');
  expect(changed).toEqual({ timezone: 'America/New_York' });
  await expect(page.getByTestId('server-menubar-clock')).toContainText('Jan 1');
  await expect(page.getByTestId('server-menubar-clock')).toContainText('10:04 PM');
  await expect(page.locator('.settings-clock strong')).toContainText('10:04:');
  await expect(page.locator('.settings-clock small')).toHaveText('America/New York');
  await page.screenshot({ path: '/tmp/lumo-server-clock-new-york.png' });
});

test('system summary shows hardware totals and compact details in both themes', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByTestId('login-username').fill('demo');
  await page.getByTestId('login-password').fill('demo');
  await page.getByTestId('login-submit').click();
  await page.getByTestId('dock-app-settings').click();
  const app = page.getByTestId('app-settings');
  for (const theme of ['light', 'dark'] as const) {
    await page.getByTestId('settings-section-appearance').click();
    await page.getByTestId(`settings-theme-${theme}`).click();
    await page.getByTestId('settings-section-system').click();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(app.locator('.settings-stat').filter({ hasText: 'CPUs' })).toHaveText('CPUs8');
      await expect(app.locator('.settings-stat').filter({ hasText: 'Memory' })).toHaveText('Memory8 GB');
      await expect(app.locator('.settings-stat').filter({ hasText: 'Storage' })).toHaveText('Storage240 GB');
      await expect(app.getByRole('meter')).toHaveCount(0);
      await expect(app.getByRole('region', { name: 'System details' })).toContainText('AMD EPYC 7763');
      await expect(app.getByText('Ubuntu 24.04.1 LTS', { exact: true })).toHaveCount(1);
      expect(await app.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(false);
      const stats = await app.locator('.settings-stats').boundingBox();
      const cards = await app.locator('.settings-stat').all();
      for (const card of cards) {
        const bounds = await card.boundingBox();
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(stats!.x + stats!.width + 1);
      }
      await page.screenshot({ path: `/tmp/lumo-system-summary-${theme}-${width}.png` });
    }
  }
  expect(errors).toEqual([]);
});
