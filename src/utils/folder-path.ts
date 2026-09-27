// SPDX-License-Identifier: AGPL-3.0-only
export function folderPath(value: string, current: string, home: string, homePath: string[]): string[] {
  if (!value.trim() || value.includes('\0')) throw new Error('Enter a folder path.');
  if (value.startsWith('~') && value !== '~' && !value.startsWith('~/')) throw new Error('Use ~ or ~/ for your home folder.');
  const absolute = value === '~' ? home : value.startsWith('~/') ? `${home}/${value.slice(2)}` : value.startsWith('/') ? value : `${current}/${value}`;
  const segments: string[] = [];
  for (const segment of absolute.split('/')) {
    if (segment === '..') segments.pop();
    else if (segment && segment !== '.') segments.push(segment);
  }
  const normalized = `/${segments.join('/')}`;
  const prefix = home === '/' ? '/' : `${home}/`;
  if (normalized === home) return [...homePath];
  if (normalized.startsWith(prefix)) return [...homePath, ...normalized.slice(prefix.length).split('/')];
  return ['', ...segments];
}
