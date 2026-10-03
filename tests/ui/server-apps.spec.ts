// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test, type Page } from '../offline';

async function login(page: Page) {
  await page.goto('/');
  await page.getByTestId('login-username').fill('demo');
  await page.getByTestId('login-password').fill('demo');
  await page.getByTestId('login-submit').click();
}

test('Containers opens from the dock and confirms lifecycle changes without losing storage', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page);
  await page.getByTestId('dock-app-library').click();
  await page.getByTestId('library-docker').click();
  await expect(page.getByTestId('library-primary')).toHaveText('Uninstall');
  await expect(page.getByTestId('app-containers')).toHaveCount(0);
  await page.getByTestId('dock-app-containers').click();
  await expect(page.getByTestId('app-containers')).toBeVisible();
  await page.getByTestId('container-row-notes-web').click();
  await expect(page.getByTestId('app-containers')).toContainText('/srv/notes');
  await page.getByTestId('container-stop').click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByTestId('container-stop')).toBeEnabled();
  await page.getByTestId('container-stop').click();
  await page.getByTestId('server-app-confirm-ok').click();
  await expect(page.getByTestId('container-start')).toBeEnabled();
  await expect(page.getByTestId('container-row-notes-web')).toContainText('exited');
  await expect(page.getByTestId('app-containers')).toContainText('/srv/notes');
  await page.getByTestId('container-start').click();
  await expect(page.getByTestId('container-stop')).toBeEnabled();
  await page.getByRole('tab', { name: 'Logs', exact: true }).click();
  await expect(page.getByTestId('server-app-logs')).toContainText('Ready to accept connections');
  await page.getByLabel('Search containers').fill('no-such-container');
  await expect(page.getByTestId('app-containers')).toContainText('No matching containers');
  expect(errors).toEqual([]);
});

test('Websites keeps drafts between sites and adds a reviewed proxy without altering custom files', async ({ page }) => {
  await login(page);
  await page.getByTestId('dock-app-websites').click();
  await expect(page.getByLabel('Website domain')).toHaveValue('notes.example.com');
  const enabled = page.getByRole('checkbox', { name: 'Enabled' });
  expect((await enabled.boundingBox())!.x).toBeGreaterThan((await page.locator('.website-enabled span').boundingBox())!.x);
  const kind = page.locator('.website-kind-options label').first();
  expect((await kind.locator('input').boundingBox())!.x).toBeGreaterThan((await kind.locator('strong').boundingBox())!.x);
  await page.locator('.website-enabled span').click();
  await expect(page.getByRole('checkbox', { name: 'Enabled' })).toBeChecked();
  await page.getByRole('checkbox', { name: 'Enabled' }).press('Space');
  await expect(page.getByRole('checkbox', { name: 'Enabled' })).not.toBeChecked();
  await page.getByRole('checkbox', { name: 'Enabled' }).check();
  await page.getByLabel('Application port').fill('4000');
  await page.getByTestId('website-row-default').click();
  await expect(page.getByTestId('website-source')).toContainText('default_server');
  await expect(page.getByTestId('website-save')).toHaveCount(0);
  await page.getByTestId('website-row-notes.example.com').click();
  await expect(page.getByLabel('Application port')).toHaveValue('4000');
  await page.getByTestId('website-save').click();
  await expect(page.getByTestId('server-app-confirm')).toContainText('local port 4000');
  await page.getByTestId('server-app-confirm-ok').click();
  await expect(page.getByTestId('website-save')).toBeDisabled();
  await page.getByTestId('website-add').click();
  await page.getByLabel('Website domain').fill('app.example.com');
  await page.getByLabel('Application port').fill('5000');
  await page.getByTestId('website-save').click();
  await page.getByTestId('server-app-confirm-ok').click();
  await expect(page.getByTestId('website-row-app.example.com')).toBeVisible();
  await page.getByTestId('websites-refresh').click();
  await expect(page.getByLabel('Application port')).toHaveValue('5000');
  await page.getByTestId('website-row-default').click();
  await expect(page.getByTestId('website-source')).toContainText('default_server');
});

test('App Library and both server apps fit compact windows and retain a reachable dock', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  for (const [id, testId] of [['library', 'app-library'], ['containers', 'app-containers'], ['websites', 'app-websites']]) {
    await page.getByTestId(`dock-app-${id}`).click();
    const app = page.getByTestId(testId);
    await expect(app).toBeVisible();
    expect(await app.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    const detail = await app.locator('main').boundingBox();
    const sidebar = await app.locator('aside').boundingBox();
    expect(detail!.width).toBeGreaterThanOrEqual(370);
    expect(sidebar!.y + sidebar!.height).toBeLessThanOrEqual(detail!.y + 1);
    const box = await page.getByTestId('dock').locator('.dock-tray').boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    if (id === 'websites') {
      await page.getByTestId('website-add').click();
      await page.getByLabel('Website domain').fill('small.example.com');
      await page.getByLabel('Application port').fill('8080');
      await page.getByTestId('website-save').click();
      await expect(page.getByTestId('server-app-confirm')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('server-app-confirm')).toHaveCount(0);
    }
    await page.getByTestId(`window-${id}`).getByRole('button', { name: /^Close / }).click();
  }
});


test('App Library entries show descriptions and management actions without launching apps', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await login(page);
  await page.getByTestId('dock-app-library').click();
  for (const [id, appId, description] of [
    ['docker', 'containers', 'Run apps in isolated containers'],
    ['nginx', 'websites', 'Serve websites'],
  ]) {
    await page.getByTestId(`library-${id}`).click();
    await expect(page.locator('.library-discovery-grid')).toHaveCount(0);
    await expect(page.getByTestId('app-library')).toContainText(description);
    await expect(page.getByTestId('library-description')).toBeVisible();
    await expect(page.getByTestId('library-description')).not.toContainText('Trash');
    await expect(page.getByTestId('app-library')).not.toContainText('Installed for your Linux account.');
    await expect(page.getByTestId(`app-${appId}`)).toHaveCount(0);
    await page.getByTestId('library-back').click();
  }
  await page.getByTestId('library-nginx').click();
  await expect(page.getByTestId('library-primary')).toHaveText('Uninstall');
  await page.screenshot({ path: '/tmp/lumo-library-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId('app-library')).toContainText('Serve websites');
  await page.screenshot({ path: '/tmp/lumo-library-compact.png' });
  expect(errors).toEqual([]);
});
