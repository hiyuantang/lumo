// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect, type Page } from '../offline';

async function open(page: Page) {
  await page.goto('/');
  await expect(page).toHaveTitle(/Lumo/);
  await page.getByTestId('login-username').fill('demo');
  await page.getByTestId('login-password').fill('demo');
  await page.getByTestId('login-submit').click();
  await page.getByTestId('dock-app-git').click();
  await expect(page.getByTestId('git-toolbar')).toContainText('No repository open');
  await expect(page.getByTestId('git-branch')).toHaveCount(0);
  await expect(page.getByTestId('git-fetch')).toHaveCount(0);
  await expect(page.getByTestId('git-repository')).toBeEnabled();
  await expect(page.getByTestId('git-open')).toHaveCount(0);
  await page.screenshot({ path: '/tmp/lumo-git-toolbar-empty.png', animations: 'disabled' });
  await page.getByTestId('git-demo').click();
  await expect(page.getByTestId('git-file-src/agent.ts')).toBeVisible();
}

test('Git stages selected files, commits, and shows history without losing other changes', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  await open(page);
  await expect(page.getByTestId('git-file-src/agent.ts').getByRole('img', { name: 'Modified', exact: true })).toBeVisible();
  await expect(page.getByTestId('git-file-tests/metrics.test.ts').getByRole('img', { name: 'New', exact: true })).toBeVisible();
  await expect(page.getByTestId('git-file-src/agent.ts')).toHaveText('src/agent.ts');
  await expect(page.getByTestId('git-commit')).toBeDisabled();
  await expect(page.getByTestId('git-diff')).toContainText('os.freemem()');
  await page.getByTestId('git-stage-src/agent.ts').check();
  await expect(page.getByTestId('git-stage-src/agent.ts')).toBeChecked();
  await page.getByTestId('git-summary').fill('Add available memory');
  await page.getByTestId('git-description').fill('Keep the total and available memory together.');
  await expect(page.getByTestId('git-commit')).toBeEnabled();
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.screenshot({ path: `/tmp/lumo-git-${theme}.png`, animations: 'disabled' });
  }
  await page.getByTestId('git-commit').click();
  await expect(page.getByTestId('git-file-src/agent.ts')).toHaveCount(0);
  await expect(page.getByTestId('git-file-README.md')).toBeVisible();
  await expect(page.getByTestId('git-summary')).toHaveValue('');
  await page.getByTestId('git-tab-history').click();
  await expect(page.locator('.git-commit-row').first()).toContainText('Add available memory');
  await expect(page.locator('.git-commit-body')).toContainText('Keep the total');
  await page.getByTestId('git-tab-changes').click();
  await page.getByLabel('Filter changed files').fill('README');
  await expect(page.getByTestId('git-file-tests/metrics.test.ts')).toHaveCount(0);
  await page.getByTestId('git-refresh').click();
  await expect(page.getByLabel('Filter changed files')).toHaveValue('README');
  expect(errors).toEqual([]);
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
});

test('Git creates branches after a clean commit and explicitly confirms publishing', async ({ page }) => {
  await open(page);
  for (const name of ['src/agent.ts', 'README.md', 'tests/metrics.test.ts']) {
    await page.getByTestId(`git-stage-${name}`).check();
    await expect(page.getByTestId(`git-stage-${name}`)).toBeChecked();
  }
  await page.getByTestId('git-summary').fill('Prepare branch');
  await page.getByTestId('git-commit').click();
  await expect(page.getByText('Your working tree is clean. New edits will appear here.')).toBeVisible();
  await page.getByTestId('git-branch').click();
  await page.getByTestId('git-new-branch').click();
  await page.getByTestId('git-branch-name').fill('feature/new-work');
  await page.getByTestId('server-app-confirm-ok').click();
  await expect(page.getByTestId('git-branch')).toContainText('feature/new-work');
  await expect(page.getByTestId('git-push')).toHaveText('Publish branch');
  await expect(page.getByTestId('git-sync-options')).toBeVisible();
  await page.getByTestId('git-sync-options').click();
  await page.getByTestId('git-fetch-menu').click();
  await expect(page.getByRole('status')).toContainText('Fetched origin.');
  await page.getByTestId('git-push').click();
  await expect(page.getByRole('alertdialog')).toContainText('origin/feature/new-work');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByTestId('git-push').click();
  await page.getByTestId('server-app-confirm-ok').click();
  await expect(page.getByRole('status')).toContainText('Push completed.');
});

test('Git protects a draft and keeps controls reachable on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await page.getByTestId('git-summary').fill('Draft to keep');
  await page.getByRole('button', { name: 'Close Git', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toContainText('Discard commit draft?');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByTestId('git-summary')).toHaveValue('Draft to keep');
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    expect(await page.getByTestId('app-git').evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await expect(page.getByTestId('git-commit')).toBeInViewport();
    await page.screenshot({ path: `/tmp/lumo-git-narrow-${theme}.png`, animations: 'disabled' });
  }
  await page.getByTestId('git-tab-history').click();
  await expect(page.locator('.git-commit-row').first()).toBeInViewport();
});

test('Git opens existing folders and uses the same App Library update flow', async ({ page }) => {
  await open(page);
  await page.getByTestId('git-repository').press('ArrowDown');
  await expect(page.getByRole('menuitemradio', { name: 'lumo-agent', exact: true })).toHaveAttribute('aria-checked', 'true');
  await page.screenshot({ path: '/tmp/lumo-git-repository-menu.png', animations: 'disabled' });
  await page.getByTestId('git-open').click();
  await page.getByTestId('file-picker-entry-projects').dblclick();
  await page.getByTestId('file-picker-entry-lumo-agent').click();
  await page.getByTestId('file-picker-open').click();
  await expect(page.getByTestId('git-repository')).toContainText('lumo-agent');
  await page.locator('[data-menu-button=app]').click();
  await page.getByRole('menuitem', { name: 'Check for Updates…', exact: true }).click();
  await expect(page.getByTestId('library-update-git')).toContainText('2.43.0 → 2.43.1');
  await page.getByTestId('library-update-git').getByRole('button', { name: 'Update', exact: true }).click();
  await expect(page.getByTestId('library-update-git')).toHaveCount(0);
  await expect(page.getByTestId('library-history')).toContainText('Git updated');
});

test('Git uninstall and install reuse App Library and restore the dock entry', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Close Git', exact: true }).click();
  await page.getByTestId('dock-app-library').click();
  await page.getByTestId('library-git').click();
  await expect(page.getByTestId('library-primary')).toHaveText('Uninstall');
  await page.getByTestId('library-primary').click();
  await expect(page.getByTestId('uninstall-normal')).toBeChecked();
  await expect(page.getByRole('alertdialog')).toContainText('Repositories, SSH keys and account Git settings are preserved.');
  await page.getByTestId('server-app-confirm-ok').click();
  await expect(page.getByTestId('library-primary')).toHaveText('Install');
  await expect(page.getByTestId('dock-app-git')).toHaveCount(0);
  await page.getByTestId('library-primary').click();
  await expect(page.getByTestId('library-primary')).toHaveText('Uninstall');
  await expect(page.getByTestId('dock-app-git')).toBeVisible();
});

test('A stale live repository preserves the commit draft and refreshes before retry', async ({ page }) => {
  let revision = 'old'; let called = 0;
  await page.routeWebSocket(/\/api\/v1\/ws/, () => {});
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/git/action')) {
      called++;
      const body = route.request().postDataJSON();
      expect(body.action).toBe('commit');
      expect(body.message).toBe('Keep my draft');
      if (called === 1) { revision = 'fresh'; return route.fulfill({ status: 409, json: { ok: false, error: { code: 'stale_revision', message: 'The repository changed. Refresh and review the changes before trying again.' } } }); }
      expect(body.revision).toBe('fresh');
      return route.fulfill({ json: { ok: true, data: { done: true } } });
    }
    const data = path.endsWith('/auth/session') ? { user: { name: 'demo', uid: 1000, gid: 1000, home: '/home/user' } }
      : path.endsWith('/apps') ? { canInstall: true, apps: [{ id: 'git', installed: true }] }
      : path.endsWith('/git/repository') ? { path: '/home/user/project', branch: 'main', head: 'a'.repeat(40), revision, upstream: '', ahead: 0, behind: 0, branches: ['main'], remotes: [], operation: '', history: [], files: called > 1 ? [] : [{ path: 'notes.md', index: 'M', worktree: ' ', conflict: false }] }
      : path.endsWith('/git/diff') ? { text: '@@ -1 +1 @@\n-old\n+new', truncated: false } : {};
    return route.fulfill({ json: { ok: true, data } });
  });
  await page.addInitScript(() => {
    localStorage.setItem('lumo.view.v1:demo:git:recent', JSON.stringify(['/home/user/project']));
  });
  await page.goto('http://localhost:5200');
  await page.getByTestId('dock-app-git').click();
  await page.getByTestId('git-repository').click();
  await page.getByRole('menuitemradio', { name: 'project', exact: true }).click();
  await page.getByTestId('git-summary').fill('Keep my draft');
  await page.getByTestId('git-commit').click();
  await expect(page.getByRole('alert')).toContainText('The repository changed.');
  await expect(page.getByTestId('git-summary')).toHaveValue('Keep my draft');
  await expect(page.getByTestId('git-commit')).toBeDisabled();
  await page.getByTestId('git-refresh').click();
  await expect(page.getByTestId('git-commit')).toBeEnabled();
  await page.getByTestId('git-commit').click();
  await expect(page.getByTestId('git-summary')).toHaveValue('');
  await expect(page.getByRole('status')).toContainText('Commit created.');
  expect(called).toBe(2);
});

test('Git branch panel searches, tracks remote branches, and confirms merges', async ({ page }) => {
  await open(page);
  await page.getByTestId('git-branch').press('ArrowDown');
  const panel = page.getByRole('dialog', { name: 'Branches', exact: true });
  await expect(page.getByRole('textbox', { name: 'Filter branches' })).toBeFocused();
  await expect(panel).toContainText('Local branches');
  await expect(panel).toContainText('Remote branches');
  await expect(panel.getByRole('button', { name: 'Switch to main', exact: true })).toHaveAttribute('aria-current', 'true');
  await expect(panel.getByTestId('git-new-branch')).toBeDisabled();
  await expect(panel).toContainText('Commit or stash changes');
  await page.getByRole('textbox', { name: 'Filter branches' }).press('Escape');
  for (const name of ['src/agent.ts', 'README.md', 'tests/metrics.test.ts']) {
    await page.getByTestId(`git-stage-${name}`).check();
    await expect(page.getByTestId(`git-stage-${name}`)).toBeChecked();
  }
  await page.getByTestId('git-summary').fill('Prepare branch operations');
  await page.getByTestId('git-commit').click();
  await expect(page.getByText('Your working tree is clean. New edits will appear here.')).toBeVisible();
  await page.getByTestId('git-branch').click();
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.screenshot({ path: `/tmp/lumo-git-branches-${theme}.png`, animations: 'disabled' });
  }
  const filter = page.getByRole('textbox', { name: 'Filter branches' });
  await filter.fill('absent-branch');
  await expect(panel).toContainText('No branches match');
  await filter.fill('logs');
  await expect(panel.getByRole('button', { name: 'Switch to origin/feature/logs', exact: true })).toBeVisible();
  await filter.press('ArrowDown');
  await expect(panel.getByRole('button', { name: 'Switch to origin/feature/logs', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('git-branch')).toHaveText('feature/logs');
  await expect(page.locator('.git-footer')).toContainText('origin/feature/logs');
  await page.getByTestId('git-branch').click();
  await page.getByTestId('git-merge-choose').click();
  const mergePanel = page.getByRole('dialog', { name: 'Merge into feature/logs', exact: true });
  await expect(mergePanel.getByRole('button', { name: 'Merge feature/logs', exact: true })).toHaveCount(0);
  await mergePanel.getByRole('button', { name: 'Merge feature/metrics', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toContainText('Merge feature/metrics into feature/logs');
  await page.getByTestId('server-app-confirm-ok').click();
  await expect(page.getByRole('status')).toContainText('Branch merged.');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId('git-branch').click();
  const box = (await panel.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: '/tmp/lumo-git-branches-narrow.png', animations: 'disabled' });
  await filter.press('Escape');
  await expect(page.getByTestId('git-branch')).toBeFocused();
});

test('Git exposes abort after a conflicted merge and confirms discarding resolution edits', async ({ page }) => {
  let conflicted = false;
  const calls: string[] = [];
  await page.routeWebSocket(/\/api\/v1\/ws/, () => {});
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/git/action')) {
      const body = route.request().postDataJSON(); calls.push(body.action);
      if (body.action === 'merge') { conflicted = true; return route.fulfill({ status: 409, json: { ok: false, error: { code: 'conflict', message: 'Automatic merge failed.' } } }); }
      expect(body.action).toBe('abort-merge'); expect(body.revision).toBe('conflicted'); conflicted = false;
      return route.fulfill({ json: { ok: true, data: { done: true } } });
    }
    const data = path.endsWith('/auth/session') ? { user: { name: 'demo', uid: 1000, gid: 1000, home: '/home/user' } }
      : path.endsWith('/apps') ? { canInstall: true, apps: [{ id: 'git', installed: true }] }
      : path.endsWith('/git/repository') ? { path: '/home/user/project', branch: 'main', head: 'a'.repeat(40), revision: conflicted ? 'conflicted' : 'clean', upstream: '', ahead: 0, behind: 0, branches: ['main', 'feature'], remotes: [], operation: conflicted ? 'MERGE_HEAD' : '', history: [], files: conflicted ? [{ path: 'file.txt', index: 'U', worktree: 'U', conflict: true }] : [] }
      : path.endsWith('/git/diff') ? { text: '', truncated: false } : {};
    return route.fulfill({ json: { ok: true, data } });
  });
  await page.addInitScript(() => localStorage.setItem('lumo.view.v1:demo:git:recent', JSON.stringify(['/home/user/project'])));
  await page.goto('http://localhost:5200'); await page.getByTestId('dock-app-git').click();
  await page.getByTestId('git-repository').click();
  await page.getByRole('menuitemradio', { name: 'project', exact: true }).click();
  await page.getByTestId('git-branch').click();
  await page.getByTestId('git-merge-choose').click();
  await page.getByRole('button', { name: 'Merge feature', exact: true }).click();
  await page.getByTestId('server-app-confirm-ok').click();
  await expect(page.getByTestId('git-abort-merge')).toBeEnabled();
  await expect(page.getByRole('status')).toContainText('Merge needs attention');
  await page.getByTestId('git-abort-merge').click();
  await expect(page.getByRole('alertdialog')).toContainText('conflict-resolution edits');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(calls).toEqual(['merge']);
  await page.getByTestId('git-abort-merge').click();
  await page.getByTestId('server-app-confirm-ok').click();
  await expect(page.getByTestId('git-abort-merge')).toHaveCount(0);
  await expect(page.getByRole('status')).toHaveText('Merge aborted.');
  expect(calls).toEqual(['merge', 'abort-merge']);
});

test('Repository creation and nested folder selection stay inside Git while other apps remain usable', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  await open(page);
  await expect(page.getByTestId('git-remote')).toHaveCount(0);
  await expect(page.getByTestId('git-sync-options')).toHaveCount(0);
  await expect(page.getByTestId('git-fetch')).toHaveAttribute('title', 'Fetch from origin');
  await page.getByTestId('git-repository').click();
  await page.getByTestId('git-create').click();
  const gitWindow = page.locator('.window[data-app-id="git"]');
  const dialog = gitWindow.getByRole('alertdialog', { name: 'Create repository' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('/home/user/GitHub');
  await expect(page.getByTestId('git-repository-name')).toBeFocused();
  await page.getByTestId('git-repository-name').fill('fresh-project');
  const bounds = (await gitWindow.boundingBox())!;
  const box = (await dialog.boundingBox())!;
  expect(box.height).toBeLessThan(300);
  expect(box.x).toBeGreaterThan(bounds.x); expect(box.x + box.width).toBeLessThan(bounds.x + bounds.width);
  expect(box.y).toBeGreaterThan(bounds.y + 28); expect(box.y + box.height).toBeLessThan(bounds.y + bounds.height);
  await page.getByTestId('git-repository-location').click();
  const picker = gitWindow.getByTestId('file-picker');
  await expect(picker).toBeVisible();
  await expect(dialog).not.toBeVisible();
  await page.getByTestId('file-picker-entry-projects').dblclick();
  await page.getByTestId('file-picker-open').click();
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('git-repository-location')).toBeFocused();
  await expect(dialog).toContainText('/home/user/projects');
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(page.getByTestId('git-repository')).toHaveCSS('color', theme === 'dark' ? 'rgb(245, 245, 245)' : 'rgb(25, 25, 25)');
    await page.screenshot({ path: `/tmp/lumo-create-${theme}.png`, animations: 'disabled' });
  }
  await page.getByTestId('dock-app-files').click();
  await expect(page.locator('.window[data-app-id="files"]')).toHaveClass(/focused/);
  await expect(dialog).toBeVisible();
  await page.getByTestId('dock-app-git').click();
  await page.getByTestId('server-app-confirm-ok').click();
  await expect(page.getByTestId('git-repository')).toContainText('fresh-project');
  await expect(page.getByTestId('git-branch')).toContainText('main');
  await expect(page.getByTestId('git-fetch')).toBeDisabled();
  await page.getByTestId('git-repository').click();
  await page.getByTestId('git-clone').click();
  await expect(page.getByRole('alertdialog')).toContainText('/home/user/projects');
  await page.getByTestId('git-clone-url').fill('/home/user/projects/source.git');
  await expect(page.getByTestId('git-repository-name')).toHaveValue('source');
  await page.getByTestId('git-repository-name').fill('cloned-project');
  await page.setViewportSize({ width: 390, height: 650 });
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(page.getByTestId('git-repository')).toHaveCSS('color', theme === 'dark' ? 'rgb(245, 245, 245)' : 'rgb(25, 25, 25)');
    await expect(page.getByTestId('server-app-confirm-ok')).toBeInViewport();
    const narrow = (await gitWindow.getByRole('alertdialog').boundingBox())!;
    expect(narrow.x).toBeGreaterThanOrEqual(16); expect(narrow.x + narrow.width).toBeLessThanOrEqual(374);
    await page.screenshot({ path: `/tmp/lumo-clone-narrow-${theme}.png`, animations: 'disabled' });
  }
  await page.getByTestId('server-app-confirm-ok').click();
  await expect(page.getByTestId('git-repository')).toContainText('cloned-project');
  await expect(page.getByTestId('git-fetch')).toBeEnabled();
  expect(errors).toEqual([]);
});

test('Sync defaults to the tracking remote and offers a choice only for multiple remotes', async ({ page }) => {
  const calls: string[] = [];
  await page.routeWebSocket(/\/api\/v1\/ws/, () => {});
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/git/action')) { calls.push(route.request().postDataJSON().remote); return route.fulfill({ json: { ok: true, data: { done: true } } }); }
    const data = path.endsWith('/auth/session') ? { user: { name: 'demo', uid: 1000, gid: 1000, home: '/home/user' } }
      : path.endsWith('/apps') ? { canInstall: true, apps: [{ id: 'git', installed: true }] }
      : path.endsWith('/git/repository') ? { path: '/home/user/project', branch: 'work', head: 'a'.repeat(40), revision: 'clean', upstream: 'upstream/main', ahead: 0, behind: 1, branches: ['work'], remotes: ['origin', 'upstream'], operation: '', history: [], files: [] } : {};
    return route.fulfill({ json: { ok: true, data } });
  });
  await page.addInitScript(() => localStorage.setItem('lumo.view.v1:demo:git:recent', JSON.stringify(['/home/user/project'])));
  await page.goto('http://localhost:5200'); await page.getByTestId('dock-app-git').click();
  await page.getByTestId('git-repository').click(); await page.getByRole('menuitemradio', { name: 'project', exact: true }).click();
  await expect(page.getByTestId('git-pull')).toHaveAttribute('title', 'Pull from upstream/main');
  await page.getByTestId('git-sync-options').click(); await page.getByTestId('git-fetch-menu').click(); await expect(page.getByRole('status')).toHaveText('Fetched upstream.');
  await page.getByTestId('git-sync-options').click();
  await expect(page.getByRole('menuitemradio', { name: 'Use upstream' })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('menuitemradio', { name: 'Use origin' }).click();
  await page.getByTestId('git-sync-options').click(); await page.getByTestId('git-fetch-menu').click(); await expect(page.getByRole('status')).toHaveText('Fetched origin.');
  await page.getByTestId('git-push').click();
  await expect(page.getByRole('alertdialog')).toContainText('origin/work');
  expect(calls).toEqual(['upstream', 'origin']);
});

test('The header checkbox stages visible files and clears all without a redundant stage button', async ({ page }) => {
  await open(page);
  await expect(page.getByTestId('git-stage-current')).toHaveCount(0);
  await page.locator('.git-select-all span').click();
  await expect(page.getByTestId('git-stage-all')).not.toBeChecked();
  await page.getByTestId('git-file-src/agent.ts').click();
  await expect(page.getByTestId('git-stage-src/agent.ts')).not.toBeChecked();
  expect((await page.getByTestId('git-stage-all').boundingBox())!.x).toBeCloseTo((await page.getByTestId('git-stage-src/agent.ts').boundingBox())!.x, 0);
  await page.getByTestId('git-stage-src/agent.ts').check();
  await expect(page.getByTestId('git-stage-all')).toHaveJSProperty('indeterminate', true);
  await page.getByLabel('Filter changed files').fill('README');
  await page.getByTestId('git-stage-all').check();
  await expect(page.getByTestId('git-stage-README.md')).toBeChecked();
  await page.getByLabel('Filter changed files').fill('');
  await expect(page.getByTestId('git-stage-tests/metrics.test.ts')).not.toBeChecked();
  await page.getByTestId('git-stage-all').check();
  await expect(page.getByTestId('git-stage-tests/metrics.test.ts')).toBeChecked();
  await page.getByTestId('git-stage-all').uncheck();
  await expect(page.getByTestId('git-stage-src/agent.ts')).not.toBeChecked();
  await expect(page.getByTestId('git-stage-README.md')).not.toBeChecked();
  await expect(page.getByTestId('git-stage-tests/metrics.test.ts')).not.toBeChecked();
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(page.getByTestId('git-fetch')).toHaveCSS('color', theme === 'dark' ? 'rgb(245, 245, 245)' : 'rgb(25, 25, 25)');
    await page.screenshot({ path: `/tmp/lumo-smart-sync-${theme}.png`, animations: 'disabled' });
  }
});

test('The default GitHub folder is created on demand and remembered', async ({ page }) => {
  await open(page);
  await page.getByTestId('git-repository').click(); await page.getByTestId('git-create').click();
  await expect(page.getByRole('alertdialog')).toContainText('/home/user/GitHub');
  await page.getByTestId('git-repository-name').fill('new-project');
  await page.getByTestId('server-app-confirm-ok').click();
  await expect(page.getByTestId('git-repository')).toContainText('new-project');
  await expect(page.locator('.git-footer')).toContainText('/home/user/GitHub/new-project');
  await page.getByTestId('git-repository').click(); await page.getByTestId('git-clone').click();
  await page.getByTestId('git-repository-location').click();
  await expect(page.getByTestId('file-picker').locator('footer')).toContainText('/home/user/GitHub');
});

test('One sync button prioritizes unpublished commits and stops on a rejected push', async ({ page }) => {
  let ahead = 0; let behind = 0;
  const calls: string[] = [];
  await page.routeWebSocket(/\/api\/v1\/ws/, () => {});
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/git/action')) {
      const action = route.request().postDataJSON().action; calls.push(action);
      if (action === 'fetch') behind = 2;
      if (action === 'pull') { behind = 0; ahead = 1; }
      if (action === 'push' && behind > 0) return route.fulfill({ status: 409, json: { ok: false, error: { code: 'conflict', message: 'Push rejected: the remote contains new commits.' } } });
      if (action === 'push') ahead = 0;
      return route.fulfill({ json: { ok: true, data: { done: true } } });
    }
    const data = path.endsWith('/auth/session') ? { user: { name: 'demo', uid: 1000, gid: 1000, home: '/home/user' } }
      : path.endsWith('/apps') ? { canInstall: true, apps: [{ id: 'git', installed: true }] }
      : path.endsWith('/git/repository') ? { path: '/home/user/project', branch: 'main', head: 'a'.repeat(40), revision: 'clean', upstream: 'origin/main', ahead, behind, branches: ['main'], remotes: ['origin'], operation: '', history: [], files: [] } : {};
    return route.fulfill({ json: { ok: true, data } });
  });
  await page.addInitScript(() => localStorage.setItem('lumo.view.v1:demo:git:recent', JSON.stringify(['/home/user/project'])));
  await page.goto('http://localhost:5200'); await page.getByTestId('dock-app-git').click();
  await page.getByTestId('git-repository').click(); await page.getByRole('menuitemradio', { name: 'project', exact: true }).click();
  await page.getByTestId('git-fetch').click();
  await expect(page.getByTestId('git-pull')).toContainText('Pull origin');
  await expect(page.getByTestId('git-fetch')).toHaveCount(0); await expect(page.getByTestId('git-push')).toHaveCount(0);
  await page.getByTestId('git-pull').click();
  await expect(page.getByTestId('git-push')).toContainText('Push origin');
  await page.getByTestId('git-push').click(); await page.getByTestId('server-app-confirm-ok').click();
  await expect(page.getByTestId('git-fetch')).toBeVisible();
  ahead = 1; behind = 1; await page.getByTestId('git-refresh').click();
  await expect(page.getByTestId('git-push')).toHaveText('Push origin1');
  await expect(page.getByTestId('git-push')).toBeEnabled();
  await page.getByTestId('git-push').click();
  await expect(page.getByRole('alertdialog')).toContainText('Your local commits will be kept.');
  await page.getByTestId('server-app-confirm-ok').click();
  await expect(page.getByRole('alertdialog').getByRole('alert')).toContainText('Push rejected');
  await expect(page.getByTestId('server-app-confirm-ok')).toBeDisabled();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByTestId('git-refresh').click();
  await expect(page.getByTestId('git-push')).toHaveText('Push origin1');
  await expect(page.getByTestId('git-push')).toBeEnabled();
  expect(calls).toEqual(['fetch', 'pull', 'push', 'push']);
});


test('Selected menu items use checkmarks with only one transient highlight in both themes', async ({ page }) => {
  await open(page);
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.getByTestId('dock-app-git').click();
    await expect(page.locator('.git-branch-control')).toHaveCSS('border-right-width', '1px');
    await page.getByTestId('git-repository').click();
    const repository = page.getByRole('menuitemradio', { name: 'lumo-agent', exact: true });
    await page.getByTestId('git-open').hover();
    await expect(repository).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(repository).toHaveAttribute('aria-checked', 'true');
    await page.screenshot({ path: `/tmp/lumo-menu-repository-${theme}.png`, animations: 'disabled' });
    await page.keyboard.press('Escape');
    await page.getByTestId('git-branch').click();
    const branch = page.getByRole('button', { name: 'Switch to main', exact: true });
    await expect(branch).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await page.screenshot({ path: `/tmp/lumo-menu-branch-${theme}.png`, animations: 'disabled' });
    await page.keyboard.press('Escape');
    await page.getByTestId('dock-app-settings').click();
    await page.getByTestId('settings-section-time').click();
    await page.getByTestId('settings-timezone').click();
    const selected = page.getByRole('option', { selected: true });
    await expect(selected).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    expect(await selected.locator('.dropdown-menu-check').boundingBox()).not.toBeNull();
    await page.keyboard.press('Escape');
    await page.getByTestId('settings-section-appearance').click();
    await page.getByTestId('settings-motion').click();
    await expect(page.getByRole('option', { selected: true })).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await page.keyboard.press('Escape');
  }
});
