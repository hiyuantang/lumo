// SPDX-License-Identifier: AGPL-3.0-only
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { test, expect } from '../offline';

test('App-owned commands follow focus, survive multiple windows and clean up on close', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const manifest = JSON.parse(await readFile('public/plugins/preview/manifest.json', 'utf8'));
  const script = `const {createElement:h,useState}=globalThis.__LUMO_HOST_V1__.react;const {useAppMenus,useAppWindow}=globalThis.__LUMO_HOST_V1__['@lumo/sdk/app'];export default function App(){const [count,setCount]=useState(0);const win=useAppWindow({title:'Draft '+count,badge:String(count)});const add={id:'add-entry',label:'Add entry',keywords:'connection-probe',run:()=>setCount(n=>n+1)};useAppMenus({tools:[add,{id:'disabled-probe',label:'Disabled probe',disabled:true,run(){}}],help:[{id:'help-probe',label:'Plugin help',palette:false,run(){}}],dock:[add],commands:[add]});return h('div',{'data-testid':'connection-probe'},h('output',null,count),h('span',null,win.id));}`;
  const asset = createHash('sha256').update(script).digest('hex') + '.js';
  await page.route('**/plugins/preview/manifest.json', route => route.fulfill({ json: {...manifest, entry:asset} }));
  await page.route('**/plugins/preview/' + asset + '*', route => route.fulfill({contentType:'application/javascript',body:script}));
  await page.goto('/'); await page.getByTestId('login-username').fill('demo'); await page.getByTestId('login-password').fill('demo'); await page.getByTestId('login-submit').click();
  await page.getByTestId('dock-app-preview').click();
  const first = page.getByTestId('window-preview');
  await expect(first.getByTestId('connection-probe')).toBeVisible();
  await expect(first).toContainText('Draft 0 — Preview');
  await page.locator('[data-menu-button="tools"]').click(); await page.getByTestId('menu-add-entry').click();
  await expect(first.locator('output')).toHaveText('1');
  await expect(page.getByTestId('dock-badge-preview')).toHaveText('1');
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByPlaceholder('Search…').fill('connection-probe');
  await expect(page.getByTestId('command-center').getByText('Add entry',{exact:true})).toHaveCount(1);
  await page.getByTestId('command-center').getByText('Add entry',{exact:true}).click();
  await expect(first.locator('output')).toHaveText('2');
  await page.getByTestId('dock-app-preview').click({button:'right'});
  await page.getByRole('menuitem',{name:'Add entry',exact:true}).click();
  await expect(first.locator('output')).toHaveText('3');
  await page.locator('[data-menu-button="file"]').click(); await page.getByTestId('menu-new-window').click();
  await expect(page.getByTestId('connection-probe')).toHaveCount(2);
  const second = page.locator('[data-testid^="window-preview:"]').filter({has:page.getByTestId('connection-probe')});
  await expect(second.locator('output')).toHaveText('0');
  await page.locator('[data-menu-button="tools"]').click(); await page.getByTestId('menu-add-entry').click();
  await expect(second.locator('output')).toHaveText('1'); await expect(first.locator('output')).toHaveText('3');
  for (const colorScheme of ['light','dark'] as const) for (const width of [1440,390]) {
    await page.emulateMedia({colorScheme}); await page.setViewportSize({width,height:900});
    await page.locator('[data-menu-button="tools"]').click();
    await expect(page.getByTestId('menu-add-entry')).toBeVisible();
    await page.screenshot({path:`/tmp/lumo-connections-${colorScheme}-${width}.png`,animations:'disabled'});
    await page.keyboard.press('Escape');
    const menuBounds=await page.locator('.menubar-left').boundingBox();
    const statusBounds=await page.locator('.menubar-right').boundingBox();
    expect(menuBounds!.x+menuBounds!.width).toBeLessThanOrEqual(statusBounds!.x);
    await page.locator('[data-menu-button=help]').click();
    await expect(page.getByTestId('menu-help-probe')).toBeVisible();
    await page.keyboard.press('Escape');
  }
  await page.reload(); await expect(page.getByTestId('connection-probe')).toHaveCount(2);
  await page.locator('[data-testid^="window-close-preview:"]').click();
  await page.getByTestId('window-close-preview').click();
  await expect(page.locator('[data-menu-button="tools"]')).toHaveCount(0);
  await expect(page.getByTestId('dock-badge-preview')).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+k'); await page.getByPlaceholder('Search…').fill('connection-probe');
  await expect(page.getByTestId('command-center').getByText('Add entry',{exact:true})).toHaveCount(0);
  expect(errors).toEqual([]);
});
