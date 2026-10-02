// SPDX-License-Identifier: AGPL-3.0-only
import { clickPreviewTool } from '../preview-tools';
import { expect, test } from '../offline';

test.use({ serviceWorkers: 'allow' });

const html = '<!doctype html><html><head><style>body { margin: 32px; color: #243a45; background: #eef3f4; font-family: sans-serif; } h1 { font-size: 32px; } article { padding: 24px; background: white; border-radius: 12px; }</style></head><body><article><h1>Project overview</h1><p>A local HTML document.</p><a href="#details">Details</a><h2 id="details">Details</h2><p>Rendered directly in Preview.</p></article></body></html>';

test('HTML renders isolated local content and keeps raw editing, save and refresh', async ({ page, context }) => {
  let content = html; let revision = 'first';
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = {};
    if (path.endsWith('/apps')) data = { apps: [], capabilities: {} };
    if (path.endsWith('/auth/session')) data = { user: { name: 'user', uid: 1000, gid: 1000, home: '/home/user' } };
    if (path.endsWith('/files/list')) data = { path: '/home/user', entries: [{ name: 'index.html', type: 'file', sizeBytes: content.length, mode: '0644', modifiedAt: '2026-09-29T12:00:00Z' }] };
    if (path.endsWith('/files/read')) data = { encoding: 'utf-8', content: Buffer.from(content).toString('base64'), revision, truncated: false, sizeBytes: content.length };
    if (path.endsWith('/files/write')) { content = Buffer.from(route.request().postDataJSON().content, 'base64').toString(); revision = 'saved'; data = { revision, sizeBytes: content.length }; }
    return route.fulfill({ json: { ok: true, data } });
  });
  await page.goto('http://localhost:5200'); await page.getByTestId('dock-app-files').click();
  await page.getByTestId('file-row-index.html').dblclick();
  const frame = page.frameLocator('[data-testid="preview-html"]');
  await expect(frame.getByRole('heading', { name: 'Project overview' })).toBeVisible();
  await expect(frame.locator('body')).toHaveCSS('background-color', 'rgb(238, 243, 244)');
  for (const [width, theme] of [[1440, 'light'], [390, 'dark']] as const) {
    await page.setViewportSize({ width, height: 900 }); await page.emulateMedia({ colorScheme: theme });
    await expect(frame.getByRole('heading', { name: 'Project overview' })).toBeVisible();
    await page.screenshot({ path: `/tmp/lumo-html-preview-${theme}.png`, animations: 'disabled' });
  }
  expect(await frame.locator('body').evaluate((node) => { const e = new WheelEvent('wheel', {ctrlKey:true, bubbles:true, cancelable:true}); node.dispatchEvent(e); return e.defaultPrevented; })).toBe(true);
  const session = await context.newCDPSession(page);
  const bounds = (await page.getByTestId('preview-html').boundingBox())!;
  await session.send('Input.synthesizePinchGesture', { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2, scaleFactor: 2, gestureSourceType: 'mouse' });
  expect(await page.evaluate(() => visualViewport!.scale)).toBe(1);
  await clickPreviewTool(page, 'preview-mode-raw');
  await page.getByTestId('editor-input').fill(html.replace('Project overview', 'Updated overview') + '<script>window.previewContentExecuted = true; parent.document.body.textContent="escaped"</script><meta http-equiv="refresh" content="0;url=https://example.invalid/escape"><img src="https://example.invalid/image.png" onerror="window.previewContentExecuted = true"><a href="https://example.invalid/link">External</a><iframe src="https://example.invalid/frame"></iframe>');
  await clickPreviewTool(page, 'preview-mode-rendered');
  await expect(frame.getByRole('heading', { name: 'Updated overview' })).toBeVisible();
  await expect(page.getByTestId('preview-save-status')).toHaveText('Unsaved changes');
  await expect(page.getByTestId('preview-html')).toHaveAttribute('sandbox', 'allow-scripts');
  await expect(frame.locator('script')).toHaveCount(1);
  await expect(frame.locator('script')).not.toContainText('escaped');
  await expect(frame.locator('iframe, meta[http-equiv="refresh"]')).toHaveCount(0);
  await expect(page.locator('body')).not.toHaveText('escaped');
  expect(await frame.locator('body').evaluate(() => Reflect.get(window, 'previewContentExecuted'))).toBeUndefined();
  await expect(frame.getByText('External', { exact: true })).not.toHaveAttribute('href');
  await clickPreviewTool(page, 'editor-save');
  await expect(page.getByTestId('preview-save-status')).toHaveText('Saved');
  await clickPreviewTool(page, 'preview-refresh');
  await expect(frame.getByRole('heading', { name: 'Updated overview' })).toBeVisible();
  await clickPreviewTool(page, 'preview-mode-raw');
  await expect(page.getByTestId('editor-input')).toHaveValue(content);
  expect(errors).toEqual([]);
});
