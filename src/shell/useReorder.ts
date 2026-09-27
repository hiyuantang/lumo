// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction, type PointerEvent as ReactPointerEvent, type KeyboardEvent, type MouseEvent, type DragEvent } from 'react';
import { useShell } from './ShellContext';

type Key = string | number;
type Slot = { id: Key; node: HTMLElement; start: number; size: number };
type Gesture = { id: Key; slots: Slot[]; index: number; parent: HTMLElement; scroll: number; startX: number; startY: number; x: number; y: number; active: boolean; committed: boolean; before?: Map<HTMLElement, DOMRect> };

export function useReorder<T>(items: T[], setItems: Dispatch<SetStateAction<T[]>>, key: (item: T) => Key, axis: 'horizontal' | 'vertical') {
  const { reducedMotion } = useShell();
  const [dragged, setDragged] = useState<Key | null>(null);
  const [ending, setEnding] = useState(false);
  const nodes = useRef(new Map<Key, HTMLElement>());
  const animations = useRef(new Map<HTMLElement, Animation>());
  const gesture = useRef<Gesture | null>(null);
  const cleanup = useRef<() => void>(() => {});
  const suppressClick = useRef(false);
  const horizontal = axis === 'horizontal';
  const latest = useRef({ setItems, key, reducedMotion });
  latest.current = { setItems, key, reducedMotion };

  function move(from: Key, to: Key) {
    const { setItems, key } = latest.current;
    setItems((previous) => {
      const start = previous.findIndex((item) => key(item) === from);
      const end = previous.findIndex((item) => key(item) === to);
      if (start < 0 || end < 0 || start === end) return previous;
      const next = [...previous];
      next.splice(end, 0, ...next.splice(start, 1));
      return next;
    });
  }

  const transform = (offset: number) => horizontal ? `translateX(${offset}px)` : `translateY(${offset}px)`;
  function animate(node: HTMLElement, to: number, from = getComputedStyle(node).transform) {
    animations.current.get(node)?.cancel();
    const animation = node.animate([{ transform: from }, { transform: transform(to) }], { duration: latest.current.reducedMotion ? 0 : 180, easing: 'cubic-bezier(0.22, 0.8, 0.32, 1)', fill: 'forwards' });
    animations.current.set(node, animation);
    return animation;
  }

  function preview(drag: Gesture) {
    const scroll = (horizontal ? drag.parent.scrollLeft : drag.parent.scrollTop) - drag.scroll;
    const origin = drag.slots.findIndex((slot) => slot.id === drag.id);
    const source = drag.slots[origin];
    const delta = (horizontal ? drag.x - drag.startX : drag.y - drag.startY) + scroll;
    source.node.style.transform = transform(delta);
    const point = source.start + source.size / 2 + delta;
    const index = drag.slots.reduce((closest, slot, i) => Math.abs(point - slot.start - slot.size / 2) < Math.abs(point - drag.slots[closest].start - drag.slots[closest].size / 2) ? i : closest, 0);
    if (index === drag.index) return;
    drag.index = index;
    const ordered = [...drag.slots];
    ordered.splice(index, 0, ...ordered.splice(origin, 1));
    const gap = drag.slots.length > 1 ? drag.slots[1].start - drag.slots[0].start - drag.slots[0].size : 0;
    let position = drag.slots[0].start;
    for (const slot of ordered) {
      if (slot.id !== drag.id) animate(slot.node, position - slot.start);
      position += slot.size + gap;
    }
  }

  useLayoutEffect(() => {
    if (!ending) return;
    const drag = gesture.current;
    if (drag) {
      animations.current.forEach((animation) => animation.cancel());
      animations.current.clear();
      for (const slot of drag.slots) {
        slot.node.style.transform = '';
        const target = slot.node.getBoundingClientRect();
        const before = drag.before?.get(slot.node) ?? target;
        const offset = horizontal ? before.left - target.left : before.top - target.top;
        if (Math.abs(offset) < .1) continue;
        const animation = animate(slot.node, 0, transform(offset));
        animation.onfinish = () => { animation.cancel(); if (animations.current.get(slot.node) === animation) animations.current.delete(slot.node); };
      }
    }
    gesture.current = null;
    setDragged(null);
    setEnding(false);
  }, [ending]);

  useEffect(() => () => { cleanup.current(); animations.current.forEach((animation) => animation.cancel()); }, []);

  function start(event: ReactPointerEvent<HTMLElement>, id: Key) {
    suppressClick.current = false;
    if (event.button !== 0 || !event.isPrimary || (event.target as HTMLElement).closest('.terminal-tab-close')) return;
    cleanup.current();
    const node = event.currentTarget;
    const pointerId = event.pointerId;
    let drag: Gesture | null = null;
    let frame: number | null = null;
    const tick = () => {
      if (!drag?.active) return;
      const bounds = drag.parent.getBoundingClientRect();
      const point = horizontal ? drag.x : drag.y;
      const low = horizontal ? bounds.left : bounds.top;
      const high = horizontal ? bounds.right : bounds.bottom;
      const speed = point < low + 24 ? -Math.min(8, (low + 24 - point) / 3) : point > high - 24 ? Math.min(8, (point - high + 24) / 3) : 0;
      if (horizontal) drag.parent.scrollLeft += speed;
      else drag.parent.scrollTop += speed;
      preview(drag);
      frame = requestAnimationFrame(tick);
    };
    const moving = (e: globalThis.PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      if (!drag) {
        if (Math.hypot(e.clientX - event.clientX, e.clientY - event.clientY) < 6) return;
        animations.current.forEach((animation) => animation.cancel());
        animations.current.clear();
        const slots = items.flatMap((entry) => {
          const element = nodes.current.get(key(entry));
          if (!element) return [];
          const rect = element.getBoundingClientRect();
          return [{ id: key(entry), node: element, start: horizontal ? rect.left : rect.top, size: horizontal ? rect.width : rect.height }];
        });
        const index = slots.findIndex((slot) => slot.id === id);
        if (index < 0) return;
        const parent = node.parentElement!;
        drag = { id, slots, index, parent, scroll: horizontal ? parent.scrollLeft : parent.scrollTop, startX: event.clientX, startY: event.clientY, x: e.clientX, y: e.clientY, active: true, committed: false };
        gesture.current = drag;
        node.setPointerCapture(pointerId);
        setDragged(id);
        frame = requestAnimationFrame(tick);
      }
      e.preventDefault();
      drag.x = e.clientX; drag.y = e.clientY;
      preview(drag);
    };
    const finish = (commit: boolean) => {
      cleanup.current();
      if (!drag) return;
      drag.before = new Map(drag.slots.map((slot) => [slot.node, slot.node.getBoundingClientRect()]));
      const bounds = drag.parent.getBoundingClientRect();
      drag.committed = commit && drag.x >= bounds.left && drag.x <= bounds.right && drag.y >= bounds.top && drag.y <= bounds.bottom;
      if (drag.committed) move(drag.id, drag.slots[drag.index].id);
      suppressClick.current = true;
      setEnding(true);
    };
    const up = (e: globalThis.PointerEvent) => { if (e.pointerId === pointerId) { if (drag) { drag.x = e.clientX; drag.y = e.clientY; preview(drag); } finish(true); } };
    const cancel = () => finish(false);
    const escape = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); } };
    cleanup.current = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', moving);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', escape, true);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('resize', cancel);
      node.removeEventListener('lostpointercapture', cancel);
      if (node.hasPointerCapture(pointerId)) node.releasePointerCapture(pointerId);
      cleanup.current = () => {};
    };
    window.addEventListener('pointermove', moving, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', escape, true);
    window.addEventListener('blur', cancel);
    window.addEventListener('resize', cancel);
    node.addEventListener('lostpointercapture', cancel);
  }

  function bind(item: T) {
    const id = key(item);
    return {
      ref: (node: HTMLElement | null) => { if (node) nodes.current.set(id, node); else nodes.current.delete(id); },
      draggable: false,
      'data-reorder-dragging': dragged === id || undefined,
      onDragStart: (event: DragEvent<HTMLElement>) => event.preventDefault(),
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => start(event, id),
      onClickCapture: (event: MouseEvent<HTMLElement>) => { if (suppressClick.current && event.detail > 0) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; } },
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
        if (!event.altKey) return;
        const backward = horizontal ? 'ArrowLeft' : 'ArrowUp';
        const forward = horizontal ? 'ArrowRight' : 'ArrowDown';
        if (event.key !== backward && event.key !== forward) return;
        event.preventDefault(); event.stopPropagation();
        const visible = items.filter((entry) => nodes.current.has(key(entry)));
        const index = visible.findIndex((entry) => key(entry) === id);
        const next = visible[index + (event.key === backward ? -1 : 1)];
        if (next !== undefined) move(id, key(next));
      },
    };
  }
  return { bind, dragging: dragged !== null };
}
