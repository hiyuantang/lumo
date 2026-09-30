// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { subscribeLumoUseCursor } from './lumoCursorMotion';
import '../styles/lumo-use-cursor.css';

export function LumoUseCursor() {
  const [cursor, setCursor] = useState({ x: 0, y: 0, visible: false, pressed: false, phase: 'hide', clicks: 0, pulse: 0, duration: 0 });
  useEffect(() => subscribeLumoUseCursor((event) => setCursor((previous) => ({
    ...previous,
    x: event.x ?? previous.x, y: event.y ?? previous.y,
    visible: event.phase !== 'hide', phase: event.phase,
    pressed: event.phase === 'press' || event.phase === 'move' && previous.pressed,
    duration: event.duration ?? previous.duration,
    clicks: event.clicks ?? previous.clicks,
    pulse: previous.pulse + (event.phase === 'click' ? 1 : 0),
  }))), []);
  return createPortal(<div className={`lumo-use-cursor${cursor.visible ? ' is-visible' : ''}${cursor.pressed ? ' is-pressed' : ''}`} aria-hidden="true" data-lumo-use-protected data-testid="lumo-use-cursor" data-phase={cursor.phase} data-x={cursor.x} data-y={cursor.y} style={{ transform: `translate3d(${cursor.x - 1.5}px, ${cursor.y - 1.5}px, 0)`, '--cursor-move-duration': `${cursor.duration}ms`, '--cursor-clicks': cursor.clicks } as CSSProperties}>
    <svg key={cursor.pulse} className={`lumo-use-cursor-shape${cursor.pulse ? ' is-clicking' : ''}`} viewBox="0 0 32 32"><path d="M2.9 2.2C2.4 2 2 2.4 2.2 2.9L11.8 27.4c1.3 2.9 5.2 2.5 6-.6l2-7.8 7.8-2c3.1-.8 3.5-4.7.6-6L2.9 2.2Z"/></svg>
    {cursor.pulse > 0 && <span key={`pulse-${cursor.pulse}`} className="lumo-use-cursor-ripple"/>}
  </div>, document.body);
}
