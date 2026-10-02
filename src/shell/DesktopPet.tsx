// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import { useShell } from './ShellContext';
import { useAppCatalog } from './AppCatalogContext';
import { useContextMenu } from './ContextMenu';
import { PET_SIZE } from './petMotion';
import { usePetMotion } from './usePetMotion';
import { workArea } from './windowGeometry';
import { IconX } from './icons';
import { PetSprite } from './PetSprite';
import { PETS, PET_POSITION_RESET, PET_BUBBLE_PREVIEW, petPosition, usePetPreferences } from './pet';
import { PET_ACTIVITIES } from './petActivities';
import { PetPlayBall } from './PetPastimes';

const size = PET_SIZE;
type Point = { x: number; y: number };
type Gesture = { id: number; start: Point; origin: Point; moved: boolean; time: number };

export function DesktopPet() {
  const { state, actions, reducedMotion } = useShell();
  const pet = usePetPreferences();
  const { catalog } = useAppCatalog();
  const installed = catalog?.apps.some((app) => app.id === 'pi' && app.installed);
  const contextMenu = useContextMenu();
  const root = useRef<HTMLDivElement>(null);
  const [engaged, setEngaged] = useState(false);
  const [drag, setDrag] = useState<Point | null>(null);
  const [greeting, setGreeting] = useState(false);
  const [nativeDrag, setNativeDrag] = useState(false);
  const [bubble, setBubble] = useState<{ id: number; text: string; done: boolean } | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const newest = state.piOutcomeNotice;
  const seen = useRef(newest?.id ?? 0);
  const area = workArea(state.viewport);
  const minX = 8; const minY = area.y + 8;
  const maxX = Math.max(minX, area.w - size - 8); const maxY = Math.max(minY, state.viewport.h - size - 2);
  function fit(point: Point): Point { return { x: Math.max(minX, Math.min(maxX, point.x)), y: Math.max(minY, Math.min(maxY, point.y)) }; }
  const saved = petPosition(pet.position);
  const floatingY = Math.max(minY, area.y + area.h - size - 8);
  const savedPoint = fit({ x: minX + (maxX - minX) * saved.x, y: minY + ((saved.desktop ? maxY : floatingY) - minY) * saved.y });
  function remember(next: Point) { pet.setPosition(JSON.stringify({ area: 'desktop', x: (next.x - minX) / Math.max(1, maxX - minX), y: (next.y - minY) / Math.max(1, maxY - minY) })); }
  const working = Object.keys(state.piActivity).length > 0;
  const mood = working ? 'working' : bubble?.done || greeting ? 'done' : 'idle';
  const blocked = nativeDrag || working || !!bubble || greeting;
  const motion = usePetMotion(root, { active: !!installed && pet.enabled, gravity: pet.gravity, reduced: reducedMotion, paused: engaged || blocked, blocked, activities: pet.activities, width: state.viewport.w, height: state.viewport.h, saved: savedPoint });
  function resetPosition() {
    pet.setPosition('');
    const dock = motion.engine.terrain.dock;
    motion.place(pet.gravity && dock ? { x: (dock.left + dock.right) / 2 - size / 2, y: Math.max(minY, dock.top - size - 110) } : fit({ x: minX + (maxX - minX) * .94, y: floatingY }));
  }
  useEffect(() => {
    window.addEventListener(PET_POSITION_RESET, resetPosition);
    return () => window.removeEventListener(PET_POSITION_RESET, resetPosition);
  }, [pet.gravity, maxX, maxY]);
  const previousGravity = useRef(pet.gravity);
  useLayoutEffect(() => {
    if (previousGravity.current && !pet.gravity) remember(fit(motion.engine.point));
    previousGravity.current = pet.gravity;
  }, [pet.gravity]);

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
    if (cancelled) { motion.place(current.origin); gesture.current = null; }
    else {
      if (current.moved) {
        const next = fit({ x: current.origin.x + event.clientX - current.start.x, y: current.origin.y + event.clientY - current.start.y });
        if (Math.hypot(next.x - motion.engine.point.x, next.y - motion.engine.point.y) > .5) {
          motion.hold(next, (event.timeStamp - current.time) / 1000); current.time = event.timeStamp;
        }
      }
      if (current.moved && !pet.gravity) remember(motion.engine.point);
      motion.drop((event.timeStamp - current.time) / 1000);
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setDrag(null);
  }

  if (!pet.enabled || !installed) return null;
  const character = PETS.find((item) => item.value === pet.kind)!;
  return <div ref={root} className={`desktop-pet${drag ? ' is-dragging' : ''}${nativeDrag ? ' is-passive' : ''}`} data-lumo-use-protected data-testid="desktop-pet" data-mood={mood} data-kind={pet.kind} data-coat={pet.coat} data-gravity={pet.gravity}>
    {bubble && pet.bubbles && <div className="pet-bubble" role="status" data-testid="pet-bubble">
      <span>{bubble.text}</span><button type="button" className="pet-bubble-close" aria-label="Dismiss pet bubble" onClick={() => setBubble(null)}><IconX size={12} /></button>
    </div>}
    <PetPlayBall/>
    <button ref={button} type="button" className="pet-handle" data-testid="pet-handle" aria-label={`${character.label} pet, ${working ? 'Pi is working' : 'idle'}. Drag or use arrow keys to move.`} title={`${character.label} · ${working ? 'Working' : 'Idle'}`} onContextMenu={(event) => contextMenu(event, [{ label: 'Pet settings', run: () => actions.openPiSettings('pet') }, ...PET_ACTIVITIES.filter((item) => pet.activities.includes(item.value)).map((item, index) => ({ label: item.label, separator: index === 0, disabled: blocked, run: () => motion.trick(item.value) })), { label: 'Reset position', separator: true, run: resetPosition }, { label: 'Hide pet', run: () => pet.setEnabled(false) }])}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        gesture.current = { id: event.pointerId, start: { x: event.clientX, y: event.clientY }, origin: { ...motion.engine.point }, moved: false, time: event.timeStamp };
        motion.pick(); event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const current = gesture.current;
        if (!current || current.id !== event.pointerId || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const dx = event.clientX - current.start.x; const dy = event.clientY - current.start.y;
        if (Math.hypot(dx, dy) < 4 && !current.moved) return;
        current.moved = true; const next = fit({ x: current.origin.x + dx, y: current.origin.y + dy });
        motion.hold(next, (event.timeStamp - current.time) / 1000); current.time = event.timeStamp; setDrag(next);
      }}
      onPointerUp={(event) => release(event)} onPointerCancel={(event) => release(event, true)} onLostPointerCapture={(event) => { if (motion.engine.movement === 'held') { motion.drop((event.timeStamp - (gesture.current?.time ?? event.timeStamp)) / 1000); gesture.current = null; } setDrag(null); }}
      onPointerEnter={() => setEngaged(true)} onPointerLeave={() => setEngaged(button.current?.matches(':focus-visible') ?? false)} onFocus={(event) => setEngaged(event.currentTarget.matches(':focus-visible'))} onBlur={() => setEngaged(false)}
      onClick={() => { if (gesture.current?.moved) { gesture.current = null; return; } gesture.current = null; setGreeting(true); }}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 30 : 10;
        const deltas: Record<string, Point> = { ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 }, ArrowUp: { x: 0, y: -step }, ArrowDown: { x: 0, y: step } };
        if (deltas[event.key]) { event.preventDefault(); const point = motion.engine.point; const next = fit({ x: point.x + deltas[event.key].x, y: point.y + deltas[event.key].y }); motion.place(next); if (!pet.gravity) remember(next); }
        if (event.key === 'Home') { event.preventDefault(); resetPosition(); }
        if (event.key === 'Escape') { const current = gesture.current; if (current && button.current?.hasPointerCapture(current.id)) button.current.releasePointerCapture(current.id); gesture.current = null; if (current) motion.place(current.origin); setDrag(null); setBubble(null); }
      }}><PetSprite kind={pet.kind} coat={pet.coat} mood={mood} interactive paused={!!drag || nativeDrag} /></button>
  </div>;
}
