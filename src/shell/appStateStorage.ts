// SPDX-License-Identifier: AGPL-3.0-only
export function windowStatePrefix(user: string | null, id: string) {
  return `lumo.window-view.v1:${encodeURIComponent(user ?? '')}:${encodeURIComponent(id)}:`;
}

export function clearWindowState(user: string | null, id: string) {
  const prefix = windowStatePrefix(user, id);
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(prefix)) localStorage.removeItem(key);
    }
  } catch {}
}
