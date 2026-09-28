// SPDX-License-Identifier: AGPL-3.0-only
import { useAppPreference } from '../shell/useAppState';

function labels(value: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([path, name]) => path.startsWith('/') && typeof name === 'string' && name.trim().length > 0));
  } catch { return {}; }
}
export function usePiProjectNames() {
  const [value, setValue] = useAppPreference<string>('pi', 'project-names', '{}');
  return [labels(value), (path: string, name: string) => setValue((previous) => JSON.stringify({ ...labels(previous), [path]: name }))] as const;
}
