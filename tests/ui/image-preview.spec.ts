// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '../offline';

test('Files opens PNG, JPEG and WebP images with fit, actual size, refresh and file selection', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  const requests: string[] = [];
  let images: Record<string, string> = {};
  await page.route('**/api/v1/**', (route) => {
    const url = new URL(route.request().url());
    let data: unknown = {};
    if (url.pathname.endsWith('/auth/session')) data = { user: { name: 'user', uid: 1000, gid: 1000, home: '/home/user' } };
    if (url.pathname.endsWith('/files/list')) data = { path: '/home/user', entries: ['landscape.png', 'photo.JPG', 'picture.webp', 'damaged.png', 'huge.png'].map((name) => ({ name, type: 'file', sizeBytes: 1234, mode: '0644', modifiedAt: '2026-09-29T12:00:00Z' })) };
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
    return Object.fromEntries([['landscape.png', 'image/png'], ['photo.JPG', 'image/jpeg'], ['picture.webp', 'image/webp']].map(([name, mime]) => [name, canvas.toDataURL(mime).split(',')[1]]));
  });
  await page.getByTestId('dock-app-files').click();
  await page.getByTestId('file-row-landscape.png').dblclick();
  const image = page.getByTestId('preview-image');
  await expect(image).toBeVisible();
  await expect(page.getByTestId('preview-image-dimensions')).toHaveText('1600 × 900');
  await expect(page.getByTestId('editor-save')).toHaveCount(0);
  for (const [width, theme] of [[1440, 'light'], [390, 'dark']] as const) {
    await page.setViewportSize({ width, height: 900 }); await page.emulateMedia({ colorScheme: theme });
    const bounds = await image.boundingBox(); const pane = await page.getByTestId('preview-image-content').boundingBox();
    expect(bounds!.width).toBeLessThanOrEqual(pane!.width); expect(bounds!.height).toBeLessThanOrEqual(pane!.height);
    expect(bounds!.width / bounds!.height).toBeCloseTo(1600 / 900, 1);
    await page.screenshot({ path: `/tmp/lumo-image-preview-${theme}.png`, animations: 'disabled' });
  }
  await page.getByTestId('preview-image-size').click();
  expect((await image.boundingBox())!.width).toBe(1600);
  await page.getByTestId('preview-image-size').click();
  const readsBeforeRefresh = requests.length;
  await page.getByTestId('preview-refresh').click(); await expect(image).toBeVisible();
  expect(requests).toHaveLength(readsBeforeRefresh + 1);
  for (const name of ['photo.JPG', 'picture.webp', 'damaged.png', 'huge.png']) {
    await page.getByTestId('preview-open').click();
    await page.getByTestId(`file-picker-entry-${name}`).dblclick();
    if (name === 'damaged.png') await expect(page.getByRole('alert')).toContainText('could not be displayed');
    else if (name === 'huge.png') await expect(page.getByRole('alert')).toContainText('32 MiB');
    else { await expect(image).toBeVisible(); await expect(page.getByTestId('preview-image-dimensions')).toHaveText('1600 × 900'); }
  }
  await expect(image).toHaveCount(0);
  expect(errors).toEqual([]);
});
