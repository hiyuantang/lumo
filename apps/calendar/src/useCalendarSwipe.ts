// SPDX-License-Identifier: AGPL-3.0-only
import { useLayoutEffect, useRef, useState } from 'react';

export function useCalendarSwipe(enabled: boolean, context: string, vertical: boolean, reducedMotion: boolean, navigate: (direction: number) => void) {
  const pane = useRef<HTMLDivElement>(null), track = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState(0);
  const currentNavigate = useRef(navigate); currentNavigate.current = navigate;
  useLayoutEffect(() => {
    setPreview(0);
    const node = pane.current, content = track.current;
    if (!node || !content || !enabled) return;
    const measure = () => vertical ? node.clientHeight : node.clientWidth;
    const transform = (offset: number) => vertical ? `translate3d(0, ${offset}px, 0)` : `translate3d(${offset}px, 0, 0)`;
    let distance = 0, cross = 0, previous = -Infinity, velocity = 0, direction = 0, size = measure();
    let axis: 'pending' | 'cross' | 'tracking' | 'scroll' = 'pending';
    let timer = 0, frame = 0, animation: Animation | null = null, alive = true;
    const show = () => {
      content.style.transform = transform(-distance);
      const next = Math.sign(distance);
      if (direction !== next) { direction = next; setPreview(next); }
    };
    const finish = (commit: number) => {
      if (commit) currentNavigate.current(commit);
      else { animation?.cancel(); animation = null; distance = 0; cross = 0; velocity = 0; axis = 'pending'; content.style.transform = ''; delete node.dataset.swipeState; direction = 0; setPreview(0); }
    };
    const settle = () => {
      timer = 0; if (!alive || axis !== 'tracking') return;
      if (frame) { cancelAnimationFrame(frame); frame = 0; show(); }
      const commit = Math.abs(distance) >= Math.min(220, Math.max(72, size * .18)) || Math.abs(distance) >= 48 && Math.sign(velocity) === Math.sign(distance) && Math.abs(velocity) > .45 ? Math.sign(distance) : 0;
      const destination = -commit * size;
      const remaining = Math.abs(destination + distance);
      node.dataset.swipeState = 'settling';
      if (reducedMotion || remaining <= 1) { content.style.transform = transform(destination); finish(commit); return; }
      const duration = 90 + 50 * Math.min(1, remaining / Math.max(1, size));
      const active = content.animate([{ transform: transform(-distance) }, { transform: transform(destination) }], { duration, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' });
      animation = active;
      void active.finished.then(() => { if (alive && animation === active) { if (!commit) active.cancel(); finish(commit); } }).catch(() => {});
    };
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.defaultPrevented) return;
      if (animation) {
        const matrix = new DOMMatrixReadOnly(getComputedStyle(content).transform);
        distance = -(vertical ? matrix.m42 : matrix.m41);
        animation.cancel(); animation = null; content.style.transform = transform(-distance); velocity = 0;
      } else if (axis !== 'tracking' && event.timeStamp - previous > 220) { distance = 0; cross = 0; velocity = 0; axis = 'pending'; }
      const elapsed = Math.min(64, Math.max(8, event.timeStamp - previous)); previous = event.timeStamp;
      const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? size : 1;
      const delta = (vertical ? event.deltaY : event.deltaX) * unit;
      distance += delta; cross += (vertical ? event.deltaX : event.deltaY) * unit;
      if (axis === 'pending') {
        if (Math.abs(cross) > Math.abs(distance) * 1.4 && Math.abs(cross) >= 8) axis = 'cross';
        else if (Math.abs(distance) > Math.abs(cross) * 1.4 && Math.abs(distance) >= 8) {
          axis = 'tracking'; size = measure();
          let target = event.target instanceof HTMLElement ? event.target : null;
          while (target && target !== node) {
            const extent = vertical ? target.scrollHeight - target.clientHeight : target.scrollWidth - target.clientWidth;
            const position = vertical ? target.scrollTop : target.scrollLeft;
            const style = getComputedStyle(target);
            if (extent > 1 && ['auto', 'scroll'].includes(vertical ? style.overflowY : style.overflowX) && (distance > 0 ? position < extent - 1 : position > 1)) { axis = 'scroll'; break; }
            target = target.parentElement;
          }
        }
      }
      if (axis !== 'tracking') { window.clearTimeout(timer); timer = window.setTimeout(() => { timer = 0; axis = 'pending'; distance = 0; cross = 0; velocity = 0; }, 160); return; }
      event.preventDefault(); distance = Math.max(-size, Math.min(size, distance)); velocity = velocity * .6 + delta / elapsed * .4;
      node.dataset.swipeState = 'dragging';
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; if (alive) show(); });
      window.clearTimeout(timer); timer = window.setTimeout(settle, 80);
    };
    const cancel = () => { window.clearTimeout(timer); timer = 0; cancelAnimationFrame(frame); frame = 0; finish(0); };
    node.addEventListener('wheel', wheel, { passive: false });
    const interrupt = () => { if (axis === 'tracking' || animation) cancel(); };
    document.addEventListener('pointerdown', interrupt, true); document.addEventListener('keydown', interrupt, true); window.addEventListener('blur', interrupt);
    const observer = new ResizeObserver(() => { if (measure() !== size) { cancel(); size = measure(); } });
    observer.observe(node);
    return () => { alive = false; window.clearTimeout(timer); cancelAnimationFrame(frame); animation?.cancel(); observer.disconnect(); node.removeEventListener('wheel', wheel); document.removeEventListener('pointerdown', interrupt, true); document.removeEventListener('keydown', interrupt, true); window.removeEventListener('blur', interrupt); content.style.transform = ''; delete node.dataset.swipeState; };
  }, [enabled, context, vertical, reducedMotion]);
  return { pane, track, preview };
}
