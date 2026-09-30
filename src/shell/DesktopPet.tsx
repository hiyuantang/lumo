// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, useState, type PointerEvent, type CSSProperties } from 'react';
import { useShell } from './ShellContext';
import { useAppCatalog } from './AppCatalogContext';
import { useContextMenu } from './ContextMenu';
import { workArea } from './windowGeometry';
import { IconX } from './icons';
import { PetSprite } from './PetSprite';
import { PETS, PET_BUBBLE_PREVIEW, petPosition, usePetPreferences } from './pet';

const size = 84;
type Point = { x: number; y: number };
type Gesture = { id: number; start: Point; origin: Point; moved: boolean };

export function DesktopPet() {
  const { state, actions } = useShell();
  const pet = usePetPreferences();
  const { catalog } = useAppCatalog();
  const installed = catalog?.apps.some((app) => app.id === 'pi' && app.installed);
  const contextMenu = useContextMenu();
  const [drag, setDrag] = useState<Point | null>(null);
  const [greeting, setGreeting] = useState(false);
  const [nativeDrag, setNativeDrag] = useState(false);
  const [bubble, setBubble] = useState<{ id: number; text: string; done: boolean } | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const newest = state.notifications.find((item) => item.piOutcome);
  const seen = useRef(newest?.id ?? 0);
  const area = workArea(state.viewport);
  const minX = 8; const minY = area.y + 8;
  const maxX = Math.max(minX, area.w - size - 8); const maxY = Math.max(minY, area.y + area.h - size - 8);
  function fit(point: Point): Point { return { x: Math.max(minX, Math.min(maxX, point.x)), y: Math.max(minY, Math.min(maxY, point.y)) }; }
  const saved = petPosition(pet.position);
  const point = fit(drag ?? { x: minX + (maxX - minX) * saved.x, y: minY + (maxY - minY) * saved.y });
  function remember(next: Point) { pet.setPosition(JSON.stringify({ x: (next.x - minX) / Math.max(1, maxX - minX), y: (next.y - minY) / Math.max(1, maxY - minY) })); }
  const working = Object.keys(state.piActivity).length > 0;
  const mood = working ? 'working' : bubble?.done || greeting ? 'done' : 'idle';

  useEffect(() => {
    if (!newest || newest.id === seen.current) return;
    seen.current = newest.id;
    if (!pet.enabled) return;
    setGreeting(false);
    setBubble({ id: newest.id, text: newest.piOutcome === 'done' ? 'Work done' : newest.piOutcome === 'stopped' ? 'Stopped' : 'Needs attention', done: newest.piOutcome === 'done' });
  }, [newest, pet.enabled]);
  useEffect(() => {
    const preview = () => {
      if (!pet.enabled) return;
      setGreeting(true);
      setBubble({ id: -1, text: 'Hello!', done: false });
    };
    window.addEventListener(PET_BUBBLE_PREVIEW, preview);
    return () => window.removeEventListener(PET_BUBBLE_PREVIEW, preview);
  }, [pet.enabled]);
  useEffect(() => {
    if (!bubble) return;
    const timer = window.setTimeout(() => setBubble(null), 8000);
    return () => window.clearTimeout(timer);
  }, [bubble]);
  useEffect(() => {
    if (!greeting) return;
    const timer = window.setTimeout(() => setGreeting(false), 1600);
    return () => window.clearTimeout(timer);
  }, [greeting]);
  useEffect(() => {
    if (pet.enabled) return;
    setBubble(null); setGreeting(false); setDrag(null); gesture.current = null;
  }, [pet.enabled]);

  useEffect(() => {
    const start = () => setNativeDrag(true);
    const finish = () => setNativeDrag(false);
    window.addEventListener('dragstart', start, true);
    window.addEventListener('dragend', finish, true);
    window.addEventListener('drop', finish, true);
    window.addEventListener('blur', finish);
    return () => {
      window.removeEventListener('dragstart', start, true);
      window.removeEventListener('dragend', finish, true);
      window.removeEventListener('drop', finish, true);
      window.removeEventListener('blur', finish);
    };
  }, []);

  function release(event: PointerEvent<HTMLButtonElement>, cancelled = false) {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) return;
    if (!cancelled && current.moved) remember(fit({ x: current.origin.x + event.clientX - current.start.x, y: current.origin.y + event.clientY - current.start.y }));
    if (cancelled) gesture.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setDrag(null);
  }

  if (!pet.enabled || !installed) return null;
  const character = PETS.find((item) => item.value === pet.kind)!;
  const bubbleWidth = Math.min(176, state.viewport.w - 16);
  const bubbleLeft = Math.max(8, Math.min(state.viewport.w - bubbleWidth - 8, point.x + size / 2 - bubbleWidth / 2)) - point.x;
  return <div className={`desktop-pet${drag ? ' is-dragging' : ''}${nativeDrag ? ' is-passive' : ''}`} data-lumo-use-protected data-testid="desktop-pet" data-mood={mood} data-kind={pet.kind} style={{ left: point.x, top: point.y }}>
    {bubble && pet.bubbles && <div className={`pet-bubble${point.y < 112 ? ' below' : ''}`} role="status" data-testid="pet-bubble" style={{ width: bubbleWidth, left: bubbleLeft, '--pet-tail': `${point.x + size / 2 - (point.x + bubbleLeft)}px` } as CSSProperties}>
      <span>{bubble.text}</span><button type="button" className="pet-bubble-close" aria-label="Dismiss pet bubble" onClick={() => setBubble(null)}><IconX size={12} /></button>
    </div>}
    <button ref={button} type="button" className="pet-handle" data-testid="pet-handle" aria-label={`${character.label} pet, ${working ? 'Pi is working' : 'idle'}. Drag or use arrow keys to move.`} title={`${character.label} · ${working ? 'Working' : 'Idle'}`} onContextMenu={(event) => contextMenu(event, [{ label: 'Pet settings', run: () => actions.openPiSettings('pet') }, { label: 'Reset position', run: () => pet.setPosition('') }, { label: 'Hide pet', run: () => pet.setEnabled(false) }])}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        gesture.current = { id: event.pointerId, start: { x: event.clientX, y: event.clientY }, origin: point, moved: false };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const current = gesture.current;
        if (!current || current.id !== event.pointerId || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const dx = event.clientX - current.start.x; const dy = event.clientY - current.start.y;
        if (Math.hypot(dx, dy) < 4 && !current.moved) return;
        current.moved = true; setDrag(fit({ x: current.origin.x + dx, y: current.origin.y + dy }));
      }}
      onPointerUp={(event) => release(event)} onPointerCancel={(event) => release(event, true)} onLostPointerCapture={() => setDrag(null)}
      onClick={() => { if (gesture.current?.moved) { gesture.current = null; return; } gesture.current = null; setGreeting(true); }}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 30 : 10;
        const deltas: Record<string, Point> = { ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 }, ArrowUp: { x: 0, y: -step }, ArrowDown: { x: 0, y: step } };
        if (deltas[event.key]) { event.preventDefault(); remember(fit({ x: point.x + deltas[event.key].x, y: point.y + deltas[event.key].y })); }
        if (event.key === 'Home') { event.preventDefault(); pet.setPosition(''); }
        if (event.key === 'Escape') { const current = gesture.current; if (current && button.current?.hasPointerCapture(current.id)) button.current.releasePointerCapture(current.id); gesture.current = null; setDrag(null); setBubble(null); }
      }}><PetSprite kind={pet.kind} mood={mood} /></button>
  </div>;
}
