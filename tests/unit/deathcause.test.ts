// Death line (V1_PLAN §10): one crafted scenario per cause, plus cases where a cause must not fire.
import { describe, expect, it } from 'vitest';
import { dayParams } from '../../src/config/days.ts';
import { elevation, TICK_HZ, yAtDayTick } from '../../src/core/clock.ts';
import { TUNING } from '../../src/config/tuning.ts';
import { angleDiff, cosD, sinD, tanD } from '../../src/core/dmath.ts';
import { makeCaster, makePrism } from '../../src/core/gen/catalog.ts';
import { addCloud } from '../../src/core/gen/placer.ts';
import { insertBall, insertCaster } from '../../src/core/gen/store.ts';
import { BINS, markEllipse, SAMPLE_DX, SAMPLE_DY, SAMPLES } from '../../src/core/intervals.ts';
import { createBot } from '../../src/core/sim/bots.ts';
import { rectPoly } from '../../src/core/geom.ts';
import type { Cloud } from '../../src/core/objects.ts';
import { cloudAlive, cloudCenter, cloudOffset, glareOffset } from '../../src/core/shadows.ts';
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

  /** A cloud riding along at v whose shadow covers Nubs at tick 50 with the sun at θ0 + turn. */
  function ridingCloud(s: SimState, turn: number): void {
    const v = dayParams(1, 3).v;
    const tAt = 50 / 60; // aim at tick 50, about a second before the ~110-tick death
    const y = yAtDayTick(1, 50);
    const x = trailX(s.world.trail, y);
    const R = cloudOffset(300, 1 / tanD(elevation(dayParams(1, 3), tAt)));
    const a = s.theta0 + turn;
    addCloud(s.world, 'parked', 0, 10, x + cosD(a) * R, y + sinD(a) * R - v * tAt, 0, v, 80);
  }

  it('cloud: a cloud could have shaded Nubs within ±60° one second before death', () => {
    expect(TUNING.death.cloudTurnRate * TUNING.death.cloudTurnSec).toBe(60);
    for (const turn of [45, -45]) {
      const s = lab();
      ridingCloud(s, turn);
      runToDeath(s);
      expect(s.death!.cause).toBe('cloud');
      expect(s.death!.line).toBe(`Melted by You at ${s.death!.time}. That cloud was right there.`);
    }
  });

  it('must not fire: a cloud that needed a 90° turn (beyond ±60°) is not blamed', () => {
    for (const turn of [90, -90, 180]) {
      const s = lab();
      ridingCloud(s, turn);
      runToDeath(s);
      expect(s.death!.cause).toBe('plain');
    }
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

/**
 * Bins where cloud `cl` fully covers all 5 coverage samples of Nubs at (x, y) with the sun at
 * elevation eps and the clouds at tAbs: the same geometry the sim's coverage and the death line use.
 */
function cloudFullCover(cl: Cloud, x: number, y: number, eps: number, tAbs: number): Uint8Array {
  const R = cloudOffset(TUNING.shadow.cloudZ, 1 / tanD(eps));
  const c = new Float64Array(2);
  cloudCenter(cl, tAbs, c);
  const count = new Uint8Array(BINS);
  const mask = new Uint8Array(BINS);
  for (let k = 0; k < SAMPLES; k++) {
    mask.fill(0);
    markEllipse(mask, x + SAMPLE_DX[k]!, y + SAMPLE_DY[k]!, R, c[0]!, c[1]!, cl.rx, cl.ry);
    for (let b = 0; b < BINS; b++) count[b]! += mask[b]!;
  }
  const out = new Uint8Array(BINS);
  for (let b = 0; b < BINS; b++) out[b] = count[b] === SAMPLES ? 1 : 0;
  return out;
}

describe('death cause over real runs', () => {
  it('novice p3, seeds 1-20: a cloud is blamed exactly when one fully covered Nubs within 60° of θ 60 ticks before death', () => {
    const back = TUNING.death.cloudLookbackTicks;
    const causes: Record<string, number> = {};
    let cloudDeaths = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const s = createRun(headlessConfig(seed, 3));
      const bot = createBot('novice');
      // θ after every tick of the clock (start-beat ticks don't advance it, like the sim's ring).
      const theta: number[] = [];
      for (let i = 0; i < 60 * 60 * 8 && s.phase !== 'dead'; i++) {
        step(s, bot.next(s));
        if (s.ready === 0 && s.phase !== 'hold') theta.push(s.sun.theta);
      }
      expect(s.phase, `seed ${seed}`).toBe('dead');
      const d = s.death!;
      causes[d.cause] = (causes[d.cause] ?? 0) + 1;
      if (d.cause === 'glare' || s.dayTick < back) continue;
      const th = theta[theta.length - 1 - back]!;
      const dt = s.dayTick - back;
      const y = yAtDayTick(s.day, dt);
      const eps = elevation(s.params, dt / TICK_HZ);
      const tAbs = s.tAbs - back / TICK_HZ;
      let near = false;
      for (const cl of s.world.clouds) {
        if (!cloudAlive(cl, tAbs)) continue;
        const full = cloudFullCover(cl, trailX(s.world.trail, y), y, eps, tAbs);
        for (let b = 0; b < BINS && !near; b++) if (full[b] && Math.abs(angleDiff(b, th)) <= 60) near = true;
      }
      if (d.cause === 'cloud') {
        cloudDeaths++;
        expect(near, `seed ${seed}: blamed a cloud that was not within 60°`).toBe(true);
      } else {
        expect(near, `seed ${seed}: ${d.cause} death although a cloud was within 60°`).toBe(false);
      }
    }
    // The run set must actually exercise the cloud line (and the other causes).
    expect(cloudDeaths, JSON.stringify(causes)).toBeGreaterThan(0);
    expect(cloudDeaths, JSON.stringify(causes)).toBeLessThan(20);
  }, 60_000);
});
