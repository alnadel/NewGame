// Fairness validator (V1_PLAN §7.4).
import { describe, expect, it } from 'vitest';
import { dayParams } from '../../src/config/days.ts';
import { dayAtTick, dayStartTick, dayStartY, elevation } from '../../src/core/clock.ts';
import { chillDeltaTable, slidingMaxCircular } from '../../src/core/gen/validator.ts';
import { createWorld, ensureGenerated, generateSome, type World } from '../../src/core/gen/world.ts';
import { binOf } from '../../src/core/intervals.ts';
import { Rng } from '../../src/core/rng.ts';

/**
 * Independent re-check of a validated world: runs the human-model DP (naive sliding max, 3-step
 * lit max, night refills) over every cached step from the start and returns the worst margin
 * max(C) − floor over all daylight steps.
 */
function worstMargin(w: World): number {
  const steps: Uint8Array[] = [];
  for (const c of w.chunkLit) for (let i = 0; i < c.n; i++) steps.push(c.lit.subarray(i * 360, (i + 1) * 360));
  const delta = chillDeltaTable(dayParams(1, w.profile).drain);
  let C = new Float64Array(360).fill(-1e9);
  C[binOf(w.theta0)] = 100;
  let worst = Infinity;
  for (let j = 0; j < steps.length; j++) {
    const tick = j * 6;
    const day = dayAtTick(tick);
    const eps = elevation(dayParams(day, w.profile), (tick - dayStartTick(day)) / 60);
    const next = new Float64Array(360);
    if (eps <= 0) {
      next.fill(100);
    } else {
      for (let b = 0; b < 360; b++) {
        let m = -1e9;
        for (let k = -18; k <= 18; k++) m = Math.max(m, C[(b + k + 360) % 360]!);
        let lh = steps[j]![b]!;
        if (j > 0) lh = Math.max(lh, steps[j - 1]![b]!);
        if (j + 1 < steps.length) lh = Math.max(lh, steps[j + 1]![b]!);
        let v = m + delta[lh]!;
        if (v > 100) v = 100;
        if (v <= 0) v = -1e9;
        next[b] = v;
      }
      let mx = -1e9;
      for (let b = 0; b < 360; b++) mx = Math.max(mx, next[b]!);
      worst = Math.min(worst, mx - dayParams(day, w.profile).floor);
    }
    C = next;
  }
  return worst;
}

describe('validator', () => {
  it('sliding circular max equals the naive max', () => {
    const r = new Rng(3);
    const src = new Float64Array(360);
    const out = new Float64Array(360);
    for (const radius of [0, 1, 7, 18, 24, 36]) {
      for (let t = 0; t < 20; t++) {
        for (let b = 0; b < 360; b++) src[b] = r.range(-50, 100);
        slidingMaxCircular(src, radius, out);
        for (let b = 0; b < 360; b++) {
          let m = -Infinity;
          for (let k = -radius; k <= radius; k++) m = Math.max(m, src[(b + k + 360) % 360]!);
          expect(out[b]).toBe(m);
        }
      }
    }
  });

  it('chill deltas per 0.1 s step follow −drain·f + 30·max(0, 1 − f)', () => {
    const d = chillDeltaTable(55);
    expect(d[0]).toBeCloseTo(3, 12);
    expect(d[5]).toBeCloseTo(-5.5, 12);
    expect(d[10]).toBeCloseTo(-11, 12);
    expect(d[2]).toBeCloseTo((-55 * 0.4 + 30 * 0.6) * 0.1, 12);
    expect(chillDeltaTable(30)[5]).toBeCloseTo(-3, 12);
  });

  it('an emptied chunk fails, gets Shade Rocks, and then passes', () => {
    const w = createWorld(8, 3, false);
    // Place chunks −1, 0 and 1 (8 work units each) without validating anything yet…
    expect(generateSome(w, 480, 24)).toBe(false);
    expect(w.placedThrough).toBe(1);
    expect(w.validatedThrough).toBe(-1);
    // …then strip every caster except the start hut and validate chunk 0.
    for (let i = w.casters.length - 1; i >= 0; i--) {
      const c = w.casters[i]!;
      if (c.id !== w.startHutId) {
        w.casters.splice(i, 1);
        w.byId.delete(c.id);
      }
    }
    ensureGenerated(w, 480);
    expect(w.stats.rescuesPerChunk[0]).toBeGreaterThan(0);
    expect(w.casters.some((c) => c.rescue && c.kind === 'rock' && c.chunk === 0)).toBe(true);
    expect(w.stats.unresolved).toBe(0);
    expect(worstMargin(w)).toBeGreaterThanOrEqual(0);
  });

  it('validated worlds stay above the floor for a human-model player (seeds 1-3, Days 1-5)', () => {
    for (const seed of [1, 2, 3]) {
      const w = createWorld(seed, 3, false);
      ensureGenerated(w, dayStartY(6));
      expect(w.stats.unresolved).toBe(0);
      expect(Math.max(...w.stats.rescuesPerChunk.filter((x) => x !== undefined))).toBeLessThanOrEqual(8);
      expect(worstMargin(w)).toBeGreaterThanOrEqual(0);
    }
  });

  it('the Day-1 wave (sparser casters at noon) still validates: seeds 1-12 stay fair through Day 1', () => {
    let rescues = 0;
    let chunks = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const w = createWorld(seed, 3, false);
      ensureGenerated(w, dayStartY(2));
      expect(w.stats.unresolved, `seed ${seed}`).toBe(0);
      expect(worstMargin(w), `seed ${seed}`).toBeGreaterThanOrEqual(0);
      for (const r of w.stats.rescuesPerChunk) {
        if (r === undefined) continue;
        rescues += r;
        chunks++;
      }
    }
    expect(rescues / chunks).toBeLessThanOrEqual(1.0);
  }, 60_000);

  it('profile 0 holds Day 1 to the higher floor (70)', () => {
    const w = createWorld(4, 0, true);
    ensureGenerated(w, dayStartY(2));
    expect(dayParams(1, 0).floor).toBe(70);
    expect(worstMargin(w)).toBeGreaterThanOrEqual(0);
  });
});
