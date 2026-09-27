// SPDX-License-Identifier: AGPL-3.0-only
import { useLayoutEffect, useRef, type RefObject } from 'react';
import type { WindowState } from './ShellContext';

export function useWindowPlacement(ref: RefObject<HTMLElement>, win: WindowState, interacting: boolean, reducedMotion: boolean) {
  const previous = useRef(win);
  const animation = useRef<Animation | null>(null);
  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = win;
    const element = ref.current;
    if (!element) return;
    const moved = before.x !== win.x || before.y !== win.y || before.w !== win.w || before.h !== win.h;
    const placementChanged = before.maximized !== win.maximized || before.snapped !== win.snapped;
    if (!moved && !interacting && !reducedMotion && !win.minimized) return;
    const current = animation.current ? element.getBoundingClientRect() : null;
    animation.current?.cancel();
    animation.current = null;
    if (!placementChanged || !moved || interacting || reducedMotion || win.minimized || before.minimized) return;
    const start = current ? { x: current.x, y: current.y, w: current.width, h: current.height } : before;
    const motion = element.animate([start, win].map((rect) => ({ left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.w}px`, height: `${rect.h}px` })), {
      duration: 260, easing: 'cubic-bezier(0.22, 0.8, 0.32, 1)', fill: 'both',
    });
    animation.current = motion;
    motion.onfinish = () => { motion.cancel(); if (animation.current === motion) animation.current = null; };
  }, [ref, win, interacting, reducedMotion]);
  useLayoutEffect(() => () => animation.current?.cancel(), []);
}
