// SPDX-License-Identifier: AGPL-3.0-only
import type { Locator, Page } from './offline';

export async function clickPreviewTool(scope: Page | Locator, id: string) {
  const trigger = scope.getByTestId('preview-tools-toggle');
  if (await trigger.count()) await trigger.hover();
  await scope.getByTestId(id).click();
}
