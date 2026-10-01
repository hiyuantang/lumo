// SPDX-License-Identifier: AGPL-3.0-only
import { useLayoutEffect, useRef, type RefObject } from 'react';
import { PetMotion, PET_FEET, PET_SIZE, type PetPoint, type PetTerrain, type PetTrick } from './petMotion';

export function usePetMotion(root: RefObject<HTMLDivElement>, options: { active: boolean; gravity: boolean; reduced: boolean; paused: boolean; blocked: boolean; width: number; height: number; saved: PetPoint }) {
  const motion = useRef<PetMotion>();
  if (!motion.current) motion.current = new PetMotion(options.saved, { width: options.width, height: options.height, top: 40, dock: null });
  const engine = motion.current;
  const current = useRef(options); current.current = options;
  const wake = useRef<() => void>(() => {});
  const bubbleSize = useRef(0);
  const paint = () => {
    const node = root.current;
    if (!node) return;
    node.style.left = `${engine.point.x}px`; node.style.top = `${engine.point.y}px`;
    node.dataset.motion = engine.movement; node.dataset.surface = engine.surface;
    node.dataset.activity = engine.activity; node.dataset.climb = engine.climbStyle;
    node.style.setProperty('--pet-facing', String(engine.direction));
    node.style.setProperty('--pet-stride', String(Math.sin(engine.stride)));
    node.style.setProperty('--pet-bob', `${-Math.abs(Math.sin(engine.stride)) * (engine.movement === 'run' ? 3 : 1.7)}px`);
    node.style.setProperty('--pet-lean', `${engine.movement === 'run' ? 7 : 3}deg`);
    node.style.setProperty('--pet-tilt', `${engine.tilt}deg`);
    node.style.setProperty('--pet-flight-turn', `${engine.tilt * engine.direction}deg`);
    node.style.setProperty('--pet-stretch', String(Math.min(.09, Math.abs(engine.vy) / 10000)));
    node.style.setProperty('--pet-impact', String(engine.impact));
    node.style.setProperty('--pet-skid', `${Math.min(18, Math.abs(engine.vx) / 28)}deg`);
    node.style.setProperty('--pet-air-arm', `${Math.min(125, 70 + Math.abs(engine.vy) / 20)}deg`);
    node.style.setProperty('--pet-trail', String(Math.min(.5, Math.max(0, (Math.abs(engine.vx) - 180) / 1400))));
    node.style.setProperty('--pet-trick-speed', String(engine.trickSpeed));
    node.style.setProperty('--pet-progress', String(engine.progress));
    const cycle = engine.reduced ? .15 : engine.elapsed * engine.trickSpeed / 1.5 % 1;
    node.style.setProperty('--pet-ball-x', `${73 + Math.sin(cycle * Math.PI) * 16}px`);
    node.style.setProperty('--pet-ball-y', `${82 - Math.sin(cycle * Math.PI) * 33}px`);
    node.style.setProperty('--pet-ball-spin', `${cycle * 360}deg`);
    node.style.setProperty('--pet-kick', String(cycle < .18 ? Math.sin(cycle / .18 * Math.PI) : 0));
    if (engine.pole) {
      node.style.setProperty('--pet-pole-left', `${engine.pole.x - engine.point.x - 5}px`);
      node.style.setProperty('--pet-pole-top', `${engine.pole.top - engine.point.y}px`);
      node.style.setProperty('--pet-pole-height', `${engine.pole.bottom - engine.pole.top}px`);
      const grip = engine.direction > 0 ? engine.pole.x - engine.point.x : engine.point.x + PET_SIZE - engine.pole.x;
      node.style.setProperty('--pet-climb-grip', `${grip * 96 / PET_SIZE - 86}px`);
    }
    const dock = engine.terrain.dock;
    const ground = dock && engine.point.x + PET_SIZE / 2 >= dock.left && engine.point.x + PET_SIZE / 2 <= dock.right && engine.point.y + PET_FEET <= dock.top ? dock.top - PET_FEET : engine.terrain.height - PET_SIZE - 2;
    node.style.setProperty('--pet-shadow-drop', `${engine.gravity ? Math.max(0, ground - engine.point.y) * 96 / PET_SIZE : 0}px`);
    const height = engine.gravity ? Math.max(0, ground - engine.point.y) : 0;
    node.style.setProperty('--pet-shadow-scale', String(Math.max(.3, 1 - height / 900)));
    node.style.setProperty('--pet-shadow-opacity', String(.025 + .055 * Math.exp(-height / 200)));
    const bubble = node.querySelector<HTMLElement>('.pet-bubble');
    if (bubble) {
      const left = Math.max(8 - engine.point.x, Math.min(current.current.width - bubbleSize.current - 8 - engine.point.x, PET_SIZE / 2 - bubbleSize.current / 2));
      bubble.style.left = `${left}px`; bubble.style.setProperty('--pet-tail', `${PET_SIZE / 2 - left}px`); bubble.classList.toggle('below', engine.point.y < 112);
    }
  };
  const paintRef = useRef(paint); paintRef.current = paint;
  useLayoutEffect(() => {
    if (!options.active) return;
    const node = root.current!;
    if (engine.movement === 'held') engine.place(current.current.saved);
    let frame = 0; let timer = 0; let last = 0;
    const dock = document.querySelector<HTMLElement>('.dock-tray');
    const terrain = (): PetTerrain => {
      const bounds = dock?.getBoundingClientRect();
      return { width: current.current.width, height: current.current.height, top: 40, dock: bounds && bounds.width ? { left: bounds.left, right: bounds.right, top: bounds.top } : null };
    };
    const cancel = () => { cancelAnimationFrame(frame); clearTimeout(timer); frame = 0; timer = 0; last = 0; };
    const schedule = () => {
      if (document.hidden) return;
      const delay = engine.delay();
      if (delay !== null) {
        timer = window.setTimeout(() => { timer = 0; engine.advanceRest(delay / 1000); paintRef.current(); schedule(); }, delay);
      } else if (engine.movement !== 'rest' && engine.movement !== 'held') frame = requestAnimationFrame(tick);
    };
    const tick = (time: number) => {
      frame = 0; engine.step(last ? (time - last) / 1000 : .016); last = time; paintRef.current();
      if (engine.movement === 'rest') last = 0;
      schedule();
    };
    const resume = () => { cancel(); paintRef.current(); schedule(); };
    wake.current = resume;
    const resize = () => { engine.setTerrain(terrain()); resume(); };
    const visibility = () => { if (document.hidden) cancel(); else resume(); };
    const observer = new ResizeObserver(resize);
    if (dock) observer.observe(dock);
    const bubbleObserver = new ResizeObserver(() => {
      const bubble = node.querySelector<HTMLElement>('.pet-bubble'); bubbleSize.current = bubble?.offsetWidth ?? 0; paintRef.current();
    });
    bubbleObserver.observe(node);
    engine.setTerrain(terrain()); engine.configure(current.current.gravity, current.current.reduced, current.current.paused, current.current.blocked); resume();
    document.addEventListener('visibilitychange', visibility);
    return () => { cancel(); observer.disconnect(); bubbleObserver.disconnect(); document.removeEventListener('visibilitychange', visibility); wake.current = () => {}; };
  }, [options.active, root, engine]);
  const previous = useRef({ saved: options.saved, width: options.width, height: options.height });
  useLayoutEffect(() => {
    const prev = previous.current;
    if (!options.gravity && (options.saved.x !== prev.saved.x || options.saved.y !== prev.saved.y) && Math.hypot(engine.point.x - options.saved.x, engine.point.y - options.saved.y) > .5) engine.place(options.saved);
    previous.current = { saved: options.saved, width: options.width, height: options.height };
    engine.configure(options.gravity, options.reduced, options.paused, options.blocked);
    if (prev.width !== options.width || prev.height !== options.height) {
      const dock = document.querySelector('.dock-tray')?.getBoundingClientRect();
      engine.setTerrain({ width: options.width, height: options.height, top: 40, dock: dock ? { left: dock.left, right: dock.right, top: dock.top } : null });
    }
    const bubble = root.current?.querySelector<HTMLElement>('.pet-bubble'); bubbleSize.current = bubble?.offsetWidth ?? 0;
    paint(); wake.current();
  }, [options.gravity, options.reduced, options.paused, options.blocked, options.width, options.height, options.saved.x, options.saved.y]);
  useLayoutEffect(() => {
    const blocked = options.paused || !!document.querySelector('[data-testid="context-menu"]');
    if (engine.paused !== blocked) { engine.configure(options.gravity, options.reduced, blocked, options.blocked); wake.current(); }
    const bubble = root.current?.querySelector<HTMLElement>('.pet-bubble'); bubbleSize.current = bubble?.offsetWidth ?? 0; paint();
  });
  return {
    engine,
    pick: () => { engine.pick(); paint(); wake.current(); },
    hold: (point: PetPoint, seconds: number) => { engine.hold(point, seconds); paint(); },
    drop: (idleSeconds = 0) => { engine.drop(idleSeconds); paint(); wake.current(); },
    place: (point: PetPoint) => { engine.place(point); paint(); wake.current(); },
    trick: (activity: PetTrick) => { engine.startActivity(activity); paint(); wake.current(); },
  };
}
