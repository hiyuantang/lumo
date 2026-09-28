// SPDX-License-Identifier: AGPL-3.0-only
export function timezoneLabel(zone: string): string {
  return zone === 'Etc/UTC' ? 'UTC' : zone.replaceAll('_', ' ');
}
