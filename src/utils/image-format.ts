// SPDX-License-Identifier: AGPL-3.0-only
const formats: Record<string,string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', ico: 'image/x-icon' };
export const imageType = (name: string) => formats[name.split('.').at(-1)?.toLowerCase() ?? ''];
