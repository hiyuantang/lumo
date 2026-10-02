// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from '../offline';
import { PET_ACTIVITIES } from '../../src/shell/petActivities';
import { piPage } from './pi-fixture';

for (const [width, colorScheme] of [[1440, 'light'], [390, 'dark']] as const) {
  test(`New pet activities animate, clean up and respect reduced motion at ${width}px in ${colorScheme}`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (['error', 'warning'].includes(message.type())) errors.push(message.text()); });
    await piPage(page); await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'no-preference', colorScheme }); await page.clock.install();
    await page.goto('http://localhost:5200'); await expect(page).toHaveTitle('Lumo');
    const pet = page.getByTestId('desktop-pet'); const handle = page.getByTestId('pet-handle');
    await expect(handle).toBeVisible(); await expect(page.locator('vite-error-overlay')).toHaveCount(0);
    for (const activity of PET_ACTIVITIES.slice(3)) {
      await handle.click({ button: 'right' }); await page.getByRole('menuitem', { name: activity.label, exact: true }).click();
      await expect(pet).toHaveAttribute('data-activity', activity.value);
      await expect(pet).toHaveAttribute('data-motion', 'conjure');
      const prop = pet.locator(`.pet-${activity.value}-prop`);
      await expect(prop).toHaveCSS('display', 'block');
      expect(await pet.locator('.pet-pastime-prop').evaluateAll((nodes) => nodes.filter((node) => getComputedStyle(node).display !== 'none').length)).toBe(1);
      await page.clock.runFor(950); await expect(pet).toHaveAttribute('data-motion', 'perform');
      await expect(prop).toHaveCSS('opacity', '1');
      await page.clock.runFor(500);
      const box = (await pet.boundingBox())!;
      await page.screenshot({ path: `/tmp/lumo-pet-${activity.value}-${width}-${colorScheme}.png`, clip: { x: Math.max(0, box.x - 14), y: box.y - 28, width: Math.min(120, width - Math.max(0, box.x - 14)), height: 122 } });
      if (activity.value === 'golf') {
        const ball = page.getByTestId('pet-play-ball');
        const first = (await ball.boundingBox())!;
        await page.clock.runFor(400);
        expect((await ball.boundingBox())!.x).not.toBe(first.x);
        for (let frame = 0; frame < 20 && Number(await pet.getAttribute('data-ball-bounces')) === 0; frame++) await page.clock.runFor(100);
        expect(Number(await pet.getAttribute('data-ball-bounces'))).toBeGreaterThan(0);
        const bounced = (await ball.boundingBox())!;
        expect(bounced.x).toBeGreaterThanOrEqual(0); expect(bounced.x + bounced.width).toBeLessThanOrEqual(width);
        await page.screenshot({ path: `/tmp/lumo-golf-rebound-${width}-${colorScheme}.png` });
      }
      if (activity.value === 'basketball') {
        const ball = page.getByTestId('pet-play-ball');
        const first = (await ball.boundingBox())!;
        const heights = [first.y];
        for (let frame = 0; frame < 5; frame++) {
          await page.clock.runFor(120); const bouncing = (await ball.boundingBox())!;
          expect(bouncing.x).toBeCloseTo(first.x, 1); heights.push(bouncing.y);
        }
        expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(8);
      }
      await page.clock.runFor(10000);
      await expect(pet).toHaveAttribute('data-activity', 'none'); await expect(prop).toHaveCSS('display', 'none');
      await expect(page.getByTestId('pet-play-ball')).toBeHidden();
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await handle.click({ button: 'right' }); await page.getByRole('menuitem', { name: 'Play golf', exact: true }).click();
    await expect(pet).toHaveAttribute('data-motion', 'perform');
    const still = await page.getByTestId('pet-play-ball').boundingBox();
    await page.clock.runFor(1600); expect(await page.getByTestId('pet-play-ball').boundingBox()).toEqual(still);
    expect(await pet.locator('.pet-pastimes *').evaluateAll((nodes) => nodes.every((node) => node.getAnimations().length === 0))).toBe(true);
    await page.clock.runFor(10000); await expect(page.getByTestId('pet-play-ball')).toBeHidden();
    expect(errors).toEqual([]);
  });
}

test('Activity switches are precise, persist, control the menu and stop running props', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (['error', 'warning'].includes(message.type())) errors.push(message.text()); });
  await piPage(page); await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.clock.install(); await page.goto('http://localhost:5200');
  const pet = page.getByTestId('desktop-pet'); const handle = page.getByTestId('pet-handle');
  await handle.click({ button: 'right' }); await page.getByRole('menuitem', { name: 'Pet settings', exact: true }).click();
  const group = page.getByTestId('settings-pet-activities');
  await expect(group.getByRole('switch')).toHaveCount(PET_ACTIVITIES.length);
  for (const activity of PET_ACTIVITIES) await expect(page.getByTestId(`settings-pet-activity-${activity.value}`)).toBeChecked();
  const golf = page.getByTestId('settings-pet-activity-golf');
  await group.getByText('Play golf', { exact: true }).click(); await expect(golf).toBeChecked();
  await golf.click(); await expect(golf).not.toBeChecked();
  await handle.click({ button: 'right' }); await expect(page.getByRole('menuitem', { name: 'Play golf', exact: true })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Play soccer', exact: true })).toBeVisible(); await page.keyboard.press('Escape');
  await page.reload();
  await handle.click({ button: 'right' }); await page.getByRole('menuitem', { name: 'Pet settings', exact: true }).click();
  await expect(golf).not.toBeChecked();
  await golf.click();
  await handle.click({ button: 'right' }); await page.getByRole('menuitem', { name: 'Play golf', exact: true }).click();
  await page.clock.runFor(1300); await expect(page.getByTestId('pet-play-ball')).toBeVisible();
  await golf.click(); await expect(pet).toHaveAttribute('data-activity', 'none'); await expect(page.getByTestId('pet-play-ball')).toBeHidden();
  for (const activity of PET_ACTIVITIES) {
    const toggle = page.getByTestId(`settings-pet-activity-${activity.value}`);
    if (await toggle.isChecked()) await toggle.click();
    const label = (await group.getByText(activity.label, { exact: true }).boundingBox())!;
    expect((await toggle.boundingBox())!.x).toBeGreaterThan(label.x + label.width);
  }
  await handle.click({ button: 'right' });
  for (const activity of PET_ACTIVITIES) await expect(page.getByRole('menuitem', { name: activity.label, exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape'); await page.reload();
  await handle.click({ button: 'right' }); await page.getByRole('menuitem', { name: 'Pet settings', exact: true }).click();
  for (const activity of PET_ACTIVITIES) await expect(page.getByTestId(`settings-pet-activity-${activity.value}`)).not.toBeChecked();
  for (const [width, colorScheme] of [[1440, 'light'], [390, 'dark']] as const) {
    await page.setViewportSize({ width, height: 1000 }); await page.emulateMedia({ colorScheme });
    await group.scrollIntoViewIfNeeded();
    const rows = group.locator('.pi-extension-item');
    const first = (await rows.nth(0).boundingBox())!; const second = (await rows.nth(1).boundingBox())!;
    if (width === 1440) {
      expect(second.y).toBeCloseTo(first.y, 1); expect(second.x).toBeGreaterThan(first.x + first.width);
      expect((await rows.nth(2).boundingBox())!.y).toBeGreaterThan(first.y + first.height - 1);
      expect((await group.boundingBox())!.height).toBeLessThan(240);
    } else {
      expect(second.x).toBeCloseTo(first.x, 1); expect(second.y).toBeGreaterThan(first.y + first.height - 1);
    }
    const scroll = page.locator('.pi-pet-settings');
    expect(await scroll.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.getByTestId('settings-pet-activity-bubbles').scrollIntoViewIfNeeded();
    await expect(page.getByTestId('settings-pet-activity-bubbles')).toBeVisible();
    await page.getByTestId('window-pi').screenshot({ path: `/tmp/lumo-pet-activities-settings-${width}-${colorScheme}.png` });
  }
  expect(errors).toEqual([]);
});
