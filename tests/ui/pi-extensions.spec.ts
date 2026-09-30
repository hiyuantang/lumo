// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from '../offline';
import { piPage } from './pi-fixture';

test('Extension choices remain editable while running and apply the last saved choice when idle', async ({ page }) => {
  const fixture = await piPage(page);
  fixture.setExtensions([{ id: 'notes', name: 'Notes', enabled: true }, { id: 'review', name: 'Review', enabled: false }]);
  await page.goto('http://localhost:5200'); await page.getByTestId('dock-app-pi').click();
  const input = page.getByTestId('pi-prompt'); await expect(input).toBeEnabled();
  await input.fill('Long task'); await page.getByTestId('pi-send').click();
  await expect(page.getByTestId('pi-send')).toHaveAttribute('aria-label', 'Stop');
  await input.fill('Keep my draft');
  await page.getByTestId('pi-settings-button').click(); await page.getByRole('tab', { name: 'Extensions', exact: true }).click();
  const notes = page.getByRole('switch', { name: 'Notes', exact: true });
  const review = page.getByRole('switch', { name: 'Review', exact: true });
  const starts = fixture.starts.length;
  await expect(page.getByRole('tab', { name: 'Images', exact: true })).toHaveCount(0);
  const questions = page.getByRole('switch', { name: 'Questions', exact: true });
  await expect(questions).toBeChecked(); await questions.click(); await expect(questions).not.toBeChecked();
  await expect(questions).toBeEnabled();
  await expect(notes).toBeChecked(); await expect(review).not.toBeChecked();
  await page.getByText('Notes', { exact: true }).click(); await expect(notes).toBeChecked();
  await notes.click(); await expect(notes).not.toBeChecked();
  await expect(page.getByText('Saved. Applies when Pi is idle.', { exact: true })).toBeVisible();
  await expect(notes).toBeEnabled(); await review.click(); await expect(review).toBeChecked();
  await expect(review).toBeEnabled(); await notes.click(); await expect(notes).toBeChecked();
  await expect(notes).toBeEnabled();
  expect(fixture.starts.length).toBe(starts);
  expect(fixture.commands.filter((command) => command.type === 'abort')).toHaveLength(0);
  await page.getByRole('button', { name: 'Reload extensions' }).click();
  await expect(notes).toBeChecked(); await expect(review).toBeChecked(); await expect(questions).not.toBeChecked();
  fixture.finish('Finished safely');
  await expect.poll(() => fixture.starts.length).toBe(starts + 1);
  await expect(notes).toBeEnabled();
  for (const width of [1440, 390]) for (const colorScheme of ['light', 'dark'] as const) {
    await page.setViewportSize({ width, height: 900 }); await page.emulateMedia({ colorScheme });
    await expect(notes).toBeVisible(); await expect(review).toBeVisible();
    await page.getByTestId('app-pi').screenshot({ path: `/tmp/lumo-extensions-${width}-${colorScheme}.png` });
  }
  await page.getByTestId('pi-home-button').click();
  await expect(input).toHaveText('Keep my draft');
  await expect(page.getByTestId('pi-messages')).toContainText('Finished safely');
});
