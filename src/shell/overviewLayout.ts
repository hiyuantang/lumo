// SPDX-License-Identifier: AGPL-3.0-only
import type { Rect } from './windowGeometry';

const intersects = (a: Rect, b: Rect) => a.x < b.x + b.w - .001 && a.x + a.w > b.x + .001 && a.y < b.y + b.h - .001 && a.y + a.h > b.y + .001;
const contains = (a: Rect, b: Rect) => a.x <= b.x && a.y <= b.y && a.x + a.w >= b.x + b.w && a.y + a.h >= b.y + b.h;

export function overviewLayout(windows: Rect[], area: Rect): Rect[] {
  if (!windows.length) return [];
  const gap = Math.min(24, area.w / 24);
  const caption = 34;
  const orders = [
    windows.map((_, index) => index).sort((a, b) => windows[b].w * windows[b].h - windows[a].w * windows[a].h),
    windows.map((_, index) => index).sort((a, b) => windows[b].h - windows[a].h),
    windows.map((_, index) => index).sort((a, b) => windows[b].w - windows[a].w),
  ];
  function pack(scale: number, order: number[]): Rect[] | null {
    let free: Rect[] = [{ x: 0, y: 0, w: area.w + gap, h: area.h + gap }];
    const result: Rect[] = [];
    for (const index of order) {
      const w = windows[index].w * scale + gap;
      const h = windows[index].h * scale + caption + gap;
      const space = free.filter((rect) => rect.w >= w && rect.h >= h).sort((a, b) => Math.min(a.w - w, a.h - h) - Math.min(b.w - w, b.h - h) || a.w * a.h - b.w * b.h)[0];
      if (!space) return null;
      const placed = { x: space.x, y: space.y, w, h };
      result[index] = { ...placed, w: w - gap, h: h - gap };
      const split: Rect[] = [];
      for (const rect of free) {
        if (!intersects(rect, placed)) { split.push(rect); continue; }
        if (placed.x > rect.x) split.push({ ...rect, w: placed.x - rect.x });
        if (placed.x + w < rect.x + rect.w) split.push({ ...rect, x: placed.x + w, w: rect.x + rect.w - placed.x - w });
        if (placed.y > rect.y) split.push({ ...rect, h: placed.y - rect.y });
        if (placed.y + h < rect.y + rect.h) split.push({ ...rect, y: placed.y + h, h: rect.y + rect.h - placed.y - h });
      }
      free = split.filter((rect, i) => !split.some((other, j) => i !== j && contains(other, rect) && (!contains(rect, other) || j < i)));
    }
    return result;
  }
  let bestScale = -1;
  let boxes: Rect[] = [];
  for (const order of orders) {
    let low = 0;
    let high = .88;
    for (let iteration = 0; iteration < 32; iteration++) {
      const scale = (low + high) / 2;
      if (pack(scale, order)) low = scale;
      else high = scale;
    }
    if (low > bestScale) { bestScale = low; boxes = pack(low, order) ?? []; }
  }
  const width = Math.max(...boxes.map((box) => box.x + box.w));
  const height = Math.max(...boxes.map((box) => box.y + box.h));
  boxes = boxes.map((box) => ({ ...box, x: box.x + (area.w - width) / 2, y: box.y + (area.h - height) / 2 }));
  for (let iteration = 0; iteration < 100; iteration++) {
    boxes.forEach((box, index) => {
      let dx = 0;
      let dy = 0;
      boxes.forEach((other, candidate) => {
        if (candidate === index) return;
        const x = box.x + box.w / 2 - other.x - other.w / 2;
        const y = box.y + box.h / 2 - other.y - other.h / 2;
        const distance = Math.hypot(x, y) || 1;
        const edgeX = Math.max(0, Math.abs(x) - (box.w + other.w) / 2);
        const edgeY = Math.max(0, Math.abs(y) - (box.h + other.h) / 2);
        const strength = Math.min(3, 240 / (Math.hypot(edgeX, edgeY) + 40));
        dx += x / distance * strength;
        dy += y / distance * strength;
      });
      const next = { ...box, x: Math.max(0, Math.min(area.w - box.w, box.x + dx)), y: Math.max(0, Math.min(area.h - box.h, box.y + dy)) };
      const padded = { x: next.x - gap / 3, y: next.y - gap / 3, w: next.w + gap * 2 / 3, h: next.h + gap * 2 / 3 };
      if (!boxes.some((other, candidate) => candidate !== index && intersects(padded, other))) boxes[index] = next;
    });
  }
  return boxes.map((box) => ({ x: area.x + box.x, y: area.y + box.y, w: box.w, h: box.h - caption }));
}
