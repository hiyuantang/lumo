// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from '../offline';
import { piPage } from './pi-fixture';
import type { Page } from '@playwright/test';

async function options(page: Page, name: string, recent = false) {
  const nav = page.getByRole('navigation', { name: recent ? 'Recent Pi chats' : 'Pi projects', exact: true });
  const row = nav.getByRole('button', { name, exact: true });
  await row.hover();
  await nav.getByRole('button', { name: `Chat options for ${name}`, exact: true }).click();
}

test('Chat menus rename the selected conversation and preserve another chat draft', async ({ page }) => {
  const fixture = await piPage(page);
  const names = new Map([['first.jsonl', 'Project notes'], ['second.jsonl', 'Earlier work']]);
  await page.route('**/api/v1/pi/sessions?**', (route) => route.fulfill({ json: { ok: true, data: { sessions: [...names].map(([id, name]) => ({ id, name, modified: '2026-09-28' })) } } }));
  await page.route('**/api/v1/pi/command', (route) => {
    const { command } = route.request().postDataJSON(); const session = fixture.starts.at(-1)?.session || 'first.jsonl';
    if (command.type === 'set_session_name') names.set(session, command.name);
    if (command.type === 'get_state') return route.fulfill({ json: { ok: true, data: { success: true, data: { sessionFile: `/sessions/${session}`, sessionName: names.get(session) } } } });
    return route.fallback();
  });
  await page.goto('http://localhost:5200'); await page.getByTestId('dock-app-pi').click();
  await expect(page.getByTestId('pi-prompt')).toBeEnabled();
  await page.getByTestId('pi-prompt').fill('Keep my first draft');
  await options(page, 'Earlier work', true);
  await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
  await expect(page.getByRole('alertdialog', { name: 'Rename conversation' })).toBeVisible();
  expect(fixture.starts.at(-1)?.session).toBe('second.jsonl');
  await expect(page.getByRole('textbox', { name: 'Conversation name' })).toHaveValue('Earlier work');
  await page.getByRole('textbox', { name: 'Conversation name' }).fill('Deployment plan');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  expect(fixture.commands.filter((command) => command.type === 'set_session_name')).toEqual([{ type: 'set_session_name', name: 'Deployment plan' }]);
  await page.getByRole('navigation', { name: 'Pi projects', exact: true }).getByRole('button', { name: 'Project notes', exact: true }).click();
  await expect(page.getByTestId('pi-prompt')).toBeEnabled();
  await expect(page.getByTestId('pi-prompt')).toHaveText('Keep my first draft');
  await options(page, 'Deployment plan'); await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Chat options for Deployment plan' }).first()).toBeFocused();
});

test('Assistant mode keeps the live process and draft, and returns without restarting', async ({ page }) => {
  const fixture = await piPage(page);
  const stops: string[] = [];
  await page.route('**/api/v1/pi/stop', (route) => { stops.push(route.request().postDataJSON().id); return route.fulfill({ json: { ok: true, data: { closed: true } } }); });
  await page.goto('http://localhost:5200'); await page.getByTestId('dock-app-pi').click();
  await expect(page.getByTestId('pi-prompt')).toBeEnabled();
  await page.getByTestId('pi-prompt').fill('Work on this'); await page.getByTestId('pi-send').click();
  await expect(page.getByTestId('pi-send')).toHaveAttribute('aria-label', 'Stop');
  await page.getByTestId('pi-prompt').fill('Keep this draft');
  const starts = fixture.starts.length;
  await options(page, 'Project notes');
  await expect(page.getByRole('menuitem', { name: 'Rename', exact: true })).toBeDisabled();
  await expect(page.getByRole('menuitem', { name: 'Archive', exact: true })).toBeDisabled();
  await page.getByRole('menuitem', { name: 'Move to assistant window', exact: true }).click();
  const assistant = page.getByTestId('pi-chat-assistant');
  await expect(assistant).toBeVisible();
  await expect(assistant.getByTestId('pi-compact-prompt')).toHaveValue('Keep this draft');
  await expect(assistant.getByTestId('pi-compact-send')).toHaveAttribute('aria-label', 'Stop');
  expect(fixture.starts.length).toBe(starts); expect(stops).toEqual([]);
  await page.getByTestId('pi-settings-button').click();
  await expect(page.getByTestId('pi-settings')).toBeVisible();
  await page.getByTestId('window-minimize-pi').click();
  await expect(page.getByTestId('window-pi')).toBeHidden(); await expect(assistant).toBeVisible();
  await assistant.getByTestId('pi-compact-prompt').fill('Keep this revised draft');
  await expect(page.getByTestId('window-pi')).toBeHidden();
  const observed = fixture.requestDesktop({ action: 'observe' });
  await expect.poll(() => fixture.desktopResults.find((result) => result.desktopId === observed)?.error).toBe(false);
  expect(fixture.desktopResults.find((result) => result.desktopId === observed)?.text).not.toContain('Keep this revised draft');
  fixture.finish('Updated the project');
  await expect(assistant.getByTestId('pi-compact-messages')).toContainText('Updated the project');
  for (const width of [1440, 390]) for (const colorScheme of ['light', 'dark'] as const) {
    await page.setViewportSize({ width, height: 900 }); await page.emulateMedia({ colorScheme });
    await expect(assistant.getByTestId('pi-compact-prompt')).toBeVisible();
    await page.screenshot({ path: `/tmp/lumo-chat-assistant-${width}-${colorScheme}.png`, animations: 'disabled' });
  }
  await assistant.getByTestId('pi-assistant-close-region').hover();
  await assistant.getByRole('button', { name: 'Return to Pi window', exact: true }).click();
  await expect(assistant).toHaveCount(0); await expect(page.getByTestId('window-pi')).toBeVisible();
  await expect(page.getByTestId('pi-prompt')).toHaveText('Keep this revised draft');
  expect(fixture.starts.length).toBe(starts); expect(stops).toEqual([]);
});

test('Chat menus are compact, aligned and keyboard accessible in both themes and sizes', async ({ page }) => {
  await piPage(page); await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('http://localhost:5200'); await page.getByTestId('dock-app-pi').click();
  await expect(page.getByTestId('pi-prompt')).toBeEnabled();
  const group = page.getByRole('navigation', { name: 'Pi projects', exact: true }).locator('.pi-project-group').first();
  for (const width of [1440, 390]) for (const colorScheme of ['light', 'dark'] as const) {
    await page.setViewportSize({ width, height: 900 }); await page.emulateMedia({ colorScheme });
    const heading = (await group.locator('.pi-project-row > span').boundingBox())!;
    const chat = group.getByRole('button', { name: 'Project notes', exact: true });
    expect((await chat.locator('span').boundingBox())!.x).toBe(heading.x);
    expect((await chat.boundingBox())!.height).toBeLessThanOrEqual(30);
    const trigger = group.getByRole('button', { name: 'Chat options for Project notes' });
    await trigger.focus(); await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitem', { name: 'Rename', exact: true })).toBeFocused();
    await expect(page.getByRole('menuitem', { name: 'Archive', exact: true })).toBeVisible();
    await page.screenshot({ path: `/tmp/lumo-chat-menu-${width}-${colorScheme}.png`, animations: 'disabled' });
    await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
  }
});

test('An idle assistant keeps its position and draft while another chat is selected', async ({ page }) => {
  await piPage(page); await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 900 });
  const stopped: string[] = [];
  await page.route('**/api/v1/pi/stop', (route) => { stopped.push(route.request().postDataJSON().id); return route.fulfill({ json: { ok: true, data: { closed: true } } }); });
  await page.goto('http://localhost:5200'); await page.getByTestId('dock-app-pi').click();
  await expect(page.getByTestId('pi-prompt')).toBeEnabled();
  await page.getByTestId('pi-prompt').fill('A draft in assistant mode');
  await options(page, 'Project notes'); await page.getByRole('menuitem', { name: 'Move to assistant window' }).click();
  const assistant = page.getByTestId('pi-chat-assistant');
  const handle = (await assistant.getByTestId('pi-assistant-drag-handle').boundingBox())!;
  await page.mouse.move(handle.x + 25, handle.y + 12); await page.mouse.down(); await page.mouse.move(handle.x - 75, handle.y - 68, { steps: 6 }); await page.mouse.up();
  const position = await assistant.boundingBox();
  await page.getByRole('navigation', { name: 'Pi projects', exact: true }).getByRole('button', { name: 'Earlier work', exact: true }).click();
  await expect(page.getByTestId('pi-prompt')).toBeEnabled();
  expect(await assistant.boundingBox()).toEqual(position);
  await expect(assistant.getByTestId('pi-compact-prompt')).toHaveValue('A draft in assistant mode');
  expect(stopped).toEqual([]);
  await assistant.getByTestId('pi-compact-prompt').press('Escape');
  await expect(assistant).toHaveCount(0);
  await expect(page.getByTestId('pi-prompt')).toHaveText('A draft in assistant mode');
});

test.describe('Touch chat menus', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  test('Running chats keep an accessible menu beside their activity indicator', async ({ page }) => {
    await piPage(page); await page.goto('http://localhost:5200'); await page.getByTestId('dock-app-pi').tap();
    await expect(page.getByTestId('pi-prompt')).toBeEnabled();
    await page.getByTestId('pi-prompt').fill('Work'); await page.getByTestId('pi-send').tap();
    const tree = page.getByRole('navigation', { name: 'Pi projects', exact: true });
    await expect(tree.getByTestId('pi-chat-working')).toBeVisible();
    const trigger = tree.getByRole('button', { name: 'Chat options for Project notes' });
    await expect(trigger).toHaveCSS('opacity', '1'); await trigger.tap();
    await expect(page.getByRole('menuitem', { name: 'Move to assistant window' })).toBeEnabled();
    await expect(page.getByRole('menuitem', { name: 'Archive', exact: true })).toBeDisabled();
  });
});
