// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect, type Page } from '../offline';
import { piPage } from './pi-fixture';
import type { CalendarItem } from '../../src/api/calendar';
async function openCalendar(page: Page, width = 1440, theme: 'light' | 'dark' = 'light') {
  await page.setViewportSize({ width, height: 1000 }); await page.emulateMedia({ colorScheme: theme });
  await page.clock.install({ time: new Date('2026-10-01T14:00:00Z') });
  await page.goto('/'); await page.getByTestId('login-username').fill('demo'); await page.getByTestId('login-password').fill('demo'); await page.getByTestId('login-submit').click();
  await page.getByTestId('dock-app-calendar').click(); await expect(page.getByTestId('calendar-month')).toBeVisible();
}
async function option(page: Page, label: string, value: string) { await page.getByRole('combobox', { name: label, exact: true }).click(); await page.getByRole('option', { name: value, exact: true }).click(); }
async function save(page: Page) { await page.getByTestId('server-app-confirm-ok').click(); await expect(page.getByTestId('calendar-editor')).toBeHidden(); }
function errors(page: Page) { const result: string[] = []; page.on('pageerror', (e) => result.push(e.message)); page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') result.push(m.text()); }); return result; }

test('Calendar creates, edits, filters, deletes and restores a repeating event', async ({ page }) => {
  const consoleErrors = errors(page); await openCalendar(page);
  await page.getByRole('button', { name: 'New event', exact: true }).click();
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Planning review');
  await page.getByLabel('Start date', { exact: true }).fill('2026-10-01'); await page.getByLabel('End date', { exact: true }).fill('2026-10-01');
  await page.getByLabel('Start time', { exact: true }).fill('10:00'); await page.getByLabel('End time', { exact: true }).fill('11:00');
  await option(page, 'Repeat', 'Weekly'); await page.getByLabel('Repeat until').fill('2026-10-22');
  await page.getByLabel('Notes', { exact: true }).fill('Bring the roadmap.'); await save(page);
  await expect(page.getByTestId('calendar-event').filter({ hasText: 'Planning review' })).toHaveCount(4);
  await page.getByTestId('calendar-event').filter({ hasText: 'Planning review' }).first().click();
  await page.getByTestId('calendar-detail').getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Roadmap review'); await save(page);
  await expect(page.getByTestId('calendar-event').filter({ hasText: 'Roadmap review' })).toHaveCount(4);
  await page.getByRole('textbox', { name: 'Search events' }).fill('missing'); await expect(page.getByTestId('calendar-event')).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear search' }).click();
  await page.getByRole('checkbox', { name: 'Show Personal' }).uncheck(); await expect(page.getByTestId('calendar-event')).toHaveCount(0);
  await page.getByText('Personal', { exact: true }).click(); await expect(page.getByRole('checkbox', { name: 'Show Personal' })).not.toBeChecked();
  await page.getByRole('checkbox', { name: 'Show Personal' }).check();
  await page.getByTestId('calendar-event').first().click(); await page.getByTestId('calendar-detail').getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByTestId('server-app-confirm-ok').click(); await expect(page.getByTestId('calendar-event')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(page.getByTestId('calendar-event')).toHaveCount(4);
  await page.reload(); await page.getByTestId('dock-app-calendar').click(); await expect(page.getByTestId('calendar-event')).toHaveCount(4);
  expect(consoleErrors).toEqual([]);
});

test('Reminders stay local and support lists, priorities, flags, completion and editing', async ({ page }) => {
  const consoleErrors = errors(page); await openCalendar(page);
  await page.getByRole('tab', { name: 'Reminders', exact: true }).click(); await page.getByTestId('reminders-all').click();
  await page.getByRole('button', { name: 'New list', exact: true }).click(); await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Personal tasks');
  const colors = page.getByRole('group', { name: 'Color', exact: true });
  await expect(colors.getByRole('button')).toHaveCount(8); await expect(page.locator('input[type="color"]')).toHaveCount(0);
  await colors.getByRole('button', { name: 'Red', exact: true }).click(); await expect(colors.getByRole('button', { name: 'Red', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(colors.getByRole('button', { name: 'Blue', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.getByTestId('server-app-confirm-ok').click();
  await page.getByRole('button', { name: 'Personal tasks', exact: true }).click();
  await page.getByRole('button', { name: 'New reminder', exact: true }).first().click(); await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Practice guitar');
  await page.getByLabel('Due date', { exact: true }).fill('2026-10-01'); await page.getByRole('checkbox', { name: 'At a specific time' }).check(); await page.getByLabel('Due time').fill('18:30');
  await page.getByRole('checkbox', { name: 'Flagged', exact: true }).check(); await option(page, 'Priority', 'High'); await option(page, 'Repeat', 'Daily'); await page.getByLabel('Repeat until').fill('2026-10-02'); await save(page);
  await expect(page.getByTestId('calendar-reminder')).toHaveCount(1); await page.getByTestId('reminders-flagged').click(); await expect(page.getByTestId('calendar-reminder')).toHaveCount(1);
  await page.getByTestId('calendar-reminder').getByRole('button').click(); await page.getByTestId('calendar-detail').getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Practice scales'); await save(page);
  await page.getByTestId('calendar-reminder').getByRole('button').click(); await expect(page.getByRole('checkbox', { name: 'Complete Practice scales' })).not.toBeChecked(); await page.getByRole('button', { name: 'Close details' }).click();
  await page.getByRole('checkbox', { name: 'Complete Practice scales' }).click(); await page.getByTestId('reminders-completed').click(); await expect(page.getByTestId('calendar-reminder')).toHaveCount(1);
  await page.getByRole('checkbox', { name: 'Complete Practice scales' }).click(); await page.getByTestId('reminders-all').click(); await expect(page.getByTestId('calendar-reminder')).toHaveCount(2);
  await page.getByTestId('calendar-reminder').first().getByRole('checkbox').click(); await expect(page.getByTestId('calendar-reminder')).toHaveCount(1);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('lumo.mock.calendar')!)); expect(stored.collections.every((c: { provider: string }) => c.provider === 'local')).toBe(true); expect(stored.items).toHaveLength(2); expect(stored.collections.find((c: { name: string }) => c.name === 'Personal tasks').color).toBe('#d3323b');
  expect(consoleErrors).toEqual([]);
});

for (const theme of ['light', 'dark'] as const) test(`All calendar views and overlapping events render in ${theme} and at narrow size`, async ({ page }) => {
  const consoleErrors = errors(page);
  await page.addInitScript(() => {
    const base = { id: 'a', revision: 'v1', collectionId: 'personal', kind: 'event', title: 'Product review', notes: '', location: 'Studio', start: '2026-10-01T09:00:00Z', end: '2026-10-01T10:30:00Z', due: '', allDay: false, timeZone: 'UTC', repeat: 'none', repeatUntil: '', alertMinutes: 10, flagged: false, priority: 'none', completed: false, deleted: false };
    localStorage.setItem('lumo.mock.calendar', JSON.stringify({ collections: [{ id: 'personal', name: 'Personal', color: '#487ccc', kind: 'event', provider: 'local', readOnly: false }, { id: 'reminders', name: 'Reminders', color: '#c28245', kind: 'reminder', provider: 'local', readOnly: false }], items: [base, { ...base, id: 'b', title: 'Design sync', start: '2026-10-01T09:30:00Z', end: '2026-10-01T11:00:00Z' }, { ...base, id: 'c', title: 'Launch day', start: '2026-10-01', end: '2026-10-02', allDay: true }] }));
  });
  await openCalendar(page, 1440, theme);
  for (const marker of await page.locator('.calendar-today').all()) { await expect(marker).toHaveCSS('background-color', 'rgb(211, 50, 59)'); await expect(marker).toHaveCSS('color', 'rgb(255, 255, 255)'); }
  const window = page.getByTestId('window-calendar');
  await window.screenshot({ path: `/tmp/lumo-calendar-month-${theme}.png` });
  await page.getByTestId('calendar-view-week').click(); await expect(page.getByTestId('calendar-timed-event')).toHaveCount(2);
  await expect(page.getByTestId('calendar-timeline').locator('.calendar-today')).toHaveCSS('background-color', 'rgb(211, 50, 59)');
  const boxes = await page.getByTestId('calendar-timed-event').all(); expect((await boxes[0].boundingBox())!.x).not.toEqual((await boxes[1].boundingBox())!.x);
  const eventTop = (await page.getByTestId('calendar-timed-event').filter({ hasText: 'Product review' }).boundingBox())!.y;
  const slotTop = (await page.getByRole('button', { name: 'New event 2026-10-01 9:00', exact: true }).boundingBox())!.y; expect(Math.abs(eventTop - slotTop)).toBeLessThan(1);
  await window.screenshot({ path: `/tmp/lumo-calendar-week-${theme}.png` });
  await page.getByTestId('calendar-view-day').click(); await expect(page.getByTestId('calendar-timed-event')).toHaveCount(2); await page.getByTestId('calendar-timed-event').first().click(); await expect(page.getByTestId('calendar-detail')).toBeVisible();
  await window.screenshot({ path: `/tmp/lumo-calendar-day-${theme}.png` }); await page.getByRole('button', { name: 'Close details' }).click();
  await page.getByTestId('calendar-view-year').click(); await expect(page.getByTestId('calendar-year').locator('section')).toHaveCount(12);
  await expect(page.getByTestId('calendar-year').locator('.calendar-today')).toHaveCount(1);
  const yearDay = page.getByTestId('calendar-year').getByRole('button', { name: 'Friday, October 2, 2026', exact: true }).last(); await yearDay.hover(); const hoverBox = (await yearDay.boundingBox())!; expect(hoverBox.width).toBeCloseTo(hoverBox.height, 1); await expect(yearDay).toHaveCSS('border-radius', '50%');
  await expect(page.getByRole('button', { name: 'Previous', exact: true })).toHaveCount(0); await expect(page.getByRole('button', { name: 'Next', exact: true })).toHaveCount(0); await window.screenshot({ path: `/tmp/lumo-calendar-year-${theme}.png` });
  await page.setViewportSize({ width: 420, height: 900 }); await page.getByRole('button', { name: 'Hide sidebar' }).click(); await expect(page.getByTestId('calendar-sidebar')).toBeHidden(); await window.screenshot({ path: `/tmp/lumo-calendar-narrow-${theme}.png` });
  const overflow = await page.getByTestId('calendar-app').evaluate((node) => node.scrollWidth > node.clientWidth); expect(overflow).toBe(false); await expect(page.locator('vite-error-overlay')).toHaveCount(0); expect(consoleErrors).toEqual([]);
});

test('Unsaved event edits are protected and invalid times do not save', async ({ page }) => {
  await openCalendar(page); await page.getByRole('button', { name: 'New event', exact: true }).click(); await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Keep my changes');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click(); await expect(page.getByRole('alertdialog', { name: 'Discard unsaved changes?' })).toBeVisible();
  await page.getByRole('alertdialog', { name: 'Discard unsaved changes?' }).getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByLabel('Time zone', { exact: true }).fill('America/New_York'); await page.getByLabel('Start date', { exact: true }).fill('2026-03-08'); await page.getByLabel('End date', { exact: true }).fill('2026-03-08'); await page.getByLabel('Start time', { exact: true }).fill('02:30');
  await page.getByTestId('server-app-confirm-ok').click(); await expect(page.getByRole('alert')).toContainText('does not exist');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click(); await page.getByRole('button', { name: 'Discard', exact: true }).click(); await expect(page.getByTestId('calendar-editor')).toBeHidden();
});

test('Google setup uses only Calendar and keeps secrets out of browser storage', async ({ page }) => {
  const fixture = await piPage(page); let status = { configured: false, connected: false, name: '', redirectUri: '' }; const requests: Record<string, unknown>[] = [];
  await page.route('**/api/v1/calendar**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/notices')) return route.fulfill({ json: { ok: true, data: { notices: [] } } });
    if (path.endsWith('/google')) {
      if (route.request().method() === 'POST') { const body = route.request().postDataJSON(); requests.push(body); if (body.action === 'configure') status = { ...status, configured: true, redirectUri: body.config.redirectUri }; return route.fulfill({ json: { ok: true, data: { status } } }); }
      return route.fulfill({ json: { ok: true, data: status } });
    }
    return route.fulfill({ json: { ok: true, data: { collections: [], items: [] as CalendarItem[], occurrences: [], google: status } } });
  });
  await page.goto('http://localhost:5200'); await page.getByTestId('dock-app-calendar').click(); await page.getByRole('button', { name: 'Accounts', exact: true }).click();
  await page.getByRole('textbox', { name: 'Google Client ID' }).fill('official.apps.googleusercontent.com'); await page.getByLabel('Google Client secret').fill('test-private-secret'); await page.getByRole('button', { name: 'Save setup', exact: true }).click();
  await expect(page.getByTestId('calendar-google-connect')).toBeVisible(); expect(requests[0].action).toBe('configure');
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('test-private-secret'); expect(await page.evaluate(() => JSON.stringify(sessionStorage))).not.toContain('test-private-secret');
  await page.getByRole('tab', { name: 'Reminders', exact: true }).click(); await expect(page.getByTestId('calendar-google')).toBeHidden();
  expect(fixture.starts).toHaveLength(0);
});

test('Pi Calendar extension switch is precise, independent and persistent', async ({ page }) => {
  await piPage(page); await page.goto('http://localhost:5200'); await page.getByTestId('dock-app-pi').click(); await page.getByTestId('pi-settings-button').click(); await page.getByRole('tab', { name: 'Extensions', exact: true }).click();
  const toggle = page.getByTestId('pi-calendar-enabled'); await expect(toggle).toBeChecked(); await page.getByText('Calendar & Reminders', { exact: true }).click(); await expect(toggle).toBeChecked();
  await toggle.click(); await expect(toggle).not.toBeChecked(); await expect(page.getByTestId('pi-lumo-use')).toBeChecked(); await expect(page.getByTestId('pi-questions-enabled')).toBeChecked();
  await page.reload(); await page.getByTestId('dock-app-pi').click(); await page.getByTestId('pi-settings-button').click(); await page.getByRole('tab', { name: 'Extensions', exact: true }).click(); await expect(toggle).not.toBeChecked();
});

async function holdGesture(page: Page) { await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now() + 1000))); }
async function moveFingers(page: Page, delta: number, vertical = false) { await page.mouse.wheel(vertical ? 0 : delta, vertical ? delta : 0); await page.clock.runFor(24); }
async function releaseFingers(page: Page) { await page.clock.runFor(400); await expect(page.getByTestId('calendar-swipe-pane')).not.toHaveAttribute('data-swipe-state', /./); }
const swipeOffset = (page: Page) => page.getByTestId('calendar-swipe-track').evaluate((node) => { const matrix = new DOMMatrixReadOnly(getComputedStyle(node).transform); return node.parentElement?.dataset.swipeAxis === 'vertical' ? matrix.m42 : matrix.m41; });

test('Year snap starts promptly and skips settling when the next page is already aligned', async ({ page }) => {
  await openCalendar(page); await page.getByTestId('calendar-view-year').click(); await holdGesture(page);
  const pane = page.getByTestId('calendar-swipe-pane'), track = page.getByTestId('calendar-swipe-track');
  const heading = page.getByTestId('calendar-app').getByRole('heading', { level: 1 });
  await pane.hover(); await moveFingers(page, 20); await page.clock.runFor(40);
  await expect(pane).toHaveAttribute('data-swipe-state', 'dragging');
  await page.clock.runFor(24); await expect(pane).toHaveAttribute('data-swipe-state', 'settling');
  const shortDuration = await track.evaluate((node) => Number(node.getAnimations()[0].effect!.getTiming().duration));
  expect(shortDuration).toBeLessThanOrEqual(100);
  await expect(pane).not.toHaveAttribute('data-swipe-state', /./); await expect(heading).toHaveText('2026');
  await moveFingers(page, 280); await page.clock.runFor(64);
  await expect(pane).toHaveAttribute('data-swipe-state', 'settling');
  const longDuration = await track.evaluate((node) => Number(node.getAnimations()[0].effect!.getTiming().duration));
  expect(longDuration).toBeGreaterThan(shortDuration); expect(longDuration).toBeLessThanOrEqual(140);
  await expect(heading).toHaveText('2027');
  const width = await pane.evaluate((node) => node.clientWidth);
  await moveFingers(page, width); await page.clock.runFor(64);
  await expect(heading).toHaveText('2028'); await expect(pane).not.toHaveAttribute('data-swipe-state', /./);
  expect(await track.evaluate((node) => node.getAnimations().length)).toBe(0);
});

for (const theme of ['light', 'dark'] as const) test(`Year pages follow fingers, reverse and settle on release in ${theme}`, async ({ page }) => {
  const consoleErrors = errors(page); await openCalendar(page, 1440, theme); await page.getByTestId('calendar-view-year').click(); await holdGesture(page);
  const heading = page.getByTestId('calendar-app').getByRole('heading', { level: 1 });
  await page.getByTestId('calendar-swipe-pane').hover(); await moveFingers(page, 100); await expect.poll(() => swipeOffset(page)).toBeCloseTo(-100, 0);
  await moveFingers(page, -80); await expect.poll(() => swipeOffset(page)).toBeCloseTo(-20, 0); await releaseFingers(page); await expect(heading).toHaveText('2026');
  await moveFingers(page, 100); await releaseFingers(page); await expect(heading).toHaveText('2027');
  await moveFingers(page, -100); await releaseFingers(page); await expect(heading).toHaveText('2026'); expect(consoleErrors).toEqual([]);
});

const timelineMetrics = (page: Page) => page.getByTestId('calendar-timeline').evaluate((node) => {
  const column = node.querySelector<HTMLElement>('.calendar-time-column')!, row = column.querySelector<HTMLElement>('.calendar-hour-slot')!, header = node.querySelector<HTMLElement>('.calendar-time-head')!, allDay = node.querySelector<HTMLElement>('.calendar-all-day')!;
  const box = node.getBoundingClientRect(), width = column.getBoundingClientRect().width, height = row.getBoundingClientRect().height;
  const zone = node.querySelector<HTMLElement>('.calendar-timezone')!, label = allDay.querySelector<HTMLElement>('span')!, z = zone.getBoundingClientRect(), l = label.getBoundingClientRect();
  const headerClear = zone.contains(document.elementFromPoint(z.left + z.width / 2, z.top + z.height / 2)), allDayClear = label.contains(document.elementFromPoint(l.left + l.width / 2, l.top + l.height / 2));
  return { headerClear, allDayClear, left: node.scrollLeft, top: node.scrollTop, width, height, columns: (node.clientWidth - 52) / width, rows: (node.clientHeight - header.getBoundingClientRect().height - allDay.getBoundingClientRect().height) / height, headerTop: header.getBoundingClientRect().top, gutterLeft: node.querySelector<HTMLElement>('.calendar-hour-labels')!.getBoundingClientRect().left, edge: box.left + 52, viewportTop: box.top, overflow: node.closest<HTMLElement>('[data-testid="calendar-app"]')!.scrollWidth > node.closest<HTMLElement>('[data-testid="calendar-app"]')!.clientWidth };
});
const leadingDate = (page: Page) => page.getByTestId('calendar-timeline').evaluate((node) => {
  const left = node.getBoundingClientRect().left + 52;
  return [...node.querySelectorAll<HTMLElement>('.calendar-time-column')].sort((a, b) => Math.abs(a.getBoundingClientRect().left - left) - Math.abs(b.getBoundingClientRect().left - left))[0].dataset.date!;
});

async function moveTimeline(page: Page, delta: number, vertical = false) {
  const before = await page.getByTestId('calendar-timeline').evaluate(node => `${node.scrollLeft}:${node.scrollTop}:${node.querySelector('.calendar-time-column')?.getAttribute('data-date')}`);
  await moveFingers(page, delta, vertical);
  await expect.poll(() => page.getByTestId('calendar-timeline').evaluate(node => `${node.scrollLeft}:${node.scrollTop}:${node.querySelector('.calendar-time-column')?.getAttribute('data-date')}`)).not.toBe(before);
}

for (const theme of ['light', 'dark'] as const) for (const view of ['day', 'week'] as const) test(`${view} follows fingers and snaps to resized whole columns and hour rows in ${theme}`, async ({ page }) => {
  const consoleErrors = errors(page); await openCalendar(page, 1440, theme); await page.getByTestId(`calendar-view-${view}`).click(); await holdGesture(page);
  const scroller = page.getByTestId('calendar-timeline'); await scroller.hover(); await page.clock.runFor(300); await expect.poll(() => page.getByTestId('window-calendar').evaluate(node => node.getAnimations().length)).toBe(0);
  const initial = await timelineMetrics(page), firstDate = await leadingDate(page);
  expect(initial.headerClear).toBe(true); expect(initial.allDayClear).toBe(true); expect(Math.abs(initial.columns - Math.round(initial.columns)) * initial.width).toBeLessThan(1); expect(Math.abs(initial.rows - Math.round(initial.rows)) * initial.height).toBeLessThan(1); if (view === 'day') expect(Math.abs(initial.columns - 1) * initial.width).toBeLessThan(1);
  await moveTimeline(page, initial.width * .7); await expect.poll(async () => (await timelineMetrics(page)).left).toBeCloseTo(initial.left + initial.width * .7, 0);
  await moveTimeline(page, -initial.width * .4); await expect.poll(async () => (await timelineMetrics(page)).left).toBeCloseTo(initial.left + initial.width * .3, 0);
  await page.clock.runFor(300); expect((await timelineMetrics(page)).left).toBeCloseTo(initial.left, 0); expect(await leadingDate(page)).toBe(firstDate);
  await moveTimeline(page, initial.width * .7); await page.clock.runFor(112);
  const settling = await timelineMetrics(page); expect(settling.left).toBeGreaterThan(initial.left + initial.width * .7); expect(settling.left).toBeLessThan(initial.left + initial.width);
  await moveTimeline(page, -initial.width * .5); await expect.poll(async () => (await timelineMetrics(page)).left).toBeCloseTo(settling.left - initial.width * .5, 0);
  await page.clock.runFor(300); expect((await timelineMetrics(page)).left).toBeCloseTo(initial.left, 0);
  await moveTimeline(page, initial.width * .7); await page.clock.runFor(300); expect((await timelineMetrics(page)).left).toBeCloseTo(initial.left + initial.width, 0);
  expect(await leadingDate(page)).toBe(new Date(new Date(`${firstDate}T12:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10));
  expect((await timelineMetrics(page)).gutterLeft).toBeCloseTo(initial.gutterLeft, 0);
  const beforeVertical = await timelineMetrics(page); await moveTimeline(page, initial.height * .7, true);
  await expect.poll(async () => (await timelineMetrics(page)).top).toBeCloseTo(beforeVertical.top + initial.height * .7, 0);
  await page.clock.runFor(300); expect((await timelineMetrics(page)).top).toBeCloseTo(beforeVertical.top + initial.height, 0); expect((await timelineMetrics(page)).headerTop).toBeCloseTo(initial.headerTop, 0);
  await page.emulateMedia({ reducedMotion: 'reduce' }); await moveTimeline(page, initial.width * .7); await page.clock.runFor(300);
  expect((await timelineMetrics(page)).left).toBeCloseTo(initial.left + initial.width * 2, 0); expect(await page.getByTestId('calendar-swipe-track').evaluate(node => node.getAnimations().length)).toBe(0);
  await expect.poll(() => leadingDate(page)).toBe(new Date(new Date(`${firstDate}T12:00:00Z`).getTime() + 2 * 86400000).toISOString().slice(0, 10));
  const preserved = await leadingDate(page), hour = Math.round((await timelineMetrics(page)).top / initial.height);
  await page.setViewportSize({ width: 420, height: 650 }); await page.clock.runFor(200); await page.getByRole('button', { name: 'Hide sidebar', exact: true }).click(); await page.clock.runFor(300);
  const narrow = await timelineMetrics(page); expect(Math.abs(narrow.columns - Math.round(narrow.columns)) * narrow.width).toBeLessThan(1); expect(Math.abs(narrow.rows - Math.round(narrow.rows)) * narrow.height).toBeLessThan(1); expect(narrow.width).not.toBeCloseTo(initial.width, 0); expect(narrow.height).not.toBeCloseTo(initial.height, 0);
  expect(await leadingDate(page)).toBe(preserved); expect(Math.round(narrow.top / narrow.height)).toBe(hour); expect(narrow.overflow).toBe(false); expect(narrow.headerClear).toBe(true); expect(narrow.allDayClear).toBe(true);
  await scroller.hover(); await moveTimeline(page, narrow.width * .7); await page.clock.runFor(300); expect((await timelineMetrics(page)).left).toBeCloseTo(narrow.left + narrow.width, 0);
  await moveTimeline(page, narrow.height * .7, true); await page.clock.runFor(300); expect(Math.abs((await timelineMetrics(page)).top - narrow.top - narrow.height)).toBeLessThan(1);
  await page.getByTestId('window-calendar').screenshot({ path: `/tmp/lumo-calendar-${view}-grid-narrow-${theme}.png` }); expect(consoleErrors).toEqual([]);
});

for (const view of ['day', 'week'] as const) test(`${view} preserves its date and hour through animated window maximization`, async ({ page }) => {
  await openCalendar(page); await page.getByTestId(`calendar-view-${view}`).click(); await holdGesture(page); await page.clock.runFor(300);
  await expect.poll(() => page.getByTestId('window-calendar').evaluate(node => node.getAnimations().length)).toBe(0);
  const initial = await timelineMetrics(page), date = await leadingDate(page);
  await page.getByRole('button', { name: 'Maximize Calendar', exact: true }).click(); await page.clock.runFor(500);
  await expect.poll(() => page.getByTestId('window-calendar').evaluate(node => node.getAnimations().length)).toBe(0);
  await expect.poll(() => leadingDate(page)).toBe(date); const larger = await timelineMetrics(page); expect(Math.round(larger.top / larger.height)).toBe(Math.round(initial.top / initial.height));
  await page.getByRole('button', { name: 'Restore Calendar', exact: true }).click(); await page.clock.runFor(500);
  await expect.poll(() => leadingDate(page)).toBe(date); const restored = await timelineMetrics(page); expect(Math.round(restored.top / restored.height)).toBe(Math.round(initial.top / initial.height));
});

test('Continuous day columns reveal real events and preserve the visible hour', async ({ page }) => {
  await openCalendar(page); await page.getByRole('button', { name: 'New event', exact: true }).click(); await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Tomorrow roadmap');
  await page.getByLabel('Start date', { exact: true }).fill('2026-10-02'); await page.getByLabel('End date', { exact: true }).fill('2026-10-02'); await save(page);
  await page.getByTestId('calendar-view-day').click(); await holdGesture(page); const scroller = page.getByTestId('calendar-timeline'); await scroller.hover();
  const initial = await timelineMetrics(page); await moveTimeline(page, initial.width * .7); await expect(page.getByTestId('calendar-timed-event')).toContainText('Tomorrow roadmap'); await expect(page.getByTestId('calendar-timed-event')).toBeInViewport();
  await page.clock.runFor(300); expect(await leadingDate(page)).toBe('2026-10-02'); expect((await timelineMetrics(page)).top).toBeCloseTo(initial.top, 0);
  await moveTimeline(page, initial.width * 28); await page.clock.runFor(300); expect(await leadingDate(page)).toBe('2026-10-30');
  await moveTimeline(page, initial.width * 7); await page.clock.runFor(300); expect(await leadingDate(page)).toBe('2026-11-06'); await expect(page.getByTestId('calendar-app').getByRole('heading', { level: 1 })).toHaveText('Friday, November 6, 2026');
  await moveTimeline(page, -initial.width * 35); await page.clock.runFor(300); expect(await leadingDate(page)).toBe('2026-10-02'); await expect(page.getByTestId('calendar-timed-event')).toContainText('Tomorrow roadmap');
});

test('Opening a sheet cancels pending grid settling', async ({ page }) => {
  await openCalendar(page); await page.getByTestId('calendar-view-day').click(); await holdGesture(page); const scroller = page.getByTestId('calendar-timeline'); await scroller.hover();
  const initial = await timelineMetrics(page); await moveTimeline(page, initial.width * .3);
  await page.getByRole('button', { name: 'New event', exact: true }).click(); await page.clock.runFor(500); expect((await timelineMetrics(page)).left).toBeCloseTo(initial.left + initial.width * .3, 0);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click(); await page.emulateMedia({ reducedMotion: 'reduce' }); await scroller.hover(); await moveTimeline(page, initial.width * .7); await page.clock.runFor(300); expect(await leadingDate(page)).toBe('2026-10-02');
});

test('Calendar swipes leave sheets, search, details and Reminders alone', async ({ page }) => {
  await openCalendar(page); await page.clock.resume();
  const heading = page.getByTestId('calendar-app').getByRole('heading', { level: 1 });
  await page.getByRole('textbox', { name: 'Search events' }).hover(); await page.mouse.wheel(0, 140);
  await page.getByTestId('calendar-sidebar').hover(); await page.mouse.wheel(0, 140); await expect(heading).toHaveText('October 2026');
  await page.getByRole('button', { name: 'New event', exact: true }).click();
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Swipe boundary');
  await page.getByTestId('calendar-editor').hover(); await page.mouse.wheel(0, 140); await save(page);
  await page.getByTestId('calendar-event').filter({ hasText: 'Swipe boundary' }).click();
  await page.getByTestId('calendar-detail').hover(); await page.mouse.wheel(0, 140); await expect(heading).toHaveText('October 2026');
  await page.getByRole('button', { name: 'Close details' }).click();
  await page.waitForTimeout(300); await page.getByTestId('calendar-swipe-pane').hover(); await page.keyboard.down('Control'); await page.mouse.wheel(12, -140); await page.keyboard.up('Control'); await expect(heading).toHaveText('October 2026');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(300); await page.mouse.wheel(0, 620); await expect(heading).toHaveText('November 2026');
  expect(await page.getByTestId('calendar-swipe-pane').evaluate((node) => node.getAnimations().length)).toBe(0);
  await page.getByRole('tab', { name: 'Reminders', exact: true }).click(); await page.getByTestId('calendar-reminders').hover(); await page.mouse.wheel(0, 140);
  await page.getByRole('tab', { name: 'Calendar', exact: true }).click(); await expect(heading).toHaveText('November 2026');
});

for (const theme of ['light', 'dark'] as const) test(`Month snaps to window-sized rows and highlights the dominant month in ${theme}`, async ({ page }) => {
  const consoleErrors = errors(page); await openCalendar(page, 1440, theme); await holdGesture(page);
  const scroller = page.getByTestId('calendar-month'), weekdays = page.getByTestId('calendar-month-weekdays');
  const heading = page.getByTestId('calendar-app').getByRole('heading', { level: 1 });
  await expect.poll(() => page.getByTestId('window-calendar').evaluate((node) => node.getAnimations().length)).toBe(0);
  const headerTop = (await weekdays.boundingBox())!.y;
  const initial = await scroller.evaluate((node) => node.scrollTop);
  const rowHeight = await page.locator('.calendar-month-cell').first().evaluate((node) => node.getBoundingClientRect().height);
  expect(await scroller.evaluate((node) => node.clientHeight)).toBeCloseTo(rowHeight * 5, 0);
  await scroller.hover(); await moveFingers(page, 40, true);
  await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBeCloseTo(initial + 40, 0);
  await page.clock.runFor(500); await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBeCloseTo(initial, 0);
  await moveFingers(page, rowHeight * .7, true);
  await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBeCloseTo(initial + rowHeight * .7, 0);
  await moveFingers(page, -rowHeight * .4, true);
  await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBeCloseTo(initial + rowHeight * .3, 0);
  await page.clock.runFor(500); await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBeCloseTo(initial, 0);
  await moveFingers(page, rowHeight * .7, true);
  await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBeCloseTo(initial + rowHeight * .7, 0);
  await page.clock.runFor(112);
  const settlingTop = await scroller.evaluate((node) => node.scrollTop);
  expect(settlingTop).toBeGreaterThan(initial + rowHeight * .7); expect(settlingTop).toBeLessThan(initial + rowHeight);
  await moveFingers(page, -rowHeight * .5, true);
  await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBeCloseTo(settlingTop - rowHeight * .5, 0);
  await page.clock.runFor(500); await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBeCloseTo(initial, 0);
  await moveFingers(page, rowHeight * .7, true);
  await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBeCloseTo(initial + rowHeight * .7, 0);
  await page.clock.runFor(240); await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBeCloseTo(initial + rowHeight, 0);
  await moveFingers(page, -rowHeight, true); await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBeCloseTo(initial, 0);
  await page.mouse.wheel(180, 0); await page.clock.runFor(200); expect(await scroller.evaluate((node) => node.scrollTop)).toBeCloseTo(initial, 0);
  await moveFingers(page, rowHeight * 2, true); await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBeCloseTo(initial + rowHeight * 2, 0);
  await expect(heading).toHaveText('October 2026');
  await moveFingers(page, rowHeight, true); await expect(heading).toHaveText('November 2026');
  await expect(scroller.getByRole('button', { name: 'Open Sunday, November 1, 2026', exact: true })).not.toHaveClass(/calendar-other/);
  await expect(scroller.getByRole('button', { name: 'Open Sunday, November 1, 2026', exact: true }).locator('..')).not.toHaveClass(/calendar-other/);
  await expect(scroller.getByRole('button', { name: 'Open Sunday, October 25, 2026', exact: true }).locator('..')).toHaveClass(/calendar-other/);
  expect((await weekdays.boundingBox())!.y).toBe(headerTop);
  await page.clock.runFor(500);
  await page.getByTestId('window-calendar').screenshot({ path: `/tmp/lumo-calendar-row-snap-${theme}.png` });
  await moveFingers(page, -rowHeight * 3, true); await expect(heading).toHaveText('October 2026');
  await moveFingers(page, rowHeight * 14, true); await expect(heading).toHaveText('January 2027');
  await moveFingers(page, -rowHeight * 14, true); await expect(heading).toHaveText('October 2026');
  for (const month of ['December 2026', 'March 2027', 'May 2027', 'July 2027']) { await moveFingers(page, rowHeight * 10, true); await expect(heading).toHaveText(month); }
  for (const month of ['May 2027', 'March 2027', 'December 2026', 'October 2026']) { await moveFingers(page, -rowHeight * 10, true); await expect(heading).toHaveText(month); }
  await page.getByRole('button', { name: 'Next month', exact: true }).click(); await expect(page.getByTestId('calendar-sidebar-mini').getByRole('heading')).toHaveText('November 2026'); await expect(heading).toHaveText('October 2026');
  await page.getByRole('button', { name: 'Previous month', exact: true }).click(); await expect(page.getByTestId('calendar-sidebar-mini').getByRole('heading')).toHaveText('October 2026');
  await page.getByRole('button', { name: 'Today', exact: true }).click(); await expect(heading).toHaveText('October 2026');
  await expect(scroller.getByRole('button', { name: 'Open Thursday, October 1, 2026', exact: true })).toBeInViewport();
  expect(await page.getByTestId('calendar-swipe-track').evaluate((node) => node.getAnimations().length)).toBe(0);
  await page.emulateMedia({ reducedMotion: 'reduce' }); await scroller.hover(); await moveFingers(page, rowHeight * .7, true);
  await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBeCloseTo(initial + rowHeight * .7, 0); await page.clock.runFor(500);
  await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBeCloseTo(initial + rowHeight, 0);
  await page.setViewportSize({ width: 420, height: 650 }); await page.clock.runFor(100);
  await page.getByRole('button', { name: 'Hide sidebar', exact: true }).click();
  const narrowHeaderTop = (await weekdays.boundingBox())!.y;
  const narrowHeight = await page.locator('.calendar-month-cell').first().evaluate((node) => node.getBoundingClientRect().height);
  expect((await scroller.evaluate((node) => node.clientHeight)) / narrowHeight).toBeCloseTo(Math.round((await scroller.evaluate((node) => node.clientHeight)) / narrowHeight), 5);
  await scroller.hover(); const narrowTop = await scroller.evaluate((node) => node.scrollTop);
  await moveFingers(page, narrowHeight * .7, true); await expect.poll(async () => Math.abs((await scroller.evaluate((node) => node.scrollTop)) - narrowTop - narrowHeight * .7)).toBeLessThan(1); await page.clock.runFor(500);
  await expect.poll(async () => Math.abs((await scroller.evaluate((node) => node.scrollTop)) - narrowTop - narrowHeight)).toBeLessThan(1);
  expect((await weekdays.boundingBox())!.y).toBe(narrowHeaderTop);
  await page.getByTestId('window-calendar').screenshot({ path: `/tmp/lumo-calendar-row-snap-narrow-${theme}.png` });
  expect(consoleErrors).toEqual([]);
});
