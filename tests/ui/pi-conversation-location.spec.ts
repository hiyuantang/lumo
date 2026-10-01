// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '../offline';
import { piPage } from './pi-fixture';

const occupied = { code: 'conflict', message: 'This conversation is already open in another Pi window.' };

test('A conversation in the hidden floating window has a neutral location and a working return action', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  const fixture = await piPage(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('http://localhost:5200');
  await page.getByTestId('pi-tray-button').click(); await page.getByTestId('pi-tray-toggle').click();
  const assistant = page.getByTestId('pi-assistant');
  await expect(page.getByTestId('pi-compact-prompt')).toBeEnabled();
  await page.getByTestId('pi-compact-prompt').fill('Keep my floating draft');
  await page.getByTestId('pi-compact-prompt').press('Escape');
  await expect(assistant).toBeHidden();
  await page.route('**/api/v1/pi/start', (route) => route.request().postDataJSON().session === 'first.jsonl' ? route.fulfill({ status: 409, json: { ok: false, error: occupied } }) : route.fulfill({ json: { ok: true, data: { id: 'main-run', project: '/home/user', permissionMode: 'ask' } } }));
  await page.route('**/api/v1/pi/command', (route) => {
    const { id, command } = route.request().postDataJSON();
    return id === 'main-run' && command.type === 'get_state' ? route.fulfill({ json: { ok: true, data: { success: true, data: { sessionFile: '/sessions/main.jsonl' } } } }) : route.fallback();
  });
  await page.getByTestId('dock-app-pi').click();
  const main = page.getByTestId('app-pi');
  await expect(main.getByTestId('pi-prompt')).toBeEnabled();
  await main.getByRole('navigation', { name: 'Recent Pi chats' }).getByRole('button', { name: 'Project notes', exact: true }).click();
  const location = main.getByTestId('pi-conversation-location');
  await expect(location).toContainText('Open in the floating window');
  await expect(location).toHaveAttribute('role', 'status');
  await expect(main.getByRole('alert')).toHaveCount(0);
  await expect(main.getByRole('button', { name: 'Reconnect' })).toHaveCount(0);
  await expect(main.getByTestId('pi-prompt')).toHaveCount(0);
  for (const width of [1440, 390]) for (const colorScheme of ['light', 'dark'] as const) {
    await page.setViewportSize({ width, height: 1000 }); await page.emulateMedia({ colorScheme });
    await expect(location.getByRole('button')).toBeVisible();
    expect(await main.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.screenshot({ path: `/tmp/lumo-pi-location-${width}-${colorScheme}.png` });
  }
  const starts = fixture.starts.length;
  await location.getByRole('button', { name: 'Show floating window' }).click();
  await expect(assistant).toBeVisible();
  await expect(page.getByTestId('pi-compact-prompt')).toHaveValue('Keep my floating draft');
  await expect(page.getByTestId('pi-compact-prompt')).toBeFocused();
  await location.getByRole('button', { name: 'Show floating window' }).click();
  await expect(page.getByTestId('pi-compact-prompt')).toBeFocused();
  expect(fixture.starts).toHaveLength(starts);
  expect(errors).toEqual([]);
});

test('A conversation in another tab offers a neutral retry, while real startup errors remain errors', async ({ page }) => {
  await piPage(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/v1/pi/start', (route) => route.fulfill({ status: 409, json: { ok: false, error: occupied } }));
  await page.goto('http://localhost:5200'); await page.getByTestId('dock-app-pi').click();
  const main = page.getByTestId('app-pi');
  await expect(main.getByTestId('pi-conversation-location')).toContainText('Open in another Pi window');
  await expect(main.getByRole('alert')).toHaveCount(0);
  await page.unroute('**/api/v1/pi/start');
  await main.getByRole('button', { name: 'Try again' }).click();
  await expect(main.getByTestId('pi-prompt')).toBeEnabled();
  await page.route('**/api/v1/pi/start', (route) => route.fulfill({ status: 409, json: { ok: false, error: { code: 'conflict', message: 'Up to eight Pi chats can run at once.' } } }));
  await main.getByTestId('pi-new').click();
  await expect(main.getByRole('alert')).toContainText('Up to eight Pi chats');
  await expect(main.getByTestId('pi-conversation-location')).toHaveCount(0);
  await expect(main.getByRole('button', { name: 'Reconnect' })).toBeVisible();
});

test('The floating assistant can return to an existing minimized Pi window without restarting its conversation', async ({ page }) => {
  const fixture = await piPage(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => sessionStorage.setItem('lumo.pi.chats:demo:pi:assistant', JSON.stringify({ active: 'initial', chats: [{ key: 'initial', project: '~', session: 'first.jsonl', running: true, dirty: false }] })));
  await page.goto('http://localhost:5200'); await page.getByTestId('dock-app-pi').click();
  await expect(page.getByTestId('pi-prompt')).toBeEnabled();
  await page.getByTestId('pi-prompt').fill('Keep my main window draft');
  await page.getByTestId('window-minimize-pi').click();
  await expect(page.getByTestId('window-pi')).toBeHidden();
  await page.route('**/api/v1/pi/start', (route) => route.fulfill({ status: 409, json: { ok: false, error: occupied } }));
  await page.getByTestId('pi-tray-button').click(); await page.getByTestId('pi-tray-toggle').click();
  const assistant = page.getByTestId('pi-assistant');
  await expect(assistant.getByTestId('pi-conversation-location')).toContainText('Open in another Pi window');
  await expect(assistant.getByRole('alert')).toHaveCount(0);
  await expect(page.getByTestId('desktop-pet')).toHaveAttribute('data-mood', 'idle');
  const starts = fixture.starts.length;
  await assistant.getByRole('button', { name: 'Show Pi window' }).click();
  await expect(page.getByTestId('window-pi')).toBeVisible();
  await expect(page.getByTestId('window-pi')).toHaveClass(/focused/);
  await expect(page.getByTestId('pi-prompt')).toHaveText('Keep my main window draft');
  await expect(page.getByTestId('pi-prompt')).toBeFocused();
  expect(fixture.starts).toHaveLength(starts);
});
