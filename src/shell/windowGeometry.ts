// SPDX-License-Identifier: AGPL-3.0-only
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Viewport {
  w: number;
  h: number;
}

export type SnapTarget = 'left' | 'right' | 'maximize';
export type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export const MENUBAR_H = 32;
export const COMPACT_WIDTH = 700;
const SNAP_DISTANCE = 20;
const TILE_GAP = 8;

export function dockSpace(viewport: Viewport): number {
  return viewport.w <= COMPACT_WIDTH ? Math.min(38, Math.max(29, viewport.w * 0.08)) + 35 : 112;
}

export function workArea(viewport: Viewport): Rect {
  return {
    x: 0,
    y: MENUBAR_H,
    w: viewport.w,
    h: Math.max(0, viewport.h - MENUBAR_H - dockSpace(viewport)),
  };
}

export function clampRect(rect: Rect, viewport: Viewport): Rect {
  const area = workArea(viewport);
  const w = Math.min(Math.max(0, rect.w), area.w);
  const h = Math.min(Math.max(0, rect.h), area.h);
  const x = Math.min(Math.max(rect.x, area.x), area.x + area.w - w);
  const y = Math.min(Math.max(rect.y, area.y), area.y + area.h - h);
  return { x, y, w, h };
}

export function snapRect(target: SnapTarget, viewport: Viewport): Rect {
  const area = workArea(viewport);
  if (target === 'maximize') return area;
  const w = Math.floor((area.w - TILE_GAP) / 2);
  return { ...area, x: target === 'left' ? area.x : area.x + area.w - w, w };
}

export function canSnap(target: SnapTarget, viewport: Viewport, minSize: { w: number; h: number }): boolean {
  if (viewport.w <= COMPACT_WIDTH) return false;
  if (target === 'maximize') return true;
  const rect = snapRect(target, viewport);
  return rect.w >= minSize.w && rect.h >= minSize.h;
}

export function snapTargetAt(x: number, y: number, viewport: Viewport, minSize: { w: number; h: number }): SnapTarget | null {
  const target = x <= SNAP_DISTANCE ? 'left'
    : x >= viewport.w - SNAP_DISTANCE ? 'right'
      : y <= MENUBAR_H + SNAP_DISTANCE ? 'maximize'
        : null;
  return target && canSnap(target, viewport, minSize) ? target : null;
}

export function resizeRect(rect: Rect, direction: ResizeDirection, dx: number, dy: number, minSize: { w: number; h: number }, viewport: Viewport): Rect {
  const area = workArea(viewport);
  const minW = Math.min(minSize.w, area.w);
  const minH = Math.min(minSize.h, area.h);
  let { x, y, w, h } = rect;
  if (direction.includes('e')) w = Math.min(Math.max(rect.w + dx, minW), area.x + area.w - x);
  if (direction.includes('s')) h = Math.min(Math.max(rect.h + dy, minH), area.y + area.h - y);
  if (direction.includes('w')) {
    x = Math.min(Math.max(rect.x + dx, area.x), rect.x + rect.w - minW);
    w = rect.x + rect.w - x;
  }
  if (direction.includes('n')) {
    y = Math.min(Math.max(rect.y + dy, area.y), rect.y + rect.h - minH);
    h = rect.y + rect.h - y;
  }
  return clampRect({ x, y, w, h }, viewport);
}
