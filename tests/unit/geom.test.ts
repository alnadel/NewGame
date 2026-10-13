import { describe, expect, it } from 'vitest';
import {
  convexDistance,
  convexHull,
  distPointConvex,
  pointInConvex,
  rectPoly,
  segmentEnterConvex,
  segmentIntersectsConvex,
  sweepConvex,
} from '../../src/core/geom.ts';
import { cosD, sinD, smoothstep } from '../../src/core/dmath.ts';
import { Rng } from '../../src/core/rng.ts';

function randomConvex(r: Rng): Float64Array {
  const n = r.int(3, 9);
  const pts: number[] = [];
  const cx = r.range(-50, 50);
  const cy = r.range(-50, 50);
  for (let i = 0; i < n; i++) pts.push(cx + r.range(-30, 30), cy + r.range(-30, 30));
  return convexHull(pts, n);
}

function signedArea(p: Float64Array): number {
  const n = p.length / 2;
  let a = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += (p[2 * i] as number) * (p[2 * j + 1] as number) - (p[2 * j] as number) * (p[2 * i + 1] as number);
  }
  return a / 2;
}

describe('geom', () => {
  const r = new Rng(2024);

  it('convex hull is CCW and contains every input point', () => {
    for (let t = 0; t < 300; t++) {
      const n = r.int(3, 30);
      const pts: number[] = [];
      for (let i = 0; i < n; i++) pts.push(r.range(-100, 100), r.range(-100, 100));
      const h = convexHull(pts, n);
      expect(signedArea(h)).toBeGreaterThan(0);
      for (let i = 0; i < n; i++) {
        // Inside or within rounding of the boundary.
        const d = distPointConvex(pts[2 * i] as number, pts[2 * i + 1] as number, h, h.length / 2);
        expect(d).toBeLessThan(1e-9);
      }
    }
  });

  it('pointInConvex matches a rectangle test', () => {
    const rect = rectPoly(10, 20, 40, 20, 1, 0);
    expect(pointInConvex(10, 20, rect, 4)).toBe(true);
    expect(pointInConvex(29.9, 29.9, rect, 4)).toBe(true);
    expect(pointInConvex(30.1, 20, rect, 4)).toBe(false);
    expect(pointInConvex(-10, 10, rect, 4)).toBe(true); // corner, inclusive
  });

  it('segment-vs-convex agrees with brute-force sampling (5k cases)', () => {
    let checked = 0;
    for (let t = 0; t < 5000; t++) {
      const poly = randomConvex(r);
      const n = poly.length / 2;
      const ax = r.range(-120, 120);
      const ay = r.range(-120, 120);
      const bx = r.range(-120, 120);
      const by = r.range(-120, 120);
      let hit = false;
      let nearEdge = false;
      for (let k = 0; k <= 400; k++) {
        const s = k / 400;
        const px = ax + (bx - ax) * s;
        const py = ay + (by - ay) * s;
        if (pointInConvex(px, py, poly, n)) hit = true;
        if (distPointConvex(px, py, poly, n) < 0.6) nearEdge = true;
      }
      const got = segmentIntersectsConvex(ax, ay, bx, by, poly, n);
      if (hit) expect(got).toBe(true);
      else if (!nearEdge) {
        expect(got).toBe(false);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it('segmentEnterConvex returns the entry parameter', () => {
    const sq = rectPoly(0, 0, 2, 2, 1, 0);
    expect(segmentEnterConvex(-3, 0, 3, 0, sq, 4)).toBeCloseTo(2 / 6, 12);
    expect(segmentEnterConvex(0, 0, 3, 0, sq, 4)).toBe(0);
    expect(segmentEnterConvex(-3, 5, 3, 5, sq, 4)).toBe(-1);
    // Degenerate segment = point test.
    expect(segmentEnterConvex(0.5, 0.5, 0.5, 0.5, sq, 4)).toBe(0);
    expect(segmentEnterConvex(5, 5, 5, 5, sq, 4)).toBe(-1);
  });

  it('sweepConvex equals the Minkowski sum with a segment', () => {
    const out = new Float64Array(64);
    for (let t = 0; t < 300; t++) {
      const poly = randomConvex(r);
      const n = poly.length / 2;
      const a = r.range(0, 360);
      const L = r.range(0, 200);
      const dx = cosD(a) * L;
      const dy = sinD(a) * L;
      const m = sweepConvex(poly, n, dx, dy, out);
      const sw = out.slice(0, 2 * m);
      expect(signedArea(sw)).toBeGreaterThan(0);
      for (let k = 0; k < 200; k++) {
        const px = r.range(-150, 150) + dx / 2;
        const py = r.range(-150, 150) + dy / 2;
        // p ∈ F ⊕ [0, d]  ⇔  segment [p − d, p] meets F.
        const truth = segmentIntersectsConvex(px - dx, py - dy, px, py, poly, n);
        const inSweep = pointInConvex(px, py, sw, m);
        if (truth !== inSweep) {
          const d = Math.min(distPointConvex(px, py, sw, m), 1);
          expect(d).toBeLessThan(1e-7);
        }
      }
    }
  });

  it('convexDistance', () => {
    const a = rectPoly(0, 0, 10, 10, 1, 0);
    const b = rectPoly(20, 0, 10, 10, 1, 0);
    expect(convexDistance(a, 4, b, 4)).toBeCloseTo(10, 12);
    const c = rectPoly(8, 3, 10, 10, cosD(30), sinD(30));
    expect(convexDistance(a, 4, c, 4)).toBe(0);
  });

  it('smoothstep', () => {
    expect(smoothstep(0, 1, -1)).toBe(0);
    expect(smoothstep(0, 1, 2)).toBe(1);
    expect(smoothstep(0, 1, 0.5)).toBe(0.5);
  });
});
