import { describe, expect, it } from 'vitest';
import type { CasterKind } from '../../src/config/casters.ts';
import { SUN_COS, SUN_SIN, tanD } from '../../src/core/dmath.ts';
import { buildParts, makeCaster } from '../../src/core/gen/catalog.ts';
import {
  BINS,
  binOf,
  createMaskScene,
  glareMask,
  litMask,
  markRange,
  SAMPLE_DX,
  SAMPLE_DY,
  sceneAddBall,
  sceneAddCaster,
  sceneAddCloud,
  sceneBegin,
  shadeMask,
} from '../../src/core/intervals.ts';
import type { Caster } from '../../src/core/objects.ts';
import { Rng } from '../../src/core/rng.ts';
import { casterShades, cloudOffset, glareOffset } from '../../src/core/shadows.ts';

const KINDS: CasterKind[] = ['hut', 'tree', 'oak', 'cottage', 'stone', 'hedge', 'house', 'arch', 'stall', 'column', 'wall', 'rock'];

interface Scene {
  casters: Caster[];
  clouds: [number, number, number, number][];
  balls: [number, number][];
  eps: number;
  cot: number;
}

function randomScene(r: Rng): Scene {
  const eps = r.range(6, 80);
  const cot = 1 / tanD(eps);
  const casters: Caster[] = [];
  const n = r.int(1, 6);
  for (let i = 0; i < n; i++) {
    const kind = KINDS[r.int(0, KINDS.length - 1)] as CasterKind;
    const d = r.range(10, Math.min(500, 140 * cot + 40));
    const a = r.range(0, 360);
    const x = d * (SUN_COS[Math.floor(a)] as number);
    const y = d * (SUN_SIN[Math.floor(a)] as number);
    casters.push(
      makeCaster({
        id: i, kind, name: '', biome: 'meadow', x, y, rot: 0,
        parts: buildParts(kind, x, y, r.int(0, 11), kind === 'rock' ? r.range(60, 160) : 0),
        side: 1, rescue: false, gate: false, ballId: -1, chunk: 0,
      }),
    );
  }
  const clouds: [number, number, number, number][] = [];
  const R = cloudOffset(300, cot);
  for (let i = r.int(0, 2); i > 0; i--) {
    const a = r.int(0, 359);
    const rx = r.range(60, 80);
    clouds.push([R * (SUN_COS[a] as number) + r.range(-60, 60), R * (SUN_SIN[a] as number) + r.range(-60, 60), rx, 0.66 * rx]);
  }
  const balls: [number, number][] = [];
  const G = glareOffset(cot);
  for (let i = r.int(0, 2); i > 0; i--) {
    const a = r.int(0, 359);
    balls.push([G * (SUN_COS[a] as number) + r.range(-20, 20), G * (SUN_SIN[a] as number) + r.range(-20, 20)]);
  }
  return { casters, clouds, balls, eps, cot };
}

function bruteShade(s: Scene, px: number, py: number, b: number, circles: boolean): boolean {
  const ux = SUN_COS[b] as number;
  const uy = SUN_SIN[b] as number;
  for (const c of s.casters) if (casterShades(c, px, py, ux, uy, s.cot)) return true;
  const R = cloudOffset(300, s.cot);
  for (const [cx, cy, rx, ry] of s.clouds) {
    const qx = px + ux * R - cx;
    const qy = py + uy * R - cy;
    if (circles ? qx * qx + qy * qy <= ry * ry : (qx / rx) ** 2 + (qy / ry) ** 2 <= 1) return true;
  }
  return false;
}

function bruteGlare(s: Scene, px: number, py: number, b: number): boolean {
  if (s.eps < 8) return false;
  const G = glareOffset(s.cot);
  for (const [bx, by] of s.balls) {
    const dx = px - (bx + (SUN_COS[b] as number) * G);
    const dy = py - (by + (SUN_SIN[b] as number) * G);
    if (dx * dx + dy * dy <= 22 * 22) return true;
  }
  return false;
}

function buildMaskScene(s: Scene) {
  const scene = createMaskScene();
  sceneBegin(scene, s.eps, s.cot);
  for (const c of s.casters) sceneAddCaster(scene, c);
  s.clouds.forEach(([cx, cy, rx, ry], i) => sceneAddCloud(scene, cx, cy, rx, ry, i));
  s.balls.forEach(([bx, by], i) => sceneAddBall(scene, bx, by, i));
  return scene;
}

/** Mismatching bins must sit at an edge of the brute-force interval. */
function compare(analytic: Uint8Array, brute: Uint8Array): { same: number; bad: number } {
  let same = 0;
  let bad = 0;
  for (let b = 0; b < BINS; b++) {
    if (analytic[b] === brute[b]) {
      same++;
      continue;
    }
    const prev = brute[(b + BINS - 1) % BINS];
    const next = brute[(b + 1) % BINS];
    if (prev === brute[b] && next === brute[b]) bad++;
  }
  return { same, bad };
}

describe('angular masks', () => {
  it('markRange wraps and handles full circles', () => {
    const m = new Uint8Array(BINS);
    markRange(m, 358.5, 361.2);
    expect([m[358], m[359], m[0], m[1], m[2], m[357]]).toEqual([0, 1, 1, 1, 0, 0]);
    m.fill(0);
    markRange(m, -0.5, 400);
    expect(m.every((v) => v === 1)).toBe(true);
    m.fill(0);
    markRange(m, 10.2, 10.8);
    expect(m.every((v) => v === 0)).toBe(true);
    expect(binOf(359.6)).toBe(0);
    expect(binOf(-0.6)).toBe(359);
  });

  it('analytic shade/glare masks match brute force on 2000 random scenes (≥ 99.5%)', () => {
    const r = new Rng(8080);
    const brute = new Uint8Array(BINS);
    const got = new Uint8Array(BINS);
    let same = 0;
    let total = 0;
    for (let t = 0; t < 2000; t++) {
      const s = randomScene(r);
      const scene = buildMaskScene(s);
      const px = r.range(-8, 8);
      const py = r.range(-8, 8);
      const circles = t % 2 === 0;
      shadeMask(scene, px, py, circles, got);
      for (let b = 0; b < BINS; b++) brute[b] = bruteShade(s, px, py, b, circles) ? 1 : 0;
      const c1 = compare(got, brute);
      expect(c1.bad).toBe(0);
      glareMask(scene, px, py, got);
      for (let b = 0; b < BINS; b++) brute[b] = bruteGlare(s, px, py, b) ? 1 : 0;
      const c2 = compare(got, brute);
      expect(c2.bad).toBe(0);
      same += c1.same + c2.same;
      total += 2 * BINS;
    }
    expect(same / total).toBeGreaterThanOrEqual(0.995);
  });

  it('litMask sums the five samples (0 shaded, 1 lit, 2 glare)', () => {
    const r = new Rng(77);
    const lit = new Uint8Array(BINS);
    for (let t = 0; t < 200; t++) {
      const s = randomScene(r);
      const scene = buildMaskScene(s);
      litMask(scene, 0, 0, true, lit, null);
      let mismatches = 0;
      for (let b = 0; b < BINS; b++) {
        let w = 0;
        for (let k = 0; k < 5; k++) {
          const px = SAMPLE_DX[k] as number;
          const py = SAMPLE_DY[k] as number;
          w += bruteGlare(s, px, py, b) ? 2 : bruteShade(s, px, py, b, true) ? 0 : 1;
        }
        if (w !== lit[b]) mismatches++;
      }
      expect(mismatches).toBeLessThanOrEqual(6);
    }
  });

  it('the sun below the horizon shades nothing', () => {
    const scene = createMaskScene();
    sceneBegin(scene, 0, 0);
    const m = new Uint8Array(BINS).fill(7);
    shadeMask(scene, 0, 0, false, m);
    expect(m.every((v) => v === 0)).toBe(true);
  });
});
