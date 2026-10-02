// SPDX-License-Identifier: AGPL-3.0-only
import { PET_ACTIVITIES, type PetTrick } from './petActivities';
export type { PetTrick } from './petActivities';
export const PET_SIZE = 84;
export const PET_FEET = 78;
export type PetPoint = { x: number; y: number };
export type PetTerrain = { width: number; height: number; top: number; dock: { left: number; right: number; top: number } | null };
export type PetMovement = 'rest' | 'walk' | 'run' | 'crouch' | 'jump' | 'throw' | 'fall' | 'bounce' | 'slide' | 'climb' | 'mantle' | 'vault' | 'conjure' | 'perform' | 'vanish' | 'land' | 'held';
export type PetActivity = PetTrick | 'none' | 'pole';
export type PetSurface = 'dock' | 'floor' | 'air';
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const approach = (value: number, target: number, amount: number) => value < target ? Math.min(target, value + amount) : Math.max(target, value - amount);

export class PetMotion {
  point: PetPoint;
  movement: PetMovement = 'rest';
  surface: PetSurface = 'air';
  direction = 1;
  vx = 0;
  vy = 0;
  stride = 0;
  tilt = 0;
  impact = 0;
  bounces = 0;
  private angularVelocity = 0;
  gravity = false;
  reduced = false;
  paused = false;
  blocked = false;
  activity: PetActivity = 'none';
  climbStyle: 'edge' | 'pole' = 'edge';
  pole: { x: number; top: number; bottom: number } | null = null;
  progress = 0;
  trickDuration = 6;
  trickSpeed = 1;
  activities: readonly PetTrick[] = PET_ACTIVITIES.map((item) => item.value);
  ball: { x: number; y: number; vx: number; vy: number; radius: number; spin: number; bounces: number; ground: number; launched: boolean } | null = null;
  private manual = false;
  private previousTrick: PetTrick | null = null;
  private lastWasTrick = false;
  elapsed = 0;
  restFor = 3;
  target = 0;
  speed = 0;
  next: 'rest' | 'jump' | 'climb' = 'rest';
  private climbFrom: PetPoint = { x: 0, y: 0 };
  private climbTo: PetPoint = { x: 0, y: 0 };
  private climbDuration = 1;
  private climbLip: PetPoint = { x: 0, y: 0 };
  private jumpDirection = 1;

  constructor(point: PetPoint, public terrain: PetTerrain, private random: () => number = Math.random) { this.point = { ...point }; }
  private between(min: number, max: number) { return min + this.random() * (max - min); }
  private phase(movement: PetMovement) { this.movement = movement; this.elapsed = 0; }
  private floorY() { return Math.max(this.terrain.top, this.terrain.height - PET_SIZE - 2); }
  private deck() {
    const dock = this.terrain.dock;
    return dock && dock.right - dock.left > 60 ? { left: Math.max(8, dock.left - 26), right: Math.min(this.terrain.width - PET_SIZE - 8, dock.right - 58), y: Math.max(this.terrain.top, dock.top - PET_FEET) } : null;
  }
  private bounds() {
    const dock = this.terrain.dock;
    const deck = this.deck();
    if (this.surface === 'dock' && deck) return { left: deck.left, right: Math.max(deck.left, deck.right) };
    if (dock && this.point.x + PET_SIZE / 2 < (dock.left + dock.right) / 2) return { left: 8, right: Math.max(8, dock.left - PET_SIZE + 8) };
    return { left: Math.min(this.terrain.width - PET_SIZE - 8, (dock?.right ?? 16) - 8), right: Math.max(8, this.terrain.width - PET_SIZE - 8) };
  }
  private clearProps() { this.activity = 'none'; this.pole = null; this.ball = null; this.manual = false; this.progress = 0; }
  setActivities(activities: readonly PetTrick[]) {
    this.activities = PET_ACTIVITIES.map((item) => item.value).filter((activity) => activities.includes(activity));
    if (this.activity !== 'none' && this.activity !== 'pole' && !this.activities.includes(this.activity)) this.rest(.8, 1.4);
  }
  private rest(min = 1.8, max = 5.5) { this.clearProps(); this.vx = 0; this.vy = 0; this.tilt = 0; this.restFor = this.between(min, max); this.phase('rest'); }
  setTerrain(terrain: PetTerrain) {
    this.terrain = terrain;
    if (this.ball) this.rest(.8, 1.4);
    this.point.x = clamp(this.point.x, 8, Math.max(8, terrain.width - PET_SIZE - 8));
    this.point.y = clamp(this.point.y, terrain.top, this.floorY());
    if (!this.gravity || this.movement === 'held') return;
    if (this.surface === 'dock' && this.deck()) {
      const deck = this.deck()!;
      this.point.x = clamp(this.point.x, deck.left, Math.max(deck.left, deck.right)); this.point.y = deck.y;
    } else if (this.surface === 'floor') {
      const bounds = this.bounds(); this.point.x = clamp(this.point.x, bounds.left, bounds.right); this.point.y = this.floorY();
    } else if (this.surface === 'dock') { this.surface = 'air'; this.phase('fall'); }
    if (['climb', 'mantle', 'vault', 'crouch'].includes(this.movement) || this.activity === 'pole') { this.clearProps(); this.surface = 'air'; this.phase('fall'); }
  }
  configure(gravity: boolean, reduced: boolean, paused: boolean, blocked = false) {
    const changed = this.gravity !== gravity;
    this.gravity = gravity; this.reduced = reduced; this.paused = paused; this.blocked = blocked;
    if (changed) {
      this.clearProps();
      this.vx = 0; this.vy = 0; this.surface = 'air';
      if (gravity) this.drop(0, false); else this.rest();
    }
    if (gravity && reduced && this.movement !== 'held' && !this.manual) this.settle();
    if ((blocked || paused && !this.manual) && ['conjure', 'perform', 'vanish'].includes(this.movement) && this.activity !== 'pole') this.rest(.8, 1.4);
    if (paused && ['walk', 'run', 'crouch'].includes(this.movement)) this.rest(.8, 1.4);
  }
  place(point: PetPoint) { this.clearProps(); this.point = { ...point }; this.vx = 0; this.vy = 0; this.surface = 'air'; if (this.gravity) this.drop(0, false); else this.rest(); }
  pick() { this.clearProps(); this.vx = 0; this.vy = 0; this.tilt = 0; this.impact = 0; this.bounces = 0; this.angularVelocity = 0; this.phase('held'); }
  hold(point: PetPoint, seconds: number) {
    const dt = Math.max(1 / 240, seconds); const weight = 1 - Math.exp(-dt / .035);
    this.vx += (clamp((point.x - this.point.x) / dt, -1100, 1100) - this.vx) * weight;
    this.vy += (clamp((point.y - this.point.y) / dt, -950, 1100) - this.vy) * weight;
    this.tilt = clamp(-this.vx / 35, -22, 22); this.point = { ...point };
  }
  drop(idleSeconds = 0, thrown = true) {
    this.bounces = 0; this.impact = 0;
    if (!this.gravity) { this.phase(this.reduced ? 'rest' : 'land'); return; }
    if (this.reduced) { this.settle(); return; }
    const dock = this.terrain.dock;
    if (!thrown && dock && this.point.y + PET_FEET > dock.top && this.point.x + 42 > dock.left && this.point.x + 42 < dock.right) { this.climb(true); return; }
    const freshness = Math.exp(-Math.max(0, idleSeconds - .04) / .045);
    this.vx = clamp(this.vx * freshness, -1100, 1100); this.vy = clamp(this.vy * freshness, -950, 1100);
    if (Math.abs(this.vx) < 8) this.vx = 0;
    if (Math.abs(this.vy) < 8) this.vy = 0;
    if (Math.abs(this.vx) > 30) this.direction = Math.sign(this.vx);
    this.angularVelocity = clamp(this.vx * .14 - this.vy * .06, -180, 180);
    this.surface = 'air'; this.phase(thrown && Math.hypot(this.vx, this.vy) > 100 ? 'throw' : 'fall');
  }
  private finishLanding() {
    const dock = this.terrain.dock;
    if (this.surface === 'floor' && dock && this.point.x + 42 > dock.left && this.point.x + 42 < dock.right) this.climb(true);
    else this.phase('land');
  }
  private impactOn(surface: PetSurface, y: number) {
    const speed = Math.max(0, this.vy);
    this.point.y = y; this.impact = clamp(speed / 700, .15, 1); this.angularVelocity *= .35;
    this.vx *= .78;
    if (speed > 140 && this.bounces < 4) {
      this.vy = -speed * .43; this.bounces++; this.surface = 'air'; this.phase('bounce');
    } else {
      this.vy = 0; this.surface = surface;
      if (Math.abs(this.vx) > 12) this.phase('slide'); else { this.vx = 0; this.finishLanding(); }
    }
  }
  private collideSides(beforeX: number) {
    const left = 8; const right = Math.max(left, this.terrain.width - PET_SIZE - 8);
    if (this.point.x < left) { this.point.x = left; this.vx = Math.abs(this.vx) * .58; this.direction = 1; this.angularVelocity *= -.5; }
    if (this.point.x > right) { this.point.x = right; this.vx = -Math.abs(this.vx) * .58; this.direction = -1; this.angularVelocity *= -.5; }
    const dock = this.terrain.dock;
    if (!dock || this.point.y + PET_FEET <= dock.top + 4) return;
    if (beforeX + 72 <= dock.left && this.point.x + 72 > dock.left) { this.point.x = dock.left - 72; this.vx = -Math.abs(this.vx) * .55; this.direction = -1; this.angularVelocity *= -.5; }
    else if (beforeX + 12 >= dock.right && this.point.x + 12 < dock.right) { this.point.x = dock.right - 12; this.vx = Math.abs(this.vx) * .55; this.direction = 1; this.angularVelocity *= -.5; }
  }
  private flight(seconds: number) {
    for (let remaining = seconds; remaining > .000001;) {
      const dt = Math.min(remaining, 1 / 120); remaining -= dt;
      const feet = this.point.y + PET_FEET; const beforeX = this.point.x;
      this.point.x += this.vx * dt; this.point.y += this.vy * dt + 525 * dt * dt;
      this.vy += 1050 * dt; this.vx *= Math.exp(-.12 * dt);
      this.tilt = clamp(this.tilt + this.angularVelocity * dt, -38, 38); this.angularVelocity *= Math.exp(-1.2 * dt);
      if (this.point.y < this.terrain.top) { this.point.y = this.terrain.top; this.vy = Math.abs(this.vy) * .35; this.angularVelocity *= -.5; }
      this.collideSides(beforeX);
      if (this.vy > 0 && ['jump', 'throw', 'bounce'].includes(this.movement)) this.movement = 'fall';
      const dock = this.terrain.dock; const deck = this.deck();
      if (dock && deck && this.vy >= 0 && feet <= dock.top + .5 && this.point.y + PET_FEET >= dock.top && this.point.x + 42 >= dock.left + 6 && this.point.x + 42 <= dock.right - 6) {
        this.impactOn('dock', deck.y); break;
      }
      if (this.point.y >= this.floorY() && this.vy >= 0) { this.impactOn('floor', this.floorY()); break; }
    }
  }
  private settle() {
    const deck = this.deck(); const dock = this.terrain.dock;
    if (deck && dock && this.point.x + 42 >= dock.left && this.point.x + 42 <= dock.right) {
      this.surface = 'dock'; this.point.x = clamp(this.point.x, deck.left, Math.max(deck.left, deck.right)); this.point.y = deck.y;
    } else {
      this.surface = 'floor'; const bounds = this.bounds(); this.point.x = clamp(this.point.x, bounds.left, bounds.right); this.point.y = this.floorY();
    }
    this.rest();
  }
  private climb(recovery = false) {
    const deck = this.deck();
    if (!deck) { this.surface = 'air'; this.phase('fall'); return; }
    this.climbFrom = { ...this.point };
    const left = this.point.x + 42 < (deck.left + deck.right) / 2 + 42;
    this.direction = left ? 1 : -1;
    this.climbStyle = recovery || this.random() >= .5 ? 'pole' : 'edge';
    this.climbTo = { x: recovery ? this.point.x : left ? deck.left + 16 : deck.right - 16, y: deck.y };
    this.climbTo.x = clamp(this.climbTo.x, deck.left, Math.max(deck.left, deck.right));
    this.climbLip = { x: this.point.x, y: Math.max(this.terrain.top, deck.y + (this.climbStyle === 'pole' ? -18 : 14)) };
    this.climbDuration = this.between(1.25, 1.75); this.vx = 0; this.vy = 0;
    if (this.climbStyle === 'pole') {
      this.activity = 'pole';
      this.pole = { x: this.point.x + (this.direction > 0 ? 76 : 8), top: this.climbLip.y + 31, bottom: this.floorY() + PET_FEET };
      this.phase('conjure');
    } else { this.surface = 'air'; this.phase('climb'); }
  }
  startActivity(activity: PetTrick, manual = true) {
    if (!this.activities.includes(activity) || this.blocked || this.movement === 'held' || ['climb', 'mantle', 'vault', 'jump', 'throw', 'fall', 'bounce', 'slide', 'crouch'].includes(this.movement) || this.activity === 'pole') return false;
    this.clearProps();
    this.vx = 0; this.vy = 0; this.manual = manual; this.activity = activity; this.previousTrick = activity;
    this.lastWasTrick = true;
    this.trickDuration = this.between(4.5, 7.5); this.trickSpeed = this.between(.85, 1.2);
    this.direction = this.point.x + PET_SIZE + 24 > this.terrain.width ? -1 : this.point.x < 24 ? 1 : this.direction;
    if (activity === 'golf' || activity === 'basketball') {
      const radius = activity === 'golf' ? 5 : 9;
      const ground = Math.min(this.terrain.height - radius - 8, this.point.y + PET_FEET - radius);
      this.ball = { x: clamp(this.point.x + (this.direction > 0 ? 76 : 8), radius + 8, this.terrain.width - radius - 8), y: ground, vx: 0, vy: 0, radius, spin: 0, bounces: 0, ground, launched: false };
    }
    this.phase(this.reduced ? 'perform' : 'conjure'); return true;
  }
  private decide() {
    const deck = this.deck(); const dock = this.terrain.dock; const bounds = this.bounds();
    if (bounds.right - bounds.left < 16) { this.rest(); return; }
    if (this.activities.length && !this.lastWasTrick && this.random() < .32) {
      const alternatives = this.activities.filter((trick) => trick !== this.previousTrick);
      const tricks = alternatives.length ? alternatives : this.activities;
      this.startActivity(tricks[Math.min(tricks.length - 1, Math.floor(this.random() * tricks.length))], false); return;
    }
    this.lastWasTrick = false;
    this.next = 'rest';
    if (this.surface === 'dock' && dock && deck && this.random() < .3) {
      const left = dock.left > PET_SIZE + 28; const right = this.terrain.width - dock.right > PET_SIZE + 28;
      if (left || right) {
        this.jumpDirection = left && right ? (this.random() < .5 ? -1 : 1) : left ? -1 : 1;
        this.target = this.jumpDirection < 0 ? deck.left : deck.right; this.next = 'jump';
      }
    } else if (this.surface === 'floor' && deck && this.random() < .55) {
      this.target = this.point.x + 42 < (deck.left + deck.right) / 2 + 42 ? bounds.right : bounds.left; this.next = 'climb';
    }
    if (this.next === 'rest') {
      this.target = this.between(bounds.left, bounds.right);
      if (Math.abs(this.target - this.point.x) < 35) this.target = this.point.x < (bounds.left + bounds.right) / 2 ? bounds.right : bounds.left;
    }
    const running = this.random() < .28;
    this.speed = running ? this.between(88, 135) : this.between(28, 52);
    this.direction = this.target < this.point.x ? -1 : 1; this.phase(running ? 'run' : 'walk');
  }
  private playBall(seconds: number) {
    const ball = this.ball;
    if (!ball || this.reduced || this.elapsed < .5) return;
    if (!ball.launched) {
      ball.launched = true;
      ball.vx = this.activity === 'golf' ? this.direction * clamp(this.terrain.width * .65, 360, 1000) : 0;
      ball.vy = this.activity === 'golf' ? -140 : -280;
    }
    for (let remaining = seconds; remaining > .000001;) {
      const dt = Math.min(remaining, 1 / 120); remaining -= dt;
      ball.x += ball.vx * dt; ball.y += ball.vy * dt + 340 * dt * dt;
      ball.vy += 680 * dt; ball.spin += ball.vx * dt / ball.radius * 180 / Math.PI;
      const left = ball.radius + 8; const right = Math.max(left, this.terrain.width - ball.radius - 8);
      if (ball.x < left) { ball.x = left; ball.vx = Math.abs(ball.vx) * .86; ball.bounces++; }
      if (ball.x > right) { ball.x = right; ball.vx = -Math.abs(ball.vx) * .86; ball.bounces++; }
      if (ball.y < this.terrain.top + ball.radius) { ball.y = this.terrain.top + ball.radius; ball.vy = Math.abs(ball.vy) * .5; }
      if (ball.y >= ball.ground && ball.vy >= 0) {
        ball.y = ball.ground;
        ball.vy = this.activity === 'basketball' ? -280 : ball.vy > 45 ? -ball.vy * .48 : 0;
        ball.vx *= Math.exp(-.28 * dt);
      }
      ball.vx *= Math.exp(-.08 * dt);
    }
  }
  step(seconds: number) {
    const dt = clamp(seconds, 0, .04);
    if (this.movement === 'held') return false;
    this.impact = Math.max(0, this.impact - dt * 4.5);
    this.elapsed += dt;
    if (this.movement === 'land') { if (this.elapsed >= .42) this.rest(); return true; }
    if (this.movement === 'conjure') {
      this.progress = Math.min(1, this.elapsed / .75);
      if (this.progress === 1) { if (this.activity === 'pole') { this.surface = 'air'; this.phase('climb'); } else this.phase('perform'); }
      return true;
    }
    if (this.movement === 'perform') { this.playBall(dt); if (this.elapsed >= this.trickDuration) { if (this.reduced) this.rest(); else this.phase('vanish'); } return true; }
    if (this.movement === 'vanish') { if (this.elapsed >= .45) this.rest(); return true; }
    if (!this.gravity || this.reduced) return false;
    if (this.movement === 'slide') {
      const beforeX = this.point.x; const beforeVelocity = this.vx;
      this.vx = approach(this.vx, 0, 520 * dt); this.point.x += (beforeVelocity + this.vx) * .5 * dt;
      this.tilt = approach(this.tilt, 0, 150 * dt); this.collideSides(beforeX);
      const dock = this.terrain.dock;
      if (this.surface === 'dock' && (!dock || this.point.x + 42 < dock.left + 6 || this.point.x + 42 > dock.right - 6)) { this.surface = 'air'; this.phase('fall'); }
      else if (Math.abs(this.vx) < 12) { this.vx = 0; this.finishLanding(); }
      return true;
    }
    if (this.movement === 'rest') {
      if (!this.paused && this.elapsed >= this.restFor) this.decide();
      return false;
    }
    if (this.movement === 'climb') {
      const t = Math.min(1, this.elapsed / this.climbDuration); const stepped = t - Math.sin(t * Math.PI * 6) / (Math.PI * 6);
      this.point.x = this.climbFrom.x;
      this.point.y = clamp(this.climbFrom.y + (this.climbLip.y - this.climbFrom.y) * stepped, this.terrain.top, this.floorY());
      this.progress = t; this.stride = t * Math.PI * 6;
      if (t === 1) { this.climbFrom = { ...this.point }; this.phase(this.climbStyle === 'pole' ? 'vault' : 'mantle'); }
      return true;
    }
    if (this.movement === 'mantle' || this.movement === 'vault') {
      const t = Math.min(1, this.elapsed / (this.movement === 'vault' ? .65 : .8)); const eased = t * t * (3 - 2 * t);
      this.point.x = this.climbFrom.x + (this.climbTo.x - this.climbFrom.x) * eased;
      this.point.y = Math.max(this.terrain.top, this.climbFrom.y + (this.climbTo.y - this.climbFrom.y) * eased - Math.sin(t * Math.PI) * (this.movement === 'vault' ? 25 : 20));
      this.progress = t;
      if (t === 1) { this.point = { ...this.climbTo }; this.surface = 'dock'; this.phase('land'); }
      return true;
    }
    if (this.movement === 'crouch') {
      if (this.elapsed >= .18) { this.bounces = 0; this.direction = this.jumpDirection; this.vy = -this.between(140, 180); const height = Math.max(0, this.floorY() - this.point.y); const airtime = (-this.vy + Math.sqrt(this.vy ** 2 + 2100 * height)) / 1050; const speed = Math.max(120, 74 / airtime); this.vx = this.direction * this.between(speed, speed + 45); this.surface = 'air'; this.phase('jump'); }
      return true;
    }
    if (['jump', 'throw', 'fall', 'bounce'].includes(this.movement)) { this.flight(dt); return true; }
    if (this.movement === 'walk' || this.movement === 'run') {
      const distance = this.target - this.point.x; const acceleration = this.movement === 'run' ? 500 : 260;
      const desired = Math.sign(distance) * Math.min(this.speed, Math.sqrt(2 * acceleration * Math.abs(distance)));
      this.vx = approach(this.vx, desired, acceleration * dt);
      const step = this.vx * dt;
      this.point.x += Math.abs(step) >= Math.abs(distance) ? distance : step;
      this.stride += Math.abs(step) / (this.movement === 'run' ? 7 : 5);
      if (Math.abs(this.target - this.point.x) < 1) {
        this.point.x = this.target; this.vx = 0;
        if (this.next === 'jump') this.phase('crouch'); else if (this.next === 'climb') this.climb(); else this.rest();
      }
      return true;
    }
    return false;
  }
  delay() {
    if (this.reduced && this.movement === 'perform') return Math.max(16, (this.trickDuration - this.elapsed) * 1000);
    return this.movement === 'rest' && this.gravity && !this.reduced && !this.paused ? Math.max(16, (this.restFor - this.elapsed) * 1000) : null;
  }
  advanceRest(seconds: number) {
    this.elapsed += seconds;
    if (this.reduced && this.movement === 'perform' && this.elapsed >= this.trickDuration) this.rest();
    else if (this.movement === 'rest' && !this.paused && this.gravity && !this.reduced && this.elapsed >= this.restFor) this.decide();
  }
}
