// SPDX-License-Identifier: AGPL-3.0-only
import { nativeAppRoute } from './native-app-fixture';
import { clickPreviewTool } from '../preview-tools';
import { expect, test, type Page } from '../offline';

async function openImage(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  const requests: string[] = [];
  let images: Record<string, string> = {};
  await page.route('**/api/v1/**', async (route) => {
    if (await nativeAppRoute(route)) return;
    const url = new URL(route.request().url());
    let data: unknown = {};
    if (url.pathname.endsWith('/apps')) data = { apps: [], capabilities: {} };
    if (url.pathname.endsWith('/auth/session')) data = { user: { name: 'user', uid: 1000, gid: 1000, home: '/home/user' } };
    if (url.pathname.endsWith('/files/list')) data = { path: '/home/user', entries: ['landscape.png', 'small.png', 'portrait.png', 'photo.JPG', 'picture.webp', 'damaged.png', 'huge.png'].map((name) => ({ name, type: 'file', sizeBytes: 1234, mode: '0644', modifiedAt: '2026-09-29T12:00:00Z' })) };
    if (url.pathname.endsWith('/files/read')) {
      expect(url.searchParams.get('preview')).toBe('image');
      const name = url.searchParams.get('path')!.split('/').at(-1)!; requests.push(name);
      data = { path: url.searchParams.get('path'), encoding: 'binary', revision: '', content: name === 'damaged.png' ? 'bm90IGFuIGltYWdl' : images[name] ?? null, sizeBytes: name === 'huge.png' ? 33 * 1024 * 1024 : 1234, truncated: name === 'huge.png' };
    }
    return route.fulfill({ json: { ok: true, data } });
  });
  await page.goto('http://localhost:5200');
  images = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 1600; canvas.height = 900;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#a6cdd0'; ctx.fillRect(0, 0, 1600, 900);
    ctx.fillStyle = '#e8d6ae'; ctx.beginPath(); ctx.arc(1230, 210, 100, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#537779'; ctx.beginPath(); ctx.moveTo(0, 900); ctx.lineTo(510, 220); ctx.lineTo(1080, 900); ctx.fill();
    ctx.fillStyle = '#36585f'; ctx.beginPath(); ctx.moveTo(600, 900); ctx.lineTo(1120, 400); ctx.lineTo(1600, 900); ctx.fill();
    const images = Object.fromEntries([['landscape.png', 'image/png'], ['photo.JPG', 'image/jpeg'], ['picture.webp', 'image/webp']].map(([name, mime]) => [name, canvas.toDataURL(mime).split(',')[1]]));
    for (const [name, width, height] of [['small.png', 160, 90], ['portrait.png', 600, 1200]] as const) {
      canvas.width = width; canvas.height = height;
      ctx.fillStyle = '#537779'; ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#e8d6ae'; ctx.fillRect(width / 4, height / 4, width / 2, height / 2);
      images[name] = canvas.toDataURL('image/png').split(',')[1];
    }
    return images;
  });
  await page.getByTestId('dock-app-files').click();
  await page.getByTestId('file-row-landscape.png').dblclick();
  const image = page.getByTestId('preview-image');
  await expect(image).toBeVisible();
  return { image, requests, errors };
}

test('Image Preview zooms on double-click, fits proportionally and remembers Fit or 100%', async ({ page }) => {
  const { image, requests, errors } = await openImage(page);
  await expect(page.getByTestId('preview-image-dimensions')).toHaveText('1600 × 900');
  await expect(page.getByTestId('editor-save')).toHaveCount(0);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme });
      const bounds = await image.boundingBox(); const pane = await page.getByTestId('preview-image-content').boundingBox();
      expect(bounds!.width).toBeLessThanOrEqual(pane!.width); expect(bounds!.height).toBeLessThanOrEqual(pane!.height);
      expect(bounds!.width / bounds!.height).toBeCloseTo(1600 / 900, 1);
      expect(Math.min(pane!.width - bounds!.width, pane!.height - bounds!.height)).toBeLessThan(1);
      await image.dblclick();
      await expect.poll(async () => (await image.boundingBox())!.width).toBeGreaterThan(bounds!.width);
      const surface = page.getByTestId('preview-image-content');
      const area = (await surface.boundingBox())!;
      const before = await surface.evaluate((node) => ({ left: node.scrollLeft, top: node.scrollTop }));
      await expect(image).toHaveCSS('cursor', 'grab');
      await page.mouse.move(area.x + area.width / 2, area.y + area.height / 2);
      await page.mouse.down();
      await page.mouse.move(area.x + area.width / 2 - 80, area.y + area.height / 2 - 60, { steps: 4 });
      await expect(image).toHaveCSS('cursor', 'grabbing');
      expect(await surface.evaluate((node) => node.scrollLeft)).toBeGreaterThan(before.left);
      expect(await surface.evaluate((node) => node.scrollTop)).toBeGreaterThan(before.top);
      await page.mouse.move(area.x - 10, area.y - 10, { steps: 4 });
      await expect(image).toHaveCSS('cursor', 'grabbing');
      await page.mouse.up();
      await expect(image).toHaveCSS('cursor', 'grab');
      const released = await surface.evaluate((node) => ({ left: node.scrollLeft, top: node.scrollTop }));
      await page.mouse.move(area.x + area.width / 2 - 120, area.y + area.height / 2 - 100);
      expect(await surface.evaluate((node) => ({ left: node.scrollLeft, top: node.scrollTop }))).toEqual(released);
      await image.dblclick();
      await expect.poll(async () => (await image.boundingBox())!.width).toBeCloseTo(bounds!.width, 0);
      await page.screenshot({ path: `/tmp/lumo-image-preview-${width}-${theme}.png`, animations: 'disabled' });
    }
  }
  await clickPreviewTool(page, 'preview-image-size');
  await expect.poll(async () => (await image.boundingBox())!.width).toBe(1600);
  await image.dblclick();
  await expect.poll(async () => (await image.boundingBox())!.width).toBe(3200);
  await image.dblclick();
  await expect.poll(async () => (await image.boundingBox())!.width).toBe(1600);
  await page.getByRole('button', { name: 'Close Preview', exact: true }).click();
  await page.getByTestId('file-row-landscape.png').dblclick();
  await expect(image).toBeVisible();
  await expect(page.getByTestId('preview-image-size')).toHaveText('Fit');
  await expect.poll(async () => (await image.boundingBox())!.width).toBe(1600);
  await page.reload();
  await expect(image).toBeVisible();
  await expect.poll(async () => (await image.boundingBox())!.width).toBe(1600);
  await clickPreviewTool(page, 'preview-image-size');
  await page.getByRole('button', { name: 'Close Preview', exact: true }).click();
  await page.getByTestId('file-row-landscape.png').dblclick();
  await expect(image).toBeVisible();
  await expect(page.getByTestId('preview-image-size')).toHaveText('100%');
  await page.reload();
  await expect(image).toBeVisible();
  await expect(page.getByTestId('preview-image-size')).toHaveText('100%');
  const readsBeforeRefresh = requests.length;
  await clickPreviewTool(page, 'preview-refresh'); await expect(image).toBeVisible();
  expect(requests).toHaveLength(readsBeforeRefresh + 1);
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const [name, ratio] of [['small.png', 160 / 90], ['portrait.png', 600 / 1200]] as const) {
    await clickPreviewTool(page, 'preview-open');
    await page.getByTestId(`file-picker-entry-${name}`).dblclick();
    await expect(image).toBeVisible();
    const bounds = await image.boundingBox(); const pane = await page.getByTestId('preview-image-content').boundingBox();
    expect(bounds!.width / bounds!.height).toBeCloseTo(ratio, 2);
    expect(Math.min(pane!.width - bounds!.width, pane!.height - bounds!.height)).toBeLessThan(1);
    if (name === 'small.png') expect(bounds!.width).toBeGreaterThan(160);
    await image.dblclick();
    await expect.poll(async () => (await image.boundingBox())!.width).toBeGreaterThan(bounds!.width);
    await image.dblclick();
    await expect.poll(async () => (await image.boundingBox())!.width).toBeCloseTo(bounds!.width, 0);
    await page.getByRole('button', { name: 'Maximize Preview', exact: true }).click();
    await expect.poll(async () => {
      const bounds = (await image.boundingBox())!; const pane = (await page.getByTestId('preview-image-content').boundingBox())!;
      return Math.abs(Math.min(pane.width - bounds.width, pane.height - bounds.height));
    }).toBeLessThan(1);
    expect((await image.boundingBox())!.width / (await image.boundingBox())!.height).toBeCloseTo(ratio, 2);
    await page.getByRole('button', { name: 'Restore Preview', exact: true }).click();
  }
  for (const name of ['photo.JPG', 'picture.webp', 'damaged.png', 'huge.png']) {
    await clickPreviewTool(page, 'preview-open');
    await page.getByTestId(`file-picker-entry-${name}`).dblclick();
    if (name === 'damaged.png') await expect(page.getByRole('alert')).toContainText('could not be displayed');
    else if (name === 'huge.png') await expect(page.getByRole('alert')).toContainText('32 MiB');
    else { await expect(image).toBeVisible(); await expect(page.getByTestId('preview-image-dimensions')).toHaveText('1600 × 900'); }
  }
  await expect(image).toHaveCount(0);
  expect(errors).toEqual([]);
});


for (const [width, theme] of [[1440, 'light'], [390, 'dark']] as const) {
  test(`Pinch zoom stays within Image Preview at ${width}px in ${theme}`, async ({ page }) => {
    const { image, errors } = await openImage(page);
    await page.setViewportSize({ width, height: 900 }); await page.emulateMedia({ colorScheme: theme });
    const surface = page.getByTestId('preview-image-content');
    const desktop = page.locator('main.desktop');
    const baseline = await desktop.boundingBox();
    const browserScale = await page.evaluate(() => visualViewport!.scale);
    const before = (await image.boundingBox())!;
    const point = { x: before.x + before.width * .65, y: before.y + before.height / 2 };
    const dispatchPinch = async (deltaY: number) => surface.evaluate((node, params) => {
      const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: params.deltaY, clientX: params.x, clientY: params.y });
      node.dispatchEvent(event); return event.defaultPrevented;
    }, { ...point, deltaY });
    expect(await dispatchPinch(-70)).toBe(true);
    await expect.poll(async () => (await image.boundingBox())!.width).toBeGreaterThan(before.width * 1.9);
    const enlarged = (await image.boundingBox())!;
    expect((point.x - enlarged.x) / enlarged.width).toBeCloseTo(.65, 2);
    expect((point.y - enlarged.y) / enlarged.height).toBeCloseTo(.5, 2);
    expect(await dispatchPinch(70)).toBe(true);
    await expect.poll(async () => (await image.boundingBox())!.width).toBeCloseTo(before.width, 0);
    const otherWindow = page.getByTestId('window-files');
    expect(await otherWindow.evaluate((node) => {
      const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -70 });
      node.dispatchEvent(event); return event.defaultPrevented;
    })).toBe(true);
    expect(await desktop.boundingBox()).toEqual(baseline);
    expect(await page.evaluate(() => visualViewport!.scale)).toBe(browserScale);
    await expect.poll(async () => (await image.boundingBox())!.width).toBeCloseTo(before.width, 0);
    expect(await surface.evaluate((node) => {
      const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 30 });
      node.dispatchEvent(event); return event.defaultPrevented;
    })).toBe(false);
    await dispatchPinch(-100);
    await dispatchPinch(-100);
    const area = (await surface.boundingBox())!;
    await page.mouse.move(area.x + area.width / 2, area.y + area.height / 2);
    const top = await surface.evaluate((node) => node.scrollTop);
    await page.mouse.wheel(0, 100);
    await expect.poll(() => surface.evaluate((node) => node.scrollTop)).toBeGreaterThan(top);
    expect(await desktop.boundingBox()).toEqual(baseline);
    expect(errors).toEqual([]);
  });
}

test('Image Preview handles touch pinching, cancellation and WebKit gesture scales', async ({ page, context }) => {
  const { image, errors } = await openImage(page);
  const surface = page.getByTestId('preview-image-content');
  const before = (await image.boundingBox())!;
  const point = { x: before.x + before.width / 2, y: before.y + before.height / 2 };
  const session = await context.newCDPSession(page);
  await session.send('Input.synthesizePinchGesture', { ...point, scaleFactor: 1.5, gestureSourceType: 'mouse' });
  await expect.poll(async () => (await image.boundingBox())!.width).toBeGreaterThan(before.width * 1.1);
  expect(await page.evaluate(() => visualViewport!.scale)).toBe(1);
  await clickPreviewTool(page, 'preview-image-size');
  await expect.poll(async () => (await image.boundingBox())!.width).toBeCloseTo(before.width, 0);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x: point.x - 40, y: point.y }, { id: 2, x: point.x + 40, y: point.y }] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 1, x: point.x - 80, y: point.y }, { id: 2, x: point.x + 80, y: point.y }] });
  await expect.poll(async () => (await image.boundingBox())!.width).toBeGreaterThan(before.width * 1.8);
  await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await expect(surface).not.toHaveClass(/is-panning/);
  const after = (await image.boundingBox())!.width;
  const left = await surface.evaluate((node) => node.scrollLeft);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 3, ...point }] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 3, x: point.x - 40, y: point.y }] });
  await expect.poll(() => surface.evaluate((node) => node.scrollLeft)).toBeGreaterThan(left);
  await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await surface.evaluate((node, point) => {
    for (const [type, scale] of [['gesturestart', 1], ['gesturechange', .75], ['gestureend', .75]] as const) {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.assign(event, { scale, clientX: point.x, clientY: point.y }); node.dispatchEvent(event);
      if (!event.defaultPrevented) throw new Error('Browser gesture was not canceled.');
    }
  }, point);
  await expect.poll(async () => (await image.boundingBox())!.width).toBeCloseTo(after * .75, 0);
  await clickPreviewTool(page, 'preview-image-size');
  await expect.poll(async () => (await image.boundingBox())!.width).toBeCloseTo(before.width, 0);
  expect(await page.evaluate(() => visualViewport!.scale)).toBe(1);
  expect(errors).toEqual([]);
});
