// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '../offline';
import { piPage } from './pi-fixture';

test('Pi workspace hover controls rename its label, reveal its folder and start a chat there', async ({ page }) => {
  const fixture = await piPage(page);
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript(() => localStorage.setItem('lumo.view.v1:demo:pi:projects', JSON.stringify(['/home/user/second-workspace'])));
  const folderRequests: string[] = [];
  await page.route('**/api/v1/files/**', (route) => {
    const path = new URL(route.request().url()).searchParams.get('path') || '/home/user'; folderRequests.push(path);
    return route.fulfill({ json: { ok: true, data: { path, entries: [] } } });
  });
  await page.goto('http://localhost:5200'); await page.getByTestId('dock-app-pi').click();
  await expect(page.getByTestId('pi-prompt')).toBeEnabled();
  const projects = page.getByRole('navigation', { name: 'Pi projects', exact: true });
  const row = projects.locator('.pi-project-row').filter({ hasText: 'second-workspace' });
  await row.hover();
  const options = projects.getByRole('button', { name: 'Workspace options for second-workspace' });
  const newChat = projects.getByRole('button', { name: 'New chat in second-workspace', exact: true });
  await expect(options).toHaveCSS('pointer-events', 'auto');
  expect((await options.boundingBox())!.x).toBeGreaterThan((await row.boundingBox())!.x + 80);
  expect((await newChat.boundingBox())!.x).toBeGreaterThan((await options.boundingBox())!.x);
  await options.click();
  await expect(page.getByRole('menuitem', { name: 'Edit name' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Reveal in Files' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Archive chats' })).toBeVisible();
  await page.screenshot({ path: '/tmp/lumo-pi-workspace-menu-light.png', animations: 'disabled' });
  await page.getByRole('menuitem', { name: 'Edit name' }).click();
  await page.getByRole('textbox', { name: 'Workspace name' }).fill('Research');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(projects.locator('.pi-project-row').filter({ hasText: 'Research' })).toHaveAttribute('title', '/home/user/second-workspace');
  await page.getByRole('button', { name: 'Workspace options for Research' }).click();
  await page.getByRole('menuitem', { name: 'Reveal in Files' }).click();
  await expect.poll(() => folderRequests.includes('/home/user/second-workspace')).toBe(true);
  await page.getByTestId('dock-app-pi').click();
  await page.getByTestId('pi-prompt').fill('Keep my current draft');
  await page.getByRole('button', { name: 'New chat in Research', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(page.getByTestId('pi-prompt')).toHaveText('');
  await expect.poll(() => fixture.starts.at(-1)?.project).toBe('/home/user/second-workspace');
  expect(fixture.starts.at(-1)?.session).toBe('');
  await expect(page.getByTestId('pi-project')).toContainText('Research');
  await page.reload(); await expect(page.getByTestId('pi-prompt')).toBeEnabled();
  await expect(projects.locator('.pi-project-row').filter({ hasText: 'Research' })).toBeVisible();
  await projects.locator('.pi-project-row').filter({ hasText: 'Research' }).hover();
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: '/tmp/lumo-pi-workspace-dark.png', animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '/tmp/lumo-pi-workspace-narrow.png', animations: 'disabled' });
  expect(errors).toEqual([]);
});

test('Pi archives only the selected workspace chats and reopens once without losing its draft', async ({ page }) => {
  const fixture = await piPage(page); const moved: string[] = [];
  await page.route('**/api/v1/pi/sessions?**', (route) => route.fulfill({ json: { ok: true, data: { sessions: [{ id: 'first.jsonl', name: 'First', modified: '2026-09-28' }, { id: 'second.jsonl', name: 'Second', modified: '2026-09-27' }].filter((item) => !moved.includes(item.id)) } } }));
  await page.route('**/api/v1/pi/sessions/archive', (route) => {
    const body = route.request().postDataJSON(); expect(body.project).toBe('/home/user'); moved.push(body.session);
    return route.fulfill({ json: { ok: true, data: { moved: true } } });
  });
  await page.goto('http://localhost:5200'); await page.getByTestId('dock-app-pi').click();
  await expect(page.getByTestId('pi-prompt')).toBeEnabled();
  await page.getByTestId('pi-prompt').fill('Keep this draft');
  await page.getByRole('button', { name: 'Workspace options for user', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Archive chats', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toContainText('2 saved conversations');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click(); expect(moved).toEqual([]);
  await page.getByRole('button', { name: 'Workspace options for user', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Archive chats', exact: true }).click();
  await page.getByRole('button', { name: 'Archive 2 chats', exact: true }).click();
  await expect.poll(() => moved.length).toBe(2);
  await expect(page.getByTestId('pi-prompt')).toBeEnabled();
  await expect(page.getByTestId('pi-prompt')).toHaveText('Keep this draft');
  await expect(page.getByRole('navigation', { name: 'Pi projects', exact: true })).toContainText('No chats yet');
  await expect(page.getByRole('navigation', { name: 'Recent Pi chats' })).toContainText('No recent chats');
  expect(fixture.starts).toHaveLength(2); expect(fixture.starts.at(-1)?.session).toBe('');
});

test('Removing an inactive workspace archives every current chat and stays removed after reload', async ({ page }) => {
  const fixture = await piPage(page);
  const folder = '/home/user/old-project';
  const archived: string[] = [];
  let count = 8;
  await page.addInitScript(() => { const key = 'lumo.view.v1:demo:pi:projects'; if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(['/home/user/old-project'])); });
  await page.route('**/api/v1/pi/sessions?**', (route) => new URL(route.request().url()).searchParams.get('project') === folder ? route.fulfill({ json: { ok: true, data: { sessions: Array.from({ length: count }, (_, index) => ({ id: `old-${index}.jsonl`, name: `Old chat ${index}`, modified: '2026-09-28' })).filter((item) => !archived.includes(item.id)) } } }) : route.fallback());
  await page.route('**/api/v1/pi/sessions/archive', (route) => { const body = route.request().postDataJSON(); expect(body.project).toBe(folder); archived.push(body.session); return route.fulfill({ json: { ok: true, data: { moved: true } } }); });
  await page.goto('http://localhost:5200'); await page.getByTestId('dock-app-pi').click();
  await expect(page.getByTestId('pi-prompt')).toBeEnabled();
  await page.getByRole('button', { name: 'Workspace options for old-project', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Remove workspace', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toContainText('archive all its chats');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click(); expect(archived).toEqual([]);
  await page.getByRole('button', { name: 'Workspace options for old-project', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Remove workspace', exact: true }).click();
  count = 9;
  await page.getByRole('button', { name: 'Remove workspace', exact: true }).click();
  await expect.poll(() => archived.length).toBe(9);
  await expect(page.getByRole('button', { name: 'Workspace options for old-project', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Workspace options for user', exact: true })).toBeVisible();
  expect(fixture.starts).toHaveLength(1);
  await page.reload(); await expect(page.getByTestId('pi-prompt')).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Workspace options for old-project', exact: true })).toHaveCount(0);
});

test('Removing the current workspace preserves the draft and does not bring the workspace back on reload', async ({ page }) => {
  const fixture = await piPage(page); const archived: string[] = [];
  await page.route('**/api/v1/pi/sessions?**', (route) => route.fulfill({ json: { ok: true, data: { sessions: [{ id: 'first.jsonl', name: 'First', modified: '2026-09-28' }, { id: 'second.jsonl', name: 'Second', modified: '2026-09-27' }].filter((item) => !archived.includes(item.id)) } } }));
  await page.route('**/api/v1/pi/sessions/archive', (route) => { archived.push(route.request().postDataJSON().session); return route.fulfill({ json: { ok: true, data: { moved: true } } }); });
  await page.goto('http://localhost:5200'); await page.getByTestId('dock-app-pi').click();
  await expect(page.getByTestId('pi-prompt')).toBeEnabled(); await page.getByTestId('pi-prompt').fill('Keep my draft');
  await page.getByRole('button', { name: 'Workspace options for user', exact: true }).click(); await page.getByRole('menuitem', { name: 'Remove workspace', exact: true }).click();
  await page.getByRole('button', { name: 'Remove workspace', exact: true }).click();
  await expect.poll(() => archived.length).toBe(2);
  await expect(page.getByTestId('pi-prompt')).toBeEnabled(); await expect(page.getByTestId('pi-prompt')).toHaveText('Keep my draft');
  await expect(page.locator('.pi-project-group')).toHaveCount(0);
  expect(fixture.starts).toHaveLength(2);
  await page.reload(); await expect(page.getByTestId('pi-prompt')).toBeEnabled(); await expect(page.locator('.pi-project-group')).toHaveCount(0);
  await page.getByTestId('pi-prompt').fill('Start a new conversation here'); await page.getByTestId('pi-send').click();
  await expect(page.locator('.pi-project-group')).toHaveCount(1);
});

test('A partial archive failure keeps the workspace and lets removal retry the remaining chats', async ({ page }) => {
  await piPage(page); const archived: string[] = []; let fail = true;
  await page.route('**/api/v1/pi/sessions?**', (route) => route.fulfill({ json: { ok: true, data: { sessions: [{ id: 'first.jsonl', name: 'First', modified: '2026-09-28' }, { id: 'second.jsonl', name: 'Second', modified: '2026-09-27' }].filter((item) => !archived.includes(item.id)) } } }));
  await page.route('**/api/v1/pi/sessions/archive', (route) => { const id = route.request().postDataJSON().session; if (id === 'second.jsonl' && fail) return route.fulfill({ status: 409, json: { ok: false, error: { message: 'Chat is open in another Pi window' } } }); archived.push(id); return route.fulfill({ json: { ok: true, data: { moved: true } } }); });
  await page.goto('http://localhost:5200'); await page.getByTestId('dock-app-pi').click();
  await expect(page.getByTestId('pi-prompt')).toBeEnabled();
  const remove = async () => { await page.getByRole('button', { name: 'Workspace options for user', exact: true }).click(); await page.getByRole('menuitem', { name: 'Remove workspace', exact: true }).click(); await page.getByRole('button', { name: 'Remove workspace', exact: true }).click(); };
  await remove();
  await expect(page.getByRole('alert')).toContainText('workspace was kept');
  await expect(page.getByRole('button', { name: 'Workspace options for user', exact: true })).toBeEnabled();
  expect(archived).toEqual(['first.jsonl']);
  fail = false; await remove();
  await expect(page.locator('.pi-project-group')).toHaveCount(0);
  expect(archived).toEqual(['first.jsonl', 'second.jsonl']);
});

test('Restoring after workspace removal opens the restored file instead of an unsaved placeholder', async ({ page }) => {
  await piPage(page);
  const items = [{ id: 'first.jsonl', name: 'First saved chat', project: '/home/user', modified: '2026-09-28' }, { id: 'second.jsonl', name: 'Second saved chat', project: '/home/user', modified: '2026-09-27' }];
  const archived = new Set<string>(); const starts: string[] = []; let active = '';
  await page.route('**/api/v1/pi/sessions?**', (route) => route.fulfill({ json: { ok: true, data: { sessions: items.filter((item) => !archived.has(item.id)) } } }));
  await page.route('**/api/v1/pi/sessions/archived', (route) => route.fulfill({ json: { ok: true, data: { sessions: items.filter((item) => archived.has(item.id)) } } }));
  for (const action of ['archive', 'restore']) await page.route(`**/api/v1/pi/sessions/${action}`, (route) => { const id = route.request().postDataJSON().session; if (action === 'archive') archived.add(id); else archived.delete(id); return route.fulfill({ json: { ok: true, data: { moved: true } } }); });
  await page.route('**/api/v1/pi/start', (route) => {
    const body = route.request().postDataJSON(); starts.push(body.session);
    if (body.session && (!items.some((item) => item.id === body.session) || archived.has(body.session))) return route.fulfill({ status: 404, json: { ok: false, error: { code: 'NOT_FOUND', message: 'Saved session is unavailable.' } } });
    active = body.session || `unsaved-${starts.length}.jsonl`;
    return route.fulfill({ json: { ok: true, data: { id: 'fixture-run', project: '/home/user' } } });
  });
  await page.route('**/api/v1/pi/command', (route) => {
    const command = route.request().postDataJSON().command.type;
    if (command === 'get_state') return route.fulfill({ json: { ok: true, data: { success: true, data: { sessionFile: `/sessions/${active}`, sessionName: 'Current', isStreaming: false } } } });
    if (command === 'get_messages') return route.fulfill({ json: { ok: true, data: { success: true, eventCursor: 0, data: { messages: active === 'second.jsonl' ? [{ role: 'user', content: 'Restored request' }, { role: 'assistant', content: 'Restored answer', stopReason: 'stop' }] : [] } } } });
    return route.fallback();
  });
  await page.goto('http://localhost:5200'); await page.getByTestId('dock-app-pi').click(); await expect(page.getByTestId('pi-prompt')).toBeEnabled();
  await page.getByTestId('pi-prompt').fill('Keep this draft');
  await page.getByRole('button', { name: 'Workspace options for user', exact: true }).click(); await page.getByRole('menuitem', { name: 'Remove workspace', exact: true }).click(); await page.getByRole('button', { name: 'Remove workspace', exact: true }).click();
  await expect(page.locator('.pi-project-group')).toHaveCount(0); await expect(page.getByTestId('pi-prompt')).toBeEnabled();
  await page.getByTestId('pi-settings-button').click(); await page.getByRole('tab', { name: 'Archived chats' }).click();
  await page.getByTestId('pi-archived').locator('li').filter({ hasText: 'Second saved chat' }).getByRole('button', { name: 'Restore', exact: true }).click();
  await expect.poll(() => starts.at(-1)).toBe('second.jsonl');
  await page.getByTestId('pi-home-button').click();
  await expect(page.getByTestId('pi-prompt')).toBeEnabled(); await expect(page.getByTestId('pi-prompt')).toHaveText('Keep this draft');
  await expect(page.getByTestId('pi-messages')).toContainText('Restored answer');
  await expect(page.getByRole('navigation', { name: 'Pi projects', exact: true }).getByRole('button', { name: 'Second saved chat', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(archived).toEqual(new Set(['first.jsonl']));
  expect(starts).toEqual(['', '', 'second.jsonl']);
});

test('A failed Pi start still lists saved chats so another conversation can be opened', async ({ page }) => {
  await piPage(page); let fail = true;
  await page.route('**/api/v1/pi/start', (route) => { if (!fail) return route.fallback(); fail = false; return route.fulfill({ status: 404, json: { ok: false, error: { code: 'NOT_FOUND', message: 'Saved session is unavailable.' } } }); });
  await page.goto('http://localhost:5200'); await page.getByTestId('dock-app-pi').click();
  await expect(page.getByRole('alert')).toContainText('Saved session is unavailable');
  await page.getByRole('navigation', { name: 'Pi projects', exact: true }).getByRole('button', { name: 'Earlier work', exact: true }).click();
  await expect(page.getByTestId('pi-messages')).toContainText('Earlier saved conversation');
  await expect(page.getByRole('alert')).toHaveCount(0);
});
