// The trail: a uniform Catmull-Rom spline through control points spaced every 120 u in y, so
// x = trailX(y) is a function (y is exactly linear in the spline parameter). V1_PLAN §7.1.
//
// Control points come from the sequential rngFor(seed, 'trail') stream and are generated lazily;
// point i always gets the same value whenever it is first needed, so queries never change the world.

import { TUNING } from '../config/tuning.ts';
import { clamp, distPointConvex, distSqPointSegment } from './geom.ts';
import { rngFor, type Rng } from './rng.ts';

const T = TUNING.trail;

export interface Trail {
  readonly tutorial: boolean;
  /** Control point x values; point i sits at y = cpY0 + cpSpacing·i. */
  readonly cps: number[];
  readonly rng: Rng;
}

export function createTrail(seed: number, tutorial: boolean): Trail {
  return { tutorial, cps: [T.center], rng: rngFor(seed, 'trail') };
}

/** y of control point i. */
export function controlY(i: number): number {
  return T.cpY0 + T.cpSpacing * i;
}

/**
 * The y range over which the profile-0 tutorial forces x = center: every control point that
 * influences a segment inside [tutorialY0, tutorialY1].
 */
function forcedStraight(trail: Trail, y: number): boolean {
  return trail.tutorial && y >= T.tutorialY0 - T.cpSpacing && y <= T.tutorialY1 + T.cpSpacing;
}

function extend(trail: Trail, upTo: number): void {
  const cps = trail.cps;
  while (cps.length <= upTo) {
    const prev = cps[cps.length - 1] as number;
    // Always draw, even when forced, so the stream stays aligned across profiles.
    const step = trail.rng.range(-T.step, T.step);
    let x = clamp(prev + step + T.pull * (T.center - prev), T.xMin, T.xMax);
    if (forcedStraight(trail, controlY(cps.length))) x = T.center;
    cps.push(x);
  }
}

/** Trail centerline x at y. */
export function trailX(trail: Trail, y: number): number {
  let s = (y - T.cpY0) / T.cpSpacing;
  if (s < 1) s = 1; // nothing is ever queried that far behind the start
  const i = Math.floor(s);
  const u = s - i;
  if (i + 2 >= trail.cps.length) extend(trail, i + 2);
  const cps = trail.cps;
  const p0 = cps[i - 1] as number;
  const p1 = cps[i] as number;
  const p2 = cps[i + 1] as number;
  const p3 = cps[i + 2] as number;
  return (
    0.5 *
    (2 * p1 +
      (p2 - p0) * u +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u +
      (3 * p1 - p0 - 3 * p2 + p3) * u * u * u)
  );
}

/** dx/dy of the centerline at y (direction of travel is (slope, 1)). */
export function trailSlope(trail: Trail, y: number): number {
  let s = (y - T.cpY0) / T.cpSpacing;
  if (s < 1) s = 1;
  const i = Math.floor(s);
  const u = s - i;
  if (i + 2 >= trail.cps.length) extend(trail, i + 2);
  const cps = trail.cps;
  const p0 = cps[i - 1] as number;
  const p1 = cps[i] as number;
  const p2 = cps[i + 1] as number;
  const p3 = cps[i + 2] as number;
  const dxdu = 0.5 * ((p2 - p0) + 2 * (2 * p0 - 5 * p1 + 4 * p2 - p3) * u + 3 * (3 * p1 - p0 - 3 * p2 + p3) * u * u);
  return dxdu / T.cpSpacing;
}

/** The y range where the tutorial trail is exactly straight at x = 180, or null. */
export function tutorialStraightRange(trail: Trail): { y0: number; y1: number } | null {
  return trail.tutorial ? { y0: T.tutorialY0, y1: T.tutorialY1 } : null;
}

/**
 * Minimum distance between a CCW convex polygon and the trail centerline, approximated by the
 * polyline sampled every `TUNING.world.clearanceSample` u over [yLo, yHi] (V1_PLAN §7.2).
 */
export function distPolyToTrail(trail: Trail, pts: Float64Array, n: number, yLo: number, yHi: number): number {
  const stepY = TUNING.world.clearanceSample;
  const y0 = Math.floor(yLo / stepY) * stepY;
  let best = Infinity;
  let px = trailX(trail, y0);
  let py = y0;
  let d = distPointConvex(px, py, pts, n);
  if (d < best) best = d;
  for (let y = y0 + stepY; y <= yHi + stepY; y += stepY) {
    const qx = trailX(trail, y);
    d = distPointConvex(qx, y, pts, n);
    if (d < best) best = d;
    for (let i = 0; i < n; i++) {
      const dd = Math.sqrt(distSqPointSegment(pts[2 * i] as number, pts[2 * i + 1] as number, px, py, qx, y));
      if (dd < best) best = dd;
    }
    px = qx;
    py = y;
  }
  return best;
}
