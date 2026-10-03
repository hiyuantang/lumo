// SPDX-License-Identifier: AGPL-3.0-only
import {test,expect} from '../offline';

test('Native package details preserve core Pi, uninstall choices and compact layouts',async({page})=>{
  await page.goto('/'); await page.getByTestId('login-username').fill('demo'); await page.getByTestId('login-password').fill('demo'); await page.getByTestId('login-submit').click();
  await page.getByTestId('dock-app-library').click(); await page.getByTestId('library-calendar').click();
  for(const colorScheme of ['light','dark'] as const) for(const width of [1440,390]) {
    await page.emulateMedia({colorScheme}); await page.setViewportSize({width,height:900});
    await expect(page.getByTestId('plugin-install')).toBeVisible();
    expect(await page.getByTestId('app-library').evaluate((element)=>element.scrollWidth<=element.clientWidth)).toBe(true);
    await page.screenshot({path:`/tmp/lumo-native-details-${width}-${colorScheme}.png`,animations:'disabled'});
  }
  await page.getByTestId('plugin-install').click();
  const choice=page.getByRole('checkbox',{name:'Move app-owned data to Trash'});
  await expect(choice).not.toBeChecked(); await page.getByText('Move app-owned data to Trash',{exact:true}).click(); await expect(choice).not.toBeChecked();
  await page.getByTestId('server-app-confirm-ok').click();
  await expect(page.getByTestId('dock-app-calendar')).toHaveCount(0); await expect(page.getByTestId('dock-app-pi')).toBeVisible();
  await expect(page.getByTestId('plugin-install')).toHaveText('Install'); await page.getByTestId('plugin-install').click();
  await expect(page.getByTestId('dock-app-calendar')).toBeVisible(); await expect(page.getByTestId('plugin-install')).toHaveText('Uninstall');
});
