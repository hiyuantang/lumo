// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '../offline';
import { piPage } from './pi-fixture';

test('Pi sidebar groups project chats, paginates, and opens recents in the correct project', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  const fixture = await piPage(page);
  const projects = ['/home/user/projects/lumo', '/home/user/projects/website', '/home/user/projects/a-project-with-a-long-name-that-must-truncate'];
  await page.addInitScript((paths) => { localStorage.setItem('lumo.view.v1:demo:pi:projects', JSON.stringify(paths)); }, projects);
  await page.route('**/api/v1/pi/sessions?**', (route) => {
    const folder = new URL(route.request().url()).searchParams.get('project');
    const names = folder === projects[0] ? ['Review sidebar design', 'Add folder navigation', 'Improve error messages', 'Test server startup', 'Refresh app icons', 'Sixth saved conversation'] : folder === projects[1] ? ['Website deployment', 'Review landing page'] : ['A long conversation title that needs to be displayed on one line without wrapping'];
    return route.fulfill({ json: { ok: true, data: { sessions: names.map((name, index) => ({ id: index === 0 ? 'first.jsonl' : `${index}.jsonl`, name, modified: `2026-09-28T12:0${5 - index}:00Z` })) } } });
  });
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('http://localhost:5200'); await page.getByTestId('dock-app-pi').click();
  await expect(page.getByTestId('pi-prompt')).toBeEnabled();
  await page.getByTestId('pi-project').click(); await page.getByRole('option', { name: 'lumo', exact: true }).click();
  await expect(page.getByTestId('pi-prompt')).toBeEnabled();
  const sidebar = page.getByTestId('pi-sidebar');
  const tree = page.getByRole('navigation', { name: 'Pi projects', exact: true });
  const recent = page.getByRole('navigation', { name: 'Recent Pi chats', exact: true });
  await expect(sidebar.getByTestId('pi-new')).toHaveText('New chat');
  await expect(tree.getByRole('button', { name: 'Sixth saved conversation', exact: true })).toHaveCount(0);
  await tree.getByRole('button', { name: 'Show more', exact: true }).click();
  await expect(tree.getByRole('button', { name: 'Sixth saved conversation', exact: true })).toBeVisible();
  await expect(tree.locator('[aria-current="page"]')).toHaveCount(1);
  await expect(recent.getByRole('button', { name: 'Website deployment', exact: true })).toBeVisible();
  const row = tree.getByRole('button', { name: 'Review sidebar design', exact: true });
  expect((await row.boundingBox())!.height).toBeLessThan(40);
  const parentRow = tree.locator('.pi-project-row[title="/home/user/projects/lumo"]');
  const parentBox = (await parentRow.boundingBox())!;
  expect((await row.boundingBox())!.y - parentBox.y - parentBox.height).toBeGreaterThanOrEqual(4);
  await parentRow.hover();
  await expect(parentRow).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(parentRow.locator('svg')).toHaveCSS('opacity', '1');
  await expect(tree.locator('[aria-expanded]')).toHaveCount(0);
  await expect(sidebar.getByRole('button', { name: 'Add project', exact: true })).toHaveCount(0);
  await page.screenshot({ animations: 'disabled', path: '/tmp/lumo-pi-sidebar-light.png' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ animations: 'disabled', path: '/tmp/lumo-pi-sidebar-dark.png' });
  await recent.getByRole('button', { name: 'Website deployment', exact: true }).click();
  await expect.poll(() => fixture.starts.at(-1)?.project).toBe(projects[1]);
  expect(fixture.starts.at(-1)?.session).toBe('first.jsonl');
  await expect(tree.locator('.pi-project-row[title="/home/user/projects/website"]')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ animations: 'disabled', path: '/tmp/lumo-pi-sidebar-narrow.png' });
  await expect(page.getByRole('button', { name: 'Collapse sidebar', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click();
  await expect(sidebar).toHaveClass(/is-collapsed/);
  await expect(sidebar.getByRole('button', { name: 'New chat', exact: true })).toBeVisible();
  await expect(page.getByTestId('pi-settings-button')).toBeVisible();
  await page.screenshot({ animations: 'disabled', path: '/tmp/lumo-pi-rail-narrow.png' });
  await page.getByTestId('pi-settings-button').click();
  await expect(page.getByTestId('pi-settings')).toBeVisible();
  await expect(page.getByTestId('pi-sidebar')).toHaveCount(0);
  await page.getByTestId('pi-home-button').click();
  await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click();
  await expect(tree.locator('.pi-project-row[title="/home/user/projects/website"]')).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click();
  const movement = await sidebar.evaluate(async (node) => {
    const start = node.getBoundingClientRect().width;
    const animations = node.getAnimations();
    await Promise.all(animations.map((animation) => animation.finished));
    return { start, end: node.getBoundingClientRect().width, animated: animations.length > 0 };
  });
  expect(movement.animated).toBe(true);
  expect(movement.start).toBeGreaterThan(movement.end);
  expect(movement.end).toBe(52);
  await page.screenshot({ animations: 'disabled', path: '/tmp/lumo-pi-rail-dark.png' });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.screenshot({ animations: 'disabled', path: '/tmp/lumo-pi-rail-light.png' });
  expect(errors).toEqual([]);
});


test('Pi keeps project conversations visible while switching sessions', async ({ page }) => {
  const fixture = await piPage(page);
  await page.goto('http://localhost:5200');
  await page.getByTestId('dock-app-pi').click();
  await expect(page.getByTestId('pi-prompt')).toBeEnabled();
  const tree = page.getByRole('navigation', { name: 'Pi projects', exact: true });
  const rows = tree.locator('.pi-chat-row');
  const before = await rows.allTextContents();
  expect(before.length).toBeGreaterThan(1);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/v1/pi/start', async (route) => { await gate; await route.fallback(); });
  await tree.getByRole('button', { name: 'Earlier work', exact: true }).click();
  await expect(page.getByTestId('pi-prompt')).toBeDisabled();
  await expect(rows).toHaveText(before);
  await expect(tree.getByText('No chats yet')).toHaveCount(0);
  await expect(tree.getByRole('button', { name: 'Earlier work', exact: true })).toHaveAttribute('aria-current', 'page');
  release();
  await expect(page.getByTestId('pi-prompt')).toBeEnabled();
  await expect(rows).toHaveText(before);
  expect(fixture.starts.at(-1)).toMatchObject({ session: 'second.jsonl' });
});


test('Pi keeps all workspace chats visible despite old collapsed preferences', async ({ page }) => {
  await piPage(page);
  await page.addInitScript(() => {
    localStorage.setItem('lumo.view.v1:demo:pi:projects', JSON.stringify(['/home/user', '/home/user/projects/website']));
    localStorage.setItem('lumo.view.v1:demo:pi:expanded-projects', '[]');
  });
  await page.goto('http://localhost:5200');
  await page.getByTestId('dock-app-pi').click();
  const tree = page.getByRole('navigation', { name: 'Pi projects', exact: true });
  for (let pass = 0; pass < 2; pass++) {
    await expect(page.getByTestId('pi-prompt')).toBeEnabled();
    await expect(tree.locator('.pi-project-group')).toHaveCount(2);
    for (const group of await tree.locator('.pi-project-group').all()) {
      await expect(group.getByRole('button', { name: 'Earlier work', exact: true })).toBeVisible();
      await expect(group.locator('[aria-expanded]')).toHaveCount(0);
    }
    if (pass === 0) await page.reload();
  }
});

test('Pi animates Recents and remembers its expansion across reopen and refresh', async ({ page }) => {
  await piPage(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('http://localhost:5200');
  await page.getByTestId('dock-app-pi').click();
  await expect(page.getByTestId('pi-prompt')).toBeEnabled();
  const recents = page.getByRole('navigation', { name: 'Recent Pi chats' });
  const recentToggle = page.getByTestId('pi-recents-toggle');
  const recentPanel = recents.locator('.pi-disclosure');
  for (const [toggle, panel] of [[recentToggle, recentPanel]]) {
    await expect(panel).toHaveCSS('opacity', '1');
    for (const expand of [false, true]) {
      await toggle.click();
      const motion = await panel.evaluate(async (node) => {
        const start = node.getBoundingClientRect().height;
        const animations = node.getAnimations();
        await Promise.all(animations.map((animation) => animation.finished));
        return { start, end: node.getBoundingClientRect().height, animated: animations.length > 0 };
      });
      expect(motion.animated).toBe(true);
      expect(expand ? motion.end > motion.start : motion.start > motion.end).toBe(true);
      await expect(toggle).toHaveAttribute('aria-expanded', String(expand));
    }
  }
  await recentToggle.click();
  await expect(recents.getByRole('button', { name: 'Earlier work', exact: true })).toHaveCount(0);
  await expect(recentPanel).toHaveAttribute('inert', '');
  await page.getByTestId('window-close-pi').click();
  await page.getByTestId('dock-app-pi').click();
  await expect(page.getByTestId('pi-prompt')).toBeEnabled();
  await expect(recentToggle).toHaveAttribute('aria-expanded', 'false');
  await page.reload();
  await expect(page.getByTestId('pi-prompt')).toBeEnabled();
  await expect(recentToggle).toHaveAttribute('aria-expanded', 'false');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await recentPanel.evaluate((node) => parseFloat(getComputedStyle(node).transitionDuration))).toBeLessThan(.001);
  await recentToggle.click();
  await recents.getByRole('button', { name: 'Earlier work', exact: true }).click();
  await expect(page.getByTestId('pi-messages')).toContainText('Earlier saved conversation');
  await expect(page.locator('.pi-main > .pi-toolbar')).toHaveCount(0);
  await page.screenshot({ path: '/tmp/lumo-pi-sidebar-clean-light.png', animations: 'disabled' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: '/tmp/lumo-pi-sidebar-clean-dark.png', animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '/tmp/lumo-pi-sidebar-clean-narrow.png', animations: 'disabled' });
  await page.reload();
  await expect(page.getByTestId('pi-prompt')).toBeEnabled();
  await expect(recentToggle).toHaveAttribute('aria-expanded', 'true');
});
