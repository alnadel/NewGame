// World generation: clearance, spacing, day objects, the tutorial chunk (V1_PLAN §6.1), and the
// world being a pure function of (seed, profile, tutorial) whatever the generation timing.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { START_HUT, TUTORIAL } from '../../src/config/casters.ts';
import { dayParams } from '../../src/config/days.ts';
import { dayStartY, yAtTime } from '../../src/core/clock.ts';
import { angleDiff, sinD } from '../../src/core/dmath.ts';
import { casterClearance } from '../../src/core/gen/placer.ts';
import { createWorld, ensureGenerated, generateSome, type World } from '../../src/core/gen/world.ts';
import { convexDistance } from '../../src/core/geom.ts';
import { createRun } from '../../src/core/sim/create.ts';
import { headlessConfig } from '../../src/core/sim/headless.ts';
import { trailX } from '../../src/core/trail.ts';
import { step } from '../../src/core/sim/step.ts';
import { NO_INPUT, type InputFrame, type SimState } from '../../src/core/sim/types.ts';
import { chunkDigests } from '../../scripts/golden.ts';

const golden = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../golden/hashes.json'), 'utf8'),
) as { chunks: Record<string, string[]> };

function fingerprint(w: World): string {
  const cs = w.casters.map((c) => `${c.id}:${c.kind}:${c.x}:${c.y}:${c.rot}:${c.name}:${c.rescue}`).join('|');
  const cl = w.clouds.map((c) => `${c.id}:${c.kind}:${c.t0}:${c.x0}:${c.y0}:${c.vx}:${c.vy}:${c.rx}`).join('|');
  const ps = w.pickups.map((p) => `${p.id}:${p.kind}:${p.x}:${p.y}`).join('|');
  const bs = w.balls.map((b) => `${b.id}:${b.x}:${b.y}:${b.name}`).join('|');
  return `${cs}#${cl}#${ps}#${bs}`;
}

describe('world generation', () => {
  it('keeps every ground footprint ≥ 20 u from the trail (gate arches excepted), seeds 1-100', () => {
    let gates = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const w = createWorld({ seed, profile: 3, tutorial: false });
      ensureGenerated(w, dayStartY(2) + 1200); // Day 1 and the start of Old Town
      for (const c of w.casters) {
        if (c.gate) {
          gates++;
          continue;
        }
        expect(casterClearance(w, c), `seed ${seed} ${c.name}`).toBeGreaterThanOrEqual(20 - 1e-9);
      }
    }
    expect(gates).toBeGreaterThan(0);
  }, 60_000);

  it('keeps casters apart (overlap margin) and names unique nearby', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const w = createWorld({ seed, profile: 3, tutorial: false });
      ensureGenerated(w, dayStartY(3));
      const cs = w.casters;
      for (let i = 0; i < cs.length; i++) {
        for (let j = i + 1; j < cs.length && cs[j]!.y - cs[i]!.y < 200; j++) {
          const a = cs[i]!;
          const b = cs[j]!;
          expect(convexDistance(a.hull, a.hullN, b.hull, b.hullN), `${a.name} / ${b.name}`).toBeGreaterThanOrEqual(6 - 1e-9);
          if (b.y - a.y < 800) expect(a.name === b.name, `${a.name} twice`).toBe(false);
        }
      }
    }
  });

  it('places the start hut first, 20 u from the trail, with θ0 pointing at it', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const w = createWorld({ seed, profile: 3, tutorial: false });
      const hut = w.byId.get(w.startHutId)!;
      expect(hut.kind).toBe('hut');
      expect(hut.y).toBe(10);
      expect(Math.abs(casterClearance(w, hut) - 20)).toBeLessThan(4.01);
      const dir = hut.x > trailX(w.trail, 10) ? 1 : -1;
      expect(Math.abs(angleDiff(w.theta0, dir > 0 ? 0 : 180))).toBeLessThan(30);
    }
  });

  it('gives Day 2 a gate arch between 11:00 AM and 1:00 PM, and Old Town days gazing balls', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const w = createWorld({ seed, profile: 3, tutorial: false });
      ensureGenerated(w, dayStartY(3));
      const p = dayParams(2, 3);
      const y11 = yAtTime(2, (300 / 720) * p.dayLen);
      const y13 = yAtTime(2, (420 / 720) * p.dayLen);
      expect(w.casters.some((c) => c.gate && c.y >= y11 && c.y <= y13)).toBe(true);
      const balls = w.balls.filter((b) => b.day === 2);
      expect(balls.length).toBe(4); // every 14 s from t = 6
      for (const b of balls) expect(w.byId.get(b.casterId)?.kind).toBe('pedestal');
      expect(w.balls.some((b) => b.day === 1)).toBe(false);
    }
  });

  it('places flakes on the centerline in clusters, a crystal per day and frost flowers at night', () => {
    const w = createWorld({ seed: 4, profile: 3, tutorial: false });
    ensureGenerated(w, dayStartY(2) + 500);
    const day1 = w.pickups.filter((p) => p.day === 1);
    const flakes = day1.filter((p) => p.kind === 'flake');
    expect(flakes.length).toBeGreaterThanOrEqual(15);
    expect(day1.filter((p) => p.kind === 'crystal').length).toBe(1);
    const flowers = day1.filter((p) => p.kind === 'flower');
    // Night 1 covers 8·70 = 560 u; flowers sit every 60 u starting 30 u in.
    expect(flowers.length).toBe(9);
    for (let i = 1; i < w.pickups.length; i++) expect(w.pickups[i]!.y).toBeGreaterThanOrEqual(w.pickups[i - 1]!.y);
  });

  it('is identical whatever the generation budget or timing', () => {
    for (const [seed, profile] of [
      [11, 3],
      [12, 0],
    ] as const) {
      const a = createWorld({ seed, profile, tutorial: profile === 0 });
      ensureGenerated(a, 9000);
      const b = createWorld({ seed, profile, tutorial: profile === 0 });
      let budget = 1;
      while (!generateSome(b, 9000, budget)) budget = (budget % 7) + 1;
      expect(fingerprint(b)).toBe(fingerprint(a));
      // Generating further ahead first never changes what was already there.
      const c = createWorld({ seed, profile, tutorial: profile === 0 });
      ensureGenerated(c, 15000);
      const prefix = (w: World) => fingerprint({ ...w, casters: w.casters.filter((x) => x.y < 8000), clouds: [], pickups: w.pickups.filter((x) => x.y < 8000), balls: [] });
      expect(prefix(c)).toBe(prefix(a));
    }
  });

  it('matches the golden chunk digests (seeds 1-3, chunks 0-9)', () => {
    for (const seed of [1, 2, 3]) expect(chunkDigests(seed)).toEqual(golden.chunks[String(seed)]);
  });
});

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
        for (const c of w.casters) {
          if (c.id === hut.id || c.y <= 0 || c.y >= START_HUT.clearAhead) continue;
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
