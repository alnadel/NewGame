// World generation: clearance, spacing, day objects, the tutorial chunk (V1_PLAN §6.1), and the
// world being a pure function of (seed, profile, tutorial) whatever the generation timing.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { dayParams } from '../../src/config/days.ts';
import { dayStartY, yAtTime } from '../../src/core/clock.ts';
import { angleDiff } from '../../src/core/dmath.ts';
import { casterClearance } from '../../src/core/gen/placer.ts';
import { createWorld, ensureGenerated, generateSome, type World } from '../../src/core/gen/world.ts';
import { convexDistance } from '../../src/core/geom.ts';
import { trailX } from '../../src/core/trail.ts';
import { budDigest, chunkDigests } from '../../scripts/golden.ts';

const golden = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../golden/hashes.json'), 'utf8'),
) as { chunks: Record<string, string[]>; chunksPlanOff: Record<string, string[]>; buds: Record<string, string> };

function fingerprint(w: World): string {
  const cs = w.casters.map((c) => `${c.id}:${c.kind}:${c.x}:${c.y}:${c.rot}:${c.name}:${c.rescue}`).join('|');
  const cl = w.clouds.map((c) => `${c.id}:${c.kind}:${c.t0}:${c.x0}:${c.y0}:${c.vx}:${c.vy}:${c.rx}`).join('|');
  const ps = w.pickups.map((p) => `${p.id}:${p.kind}:${p.x}:${p.y}`).join('|');
  const bs = w.balls.map((b) => `${b.id}:${b.x}:${b.y}:${b.name}`).join('|');
  return `${cs}#${cl}#${ps}#${bs}`;
}

describe('world generation', () => {
  it('keeps every ground footprint ≥ 20 u from the trail (gate arches excepted), seeds 1-25', () => {
    let gates = 0;
    for (let seed = 1; seed <= 25; seed++) {
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
  }, 20_000);

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

  it('plan-off worlds give Day 2 a gate arch between 11:00 AM and 1:00 PM, and Old Town days gazing balls', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const w = createWorld({ seed, profile: 3, tutorial: false, plan: false });
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
  }, 20_000);

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

  it('matches the golden chunk digests (seeds 1-3, chunks 0-9), with the Day Plan on and off', () => {
    for (const seed of [1, 2, 3]) {
      expect(chunkDigests(seed)).toEqual(golden.chunks[String(seed)]);
      expect(chunkDigests(seed, false)).toEqual(golden.chunksPlanOff[String(seed)]);
      expect(budDigest(seed)).toBe(golden.buds[String(seed)]);
    }
  });
});
