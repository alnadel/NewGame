import { describe, expect, it } from 'vitest';
import { rectPoly } from '../../src/core/geom.ts';
import {
  controlY,
  createTrail,
  distPolyToTrail,
  trailSlope,
  trailX,
  tutorialStraightRange,
} from '../../src/core/trail.ts';

describe('trail', () => {
  it('passes through its control points and stays in range', () => {
    const t = createTrail(1, false);
    trailX(t, 5000);
    for (let i = 1; i < t.cps.length - 2; i++) {
      expect(Math.abs(trailX(t, controlY(i)) - (t.cps[i] as number))).toBeLessThan(1e-9);
      expect(t.cps[i]).toBeGreaterThanOrEqual(80);
      expect(t.cps[i]).toBeLessThanOrEqual(280);
    }
  });

  it('is a cubic in y on each segment (linear-y Catmull-Rom)', () => {
    const t = createTrail(7, false);
    for (let i = 3; i < 20; i++) {
      const y0 = controlY(i);
      // Third finite differences of a cubic are constant on equally spaced samples.
      const h = 10;
      const xs = [0, 1, 2, 3, 4, 5].map((k) => trailX(t, y0 + 5 + k * h));
      const d3a = xs[3]! - 3 * xs[2]! + 3 * xs[1]! - xs[0]!;
      const d3b = xs[4]! - 3 * xs[3]! + 3 * xs[2]! - xs[1]!;
      const d3c = xs[5]! - 3 * xs[4]! + 3 * xs[3]! - xs[2]!;
      expect(Math.abs(d3a - d3b)).toBeLessThan(1e-9);
      expect(Math.abs(d3b - d3c)).toBeLessThan(1e-9);
    }
  });

  it('slope matches finite differences', () => {
    const t = createTrail(3, false);
    for (let y = 0; y < 3000; y += 37) {
      const fd = (trailX(t, y + 0.01) - trailX(t, y - 0.01)) / 0.02;
      expect(Math.abs(trailSlope(t, y) - fd)).toBeLessThan(1e-4); // C1 only at knots
    }
  });

  it('honors the tutorial straight range', () => {
    const t = createTrail(11, true);
    const r = tutorialStraightRange(t)!;
    expect(r).toEqual({ y0: -120, y1: 480 });
    for (let y = r.y0; y <= r.y1; y += 3) expect(trailX(t, y)).toBe(180);
    expect(tutorialStraightRange(createTrail(11, false))).toBeNull();
  });

  it('is a pure function of the seed, whatever the query order', () => {
    const a = createTrail(99, false);
    const b = createTrail(99, false);
    const ys = [4000, 10, 2500, -300, 8000];
    const xa = ys.map((y) => trailX(a, y));
    const xb = ys
      .slice()
      .reverse()
      .map((y) => trailX(b, y))
      .reverse();
    expect(xa).toEqual(xb);
    // The tutorial forces points but keeps the stream aligned, so far points agree.
    const c = createTrail(99, true);
    expect(trailX(c, 3000)).toBe(trailX(a, 3000));
  });

  it('measures polygon clearance against the centerline', () => {
    const t = createTrail(5, true);
    const box = rectPoly(180 + 20 + 10, 100, 20, 20, 1, 0);
    expect(Math.abs(distPolyToTrail(t, box, 4, 60, 140) - 20)).toBeLessThan(1e-9);
  });
});
