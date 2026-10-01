// SPDX-License-Identifier: AGPL-3.0-only
import { clickPreviewTool } from '../preview-tools';
import { expect, test } from '../offline';

test('Image Preview zooms on double-click, fits proportionally and remembers Fit or 100%', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  const requests: string[] = [];
  let images: Record<string, string> = {};
  await page.route('**/api/v1/**', (route) => {
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
