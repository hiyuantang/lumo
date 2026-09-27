// SPDX-License-Identifier: AGPL-3.0-only
import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';

function ubuntu(...args: string[]) {
  return execFileSync('docker', ['exec', process.env.LUMO_TEST_CONTAINER!, ...args], { encoding: 'utf8' }).trim();
}

async function login(page: Page) {
  await page.goto('/');
  await expect(page).toHaveTitle('Lumo');
  await page.getByTestId('login-username').fill('alice');
  await page.getByTestId('login-password').fill('alice-pass');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('menu-bar')).toBeVisible();
}

test('terminal renders after the mode queries used by OpenCode', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await login(page);
  await page.getByTestId('dock-app-terminal').click();
  await expect(page.getByTestId('window-terminal')).toContainText('alice@');
  const input = page.getByTestId('terminal-input');
  await input.fill("printf '\\033[?1016$p\\033[?2027$p\\033[?2031$p\\033[?1004$p\\033[?2004$p\\033[?2026$pTERMINAL_%s\\n' MODE_READY");
  await input.press('Enter');
  await expect(page.getByTestId('window-terminal')).toContainText('TERMINAL_MODE_READY');
  expect(errors).toEqual([]);
});

test('real login survives reload and logout ends the server session', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByTestId('login-username').fill('alice');
  await page.getByTestId('login-password').fill('wrong');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('login-error')).toHaveText('Incorrect username or password.');
  await login(page);
  await page.reload();
  await expect(page.getByTestId('menu-bar')).toBeVisible();
  const session = await page.request.get('/api/v1/auth/session');
  expect((await session.json()).data.user.name).toBe('alice');
  await page.getByTestId('dock-app-settings').click();
  await page.getByTestId('settings-section-system').click();
  await page.getByTestId('logout-button').click();
  await expect(page.getByTestId('login-screen')).toBeVisible();
  expect((await page.request.get('/api/v1/services')).status()).toBe(401);
  expect(errors).toEqual([]);
});

test('browser saves a real file and preserves an external edit on conflict', async ({ page }) => {
  const path = '/home/alice/browser-notes.txt';
  ubuntu('runuser', '-u', 'alice', '--', 'sh', '-c', 'printf "Original notes\n" > "$1"', 'fixture', path);
  await login(page);
  await page.getByTestId('dock-app-files').click();
  await page.getByTestId('file-row-browser-notes.txt').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  await page.getByTestId('editor-input').fill('Saved through the browser\n');
  await page.getByTestId('editor-input').press('ControlOrMeta+s');
  await expect(page.getByTestId('file-editor')).toHaveCount(0);
  expect(ubuntu('cat', path)).toBe('Saved through the browser');
  await page.getByTestId('dock-app-files').click();

  await page.getByTestId('file-row-browser-notes.txt').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  await expect(page.getByTestId('editor-input')).toHaveValue('Saved through the browser\n');
  ubuntu('runuser', '-u', 'alice', '--', 'sh', '-c', 'printf "Changed outside Lumo\n" > "$1"', 'fixture', path);
  await page.getByTestId('editor-input').fill('Conflicting draft');
  await page.getByTestId('editor-save').click();
  await expect(page.getByTestId('editor-conflict')).toBeVisible();
  expect(ubuntu('cat', path)).toBe('Changed outside Lumo');
  await page.getByTestId('editor-reload').click();
  await expect(page.getByTestId('editor-input')).toHaveValue('Changed outside Lumo\n');
  await page.getByTestId('editor-close').click();
  await page.getByTestId('dock-app-files').click();
  await page.getByTestId('file-row-browser-notes.txt').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Move to Trash', exact: true }).click();
  await page.getByTestId('delete-confirm-button').click();
  await expect(page.getByTestId('file-row-browser-notes.txt')).toHaveCount(0);
  expect(ubuntu('cat', '/home/alice/.local/share/Trash/files/browser-notes.txt')).toBe('Changed outside Lumo');
  ubuntu('test', '!', '-e', path);
});

test('browser controls a real service and reflects changes made outside Lumo', async ({ page }) => {
  ubuntu('systemctl', 'start', 'cron.service');
  await login(page);
  await page.getByTestId('dock-app-home').click();
  await page.getByTestId('monitor-section-services').click();
  const row = page.getByTestId('service-row-cron.service');
  await row.click();
  await expect(row).toContainText('active');
  await page.getByTestId('service-action-stop').click();
  await expect(page.getByTestId('service-confirm')).toBeVisible();
  expect(ubuntu('systemctl', 'show', '-p', 'ActiveState', '--value', 'cron.service')).toBe('active');
  await page.getByTestId('service-confirm-ok').click();
  await expect(row).toContainText('inactive');
  expect(ubuntu('systemctl', 'show', '-p', 'ActiveState', '--value', 'cron.service')).toBe('inactive');
  ubuntu('systemctl', 'start', 'cron.service');
  await expect(page.getByTestId('service-action-stop')).toBeEnabled();
  await expect(row).not.toContainText('inactive');
  expect(ubuntu('systemctl', 'show', '-p', 'ActiveState', '--value', 'cron.service')).toBe('active');
});

test('real API rejects missing CSRF and prevents writing protected files', async ({ request }) => {
  expect((await request.get('/api/v1/services')).status()).toBe(401);
  const response = await request.post('/api/v1/auth/login', { data: { username: 'alice', password: 'alice-pass' } });
  expect(response.ok()).toBeTruthy();
  const csrf = (await response.json()).data.csrf;
  const path = '/home/alice/csrf-must-not-exist.txt';
  const write = { path, content: Buffer.from('blocked').toString('base64'), requestId: 'browser-no-csrf' };
  expect((await request.put('/api/v1/files/write', { data: write })).status()).toBe(403);
  ubuntu('test', '!', '-e', path);
  const before = ubuntu('sha256sum', '/etc/hostname');
  const denied = await request.put('/api/v1/files/write', {
    headers: { 'X-Lumo-CSRF': csrf },
    data: { ...write, path: '/etc/hostname', requestId: 'browser-protected' },
  });
  expect(denied.status()).toBe(403);
  expect((await denied.json()).error.code).toBe('forbidden');
  expect(ubuntu('sha256sum', '/etc/hostname')).toBe(before);
});

test('time zone selection updates Ubuntu and uninstalled apps stay out of the dock', async ({ page }) => {
  const original = ubuntu('timedatectl', 'show', '--property=Timezone', '--value');
  const timezone = original === 'America/New_York' ? 'Europe/London' : 'America/New_York';
  await login(page);
  await page.getByTestId('dock-app-library').click();
  await expect(page.getByTestId('library-primary')).toHaveText('Install…');
  await expect(page.getByTestId('dock-app-containers')).toHaveCount(0);
  await expect(page.getByTestId('dock-app-websites')).toHaveCount(0);
  await page.getByTestId('dock-app-settings').click();
  await page.getByTestId('settings-section-time').click();
  await expect(page.getByTestId('settings-ntp')).toHaveCount(0);
  await page.getByTestId('settings-timezone').click();
  await page.getByRole('textbox', { name: 'Search options' }).fill(timezone.replaceAll('_', ' '));
  await page.getByRole('option', { name: timezone.replaceAll('_', ' '), exact: true }).click();
  try {
    await page.getByTestId('settings-save-timezone').click();
    await expect(page.getByTestId('reauth-sheet')).toBeVisible();
    await page.getByTestId('reauth-password').fill('alice-pass');
    await page.getByTestId('reauth-submit').click();
    await expect(page.getByTestId('settings-editor-timezone')).toContainText('Saved');
    expect(ubuntu('timedatectl', 'show', '--property=Timezone', '--value')).toBe(timezone);
  } finally {
    ubuntu('timedatectl', 'set-timezone', original);
  }
});

test('Files creates real folders and Markdown files and opens Preview independently of Details', async ({ page }) => {
  await login(page);
  await page.getByTestId('dock-app-files').click();
  await page.getByRole('listbox', { name: 'Files', exact: true }).click({ button: 'right', position: { x: 350, y: 250 } });
  await page.getByRole('menuitem', { name: 'New Folder', exact: true }).click();
  await page.getByTestId('files-create-name').fill('Preview test');
  await page.getByTestId('files-create-submit').click();
  await page.getByTestId('file-row-Preview test').dblclick();
  await expect(page.getByTestId('files-absolute-path')).toHaveText('/home/alice/Preview test');
  await page.getByTestId('files-new').click();
  await page.getByRole('menuitem', { name: 'New File', exact: true }).click();
  await page.getByTestId('files-create-name').fill('notes.md');
  await page.getByTestId('files-create-submit').click();
  const row = page.getByTestId('file-row-notes.md');
  await row.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  await page.getByTestId('editor-input').fill('# Ubuntu Preview\n\nA **real** file.\n');
  await page.getByTestId('editor-save').click();
  expect(ubuntu('cat', '/home/alice/Preview test/notes.md')).toContain('# Ubuntu Preview');
  expect(ubuntu('stat', '-c', '%U', '/home/alice/Preview test/notes.md')).toBe('alice');
  await page.getByTestId('dock-app-files').click();
  await row.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Details', exact: true }).click();
  await expect(page.getByTestId('files-details')).toContainText('/home/alice/Preview test/notes.md');
  await expect(page.getByTestId('files-details')).not.toContainText('Ubuntu Preview');
  await row.dblclick();
  await expect(page.getByTestId('preview-rendered').getByRole('heading', { name: 'Ubuntu Preview' })).toBeVisible();
  await page.getByTestId('preview-mode-raw').click();
  await expect(page.getByTestId('preview-raw')).toContainText('**real**');
  await page.getByTestId('window-close-preview').click();
  await page.getByTestId('files-new').click();
  await page.getByRole('menuitem', { name: 'New File', exact: true }).click();
  await page.getByTestId('files-create-name').fill('notes.md');
  await page.getByTestId('files-create-submit').click();
  await expect(page.getByTestId('files-create-dialog').getByRole('alert')).toContainText('already exists');
  expect(ubuntu('cat', '/home/alice/Preview test/notes.md')).toContain('# Ubuntu Preview');
});

test('file creation requires CSRF, respects permissions, and refuses existing targets', async ({ request }) => {
  const session = await request.post('/api/v1/auth/login', { data: { username: 'alice', password: 'alice-pass' } });
  const csrf = (await session.json()).data.csrf;
  const data = { path: '/home/alice/create-guard.txt', kind: 'file', requestId: 'create-guard' };
  expect((await request.post('/api/v1/files/create', { data })).status()).toBe(403);
  const headers = { 'X-Lumo-CSRF': csrf };
  for (let i = 0; i < 2; i++) expect((await request.post('/api/v1/files/create', { headers, data })).status()).toBe(200);
  ubuntu('runuser', '-u', 'alice', '--', 'sh', '-c', 'printf "keep me" > "$1"', 'fixture', data.path);
  expect((await request.post('/api/v1/files/create', { headers, data: { ...data, requestId: 'duplicate-create' } })).status()).toBe(409);
  expect(ubuntu('cat', data.path)).toBe('keep me');
  expect((await request.post('/api/v1/files/create', { headers, data: { ...data, path: '/etc/lumo-create-test', requestId: 'denied-create' } })).status()).toBe(403);
  ubuntu('test', '!', '-e', '/etc/lumo-create-test');
});

test('App Library uninstalls Nginx after review and preserves site configuration', async ({ page }) => {
  test.setTimeout(120_000);
  ubuntu('apt-get', 'update');
  ubuntu('env', 'DEBIAN_FRONTEND=noninteractive', 'apt-get', '-y', 'install', 'nginx');
  const config = '/etc/nginx/conf.d/lumo-uninstall-check.conf';
  ubuntu('sh', '-c', 'printf "# keep this site configuration\n" > "$1"', 'fixture', config);
  await login(page);
  await page.getByTestId('dock-app-library').click();
  await page.getByTestId('library-nginx').click();
  await expect(page.getByTestId('app-websites')).toHaveCount(0);
  await expect(page.getByTestId('library-primary')).toHaveText('Uninstall…');
  await page.getByTestId('library-primary').click();
  await expect(page.getByTestId('library-plan')).toContainText('nginx');
  await page.getByTestId('library-install-confirm').click();
  await expect(page.getByTestId('server-app-confirm')).toContainText('go offline');
  await page.getByTestId('server-app-confirm').getByRole('button', { name: 'Cancel', exact: true }).click();
  ubuntu('test', '-x', '/usr/sbin/nginx');
  try {
    await page.getByTestId('library-install-confirm').click();
    await page.getByTestId('server-app-confirm-ok').click();
    await expect(page.getByTestId('reauth-sheet').or(page.getByTestId('library-progress'))).toBeVisible();
    if (await page.getByTestId('reauth-sheet').isVisible()) {
      await page.getByTestId('reauth-password').fill('alice-pass');
      await page.getByTestId('reauth-submit').click();
    }
    await expect(page.getByTestId('library-primary')).toHaveText('Install…', { timeout: 60_000 });
    await expect(page.getByTestId('dock-app-websites')).toHaveCount(0);
    ubuntu('test', '!', '-e', '/usr/sbin/nginx');
    expect(ubuntu('cat', config)).toContain('keep this site configuration');
  } finally {
    ubuntu('env', 'DEBIAN_FRONTEND=noninteractive', 'apt-get', '-y', 'install', 'nginx');
  }
});

test('OpenCode uninstall keeps user data and moves only the executable to Trash', async ({ page, request }) => {
  const binary = '/home/alice/.opencode/bin/opencode';
  const installed = ubuntu('sh', '-c', 'test ! -e "$1" || printf installed', 'fixture', binary);
  test.skip(installed === 'installed', 'An existing OpenCode installation must not be replaced by a test fixture.');
  ubuntu('runuser', '-u', 'alice', '--', 'mkdir', '-p', '/home/alice/.opencode/bin', '/home/alice/.config/opencode');
  ubuntu('runuser', '-u', 'alice', '--', 'cp', '/usr/bin/true', binary);
  ubuntu('runuser', '-u', 'alice', '--', 'sh', '-c', 'printf "keep user settings" > /home/alice/.config/opencode/lumo-test-settings');
  await login(page);
  await page.getByTestId('dock-app-library').click();
  await page.getByTestId('library-opencode').click();
  await expect(page.getByTestId('app-opencode')).toHaveCount(0);
  await expect(page.getByTestId('library-primary')).toHaveText('Uninstall…');
  await page.getByTestId('library-primary').click();
  await expect(page.getByTestId('server-app-confirm')).toContainText('executable moves to Trash');
  await page.getByTestId('server-app-confirm-ok').click();
  await expect(page.getByTestId('library-primary')).toHaveText('Installation guide');
  await expect(page.getByTestId('dock-app-opencode')).toHaveCount(0);
  ubuntu('test', '!', '-e', binary);
  ubuntu('test', '-x', '/home/alice/.local/share/Trash/files/opencode');
  expect(ubuntu('cat', '/home/alice/.config/opencode/lumo-test-settings')).toBe('keep user settings');
  expect((await request.post('/api/v1/apps/opencode/uninstall', { data: { requestId: 'missing-auth' } })).status()).toBe(401);
});

test('Trash restores real files without overwriting and permanently deletes only confirmed items', async ({ page }) => {
  const path = '/home/alice/trash-roundtrip.txt';
  ubuntu('runuser', '-u', 'alice', '--', 'sh', '-c', 'printf "original contents" > "$1"', 'fixture', path);
  await login(page);
  await page.getByTestId('dock-app-files').click();
  await page.getByTestId('file-row-trash-roundtrip.txt').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Move to Trash', exact: true }).click();
  await page.getByTestId('delete-confirm-button').click();
  await expect(page.getByTestId('file-row-trash-roundtrip.txt')).toHaveCount(0);
  await page.getByTestId('files-location-trash').click();
  const row = page.getByTestId('trash-item-trash-roundtrip.txt');
  await expect(row).toContainText(path);
  await row.click();
  ubuntu('runuser', '-u', 'alice', '--', 'sh', '-c', 'printf "external replacement" > "$1"', 'fixture', path);
  await page.getByTestId('trash-restore').click();
  await expect(page.getByTestId('app-trash').getByRole('alert')).toContainText('already exists');
  expect(ubuntu('cat', path)).toBe('external replacement');
  ubuntu('rm', path);
  await page.getByTestId('trash-restore').click();
  await expect(row).toHaveCount(0);
  expect(ubuntu('cat', path)).toBe('original contents');
  const cookies = await page.context().cookies();
  const headers = { 'X-Lumo-CSRF': cookies.find((cookie) => cookie.name === 'lumo_csrf')!.value };
  const trashed = await page.request.post('/api/v1/files/delete', { headers, data: { path, requestId: 'trash-again' } });
  expect(trashed.ok(), await trashed.text()).toBe(true);
  await page.getByTestId('trash-refresh').click();
  await expect(row).toBeVisible();
  await row.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete Permanently…' }).click();
  await page.getByTestId('server-app-confirm').getByRole('button', { name: 'Cancel' }).click();
  ubuntu('test', '-e', '/home/alice/.local/share/Trash/files/trash-roundtrip.txt');
  await row.click();
  await page.getByTestId('trash-delete').click();
  await page.getByTestId('server-app-confirm-ok').click();
  await expect(row).toHaveCount(0);
  ubuntu('test', '!', '-e', '/home/alice/.local/share/Trash/files/trash-roundtrip.txt');
  ubuntu('test', '!', '-e', '/home/alice/.local/share/Trash/info/trash-roundtrip.txt.trashinfo');
  expect((await page.request.post('/api/v1/trash/delete', { data: { requestId: 'no-csrf', items: [{ id: '../.bashrc', revision: 'x' }] } })).status()).toBe(403);
  expect((await page.request.post('/api/v1/trash/delete', { headers, data: { requestId: 'invalid-item', items: [{ id: '../.bashrc', revision: 'x' }] } })).status()).toBe(400);
  ubuntu('test', '-e', '/home/alice/.bashrc');
});

test('Monitor reads real per-core metrics and processes and follows service logs', async ({ page, request }) => {
  expect((await request.get('/api/v1/system/processes')).status()).toBe(401);
  const pid = Number(ubuntu('runuser', '-u', 'alice', '--', 'sh', '-c', 'sleep 120 >/dev/null 2>&1 & echo $!'));
  try {
    await login(page);
    await page.getByTestId('dock-app-home').click();
    await page.getByTestId('monitor-section-cpu').click();
    const cpuCount = Number(ubuntu('sh', '-c', 'grep -c "^cpu[0-9]" /proc/stat'));
    await expect(page.locator('[data-testid^="cpu-core-"]')).toHaveCount(cpuCount);
    await expect.poll(async () => {
      const response = await page.request.get('/api/v1/system/metrics');
      const cores = (await response.json()).data.cpu.perCore;
      return cores.length === cpuCount && cores.every((core: { usagePercent: number | null }) => core.usagePercent !== null && core.usagePercent >= 0 && core.usagePercent <= 100);
    }).toBe(true);
    await page.getByTestId('monitor-section-activity').click();
    await page.getByRole('textbox', { name: 'Filter processes' }).fill(String(pid));
    await expect(page.getByTestId(`process-${pid}`)).toContainText('sleep');
    await expect(page.getByTestId(`process-${pid}`)).toContainText('alice');
    const response = await page.request.get('/api/v1/system/processes');
    const item = (await response.json()).data.processes.find((process: { pid: number }) => process.pid === pid);
    expect(item.memoryBytes).toBeGreaterThan(0);
    expect(item).not.toHaveProperty('commandLine');
    await page.getByTestId('dock-app-home').click();
  await page.getByTestId('monitor-section-services').click();
    await page.getByTestId('service-row-cron.service').click();
    await page.getByTestId('service-open-logs').click();
    await expect(page.getByTestId('monitor-section-logs')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('app-logs')).toBeVisible();
    await expect(page.getByTestId('dock-app-logs')).toHaveCount(0);
  } finally { ubuntu('kill', String(pid)); }
});

test('Skills reads only account skills and refreshes real file changes', async ({ page }) => {
  const root = '/home/alice/.agents/skills';
  const folder = `${root}/health-review`;
  const doc = '---\nname: health-review\ndescription: >-\n  Review resources\n  and recent events.\n---\n# Health review\n\nCheck the service status first.\n';
  ubuntu('runuser', '-u', 'alice', '--', 'mkdir', '-p', folder, '/home/alice/project/.agents/skills/project-only');
  ubuntu('runuser', '-u', 'alice', '--', 'sh', '-c', 'printf "%s" "$1" > "$2"', 'fixture', doc, `${folder}/SKILL.md`);
  ubuntu('runuser', '-u', 'alice', '--', 'sh', '-c', 'printf "%s" "$1" > "$2"', 'fixture', doc, '/home/alice/project/.agents/skills/project-only/SKILL.md');
  await login(page);
  await page.getByTestId('dock-app-skills').click();
  const app = page.getByTestId('app-skills');
  await expect(app.getByTestId('skill-health-review')).toContainText('Review resources and recent events.');
  await expect(app.getByTestId('skill-project-only')).toHaveCount(0);
  await expect(app.getByRole('heading', { name: 'Health review', exact: true })).toBeVisible();
  const result = await page.request.get('/api/v1/skills');
  expect((await result.json()).data.path).toBe(root);
  expect((await page.request.get('/api/v1/skills/detail?id=../project')).status()).toBe(400);
  ubuntu('runuser', '-u', 'alice', '--', 'sh', '-c', 'printf "%s" "$1" > "$2"', 'fixture', doc.replace('service status first', 'recent logs first'), `${folder}/SKILL.md`);
  await app.getByTestId('skills-refresh').click();
  await expect(app.getByTestId('skill-document')).toContainText('Check the recent logs first.');
});

test('reordering terminal tabs preserves the real shell process and its state', async ({ page }) => {
  await login(page);
  await page.getByTestId('dock-app-terminal').click();
  const app = page.getByTestId('app-terminal');
  const tabs = app.getByRole('tab');
  const original = await tabs.first().getAttribute('data-testid');
  await page.getByTestId('terminal-input').fill("LUMO_TAB_MARKER=SURVIVES; printf 'INITIAL_%s\\n' READY");
  await page.getByTestId('terminal-input').press('Enter');
  await expect(app).toContainText('INITIAL_READY');
  await page.getByTestId('terminal-new-tab').click();
  const next = await tabs.last().getAttribute('data-testid');
  await page.getByTestId(next!).dragTo(page.getByTestId(original!));
  await expect(tabs.first()).toHaveAttribute('data-testid', next!);
  await page.getByTestId(original!).locator('.terminal-tab-label').click();
  await page.getByTestId('terminal-input').fill("printf 'TAB_%s\\n' \"$LUMO_TAB_MARKER\"");
  await page.getByTestId('terminal-input').press('Enter');
  await expect(app.locator('.terminal-pane:not(.hidden)')).toContainText('TAB_SURVIVES');
});
