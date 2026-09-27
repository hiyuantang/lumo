// SPDX-License-Identifier: AGPL-3.0-only
export async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

export async function readClipboard(): Promise<string> {
  return await navigator.clipboard.readText();
}
