// SPDX-License-Identifier: AGPL-3.0-only
import { flushSync } from 'react-dom';
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

export async function gestureLumoUseCursor(from: { x: number; y: number }, to: { x: number; y: number }, signal: AbortSignal, progress: (amount: number) => void, committed: () => void) {
  if (signal.aborted) throw new Error('Lumo Use stopped.');
  const reduced = document.documentElement.classList.contains('motion-reduced') || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const duration = reduced ? 0 : Math.min(600, Math.max(280, Math.hypot(to.x - from.x, to.y - from.y)));
  flushSync(() => pressLumoUseCursor(true));
  try {
    await new Promise<void>((resolve, reject) => {
      let frame: number;
      const start = performance.now();
      const cleanup = () => { cancelAnimationFrame(frame); signal.removeEventListener('abort', stop); };
      const stop = () => { cleanup(); reject(new Error('Lumo Use stopped.')); };
      const tick = (now: number) => {
        try {
          if (signal.aborted) { stop(); return; }
          const time = duration ? Math.min(1, (now - start) / duration) : 1;
          const amount = 1 - Math.pow(1 - time, 3);
          flushSync(() => {
            progress(amount);
            publish({ phase: 'move', x: from.x + (to.x - from.x) * amount, y: from.y + (to.y - from.y) * amount, duration: 0 });
          });
          committed();
          if (time === 1) { cleanup(); resolve(); } else frame = requestAnimationFrame(tick);
        } catch (error) { cleanup(); reject(error); }
      };
      signal.addEventListener('abort', stop, { once: true });
      frame = requestAnimationFrame(tick);
    });
  } finally { if (!signal.aborted) pressLumoUseCursor(false); }
}
