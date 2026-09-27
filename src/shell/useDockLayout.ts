// SPDX-License-Identifier: AGPL-3.0-only
import { useLayoutEffect, useRef } from 'react';

export function useDockLayout(layout: string, reducedMotion: boolean, viewportSize: string, reordering = false) {
  const ref = useRef<HTMLDivElement>(null);
  const previous = useRef(new Map<HTMLElement, DOMRect>());
  const animations = useRef(new Map<HTMLElement, Animation>());
  const viewport = useRef(viewportSize);
  const reorder = useRef(reordering);
  reorder.current = reordering;

  useLayoutEffect(() => {
    const elements = Array.from(ref.current?.querySelectorAll<HTMLElement>('.dock-surface, .dock-app, .dock-divider') ?? []);
    const moving = new Map(Array.from(animations.current, ([element]) => [element, element.getBoundingClientRect()]));
    animations.current.forEach((animation) => animation.cancel());
    animations.current.clear();
    const next = new Map(elements.map((element) => [element, element.getBoundingClientRect()]));
    if (!reducedMotion && viewport.current === viewportSize) {
      for (const [element, target] of next) {
        if (reorder.current && element.closest('.dock-apps')) continue;
        const before = previous.current.get(element);
        if (!before || !target.width || !target.height) continue;
        const surface = element.classList.contains('dock-surface');
        const current = moving.get(element);
        const start = current ? {
          x: current.x + before.x - target.x,
          y: current.y + before.y - target.y,
          width: current.width * (surface ? 1 : before.width / target.width),
          height: current.height * (surface ? 1 : before.height / target.height),
        } : before;
        if (Math.abs(start.x - target.x) + Math.abs(start.y - target.y) + Math.abs(start.width - target.width) + Math.abs(start.height - target.height) < 0.1) continue;
        const frames = surface ? [
          { left: `${start.x - target.x - 1}px`, top: `${start.y - target.y - 1}px`, width: `${start.width}px`, height: `${start.height}px` },
          { left: '-1px', top: '-1px', width: `${target.width}px`, height: `${target.height}px` },
        ] : [
          { transform: `translate(${start.x - target.x}px, ${start.y - target.y}px) scale(${start.width / target.width}, ${start.height / target.height})` },
          { transform: 'none' },
        ];
        const animation = element.animate(frames, { duration: 360, easing: 'cubic-bezier(0.22, 0.8, 0.32, 1)', fill: 'both' });
        animations.current.set(element, animation);
        animation.onfinish = () => { animation.cancel(); if (animations.current.get(element) === animation) animations.current.delete(element); };
      }
    }
    previous.current = next;
    viewport.current = viewportSize;
  }, [layout, reducedMotion, viewportSize]);

  useLayoutEffect(() => () => { animations.current.forEach((animation) => animation.cancel()); animations.current.clear(); }, []);
  return ref;
}
