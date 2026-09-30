// SPDX-License-Identifier: AGPL-3.0-only
export type LumoCursorEvent = { x?: number; y?: number; phase: 'move' | 'press' | 'release' | 'click' | 'idle' | 'hide'; clicks?: number; duration?: number };
const eventName = 'lumo-use-cursor';
let owner: AbortSignal | undefined;
let onAbort: (() => void) | undefined;
let idleTimer: number | undefined;

function publish(detail: LumoCursorEvent) { window.dispatchEvent(new CustomEvent(eventName, { detail })); }
function hide() {
  window.clearTimeout(idleTimer); idleTimer = undefined;
  if (owner && onAbort) owner.removeEventListener('abort', onAbort);
  owner = undefined; onAbort = undefined;
  publish({ phase: 'hide' });
}
export function finishLumoUseCursor(signal: AbortSignal) {
  if (owner !== signal) return;
  if (signal.aborted) { hide(); return; }
  publish({ phase: 'idle' });
  window.clearTimeout(idleTimer); idleTimer = window.setTimeout(hide, 1600);
}
export function pressLumoUseCursor(pressed: boolean) { publish({ phase: pressed ? 'press' : 'release' }); }
export function clickLumoUseCursor(double = false) { publish({ phase: 'click', clicks: double ? 2 : 1 }); }
export function subscribeLumoUseCursor(listener: (event: LumoCursorEvent) => void) {
  const receive = (event: Event) => listener((event as CustomEvent<LumoCursorEvent>).detail);
  window.addEventListener(eventName, receive);
  return () => window.removeEventListener(eventName, receive);
}
export async function moveLumoUseCursor(x: number, y: number, signal: AbortSignal) {
  if (signal.aborted) throw new Error('Lumo Use stopped.');
  window.clearTimeout(idleTimer); idleTimer = undefined;
  if (owner !== signal) {
    if (owner && onAbort) owner.removeEventListener('abort', onAbort);
    owner = signal; onAbort = hide; signal.addEventListener('abort', onAbort, { once: true });
  }
  const duration = document.documentElement.classList.contains('motion-reduced') || window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180;
  publish({ phase: 'move', x, y, duration });
  await new Promise<void>((resolve, reject) => {
    const stop = () => { window.clearTimeout(timer); signal.removeEventListener('abort', stop); reject(new Error('Lumo Use stopped.')); };
    const timer = window.setTimeout(() => { signal.removeEventListener('abort', stop); resolve(); }, duration);
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) stop();
  });
}
