// SPDX-License-Identifier: AGPL-3.0-only
export interface PiOptionalExtension { id: string; name: string; enabled: boolean }
export interface PiExtensionSettings { lumoUse: boolean; questions?: boolean; revision: string; extensions?: PiOptionalExtension[] }
export type DesktopAction = 'observe' | 'click' | 'double_click' | 'fill' | 'press' | 'scroll' | 'drag';
export interface DesktopRequest { id: string; action: DesktopAction; target?: string; label?: string; text?: string; key?: string; deltaX?: number; deltaY?: number; expiresAt: number }

let clientId: Promise<string> | undefined;
export function desktopClientId() {
  clientId ??= new Promise<string>((resolve) => {
    let stored: string | null = null;
    try { stored = sessionStorage.getItem('lumo.desktop.client'); } catch {}
    const persist = (id: string) => { try { sessionStorage.setItem('lumo.desktop.client', id); } catch {} resolve(id); };
    if (!navigator.locks) { persist(crypto.randomUUID()); return; }
    const acquire = (id: string) => {
      void navigator.locks.request(`lumo.desktop.${id}`, { ifAvailable: true }, async (lock) => {
        if (!lock) { acquire(crypto.randomUUID()); return; }
        persist(id);
        await new Promise<void>(() => {});
      }).catch(() => persist(crypto.randomUUID()));
    };
    acquire(stored || crypto.randomUUID());
  });
  return clientId;
}
