// SPDX-License-Identifier: AGPL-3.0-only
import type { Page } from '@playwright/test';

export async function piAction(page: Page, action: 'undo' | 'rename' | 'compact') {
  const input = page.getByTestId('pi-prompt');
  await input.focus();
  await input.evaluate((node) => window.getSelection()?.collapse(node, 0));
  await input.pressSequentially(`/${action}`);
  await input.press('Tab');
}
