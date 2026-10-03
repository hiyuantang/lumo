// SPDX-License-Identifier: AGPL-3.0-only
import { execFileSync, spawnSync } from 'node:child_process';
import { test, expect } from '../offline';
const container = () => process.env.LUMO_TEST_CONTAINER!;
const run = (...args: string[]) => execFileSync('docker', ['exec', container(), 'runuser', '-u', 'alice', '--', ...args], { encoding: 'utf8' }).trim();
const image = 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAL0lEQVR4nO3OIQEAAAgDMKIRjWg0gxg3E/Ornr2kEhAQEBAQEBAQEBAQEBAQSAcejZH8iJt+oVIAAAAASUVORK5CYII=';
function cli(operation: string, input: object) {
  const result = spawnSync('docker', ['exec', '-i', container(), 'runuser', '-u', 'alice', '--', 'lumod', 'native-app', operation], { input: JSON.stringify(input), encoding: 'utf8' });
  expect(result.status, result.stderr || result.stdout).toBe(0); return JSON.parse(result.stdout);
}
test('Installed backend notifies with its window closed and packaged icon survives reload', async ({ page }) => {
  const project = '/home/alice/notice-check';
  cli('create', { project, name: 'notice-check', title: 'Notice Check', backend: true, pi: false });
  const frontend = `import { sendNotification } from '@lumo/sdk/api/notifications'; export default function App() { return <button className="btn" onClick={() => void sendNotification('notice-check', {requestId:'frontend-notice-1',title:'Frontend ready',body:'Sent through SDK'})}>Send notice</button>; }`;
  const backend = `import {spawnSync} from 'node:child_process';const result=spawnSync(process.env.LUMO_HOST_EXECUTABLE,['app-notify'],{input:JSON.stringify({requestId:'backend-notice-1',title:'Background ready',body:'The app window is closed.'}),encoding:'utf8',env:process.env});if(result.status!==0)throw new Error(result.stderr);process.stdout.write(result.stdout);`;
  run('node', '-e', `const fs=require('node:fs');const p=${JSON.stringify(project)};const f=p+'/lumo.plugin.json';const m=JSON.parse(fs.readFileSync(f));m.permissions.push('notifications.send');m.icon='IconBell';m.iconImage='assets/icon.png';fs.mkdirSync(p+'/assets');fs.writeFileSync(p+'/assets/icon.png',Buffer.from('${image}','base64'));fs.writeFileSync(f,JSON.stringify(m));fs.writeFileSync(p+'/src/main.tsx',${JSON.stringify(frontend)});fs.writeFileSync(p+'/backend/main.mjs',${JSON.stringify(backend)});`);
  const built = cli('build', { project });
  expect(built.release.manifest.iconImage).toBe('data:image/png;base64,' + image);
  cli('install', { name: 'notice-check', digest: built.release.digest, revision: '', requestId: 'notice-install', trust: true });
  await page.goto('/'); await page.getByTestId('login-username').fill('alice'); await page.getByTestId('login-password').fill('alice-pass'); await page.getByTestId('login-submit').click();
  const dock = page.getByTestId('dock-app-plugin:notice-check');
  await expect(dock.locator('img')).toHaveAttribute('src','data:image/png;base64,' + image);
  await dock.click(); await page.getByRole('button',{name:'Send notice',exact:true}).click();
  await expect(page.getByTestId('notification-banner').filter({hasText:'Frontend ready'})).toBeVisible();
  await page.getByTestId('window-close-plugin:notice-check').click();
  const first = JSON.parse(run('lumod','plugin','notice-check','notify'));
  expect(JSON.parse(run('lumod','plugin','notice-check','notify')).id).toBe(first.id);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByTestId('notification-banner').filter({hasText:'Background ready'})).toBeVisible();
  await page.getByTestId('notifications-button').click();
  const notice = page.getByTestId('notification-item').filter({hasText:'Background ready'});
  await expect(notice).toContainText('Notice Check');
  await expect(notice.locator('img')).toHaveAttribute('src','data:image/png;base64,' + image);
  expect(await notice.locator('img').evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth === 32)).toBe(true);
  await page.screenshot({ path: '/tmp/lumo-background-service-ubuntu.png', animations: 'disabled' });
  await page.reload(); await page.getByTestId('notifications-button').click();
  await expect(notice).toBeVisible(); await notice.hover(); await notice.getByTestId('notification-close').click();
  await expect(notice).toHaveCount(0);
  await page.reload(); await page.getByTestId('notifications-button').click(); await expect(notice).toHaveCount(0);
  const bob = spawnSync('docker',['exec',container(),'runuser','-u','bob','--','env','LUMO_APP_NAME=notice-check','lumod','app-notify'],{input:JSON.stringify({requestId:'other-user',title:'No access',body:''}),encoding:'utf8'});
  expect(bob.status).not.toBe(0);
});
