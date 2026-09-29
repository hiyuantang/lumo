// SPDX-License-Identifier: AGPL-3.0-only
import { writeFile } from 'node:fs/promises';
import { test, expect } from '../offline';
import { piPage } from './pi-fixture';

for (const scale of [1, 2]) test.describe(`Drag previews at ${scale}x`, () => {
test.use({ deviceScaleFactor: scale });
test('Files, folders and conversations use bounded isolated drag images in both themes', async ({ page }) => {
  await piPage(page);
  await page.route('**/api/v1/files/list?**', (route) => route.fulfill({ json: { ok: true, data: { path: '/home/user', entries: [
    { name: 'Project folder', type: 'directory', sizeBytes: 0, mode: 493 },
    { name: 'A very long file name that should never pull surrounding rows into its drag image.txt', type: 'file', sizeBytes: 10, mode: 420 },
  ] } } }));
  await page.goto('http://localhost:5200');
  await page.getByTestId('dock-app-files').click();
  await page.getByTestId('dock-app-pi').click();
  await expect(page.getByTestId('pi-prompt')).toBeEnabled();
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    for (const [kind, selector] of [
      ['folder', '[data-testid="file-row-Project folder"]'],
      ['file', '[data-kind="file"][data-file-row]'],
      ['conversation', '.pi-project-chats .pi-chat-item'],
    ]) {
      const preview = await page.locator(selector).first().evaluate((element) => {
        let image: { width: number; height: number; displayWidth: number; displayHeight: number; png: string; corners: number[]; backgroundAlpha: number; iconAlpha: number; x: number; y: number; connected: boolean } | undefined;
        const transfer = new DataTransfer();
        transfer.setDragImage = (node, x, y) => {
          if (!(node instanceof HTMLCanvasElement)) throw new Error('Expected an isolated canvas preview');
          const context = node.getContext('2d')!;
          const bounds = node.getBoundingClientRect();
          image = { width: node.width, height: node.height, displayWidth: bounds.width, displayHeight: bounds.height, png: node.toDataURL(), corners: [context.getImageData(0, 0, 1, 1).data[3], context.getImageData(node.width - 1, node.height - 1, 1, 1).data[3]], backgroundAlpha: context.getImageData(node.width / 2, node.height - 6 * devicePixelRatio, 1, 1).data[3], iconAlpha: context.getImageData(node.width / 2, 27 * devicePixelRatio, 1, 1).data[3], x, y, connected: node.isConnected };
        };
        element.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }));
        element.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: transfer }));
        return { ...image!, types: [...transfer.types] };
      });
      expect(preview.displayWidth).toBeGreaterThanOrEqual(76); expect(preview.displayWidth).toBeLessThanOrEqual(124); expect(preview.displayHeight).toBe(80);
      expect(preview.width).toBe(preview.displayWidth * scale); expect(preview.height).toBe(preview.displayHeight * scale);
      expect(preview.backgroundAlpha).toBeGreaterThan(130); expect(preview.backgroundAlpha).toBeLessThan(150);
      expect(preview.iconAlpha).toBe(255);
      expect(preview.corners).toEqual([0, 0]); expect(preview.connected).toBe(true);
      expect([preview.x, preview.y]).toEqual([preview.displayWidth / 2, 27]);
      expect(preview.types).toContain(kind === 'conversation' ? 'application/x-lumo-pi-conversation' : 'application/x-lumo-file-selection');
      await expect(page.locator('body > canvas')).toHaveCount(0);
      await writeFile(`/tmp/lumo-drag-${kind}-${theme}.png`, Buffer.from(preview.png.split(',')[1], 'base64'));
    }
  }
  expect(errors).toEqual([]);
});
});
