// Death line (V1_PLAN §10): one crafted scenario per cause, plus cases where a cause must not fire.
import { describe, expect, it } from 'vitest';
import { dayParams } from '../../src/config/days.ts';
import { elevation, yAtDayTick } from '../../src/core/clock.ts';
import { cosD, sinD, tanD } from '../../src/core/dmath.ts';
import { makeCaster, makePrism } from '../../src/core/gen/catalog.ts';
import { addCloud } from '../../src/core/gen/placer.ts';
import { insertBall, insertCaster } from '../../src/core/gen/store.ts';
import { rectPoly } from '../../src/core/geom.ts';
import { cloudOffset, glareOffset } from '../../src/core/shadows.ts';
import { createRun } from '../../src/core/sim/create.ts';
import { headlessConfig } from '../../src/core/sim/headless.ts';
import { step } from '../../src/core/sim/step.ts';
import { NO_INPUT, type RunConfig, type SimState } from '../../src/core/sim/types.ts';
import { trailX } from '../../src/core/trail.ts';

const TAP = { dTheta: 0, down: false, downEdge: true, upEdge: true, release: 0, key: 0 as const };

function lab(cfg: Partial<RunConfig> = {}): SimState {
  const s = createRun({ ...headlessConfig(2), ...cfg });
  const w = s.world;
  w.casters.length = 0;
  w.byId.clear();
  w.clouds.length = 0;
  w.balls.length = 0;
  w.pickups.length = 0;
  w.validatedThrough = 1e6;
  return s;
}

let nextId = 2_000_000;
function block(s: SimState, name: string, x: number, y: number, w: number, d: number, h: number): void {
  insertCaster(
    s.world,
    makeCaster({
      id: nextId++, kind: 'stone', name, biome: 'meadow', x, y, rot: 0,
      parts: [makePrism(rectPoly(x, y, w, d, 1, 0), h)], side: 1, rescue: false, gate: false, ballId: -1, chunk: 0,
    }),
  );
}

function runToDeath(s: SimState, max = 3000): void {
  for (let i = 0; i < max && s.phase !== 'dead'; i++) step(s, s.phase === 'hold' ? TAP : NO_INPUT);
  expect(s.phase).toBe('dead');
}

describe('death cause', () => {
  it('plain: nothing nearby', () => {
    const s = lab();
    runToDeath(s);
    expect(s.death!.cause).toBe('plain');
    expect(s.death!.line).toBe(`Melted by You at ${s.death!.time}.`);
    expect(s.death!.lastId).toBeUndefined();
    expect(s.death!.nextId).toBeUndefined();
  });

  it('glare: glare made up most of the lit weight', () => {
    const s = lab({ startT: 2 });
    // A line of balls whose glare spots sit on Nubs' path for the next few seconds.
    const p = dayParams(1, 3);
    for (let t = 121; t < 121 + 240; t += 8) {
      const cot = 1 / tanD(elevation(p, t / 60));
      const g = glareOffset(cot);
      const y = yAtDayTick(1, t);
      const x = trailX(s.world.trail, y);
      insertBall(s.world, { id: 90_000 + t, x: x - cosD(s.theta0) * g, y: y - sinD(s.theta0) * g, name: `the Glary Ball ${t}`, casterId: -1, day: 1 });
    }
    runToDeath(s);
    const d = s.death!;
    expect(d.cause).toBe('glare');
    expect(d.ballId).toBeGreaterThanOrEqual(90_000);
    expect(d.line).toBe(`Glared by the Glary Ball ${d.ballId! - 90_000} at ${d.time}.`);
  });

  it('cloud: a cloud could have shaded Nubs one second before death', () => {
    const s = lab();
    // A cloud riding along at v whose shadow covers Nubs if the sun turns 90° (sun north of θ0).
    const v = dayParams(1, 3).v;
    const tAt = 50 / 60; // aim at tick 50, about a second before the ~110-tick death
    const y = yAtDayTick(1, 50);
    const x = trailX(s.world.trail, y);
    const R = cloudOffset(300, 1 / tanD(elevation(dayParams(1, 3), tAt)));
    const a = s.theta0 + 90;
    addCloud(s.world, 'parked', 0, 10, x + cosD(a) * R, y + sinD(a) * R - v * tAt, 0, v, 80);
    runToDeath(s);
    expect(s.death!.cause).toBe('cloud');
    expect(s.death!.line).toBe(`Melted by You at ${s.death!.time}. That cloud was right there.`);
  });

  it('gap: between the last caster that shaded Nubs and the next one that could', () => {
    const s = lab();
    block(s, 'the Test Rock', trailX(s.world.trail, 10), 10, 60, 60, 60); // Nubs starts inside it
    block(s, 'the Test Stone', trailX(s.world.trail, 300) + 40, 300, 26, 26, 130);
    runToDeath(s);
    const d = s.death!;
    expect(d.cause).toBe('gap');
    expect(d.lastName).toBe('the Test Rock');
    expect(d.nextName).toBe('the Test Stone');
    expect(d.line).toBe(`Melted by You at ${d.time}, between the Test Rock and the Test Stone.`);
    expect(typeof d.lastId).toBe('number');
    expect(typeof d.nextId).toBe('number');
  });

  it('gap with only one side known', () => {
    const past = lab();
    block(past, 'the Test Rock', trailX(past.world.trail, 10), 10, 60, 60, 60);
    runToDeath(past);
    expect(past.death!.line).toBe(`Melted by You at ${past.death!.time}, just past the Test Rock.`);

    const before = lab();
    block(before, 'the Test Stone', trailX(before.world.trail, 300) + 40, 300, 26, 26, 130);
    runToDeath(before);
    expect(before.death!.line).toBe(`Melted by You at ${before.death!.time}, right before the Test Stone.`);
  });

  it('must not fire: a stale shader (> 5 s) and a cloud that had already gone', () => {
    const s = lab();
    block(s, 'the Test Rock', trailX(s.world.trail, 10), 10, 60, 60, 60);
    // A cloud follows Nubs and shades him at the actual sun angle from 0.5 s to 5.5 s (R is capped
    // at 900 u that early), then dissolves; he melts about 1.8 s later.
    const v = dayParams(1, 3).v;
    const R = cloudOffset(300, 1 / tanD(6.5));
    const tr = s.world.trail;
    const vx = (trailX(tr, 5.5 * v) - trailX(tr, 0.5 * v)) / 5;
    addCloud(s.world, 'parked', 0.5, 5, trailX(tr, 0.5 * v) + cosD(s.theta0) * R, 0.5 * v + sinD(s.theta0) * R, vx, v, 80);
    runToDeath(s);
    expect(s.stats.cloudRideBest).toBeGreaterThan(4);
    expect(s.tick).toBeGreaterThan(7 * 60);
    expect(s.death!.cause).toBe('plain');
  });
});
