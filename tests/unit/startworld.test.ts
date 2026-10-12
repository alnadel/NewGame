// The start of a world (split from generator.test.ts so the suite balances across workers): the
// Day-1 difficulty wave, the start hut's clear side and the profile-0 tutorial chunk.
import { describe, expect, it } from 'vitest';
import { START_HUT, TUTORIAL } from '../../src/config/casters.ts';
import { dayParams } from '../../src/config/days.ts';
import { dayStartY, yAtTime } from '../../src/core/clock.ts';
import { angleDiff, sinD } from '../../src/core/dmath.ts';
import { worldPlan } from '../../src/core/gen/plan.ts';
import { createWorld, ensureGenerated } from '../../src/core/gen/world.ts';
import { createRun } from '../../src/core/sim/create.ts';
import { headlessConfig } from '../../src/core/sim/headless.ts';
import { trailX } from '../../src/core/trail.ts';
import { step } from '../../src/core/sim/step.ts';
import { NO_INPUT, type InputFrame, type SimState } from '../../src/core/sim/types.ts';

describe('Day-1 difficulty wave (caster spacing)', () => {
  it('Day 1 is 0.75 / 0.65 with a day mean of ~0.994; later days are flat', () => {
    const d1 = dayParams(1, 3);
    expect([d1.waveA, d1.waveB]).toEqual([0.75, 0.65]);
    for (const profile of [0, 1, 2] as const) expect([dayParams(1, profile).waveA, dayParams(1, profile).waveB]).toEqual([0.75, 0.65]);
    // Mean of sin⁴ over a half period is 3/8.
    let sum = 0;
    const n = 10_000;
    for (let i = 0; i < n; i++) {
      const sn = sinD((180 * (i + 0.5)) / n);
      sum += d1.waveA + d1.waveB * sn * sn * sn * sn;
    }
    expect(sum / n).toBeCloseTo(0.75 + (0.65 * 3) / 8, 6);
    expect(Math.abs(sum / n - 1)).toBeLessThan(0.01);
    for (const day of [2, 3, 4, 5, 6, 7, 9, 15]) {
      expect(dayParams(day, 3).waveA).toBe(1);
      expect(dayParams(day, 3).waveB).toBe(0);
    }
  });

  it('Day-1 casters are dense at dawn and dusk and sparse at noon (30 seeds)', () => {
    const p = dayParams(1, 3);
    const band = (t0: number, t1: number) => ({ y0: yAtTime(1, t0 * p.dayLen), y1: yAtTime(1, t1 * p.dayLen), n: 0 });
    const dawn = band(0.05, 0.25);
    const noon = band(0.4, 0.6);
    const dusk = band(0.75, 0.95);
    for (let seed = 1; seed <= 30; seed++) {
      const w = createWorld({ seed, profile: 3, tutorial: false });
      ensureGenerated(w, dayStartY(2));
      for (const c of w.casters) {
        if (c.rescue || c.id === w.startHutId) continue;
        for (const b of [dawn, noon, dusk]) if (c.y >= b.y0 && c.y < b.y1) b.n++;
      }
    }
    // Mean gap per band (all bands are 0.2·Dl long): noon ≈ 1.6× dawn and dusk.
    const gap = (b: { y0: number; y1: number; n: number }) => (30 * (b.y1 - b.y0)) / b.n;
    expect(gap(noon) / gap(dawn)).toBeGreaterThan(1.35);
    expect(gap(noon) / gap(dusk)).toBeGreaterThan(1.35);
    expect(gap(dawn)).toBeLessThan(p.spacing);
    expect(gap(noon)).toBeGreaterThan(p.spacing * 1.15);
  });

  it('the authored tutorial chunk keeps its exact layout (the wave never touches it)', () => {
    for (const seed of [1, 7, 12]) {
      const w = createWorld({ seed, profile: 0, tutorial: true });
      ensureGenerated(w, 2000);
      const chunk0 = w.casters.filter((c) => c.chunk === 0 && c.id !== w.startHutId && !c.rescue);
      expect(chunk0.map((c) => [c.kind, c.y])).toEqual(TUTORIAL.casters.map((a) => [a.kind, a.y]));
    }
  });
});

describe('start of a generated world', () => {
  it("keeps the start hut's side of the trail clear just past the hut, so holding θ0 stops working", () => {
    for (let seed = 1; seed <= 30; seed++) {
      for (const profile of [1, 3] as const) {
        const w = createWorld({ seed, profile, tutorial: false });
        ensureGenerated(w, 1200);
        const hut = w.byId.get(w.startHutId)!;
        expect(Math.sign(hut.x - trailX(w.trail, hut.y))).toBe(w.startSide);
        const clearAhead = START_HUT.clearAhead[worldPlan(w, 1).biome];
        for (const c of w.casters) {
          if (c.id === hut.id || c.y <= 0 || c.y >= clearAhead) continue;
          expect(Math.sign(c.x - trailX(w.trail, c.y))).toBe(-w.startSide);
        }
      }
    }
  });
});

describe('profile-0 tutorial chunk (V1_PLAN §6.1)', () => {
  const TAP: InputFrame = { dTheta: 0, down: false, downEdge: true, upEdge: true, release: 0, key: 0 };
  /** Starts a run holding θ0: the tap, then the start beat (the clock is still at 6:00 AM after it). */
  const begin = (s: SimState): SimState => {
    step(s, TAP);
    while (s.ready > 0) step(s, NO_INPUT);
    return s;
  };

  it('runs on a straight trail with the start hut 20 u to the right (θ0 ≈ east)', () => {
    const s = createRun(headlessConfig(5, 0));
    const hut = s.world.byId.get(s.world.startHutId)!;
    expect(hut.x).toBe(180 + 20 + 18);
    expect(Math.abs(angleDiff(s.theta0, 0))).toBeLessThan(20);
    expect(s.world.stats.rescuesPerChunk[0]).toBe(0);
  });

  it('1. holding θ0 keeps Nubs fully shaded for ≥ 80% of the first 2.5 s', () => {
    for (const seed of [1, 2, 3]) {
      const s = begin(createRun(headlessConfig(seed, 0)));
      let shaded = 0;
      for (let i = 0; i < 150; i++) {
        step(s, NO_INPUT);
        if (s.nubs.f === 0) shaded++;
      }
      expect(shaded / 150).toBeGreaterThanOrEqual(0.8);
    }
  });

  it('2. around 3 s one deliberate swing is needed (≥ 90° to the west arc) and it works', () => {
    const s = begin(createRun(headlessConfig(3, 0)));
    for (let i = 0; i < 180; i++) step(s, NO_INPUT);
    // At 3.0 s θ0 no longer shades Nubs, nothing within 30° does, and the west arc is ≥ 90° away.
    expect(s.nubs.f).toBeGreaterThan(0);
    let nearest = 360;
    let west = 0;
    for (let b = 0; b < 360; b++) {
      if (s.guide.now[b] !== 1) continue;
      const d = Math.abs(angleDiff(b, s.theta0));
      nearest = Math.min(nearest, d);
      if (d >= 90 && b > 90 && b < 270) west++;
    }
    expect(nearest).toBeGreaterThanOrEqual(30);
    expect(west).toBeGreaterThanOrEqual(40);

    // Holding θ0 through the chunk melts Nubs well before it ends…
    const hold = begin(createRun(headlessConfig(3, 0)));
    for (let i = 0; i < 480 && hold.phase !== 'dead'; i++) step(hold, NO_INPUT);
    expect(hold.nubs.chill).toBeLessThan(25);

    // …while one swing (180°/s, counter-clockwise to 180°) at 2.7 s keeps him cool and lands the
    // tutorial's three flakes in shade (a generated cluster just past the chunk may count too).
    const swing = begin(createRun(headlessConfig(3, 0)));
    let flakes = 0;
    for (let i = 0; i < 420; i++) {
      let f: InputFrame = NO_INPUT;
      if (i >= 162) {
        const d = angleDiff(180, swing.sun.theta + swing.sun.lag);
        f = { dTheta: Math.max(-3, Math.min(3, d)), down: true, downEdge: i === 162, upEdge: false, release: 0, key: 0 };
      }
      step(swing, f);
      flakes += swing.events.filter((e) => e.e === 'flake' && TUTORIAL.flakes.includes(e.y)).length;
    }
    expect(swing.phase).toBe('day');
    expect(swing.nubs.chill).toBeGreaterThan(70);
    expect(flakes).toBe(TUTORIAL.flakes.length);
    expect(TUTORIAL.flakes.length).toBe(3);
  });
});
