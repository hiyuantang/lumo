// SPDX-License-Identifier: AGPL-3.0-only
import { execFileSync, spawnSync } from 'node:child_process';
import { test, expect } from '../offline';
const container = () => process.env.LUMO_TEST_CONTAINER!;
const ubuntu = (...args: string[]) => execFileSync('docker', ['exec', container(), ...args], { encoding: 'utf8' }).trim();
const project = '/home/alice/builder-check';
function cli(operation: string, input: object, valid = true) {
  const result = spawnSync('docker', ['exec', '-i', container(), 'runuser', '-u', 'alice', '--', '/usr/local/bin/lumod', 'native-app', operation], { input: JSON.stringify(input), encoding: 'utf8' });
  expect(result.status, result.stderr || result.stdout).toBe(valid ? 0 : 1);
  return JSON.parse(result.stdout);
}
test('Pi native builder enforces validation and creates a working UI, backend and extension', async ({ page }, testInfo) => {
  cli('create', { project, name: 'builder-check', title: 'Builder Check' });
  ubuntu('runuser', '-u', 'alice', '--', 'node', '-e', `const fs=require('node:fs');const file='${project}/pi/extension.mjs';fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace('lumo_builder_check_read','lumo_builder_check_wrong'));`);
  const broken = cli('build', { project }, false);
  expect(broken.diagnostics.some((d: { code: string; fix: string }) => d.code === 'tool-manifest' && d.fix.length > 0)).toBe(true);
  expect(cli('list', {}).some((app: {name:string}) => app.name === 'builder-check')).toBe(false);
  ubuntu('runuser', '-u', 'alice', '--', 'node', '-e', `const fs=require('node:fs');const file='${project}/pi/extension.mjs';fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace('lumo_builder_check_wrong','lumo_builder_check_read'));`);
  const validation = JSON.parse(ubuntu('runuser', '-u', 'alice', '--', 'node', project + '/validate.mjs'));
  expect(validation.ok).toBe(true);
  const built = cli('build', { project });
  cli('install', { name: 'builder-check', digest: built.release.digest, revision: '', requestId: 'builder-install-denied', trust: false }, false);
  cli('install', { name: 'builder-check', digest: built.release.digest, revision: '', requestId: 'builder-install', trust: true });
  await page.goto('/');
  await page.getByTestId('login-username').fill('alice'); await page.getByTestId('login-password').fill('alice-pass'); await page.getByTestId('login-submit').click();
  await page.getByTestId('dock-app-plugin:builder-check').click();
  await expect(page.getByRole('heading', { name: 'Builder Check', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Note', exact: true }).fill('Saved through the generated UI.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
  await page.getByTestId('window-close-plugin:builder-check').click();
  const tools = ubuntu('runuser', '-u', 'alice', '--', 'node', '--input-type=module', '-e', `
    import extension from '${project}/pi/extension.mjs';
    const tools=[];extension({registerTool:tool=>tools.push(tool)});
    const first=JSON.parse((await tools[0].execute('read',{},undefined)).content[0].text);
    if(first.text!=='Saved through the generated UI.')throw new Error('UI/backend/Pi data mismatch');
    await tools[1].execute('save',{text:'Updated through Pi.',revision:first.revision,requestId:'pi-builder-save'},undefined);
    console.log(JSON.stringify({names:tools.map(tool=>tool.name),text:JSON.parse((await tools[0].execute('read',{},undefined)).content[0].text).text}));`);
  expect(JSON.parse(tools).text).toBe('Updated through Pi.');
  const readonly = ubuntu('runuser', '-u', 'alice', '--', 'node', '--input-type=module', '-e', `
    import fs from 'node:fs';
    const source=fs.readFileSync('${project}/pi/extension.mjs','utf8').replace("const permissionMode = 'ask';","const permissionMode = 'read-only';");
    const {default:extension}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
    const tools=[];extension({registerTool:tool=>tools.push(tool)});
    try{await tools[1].execute('save',{},undefined);throw new Error('write allowed')}catch(error){if(!error.message.includes('Read only'))throw error;console.log('blocked')}`);
  expect(readonly).toBe('blocked');
  await page.getByTestId('dock-app-plugin:builder-check').click();
  await expect(page.getByRole('textbox', { name: 'Note', exact: true })).toHaveValue('Updated through Pi.');
  for (const colorScheme of ['light', 'dark'] as const) for (const width of [1440,390]) {
    await page.emulateMedia({ colorScheme });
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator('html')).toHaveAttribute('data-theme',colorScheme);
    const app=page.locator('.plugin-builder-check');
    await expect(app.getByRole('button',{name:'Save',exact:true})).toBeVisible();
    expect(await app.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
    await page.screenshot({path:testInfo.outputPath(`native-builder-${width}-${colorScheme}.png`)});
  }
  await page.setViewportSize({width:1440,height:900});
  await page.getByRole('textbox', { name: 'Note', exact: true }).fill('Unsaved draft');
  await page.getByTestId('window-close-plugin:builder-check').click();
  await expect(page.getByRole('alertdialog', { name: 'Unsaved changes' })).toBeVisible();
  await page.getByRole('button', { name: 'Keep editing' }).click();
  await expect(page.getByRole('textbox', { name: 'Note', exact: true })).toHaveValue('Unsaved draft');
});
