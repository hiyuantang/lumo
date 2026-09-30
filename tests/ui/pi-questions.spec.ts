// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '../offline';
import { piPage } from './pi-fixture';

async function start(page: import('@playwright/test').Page) {
  const fixture = await piPage(page);
  await page.goto('http://localhost:5200');
  await page.getByTestId('dock-app-pi').click();
  await page.getByTestId('pi-prompt').fill('Help me choose');
  await page.getByTestId('pi-send').click();
  await expect(page.getByTestId('pi-send')).toHaveAttribute('aria-label', 'Stop');
  return fixture;
}

test('Pi questions support choices, custom answers, multiple requests and preserved drafts', async ({ page }) => {
  const fixture = await start(page);
  await page.getByTestId('pi-prompt').fill('My next message');
  fixture.ask({ id: 'one', method: 'select', title: 'Which environment should I use?', options: ['Development', 'Production'] });
  fixture.ask({ id: 'two', method: 'input', title: 'What should the project be called?' });
  const cards = page.getByTestId('pi-question');
  await expect(cards).toHaveCount(2);
  await expect(page.locator('.pi-compose').getByTestId('pi-question')).toHaveCount(2);
  await expect(page.getByTestId('pi-messages').getByTestId('pi-question')).toHaveCount(0);
  await expect(page.getByTestId('pi-prompt')).toBeHidden();
  await expect(page.getByTestId('pi-send')).toHaveAttribute('aria-label', 'Stop');
  await expect(cards.first().getByRole('button', { name: 'Submit', exact: true })).toBeDisabled();
  await cards.first().getByRole('button', { name: 'Development', exact: true }).click();
  await expect(cards.first().getByRole('button', { name: 'Development' })).toHaveAttribute('aria-pressed', 'true');
  await cards.first().screenshot({ path: '/tmp/lumo-pi-question-light.png', animations: 'disabled' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await cards.first().screenshot({ path: '/tmp/lumo-pi-question-dark.png', animations: 'disabled' });
  await page.setViewportSize({ width: 600, height: 800 });
  await expect(cards.first().getByRole('button', { name: 'Submit', exact: true })).toBeVisible();
  expect(await cards.first().evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await cards.first().screenshot({ path: '/tmp/lumo-pi-question-narrow.png', animations: 'disabled' });
  await cards.first().getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(cards).toHaveCount(1);
  await expect(page.getByTestId('pi-prompt')).toBeHidden();
  expect(fixture.answers[0]).toMatchObject({ questionId: 'one', value: 'Development' });
  await cards.getByRole('textbox', { name: 'Your answer', exact: true }).fill('网站 — café');
  await cards.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(cards).toHaveCount(0);
  await expect(page.getByTestId('pi-prompt')).toBeVisible();
  expect(fixture.answers[1]).toMatchObject({ questionId: 'two', value: '网站 — café' });
  await expect(page.getByTestId('pi-prompt')).toHaveText('My next message');
  fixture.ask({ id: 'three', method: 'select', title: 'Which size?', options: ['Small', 'Large'] });
  await cards.getByRole('button', { name: 'Small', exact: true }).click();
  await cards.getByRole('textbox', { name: 'Your own answer' }).fill('Medium');
  await expect(cards.getByRole('button', { name: 'Small', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await cards.getByRole('button', { name: 'Submit', exact: true }).click();
  expect(fixture.answers[2]).toMatchObject({ questionId: 'three', value: 'Medium' });
});

test('Pi pending questions survive refresh and cancel or stop cleanly', async ({ page }) => {
  const fixture = await start(page);
  fixture.ask({ id: 'refresh', method: 'input', title: 'What name?' });
  await expect(page.getByTestId('pi-question')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('pi-question')).toContainText('What name?');
  await page.getByTestId('pi-question').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByTestId('pi-question')).toHaveCount(0);
  expect(fixture.answers[0]).toMatchObject({ questionId: 'refresh', cancelled: true });
  await page.getByTestId('pi-prompt').fill('Preserve this draft');
  fixture.ask({ id: 'stop', method: 'select', title: 'Still working?', options: ['Yes'] });
  await expect(page.getByTestId('pi-question')).toHaveCount(1);
  await page.getByTestId('pi-send').click();
  await expect(page.getByTestId('pi-question')).toHaveCount(0);
  expect(fixture.answers).toHaveLength(1);
  await expect(page.getByTestId('pi-prompt')).toBeVisible();
  await expect(page.getByTestId('pi-prompt')).toHaveText('Preserve this draft');
});

test('Compact questions share the composer with approvals and fit both themes and narrow windows', async ({ page }) => {
  const fixture = await start(page);
  await page.getByTestId('pi-prompt').fill('My next message');
  await page.getByRole('button', { name: 'Maximize Pi', exact: true }).click();
  fixture.ask({ id: 'question', method: 'select', title: 'Which environment?', message: 'Choose an environment to continue.', options: ['Development', 'Production'] });
  const card = page.getByTestId('pi-question');
  await card.getByRole('button', { name: 'Development', exact: true }).click();
  for (const width of [1280, 600, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      await expect(card.getByRole('button', { name: 'Submit', exact: true })).toBeVisible();
      await expect(page.getByTestId('pi-send')).toBeVisible();
      expect(await card.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
      expect(await page.locator('.pi-requests').evaluate((node) => node.clientHeight <= 280)).toBe(true);
      if (width === 1280) {
        const title = (await card.getByRole('heading').boundingBox())!;
        const submit = (await card.getByRole('button', { name: 'Submit', exact: true }).boundingBox())!;
        expect(submit.x).toBeGreaterThan(title.x + title.width);
        expect(Math.abs(submit.y + submit.height / 2 - title.y - title.height / 2)).toBeLessThan(2);
      }
      await page.getByTestId('app-pi').screenshot({ path: `/tmp/lumo-pi-compact-question-${width}-${colorScheme}.png`, animations: 'disabled' });
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await card.getByRole('textbox', { name: 'Your own answer' }).fill('Staging');
  fixture.ask({ id: 'approval', method: 'confirm', title: 'Use Lumo?', message: '{"action":"click","label":"Settings"}' });
  const cards = page.locator('.pi-compose').getByTestId('pi-question');
  await expect(cards).toHaveCount(2);
  await cards.last().getByRole('button', { name: 'Reject', exact: true }).click();
  await expect(cards).toHaveCount(1);
  await expect(card.getByRole('textbox', { name: 'Your own answer' })).toHaveValue('Staging');
  await expect(page.getByTestId('pi-prompt')).toBeHidden();
  await card.getByRole('button', { name: 'Submit', exact: true }).press('Enter');
  await expect(cards).toHaveCount(0);
  expect(fixture.answers).toHaveLength(2);
  expect(fixture.answers[1]).toMatchObject({ questionId: 'question', value: 'Staging' });
  await expect(page.getByTestId('pi-prompt')).toHaveText('My next message');
  expect(fixture.commands.filter((command) => command.type === 'prompt' || command.type === 'follow_up')).toHaveLength(1);
});

test('Pi retries a failed answer with the same request identity', async ({ page }) => {
  const fixture = await start(page);
  fixture.ask({ id: 'retry', method: 'input', title: 'Your preference?' });
  const ids: string[] = [];
  await page.route('**/api/v1/pi/answer', async (route) => {
    ids.push(route.request().postDataJSON().requestId);
    if (ids.length === 1) return route.fulfill({ status: 503, json: { ok: false, error: { code: 'unavailable', message: 'Try again shortly.' } } });
    return route.fallback();
  });
  const card = page.getByTestId('pi-question');
  await card.getByRole('textbox').fill('Keep my answer');
  await card.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(card.getByRole('alert')).toBeVisible();
  await expect(card.getByRole('textbox')).toHaveValue('Keep my answer');
  await card.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(card).toHaveCount(0);
  expect(ids).toHaveLength(2); expect(ids[1]).toBe(ids[0]);
});
