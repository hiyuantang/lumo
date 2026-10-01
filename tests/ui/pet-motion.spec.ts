// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from '../offline';
import { PetMotion, PET_FEET, PET_SIZE, type PetActivity, type PetMovement, type PetTerrain } from '../../src/shell/petMotion';
import { piPage } from './pi-fixture';

const terrain: PetTerrain = { width: 1440, height: 1000, top: 40, dock: { left: 350, right: 1090, top: 916 } };
function random(seed: number) { return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }; }

test('Gravity explores both dock edges with continuous walking, running, jumps, climbs and rests', () => {
  const phases = new Set<PetMovement>(); const directions = new Set<number>(); const speeds = new Set<number>();
  const activities = new Set<PetActivity>(); const climbs = new Set<string>();
  let maxHorizontalStep = 0; let maxVerticalStep = 0;
  for (let seed = 1; seed <= 8; seed++) {
    const pet = new PetMotion({ x: 600, y: 300 }, terrain, random(seed)); pet.configure(true, false, false);
    for (let frame = 0; frame < 180 * 60; frame++) {
      const before = { ...pet.point }; const beforeMovement = pet.movement; pet.step(1 / 60);
      phases.add(pet.movement); directions.add(pet.direction); if (pet.movement === 'walk' || pet.movement === 'run') speeds.add(Math.round(pet.speed));
      activities.add(pet.activity);
      if (pet.movement === 'climb') { climbs.add(pet.climbStyle); if (beforeMovement === 'climb') expect(pet.point.x).toBeCloseTo(before.x, 6); }
      if (pet.point.x < 8 || pet.point.x > terrain.width - PET_SIZE - 8 || pet.point.y < terrain.top || pet.point.y > terrain.height - PET_SIZE - 2) throw new Error(`Out of bounds: ${JSON.stringify({ seed, frame, point: pet.point, movement: pet.movement })}`);
      maxHorizontalStep = Math.max(maxHorizontalStep, Math.abs(pet.point.x - before.x)); maxVerticalStep = Math.max(maxVerticalStep, Math.abs(pet.point.y - before.y));
      if (['rest', 'walk', 'run', 'perform'].includes(pet.movement)) {
        const support = pet.surface === 'dock' ? terrain.dock!.top : terrain.height - 8;
        if (Math.abs(pet.point.y + PET_FEET - support) > .01) throw new Error(`Unsupported ${pet.movement} at ${JSON.stringify(pet.point)}`);
      }
    }
  }
  expect(maxHorizontalStep).toBeLessThan(12); expect(maxVerticalStep).toBeLessThan(24);
  expect([...phases]).toEqual(expect.arrayContaining(['rest', 'walk', 'run', 'crouch', 'jump', 'fall', 'land', 'climb']));
  expect([...directions].sort()).toEqual([-1, 1]); expect(speeds.size).toBeGreaterThan(12);
  expect([...activities]).toEqual(expect.arrayContaining(['notes', 'soccer', 'juggle', 'pole']));
  expect([...climbs].sort()).toEqual(['edge', 'pole']);
  expect([...phases]).toEqual(expect.arrayContaining(['conjure', 'perform', 'vanish', 'mantle', 'vault']));
});

test('Tricks conjure, perform and disappear without moving a free pet, and interruptions clear props', () => {
  const pet = new PetMotion({ x: 300, y: 300 }, terrain, random(1));
  for (const activity of ['notes', 'soccer', 'juggle'] as const) {
    expect(pet.startActivity(activity)).toBe(true);
    const phases = new Set<string>();
    for (let frame = 0; frame < 600 && pet.movement !== 'rest'; frame++) { phases.add(pet.movement); pet.step(1 / 60); }
    expect([...phases]).toEqual(['conjure', 'perform', 'vanish']);
    expect(pet.activity).toBe('none'); expect(pet.point).toEqual({ x: 300, y: 300 });
  }
  pet.startActivity('soccer'); pet.configure(false, false, true);
  expect(pet.activity).toBe('soccer');
  pet.configure(false, false, true, true); expect(pet.activity).toBe('none');
  pet.configure(false, false, false); pet.startActivity('notes'); pet.pick();
  expect(pet.activity).toBe('none'); expect(pet.movement).toBe('held');
  pet.drop(); for (let frame = 0; frame < 30; frame++) pet.step(1 / 60);
  pet.configure(false, true, false); pet.startActivity('juggle');
  expect(pet.movement).toBe('perform'); expect(pet.delay()).toBeGreaterThan(4000);
  pet.advanceRest(pet.delay()! / 1000); expect(pet.activity).toBe('none'); expect(pet.movement).toBe('rest');
});

test('A conjured pole stays planted through its climb and hop, and resizing or pickup removes it', () => {
  const pet = new PetMotion({ x: 650, y: 914 }, terrain, random(2)); pet.configure(true, false, false);
  expect(pet.activity).toBe('pole'); const pole = { ...pet.pole! }; const phases = new Set<string>();
  for (let frame = 0; frame < 300 && pet.movement !== 'rest'; frame++) {
    phases.add(pet.movement); pet.step(1 / 60);
    if (pet.pole) expect(pet.pole).toEqual(pole);
  }
  expect([...phases]).toEqual(['conjure', 'climb', 'vault', 'land']);
  expect(pet.surface).toBe('dock'); expect(pet.point.y + PET_FEET).toBe(916); expect(pet.pole).toBeNull();
  pet.place({ x: 650, y: 914 }); expect(pet.activity).toBe('pole'); pet.pick(); expect(pet.pole).toBeNull();
  pet.place({ x: 650, y: 914 }); expect(pet.activity).toBe('pole');
  pet.setTerrain({ width: 390, height: 700, top: 40, dock: { left: 8, right: 382, top: 637 } });
  expect(pet.pole).toBeNull(); expect(pet.activity).toBe('none');
  for (let frame = 0; frame < 180; frame++) pet.step(1 / 60);
  expect(pet.point.x).toBeGreaterThanOrEqual(8); expect(pet.point.x + PET_SIZE).toBeLessThanOrEqual(390);
});

test('Picking up freezes roaming, release accelerates toward the correct support and free mode stays put', () => {
  const pet = new PetMotion({ x: 600, y: 300 }, terrain, random(4)); pet.configure(true, false, false);
  pet.pick(); pet.hold({ x: 650, y: 200 }, .2); const held = { ...pet.point };
  for (let frame = 0; frame < 120; frame++) pet.step(1 / 60);
  expect(pet.point).toEqual(held); expect(pet.movement).toBe('held'); expect(Math.abs(pet.tilt)).toBeGreaterThan(0);
  pet.vx = 0; pet.vy = 0; pet.drop(); pet.step(1 / 60); const initial = pet.vy;
  pet.step(1 / 60); expect(pet.vy).toBeGreaterThan(initial);
  pet.configure(true, false, true);
  for (let frame = 0; frame < 240; frame++) pet.step(1 / 60);
  expect(pet.surface).toBe('dock'); expect(pet.point.y + PET_FEET).toBeCloseTo(terrain.dock!.top, 3);
  pet.configure(false, false, false); pet.pick(); pet.hold({ x: 150, y: 320 }, .2); pet.drop();
  for (let frame = 0; frame < 60 * 30; frame++) pet.step(1 / 60);
  expect(pet.point).toEqual({ x: 150, y: 320 }); expect(pet.movement).toBe('rest');
});

test('A throw preserves recent pointer momentum, a paused release loses it, and bounces lose energy', () => {
  const floor = { ...terrain, dock: null };
  const throwPet = (idle = 0) => {
    const pet = new PetMotion({ x: 250, y: 400 }, floor, random(1)); pet.configure(true, false, true); pet.pick();
    for (let sample = 1; sample <= 6; sample++) pet.hold({ x: 250 + sample * 16, y: 400 - sample * 12 }, .016);
    pet.drop(idle); return pet;
  };
  const flying = throwPet(); expect(flying.movement).toBe('throw'); expect(flying.vx).toBeGreaterThan(850); expect(flying.vy).toBeLessThan(-650);
  const release = { ...flying.point }; flying.step(1 / 60);
  expect(flying.point.x).toBeGreaterThan(release.x + 12); expect(flying.point.y).toBeLessThan(release.y - 9);
  const stopped = throwPet(.3); expect(stopped.vx).toBe(0); expect(stopped.vy).toBe(0); expect(stopped.movement).toBe('fall');
  const vertical = new PetMotion({ x: 500, y: 200 }, floor, random(1)); vertical.configure(true, false, true); vertical.pick(); vertical.drop();
  const rebounds: number[] = [];
  for (let frame = 0; frame < 600 && vertical.movement !== 'rest'; frame++) {
    const count = vertical.bounces; vertical.step(1 / 120);
    if (vertical.bounces > count) rebounds.push(-vertical.vy);
    expect(vertical.point.y).toBeLessThanOrEqual(914);
  }
  expect(rebounds.length).toBeGreaterThanOrEqual(2); expect(rebounds.length).toBeLessThanOrEqual(4);
  for (let bounce = 1; bounce < rebounds.length; bounce++) expect(rebounds[bounce]).toBeLessThan(rebounds[bounce - 1] * .5);
  expect(vertical.movement).toBe('rest'); expect(vertical.surface).toBe('floor'); expect(vertical.point.y).toBe(914);
});

test('Throws rebound from desktop and dock edges, skid to a stop and land consistently at different frame rates', () => {
  const wall = new PetMotion({ x: 1320, y: 700 }, terrain, random(1)); wall.configure(true, false, true); wall.pick(); wall.vx = 1000; wall.drop();
  for (let frame = 0; frame < 15; frame++) wall.step(1 / 120);
  expect(wall.vx).toBeLessThan(0); expect(wall.point.x + PET_SIZE).toBeLessThanOrEqual(1440);
  const ceiling = new PetMotion({ x: 150, y: 45 }, terrain, random(1)); ceiling.configure(true, false, true); ceiling.pick(); ceiling.vy = -900; ceiling.drop(); ceiling.step(1 / 60);
  expect(ceiling.vy).toBeGreaterThan(0); expect(ceiling.point.y).toBeGreaterThanOrEqual(40);
  const edge = new PetMotion({ x: 1120, y: 914 }, terrain, random(1)); edge.configure(true, false, true); edge.pick(); edge.vx = -700; edge.drop();
  for (let frame = 0; frame < 20; frame++) edge.step(1 / 120);
  expect(edge.vx).toBeGreaterThan(0); expect(edge.point.x).toBeGreaterThanOrEqual(1078);
  const outcomes = [30, 60, 120].map((rate) => {
    const pet = new PetMotion({ x: 150, y: 400 }, { ...terrain, dock: null }, random(1)); pet.configure(true, false, true); pet.pick(); pet.vx = 500; pet.vy = -300; pet.drop();
    const phases = new Set<string>();
    for (let frame = 0; frame < rate * 8 && pet.movement !== 'rest'; frame++) { pet.step(1 / rate); phases.add(pet.movement); }
    expect([...phases]).toEqual(expect.arrayContaining(['throw', 'fall', 'bounce', 'slide', 'land', 'rest']));
    expect(pet.vx).toBe(0); expect(pet.vy).toBe(0); expect(pet.point.y).toBe(914);
    return pet.point.x;
  });
  expect(Math.max(...outcomes) - Math.min(...outcomes)).toBeLessThan(15);
  const dock = new PetMotion({ x: 600, y: 200 }, terrain, random(1)); dock.configure(true, false, true); dock.pick(); dock.drop();
  for (let frame = 0; frame < 480 && dock.movement !== 'rest'; frame++) dock.step(1 / 120);
  expect(dock.bounces).toBeGreaterThan(0); expect(dock.surface).toBe('dock'); expect(dock.point.y + PET_FEET).toBe(916);
});

test('A full-width dock has no edge exits, resized docks stay reachable and reduced motion remains still', () => {
  const full: PetTerrain = { ...terrain, dock: { left: 8, right: 1432, top: 916 } };
  const pet = new PetMotion({ x: 650, y: 300 }, full, random(2)); pet.configure(true, false, false);
  const phases = new Set<PetMovement>();
  for (let frame = 0; frame < 60 * 90; frame++) { pet.step(1 / 60); phases.add(pet.movement); }
  expect(phases.has('jump')).toBe(false); expect(phases.has('climb')).toBe(false);
  pet.setTerrain({ width: 390, height: 700, top: 40, dock: { left: 8, right: 382, top: 637 } });
  expect(pet.point.x).toBeGreaterThanOrEqual(8); expect(pet.point.x + PET_SIZE).toBeLessThanOrEqual(390);
  expect(pet.point.y + PET_FEET).toBeCloseTo(637, 3);
  pet.configure(true, true, false); const before = { ...pet.point };
  for (let frame = 0; frame < 60 * 60; frame++) pet.step(1 / 60);
  expect(pet.point).toEqual(before); expect(pet.movement).toBe('rest');
  pet.pick(); pet.hold({ x: 150, y: 100 }, .1); pet.drop();
  expect(pet.movement).toBe('rest'); expect(pet.point.y + PET_FEET).toBeCloseTo(637, 3);
});

test('Compact bubbles fit their content, gravity persists and a dragged pet drops onto the dock', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  await piPage(page); await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.goto('http://localhost:5200');
  await page.getByTestId('pet-handle').click({ button: 'right' }); await page.getByRole('menuitem', { name: 'Pet settings', exact: true }).click();
  const gravity = page.getByTestId('settings-pet-gravity'); const pet = page.getByTestId('desktop-pet');
  await gravity.click(); await expect(pet).toHaveAttribute('data-gravity', 'true');
  await page.getByTestId('settings-pet-bubbles').click(); await page.getByTestId('settings-pet-bubbles').click();
  const bubble = page.getByTestId('pet-bubble'); await expect(bubble).toContainText('Hello!');
  const width = (await bubble.boundingBox())!.width; expect(width).toBeLessThan(120);
  const text = await bubble.locator('span').boundingBox(); const close = await bubble.getByRole('button').boundingBox();
  expect(close!.x - (text!.x + text!.width)).toBeLessThanOrEqual(9);
  await bubble.getByRole('button').click();
  await page.getByRole('button', { name: 'Minimize Pi', exact: true }).click();
  const dock = (await page.getByTestId('dock-surface').boundingBox())!;
  const handle = page.getByTestId('pet-handle'); const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + 42, box.y + 35); await page.mouse.down();
  await expect(pet).toHaveAttribute('data-motion', 'held');
  await page.mouse.move(dock.x + dock.width / 2, dock.y - 190, { steps: 12 });
  const shadow = (await pet.locator('.pet-ground').boundingBox())!;
  expect(Math.abs(shadow.y + shadow.height / 2 - dock.y)).toBeLessThan(1.5);
  await handle.screenshot({ path: '/tmp/lumo-pet-picked-up.png' });
  await page.waitForTimeout(300); await page.mouse.up(); await page.mouse.move(10, 100);
  await expect(pet).toHaveAttribute('data-surface', 'dock');
  await expect.poll(async () => Math.abs((await handle.boundingBox())!.y + PET_FEET - (await page.getByTestId('dock-surface').boundingBox())!.y)).toBeLessThanOrEqual(1.5);
  await expect(pet).toHaveAttribute('data-motion', 'rest');
  await handle.screenshot({ path: '/tmp/lumo-pet-gravity-dock.png' });
  await page.reload(); await expect(pet).toHaveAttribute('data-gravity', 'true');
  await page.getByTestId('pet-handle').click({ button: 'right' }); await page.getByRole('menuitem', { name: 'Pet settings', exact: true }).click();
  await expect(gravity).toBeChecked(); await gravity.click(); await expect(pet).toHaveAttribute('data-gravity', 'false');
  const stationary = await handle.boundingBox(); await page.waitForTimeout(1200);
  const after = await handle.boundingBox(); expect(after!.x).toBeCloseTo(stationary!.x, 1); expect(after!.y).toBeCloseTo(stationary!.y, 1);
  expect(errors).toEqual([]);
});

test('Dock roaming renders directional strides, edge jumps and climbing poses', async ({ page }) => {
  await page.addInitScript(() => { Math.random = () => .2; });
  await piPage(page); await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.goto('http://localhost:5200');
  await page.getByTestId('pet-handle').click({ button: 'right' }); await page.getByRole('menuitem', { name: 'Pet settings', exact: true }).click();
  await page.getByTestId('settings-pet-gravity').click(); await page.getByTestId('settings-pet-reset').click();
  await page.getByRole('button', { name: 'Minimize Pi', exact: true }).click(); await page.mouse.move(8, 100);
  await page.clock.install();
  const pet = page.getByTestId('desktop-pet'); const seen = new Set<string>();
  let running = '';
  for (let step = 0; step < 350; step++) {
    await page.clock.runFor(100);
    const movement = (await pet.getAttribute('data-motion'))!;
    if (!seen.has(movement) && ['run', 'crouch', 'jump', 'fall', 'climb'].includes(movement)) {
      seen.add(movement);
      const dock = (await page.getByTestId('dock-surface').boundingBox())!;
      await page.screenshot({ path: `/tmp/lumo-pet-motion-${movement}.png`, clip: { x: 0, y: dock.y - 230, width: 1440, height: Math.min(1000 - dock.y + 230, 315) } });
    }
    if (movement === 'run') {
      const transform = await pet.locator('.pet-leg-left').evaluate((node) => getComputedStyle(node).transform);
      if (running && running !== transform) seen.add('stride');
      running = transform;
    }
    if (['run', 'crouch', 'jump', 'fall', 'climb', 'stride'].every((phase) => seen.has(phase))) break;
  }
  expect([...seen]).toEqual(expect.arrayContaining(['run', 'crouch', 'jump', 'fall', 'climb', 'stride']));
  await expect(pet.locator('.pet-facing')).not.toHaveCSS('transform', 'none');
});

test('Mouse flicks render a throw and rebound, while holding still releases a straight drop', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => { Math.random = () => .8; });
  await piPage(page); await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.goto('http://localhost:5200');
  const pet = page.getByTestId('desktop-pet'); const handle = page.getByTestId('pet-handle');
  await handle.click({ button: 'right' }); await page.getByRole('menuitem', { name: 'Pet settings', exact: true }).click();
  await page.getByTestId('settings-pet-gravity').click(); await page.getByRole('button', { name: 'Minimize Pi', exact: true }).click();
  await page.clock.install();
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + 42, box.y + 35); await page.mouse.down(); await page.mouse.move(400, 450);
    await page.clock.runFor(300); await page.mouse.move(400, 450);
    for (let sample = 1; sample <= 6; sample++) { await page.clock.runFor(16); await page.mouse.move(400 + sample * 16, 450 - sample * 12); }
    await page.mouse.up(); await page.mouse.move(8, 100);
    await expect(pet).toHaveAttribute('data-motion', 'throw');
    const release = (await pet.boundingBox())!; await page.clock.runFor(64);
    const flying = (await pet.boundingBox())!; expect(flying.x).toBeGreaterThan(release.x + 10); expect(flying.y).toBeLessThan(release.y - 10);
    await expect(pet.locator('.pet-flight-trails')).not.toHaveCSS('opacity', '0');
    await handle.screenshot({ path: `/tmp/lumo-pet-throw-${colorScheme}.png` });
    let rebound = false;
    for (let step = 0; step < 250; step++) {
      await page.clock.runFor(16);
      if (await pet.getAttribute('data-motion') === 'bounce') {
        rebound = true; const impact = (await pet.boundingBox())!;
        await handle.screenshot({ path: `/tmp/lumo-pet-bounce-${colorScheme}.png` });
        await page.clock.runFor(160); expect((await pet.boundingBox())!.y).toBeLessThan(impact.y - 8); break;
      }
    }
    expect(rebound).toBe(true);
    const pick = (await handle.boundingBox())!;
    await page.mouse.move(pick.x + 42, pick.y + 35); await page.mouse.down(); await page.mouse.move(260, 400);
    await page.clock.runFor(300); await page.mouse.move(260, 400); await page.mouse.up(); await page.mouse.move(8, 100);
    await expect(pet).toHaveAttribute('data-motion', 'fall');
    const drop = (await pet.boundingBox())!; await page.clock.runFor(200); const falling = (await pet.boundingBox())!;
    expect(falling.x).toBeCloseTo(drop.x, 1); expect(falling.y).toBeGreaterThan(drop.y + 10);
  }
  await page.setViewportSize({ width: 390, height: 700 }); await page.clock.runFor(5000);
  const narrow = (await pet.boundingBox())!; expect(narrow.x).toBeGreaterThanOrEqual(8); expect(narrow.x + PET_SIZE).toBeLessThanOrEqual(390);
  expect(narrow.y).toBeGreaterThanOrEqual(40); expect(narrow.y + PET_SIZE).toBeLessThanOrEqual(700);
  expect(errors).toEqual([]);
});

test.describe('Magic routines', () => {
  test.use({ deviceScaleFactor: 2 });
  test('A planted magic pole grows, carries the climb, then disappears after landing on the dock', async ({ page }) => {
    await page.addInitScript(() => { Math.random = () => .8; });
    await piPage(page); await page.setViewportSize({ width: 1440, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.goto('http://localhost:5200');
    const pet = page.getByTestId('desktop-pet'); const handle = page.getByTestId('pet-handle');
    await handle.click({ button: 'right' }); await page.getByRole('menuitem', { name: 'Pet settings', exact: true }).click();
    await page.getByTestId('settings-pet-gravity').click();
    await page.getByRole('button', { name: 'Minimize Pi', exact: true }).click();
    await page.clock.install();
    const dock = (await page.getByTestId('dock-surface').boundingBox())!;
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + 42, box.y + 35); await page.mouse.down();
    await page.mouse.move(dock.x + dock.width / 2, 970, { steps: 12 }); await page.clock.runFor(300);
    await page.mouse.move(dock.x + dock.width / 2, 970); await page.mouse.up(); await page.mouse.move(8, 100);
    await page.clock.runFor(600); await expect(pet).toHaveAttribute('data-activity', 'pole');
    const seen = new Set<string>(); let planted: { x: number; y: number; height: number } | null = null;
    for (let step = 0; step < 45; step++) {
      await page.clock.runFor(100);
      const movement = (await pet.getAttribute('data-motion'))!;
      if (['climb', 'vault'].includes(movement)) {
        const pole = (await pet.locator('.pet-magic-pole').boundingBox())!;
        if (planted) { expect(pole.x).toBeCloseTo(planted.x, 1); expect(pole.y).toBeCloseTo(planted.y, 1); expect(pole.height).toBeCloseTo(planted.height, 1); }
        else planted = pole;
      }
      if (['conjure', 'climb', 'vault', 'land'].includes(movement) && !seen.has(movement)) {
        seen.add(movement);
        await page.screenshot({ path: `/tmp/lumo-magic-pole-${movement}.png`, clip: { x: dock.x + dock.width / 2 - 130, y: dock.y - 170, width: 260, height: Math.min(1000 - dock.y + 170, 255) } });
      }
      if (movement === 'rest') break;
    }
    expect([...seen]).toEqual(['conjure', 'climb', 'vault', 'land']);
    await expect(pet).toHaveAttribute('data-surface', 'dock'); await expect(pet).toHaveAttribute('data-activity', 'none');
    await expect(pet.locator('.pet-magic-pole')).toHaveCSS('display', 'none');
  });
  test('The pet menu starts each trick, props move and disappear, and reduced motion keeps a still pose', async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
    await piPage(page); await page.setViewportSize({ width: 1440, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.clock.install(); await page.goto('http://localhost:5200');
    const pet = page.getByTestId('desktop-pet'); const handle = page.getByTestId('pet-handle');
    await expect(pet.locator('.pet-fur')).toHaveAttribute('data-ready', 'true');
    const before = await pet.boundingBox();
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      for (const [label, activity, prop] of [['Take notes', 'notes', '.pet-notebook'], ['Play soccer', 'soccer', '.pet-soccer-prop'], ['Juggle stars', 'juggle', '.pet-juggle-prop']]) {
        await handle.click({ button: 'right' }); await page.getByRole('menuitem', { name: label, exact: true }).click();
        await expect(pet).toHaveAttribute('data-activity', activity); await expect(pet).toHaveAttribute('data-motion', 'conjure');
        await page.clock.runFor(850); await expect(pet).toHaveAttribute('data-motion', 'perform');
        await expect(pet.locator(prop)).toHaveCSS('opacity', '1');
        const first = await pet.locator('.pet-soccer-ball').evaluate((node) => getComputedStyle(node).transform);
        await page.clock.runFor(400);
        if (activity === 'soccer') expect(await pet.locator('.pet-soccer-ball').evaluate((node) => getComputedStyle(node).transform)).not.toBe(first);
        if (activity === 'juggle') expect(await pet.locator('.pet-juggle-star').evaluateAll((nodes) => nodes.every((node) => node.getAnimations().length > 0))).toBe(true);
        const box = (await pet.boundingBox())!;
        await page.screenshot({ path: `/tmp/lumo-magic-${activity}-${colorScheme}.png`, clip: { x: box.x - 12, y: box.y - 24, width: 112, height: 116 } });
        await page.clock.runFor(10000); await expect(pet).toHaveAttribute('data-activity', 'none'); await expect(pet.locator(prop)).toHaveCSS('opacity', '0');
        expect(await pet.boundingBox()).toEqual(before);
      }
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await handle.click({ button: 'right' }); await page.getByRole('menuitem', { name: 'Juggle stars', exact: true }).click();
    await expect(pet).toHaveAttribute('data-motion', 'perform');
    expect(await pet.locator('.pet-juggle-star').evaluateAll((nodes) => nodes.every((node) => node.getAnimations().length === 0))).toBe(true);
    await page.clock.runFor(10000); await expect(pet).toHaveAttribute('data-activity', 'none');
    expect(errors).toEqual([]);
  });
});
