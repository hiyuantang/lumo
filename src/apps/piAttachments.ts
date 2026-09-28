// SPDX-License-Identifier: AGPL-3.0-only
export function attachmentPrompt(text: string, paths: string[]): string {
  return [paths.length ? `read: ${paths.map((path) => JSON.stringify(path)).join(', ')}` : '', text.trim()].filter(Boolean).join('\n\n');
}

export function splitAttachmentPrompt(text: string): { text: string; paths: string[] } {
  const end = text.indexOf('\n\n');
  const heading = end < 0 ? text : text.slice(0, end);
  if (heading.startsWith('read: ')) {
    try {
      const paths: unknown = JSON.parse(`[${heading.slice(6)}]`);
      if (Array.isArray(paths) && paths.length > 0 && paths.every((path) => typeof path === 'string' && path.startsWith('/'))) {
        return { text: end < 0 ? '' : text.slice(end + 2), paths };
      }
    } catch {}
  }
  return { text, paths: [] };
}
