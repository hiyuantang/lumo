// SPDX-License-Identifier: AGPL-3.0-only
import type { DragEvent } from 'react';

const icons = {
  folder: 'M3.5 6.5h6l2 2.5h9v9.5a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5v-12Z',
  file: 'M6 3.5h8L18.5 8v12a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z M13.5 3.5V8.5H19',
  conversation: 'M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 3v-3H3V6a2 2 0 0 1 2-2Z',
};

export function setDragPreview(event: DragEvent, name: string, kind: keyof typeof icons, count = 1) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return;
  const style = getComputedStyle(event.currentTarget);
  const font = `500 12px ${style.fontFamily}`;
  context.font = font;
  const suffix = count > 1 ? ` +${count - 1}` : '';
  const characters = Array.from(name.replace(/\s+/g, ' ').trim());
  let label = characters.join('');
  while (characters.length && (characters.length > 24 || context.measureText(label + suffix).width > 108)) {
    characters.pop(); label = characters.join('') + '…';
  }
  label += suffix;
  const width = Math.max(76, Math.ceil(context.measureText(label).width) + 16);
  const height = 80;
  const scale = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.ceil(width * scale);
  canvas.height = Math.ceil(height * scale);
  context.scale(canvas.width / width, canvas.height / height);
  context.font = font;
  context.fillStyle = style.getPropertyValue('--surface-raised').trim();
  context.strokeStyle = style.getPropertyValue('--border-strong').trim();
  context.beginPath(); context.roundRect(.5, .5, width - 1, height - 1, 10);
  context.globalAlpha = .55; context.fill(); context.stroke(); context.globalAlpha = 1;
  context.save(); context.translate((width - 44) / 2, 5); context.scale(44 / 24, 44 / 24);
  context.strokeStyle = style.getPropertyValue(`--${kind}-icon-stroke`).trim();
  context.fillStyle = style.getPropertyValue(`--${kind}-icon-fill`).trim();
  context.lineWidth = 1.3; context.lineCap = 'round'; context.lineJoin = 'round';
  const icon = new Path2D(icons[kind]); context.fill(icon); context.stroke(icon); context.restore();
  context.fillStyle = style.getPropertyValue('--text').trim();
  context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText(label, width / 2, 65);
  canvas.style.cssText = `position:fixed;left:-10000px;top:0;pointer-events:none;width:${width}px;height:${height}px`;
  canvas.setAttribute('aria-hidden', 'true');
  document.body.append(canvas);
  event.dataTransfer.setDragImage(canvas, width / 2, 27);
  window.setTimeout(() => canvas.remove(), 0);
}
