// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, type RefObject } from 'react';

export function useCalendarGridSnap(scroller: RefObject<HTMLDivElement>, target: () => { left: number; top: number }, reducedMotion: boolean) {
  const destination = useRef(target); destination.current = target;
  const stopSnap = useRef(() => {});
  useEffect(() => {
    const node = scroller.current; if (!node) return;
    let timer = 0, frame = 0, dragging = false, animating = false;
    const stop = () => { window.clearTimeout(timer); cancelAnimationFrame(frame); animating = false; };
    stopSnap.current = stop;
    const settle = () => {
      const origin = { left: node.scrollLeft, top: node.scrollTop }, next = destination.current();
      if (Math.abs(next.top - origin.top) < .5 && Math.abs(next.left - origin.left) < .5) return;
      if (reducedMotion) { node.scrollTo(next); return; }
      animating = true;
      const started = performance.now();
      const move = (now: number) => {
        const progress = Math.min(1, (now - started) / 110), ease = 1 - (1 - progress) ** 3;
        node.scrollTo({ left: origin.left + (next.left - origin.left) * ease, top: origin.top + (next.top - origin.top) * ease });
        if (progress < 1) frame = requestAnimationFrame(move);
        else animating = false;
      };
      frame = requestAnimationFrame(move);
    };
    const schedule = () => { if (!animating && !dragging) { window.clearTimeout(timer); timer = window.setTimeout(settle, 80); } };
    const interrupt = () => { stop(); schedule(); };
    const down = () => { dragging = true; stop(); };
    const up = () => { if (dragging) { dragging = false; schedule(); } };
    const outside = (event: Event) => { if (!(event.target instanceof Node) || !node.contains(event.target)) stop(); };
    node.addEventListener('scroll', schedule, { passive: true });
    node.addEventListener('wheel', interrupt, { passive: true });
    node.addEventListener('keydown', interrupt);
    node.addEventListener('pointerdown', down);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', outside, true);
    window.addEventListener('blur', stop);
    return () => {
      stop(); stopSnap.current = () => {};
      node.removeEventListener('scroll', schedule); node.removeEventListener('wheel', interrupt);
      node.removeEventListener('keydown', interrupt); node.removeEventListener('pointerdown', down);
      window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
      document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', outside, true); window.removeEventListener('blur', stop);
    };
  }, [scroller, reducedMotion]);
  return stopSnap;
}
