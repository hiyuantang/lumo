// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef } from 'react';
import { PET_COATS, type PetCoat, type PetKind } from './pet';

const silhouettes: Record<PetKind, string> = {
  triangle: 'M46 16 Q48 12 51 17 L77 64 Q81 71 73 72 L23 72 Q15 72 19 65 Z',
  pebble: 'M48 16 C68 14 78 30 77 48 C79 65 68 74 48 74 C28 75 18 64 19 47 C18 30 30 16 48 16 Z',
  square: 'M29 19 L67 19 Q76 19 76 28 L76 63 Q76 72 67 72 L29 72 Q20 72 20 63 L20 28 Q20 19 29 19 Z',
  diamond: 'M44 15 Q48 11 52 15 L78 42 Q82 46 78 50 L52 74 Q48 78 44 74 L18 50 Q14 46 18 42 Z',
};
type Strand = { x: number; y: number; dx: number; dy: number; curl: number; shade: number; bend: number; velocity: number };

export function PetFur({ kind, coat, interactive, paused }: { kind: PetKind; coat: PetCoat; interactive: boolean; paused: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const pause = useRef(paused);
  pause.current = paused;
  useEffect(() => {
    const node = canvas.current;
    const context = node?.getContext('2d');
    if (!node || !context) return;
    node.dataset.ruffled = 'false';
    context.setTransform(1, 0, 0, 1, 0, 0);
    const shape = new Path2D(silhouettes[kind]);
    const color = PET_COATS.find((item) => item.value === coat)!.color;
    const rgb = [1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16));
    const tint = (shade: number) => `rgb(${rgb.map((channel) => Math.round(shade > 0 ? channel + (255 - channel) * shade : channel * (1 + shade))).join(',')})`;
    let seed = 47;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const strands: Strand[] = [];
    for (let y = 12; y < 77; y += .95) for (let x = 14; x < 82; x += .95) {
      const px = x + random() * .95; const py = y + random() * .95;
      if (!context.isPointInPath(shape, px, py)) continue;
      const angle = Math.atan2((py - 44) * .7, px - 48);
      const edge = !context.isPointInPath(shape, px + Math.cos(angle) * 4, py + Math.sin(angle) * 4);
      const flow = edge ? angle : Math.PI / 2 + (px - 48) * .018 + (random() - .5) * 1.6;
      const length = 2.8 + random() * 4.3;
      strands.push({ x: px, y: py, dx: Math.cos(flow) * length, dy: Math.sin(flow) * length, curl: (random() - .5) * 1.4, shade: random() * .36 - .18 + (48 - px) * .003, bend: 0, velocity: 0 });
    }
    strands.sort((a, b) => a.y - b.y);
    let frame = 0; let previousTime = 0; let drawn = false;
    let previousPointer: { x: number; y: number } | null = null;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const host = node.closest('.pet-sprite')!;
    const isReduced = () => reduced.matches || !!node.closest('.motion-reduced');
    const draw = () => {
      context.clearRect(0, 0, 96, 96);
      const undercoat = context.createLinearGradient(22, 18, 70, 74);
      undercoat.addColorStop(0, tint(.1)); undercoat.addColorStop(1, tint(-.32));
      context.fillStyle = undercoat; context.fill(shape);
      context.lineCap = 'round';
      for (const strand of strands) {
        const dx = strand.dx + strand.bend;
        const dy = strand.dy - Math.abs(strand.bend) * .22;
        context.beginPath(); context.moveTo(strand.x, strand.y);
        context.quadraticCurveTo(strand.x + dx * .48 + strand.curl, strand.y + dy * .4, strand.x + dx, strand.y + dy);
        context.strokeStyle = tint(strand.shade - .16); context.lineWidth = .52; context.stroke();
        context.beginPath(); context.moveTo(strand.x + dx * .36, strand.y + dy * .36);
        context.quadraticCurveTo(strand.x + dx * .75 + strand.curl * .3, strand.y + dy * .72, strand.x + dx, strand.y + dy);
        context.strokeStyle = tint(strand.shade + .2); context.lineWidth = .24; context.stroke();
      }
      node.dataset.ready = 'true';
    };
    const tick = (time: number) => {
      frame = 0;
      const step = Math.min(2, (time - previousTime) / 16.67 || 1); previousTime = time;
      let active = false;
      for (const strand of strands) {
        if (pause.current || isReduced()) { strand.bend = 0; strand.velocity = 0; continue; }
        strand.velocity = (strand.velocity - strand.bend * .13 * step) * Math.pow(.73, step);
        strand.bend += strand.velocity * step;
        if (Math.abs(strand.bend) + Math.abs(strand.velocity) > .025) active = true;
        else { strand.bend = 0; strand.velocity = 0; }
      }
      draw();
      if (active && !document.hidden) frame = requestAnimationFrame(tick);
      else { previousTime = 0; node.dataset.ruffled = 'false'; }
    };
    const move = (event: Event) => {
      const pointer = event as PointerEvent;
      if (!interactive || pointer.buttons || pause.current || isReduced()) { previousPointer = null; return; }
      const bounds = node.getBoundingClientRect();
      const point = { x: (pointer.clientX - bounds.x) / bounds.width * 96, y: (pointer.clientY - bounds.y) / bounds.height * 96 };
      const movement = previousPointer ? Math.max(-6, Math.min(6, point.x - previousPointer.x)) : 2;
      previousPointer = point;
      let changed = false;
      for (const strand of strands) {
        const distance = Math.hypot(strand.x - point.x, strand.y - point.y);
        if (distance >= 13) continue;
        strand.bend = Math.max(-9, Math.min(9, strand.bend + (1 - distance / 13) * movement)); changed = true;
      }
      if (changed) { node.dataset.ruffled = 'true'; if (!frame) frame = requestAnimationFrame(tick); }
    };
    const leave = () => { previousPointer = null; };
    const resize = () => {
      if (!node.clientWidth) return;
      const density = Math.max(3, (window.devicePixelRatio || 1) * 2);
      const pixels = Math.ceil(node.clientWidth * density);
      if (drawn && node.width === pixels) return;
      node.width = pixels; node.height = pixels; context.setTransform(pixels / 96, 0, 0, pixels / 96, 0, 0);
      drawn = true; draw();
    };
    let densityQuery: MediaQueryList;
    const densityChange = () => {
      densityQuery?.removeEventListener('change', densityChange);
      densityQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      densityQuery.addEventListener('change', densityChange); resize();
    };
    const observer = new ResizeObserver(resize); observer.observe(node); densityChange();
    window.addEventListener('resize', resize);
    host.addEventListener('pointermove', move); host.addEventListener('pointerleave', leave);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); densityQuery.removeEventListener('change', densityChange); window.removeEventListener('resize', resize); host.removeEventListener('pointermove', move); host.removeEventListener('pointerleave', leave); };
  }, [kind, coat, interactive]);
  return <canvas ref={canvas} className="pet-fur" aria-hidden="true" data-coat={coat}/>;
}
