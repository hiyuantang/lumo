// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '../offline';
import { splitAttachmentPrompt } from '../../src/apps/piAttachments';
import { piPage } from './pi-fixture';

test('Pi centers a new chat, selects a workspace, and shows file cards and sends read paths without uploading', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  const fixture = await piPage(page);
  const fileMutations: string[] = [];
  await page.route('**/api/v1/files/**', (route) => {
    if (route.request().method() !== 'GET') fileMutations.push(route.request().url());
    const path = new URL(route.request().url()).searchParams.get('path') || '/home/user';
    return route.fulfill({ json: { ok: true, data: { path, entries: [{ name: 'my project', type: 'directory', sizeBytes: 0, modifiedAt: '2026-09-28T00:00:00Z', mode: 493 }, { name: 'design notes.md', type: 'file', sizeBytes: 100, modifiedAt: '2026-09-28T00:00:00Z', mode: 420 }] } } });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('http://localhost:5200'); await page.getByTestId('dock-app-pi').click();
  const prompt = page.getByTestId('pi-prompt');
  await expect(prompt).toBeEnabled();
  await expect(page.getByRole('heading', { name: 'What should we work on?' })).toBeVisible();
  await prompt.fill('Review the design');
  await page.getByRole('combobox', { name: 'Workspace project' }).click();
  await page.getByRole('option', { name: 'Choose another folder…' }).click();
  await page.getByTestId('file-picker-entry-my project').click();
  await page.getByTestId('file-picker-open').click();
  await expect.poll(() => fixture.starts.at(-1)?.project).toBe('/home/user/my project');
  await expect(prompt).toHaveText('Review the design');
  await page.getByRole('button', { name: 'Attach file path' }).click();
  await page.getByTestId('file-picker-entry-design notes.md').dblclick();
  await expect(prompt).toHaveText('Review the design');
  await expect(page.locator('.pi-compose').getByTestId('pi-attachment')).toContainText('design notes.md');
  expect(fileMutations).toEqual([]);
  const attach = (await page.getByRole('button', { name: 'Attach file path' }).boundingBox())!;
  const model = (await page.getByTestId('pi-model').boundingBox())!;
  expect(model.x).toBeGreaterThan(attach.x + attach.width + 40);
  await page.getByTestId('pi-model').click(); await page.getByRole('button', { name: 'Choose model', exact: true }).click(); await page.getByRole('option', { name: 'Fast · Fixture', exact: true }).click();
  await prompt.focus();
  await expect(prompt).toHaveCSS('outline-style', 'none');
  const plus = (await page.getByRole('button', { name: 'Attach file path' }).locator('svg').boundingBox())!;
  expect(Math.abs(plus.x + plus.width / 2 - attach.x - attach.width / 2)).toBeLessThan(1);
  expect(Math.abs(plus.y + plus.height / 2 - attach.y - attach.height / 2)).toBeLessThan(1);
  await page.mouse.move(1400, 900);
  await page.screenshot({ path: '/tmp/lumo-pi-compose-light.png', animations: 'disabled' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: '/tmp/lumo-pi-compose-dark.png', animations: 'disabled' });
  await page.getByTestId('pi-send').click();
  await expect(page.getByTestId('pi-messages')).toContainText('Inspecting your project');
  const sent = fixture.commands.find((item) => item.type === 'prompt');
  if (!sent || !('message' in sent)) throw new Error('No prompt sent');
  expect(splitAttachmentPrompt(sent.message)).toMatchObject({ text: 'Review the design', paths: ['/home/user/my project/design notes.md'] });
  await expect(page.locator('.pi-compose').getByTestId('pi-attachment')).toHaveCount(0);
  await expect(page.locator('.pi-message-user').getByTestId('pi-attachment')).toContainText('design notes.md');
  await expect(page.locator('.pi-message-user')).not.toContainText('read:');
  fixture.finish();
  await expect(page.getByTestId('pi-new')).toBeEnabled();
  await page.getByTestId('pi-new').click();
  await expect(page.getByRole('heading', { name: 'What should we work on?' })).toBeVisible();
  await expect(prompt).toHaveText('');
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Attach file path' }).click();
  await page.getByTestId('file-picker-entry-design notes.md').dblclick();
  await page.screenshot({ path: '/tmp/lumo-pi-compose-narrow.png', animations: 'disabled' });
  await expect(page.getByRole('button', { name: 'Attach file path' })).toBeVisible();
  expect(await page.locator('.pi-main').evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  expect(errors).toEqual([]);
});


test('Pi resumes the existing runtime and conversation after a browser refresh', async ({ page }) => {
  const fixture = await piPage(page);
  await page.goto('http://localhost:5200');
  await page.getByTestId('dock-app-pi').click();
  await expect(page.getByTestId('pi-prompt')).toBeEnabled();
  await page.getByTestId('pi-prompt').fill('Keep this conversation');
  await page.getByTestId('pi-send').click();
  await expect(page.getByTestId('pi-messages')).toContainText('Inspecting your project');
  fixture.finish();
  await expect(page.getByTestId('pi-new')).toBeEnabled();
  await page.reload();
  await expect(page.getByTestId('pi-prompt')).toBeEnabled();
  await expect(page.getByTestId('pi-messages')).toContainText('Keep this conversation');
  await expect(page.locator('.pi-message-user')).toHaveCount(1);
  expect(fixture.starts.at(-1)).toMatchObject({ resume: 'fixture-run' });
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click();
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'What should we work on?' })).toBeVisible();
  expect(fixture.starts.at(-1)).not.toHaveProperty('resume');
});


test('Pi keeps removable attachments on failure and restores queued file cards', async ({ page }) => {
  const fixture = await piPage(page);
  const files = ['a long filename with spaces, commas and details.md', 'notes.txt'];
  const fileReads: string[] = [];
  await page.route('**/api/v1/files/**', (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.endsWith('/list') && !url.pathname.endsWith('/locations')) fileReads.push(url.pathname);
    return route.fulfill({ json: { ok: true, data: { path: '/home/user', entries: files.map((name) => ({ name, type: 'file', sizeBytes: 100, modifiedAt: '2026-09-28T00:00:00Z', mode: 420 })) } } });
  });
  await page.goto('http://localhost:5200'); await page.getByTestId('dock-app-pi').click();
  const prompt = page.getByTestId('pi-prompt');
  await expect(prompt).toBeEnabled();
  const add = async (name: string) => {
    await page.getByRole('button', { name: 'Attach file path' }).click();
    await page.getByTestId(`file-picker-entry-${name}`).dblclick();
  };
  await add(files[0]); await add(files[1]); await add(files[0]);
  const cards = page.locator('.pi-compose').getByTestId('pi-attachment');
  await expect(cards).toHaveCount(2);
  expect(Array.from(await cards.first().locator(':scope > span').innerText()).length).toBeLessThanOrEqual(24);
  await expect(cards.first()).toHaveAttribute('title', `/home/user/${files[0]}`);
  await page.getByRole('button', { name: 'Remove notes.txt' }).click();
  await expect(cards).toHaveCount(1);
  await add(files[1]);
  await prompt.fill('Compare the files');
  let reject = true;
  await page.route('**/api/v1/pi/command', (route) => {
    if (reject && route.request().postDataJSON().command.type === 'prompt') {
      reject = false;
      return route.fulfill({ json: { ok: true, data: { success: false, error: 'Fixture failure' } } });
    }
    return route.fallback();
  });
  await page.getByTestId('pi-send').click();
  await expect(page.getByRole('alert')).toContainText('Fixture failure');
  await expect(cards).toHaveCount(2);
  await expect(prompt).toHaveText('Compare the files');
  await page.getByTestId('pi-send').click();
  await expect(cards).toHaveCount(0);
  const sent = fixture.commands.find((item) => item.type === 'prompt');
  if (!sent || !('message' in sent)) throw new Error('No prompt sent');
  expect(splitAttachmentPrompt(sent.message)).toMatchObject({ text: 'Compare the files', paths: [`/home/user/${files[0]}`, '/home/user/notes.txt'] });
  await add(files[1]);
  await page.getByTestId('pi-send').click();
  await expect(page.getByTestId('pi-queued-message')).toBeVisible();
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(cards).toContainText('notes.txt');
  await expect(prompt).toHaveText('');
  await page.getByTestId('pi-new').click();
  await expect(page.getByTestId('pi-prompt')).toBeEnabled();
  await expect(page.getByTestId('server-app-confirm')).toHaveCount(0);
  await expect(cards).toHaveCount(0);
  await page.getByRole('navigation', { name: 'Pi projects', exact: true }).getByRole('button', { name: 'Project notes', exact: true }).click();
  await expect(cards).toContainText('notes.txt');
  expect(fileReads).toEqual([]);
});

test('Changing workspace retains the composer and editable draft while reconnecting', async ({ page }) => {
  const fixture = await piPage(page);
  await page.addInitScript(() => localStorage.setItem('lumo.view.v1:demo:pi:projects', JSON.stringify(['/home/user/other'])));
  await page.goto('http://localhost:5200'); await page.getByTestId('dock-app-pi').click();
  const input = page.getByTestId('pi-prompt'); await expect(input).toBeEnabled();
  await input.fill('Keep my workspace draft');
  const composer = (await page.locator('.pi-compose').elementHandle())!;
  const editor = (await input.elementHandle())!;
  let release!: () => void; let pending = false;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/v1/pi/start', async (route) => { pending = true; await gate; await route.fallback(); });
  try {
    await page.getByRole('combobox', { name: 'Workspace project' }).click();
    await page.getByRole('option', { name: 'other', exact: true }).click();
    await expect.poll(() => pending).toBe(true);
    expect(await composer.evaluate((node) => node.isConnected)).toBe(true);
    expect(await editor.evaluate((node) => node.isConnected)).toBe(true);
    await expect(page.getByTestId('pi-conversation-loading')).toHaveCount(0);
    await expect(page.getByTestId('pi-model')).toContainText('Balanced');
    await expect(input).toHaveText('Keep my workspace draft');
    await expect(input).toBeEnabled(); await input.fill('Keep typing during the workspace change');
    await expect(page.getByTestId('pi-send')).toBeDisabled();
    await input.press('Enter');
    expect(fixture.commands.some((item) => item.type === 'prompt')).toBe(false);
  } finally { release(); }
  await expect(page.getByTestId('pi-send')).toBeEnabled();
  await expect(input).toHaveText('Keep typing during the workspace change');
  expect(await composer.evaluate((node) => node.isConnected)).toBe(true);
  expect(fixture.starts.at(-1)?.project).toBe('/home/user/other');
  expect(fixture.starts.at(-1)?.session).toBeFalsy();
});
