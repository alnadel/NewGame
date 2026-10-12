// Shadow logic tests and render polygons (V1_PLAN §2.7, archive/TECH_SPEC §6).
//
// Conventions: u = (ux, uy) = (cos θ, sin θ) points toward the sun; cot = 1/tan ε. A point at
// height h casts its shadow at p − u·L with L = min(h·cot, 520). The logic tests below and the
// render polygons describe exactly the same sets, so what the player sees is what the sim uses:
//   prism: p shaded ⇔ segment [p, p + u·L] meets F      ⇔ p ∈ F ⊕ [−u·L, 0] = hull(F ∪ F − u·L)
//   slab:  p shaded ⇔ segment [p + u·R0, p + u·R1] meets F ⇔ p ∈ hull(F − u·R0 ∪ F − u·R1)
//   disc:  p shaded ⇔ |p + u·R − c| ≤ r                 ⇔ p in the disc centered c − u·R
// (A slab is a solid between z0 and z1, so every height in between casts shadow; this is the
// exact Minkowski-sum form of GDD §2.4's three-height test.)

import { BALL_Z } from '../config/casters.ts';
import { TUNING } from '../config/tuning.ts';
import { segmentIntersectsConvex, sweepConvex } from './geom.ts';
import type { Caster, Cloud, GazingBall, Part } from './objects.ts';

const CAP = TUNING.shadow.capLen;
const CLOUD_CAP = TUNING.shadow.cloudCap;
const GLARE_R = TUNING.glare.radius;
const GLARE_R2 = GLARE_R * GLARE_R;
const GLARE_CAP = TUNING.glare.cap;

/** Ground shadow length of a point at height h (u). */
export function shadowLength(h: number, cot: number): number {
  const l = h * cot;
  return l < CAP ? l : CAP;
}

/** Shadow offset of a cloud at altitude z (u). */
export function cloudOffset(z: number, cot: number): number {
  const l = z * cot;
  return l < CLOUD_CAP ? l : CLOUD_CAP;
}

/** Distance of a glare spot from its ball (u). */
export function glareOffset(cot: number): number {
  const l = BALL_Z * cot;
  return l < GLARE_CAP ? l : GLARE_CAP;
}

/** Glare exists only while the sun is at least this high. */
export function glareActive(eps: number): boolean {
  return eps >= TUNING.glare.minEps;
}

/** Logic test: does `part` shade ground point p? */
export function partShades(part: Part, px: number, py: number, ux: number, uy: number, cot: number): boolean {
  if (part.t === 'prism') {
    const l = shadowLength(part.h, cot);
    return segmentIntersectsConvex(px, py, px + ux * l, py + uy * l, part.pts, part.n);
  }
  if (part.t === 'slab') {
    const r0 = shadowLength(part.z0, cot);
    const r1 = shadowLength(part.z1, cot);
    return segmentIntersectsConvex(px + ux * r0, py + uy * r0, px + ux * r1, py + uy * r1, part.pts, part.n);
  }
  const r = shadowLength(part.z, cot);
  const dx = px + ux * r - part.cx;
  const dy = py + uy * r - part.cy;
  return dx * dx + dy * dy <= part.r * part.r;
}

/** Distance from p to the caster's ground bounds (0 inside). */
export function distToCasterBounds(c: Caster, px: number, py: number): number {
  const dx = px < c.minX ? c.minX - px : px > c.maxX ? px - c.maxX : 0;
  const dy = py < c.minY ? c.minY - py : py > c.maxY ? py - c.maxY : 0;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Max distance from its footprint at which a caster can shade anything at this elevation. */
export function casterReach(c: Caster, cot: number): number {
  return shadowLength(c.maxZ, cot);
}

/** Logic test: does any part of caster c shade p? */
export function casterShades(c: Caster, px: number, py: number, ux: number, uy: number, cot: number): boolean {
  if (distToCasterBounds(c, px, py) > casterReach(c, cot)) return false;
  const parts = c.parts;
  for (let i = 0; i < parts.length; i++) {
    if (partShades(parts[i] as Part, px, py, ux, uy, cot)) return true;
  }
  return false;
}

/** True while the cloud exists at absolute time tAbs (s). */
export function cloudAlive(cl: Cloud, tAbs: number): boolean {
  return tAbs >= cl.t0 && tAbs <= cl.t0 + cl.life;
}

/**
 * Render-only opacity ramp of a cloud: 0 → 1 over the first TUNING.cloud.fade seconds of its life
 * and back to 0 over the last ones (its shadow is fully real while it is alive).
 */
export function cloudVisibility(cl: Cloud, tAbs: number): number {
  const fade = TUNING.cloud.fade;
  const a = (tAbs - cl.t0) / fade;
  const b = (cl.t0 + cl.life - tAbs) / fade;
  const v = a < b ? a : b;
  return v <= 0 ? 0 : v >= 1 ? 1 : v;
}

/** Cloud body center at absolute time tAbs: writes [x, y] into out. */
export function cloudCenter(cl: Cloud, tAbs: number, out: Float64Array): void {
  const dt = tAbs - cl.t0;
  out[0] = cl.x0 + cl.vx * dt;
  out[1] = cl.y0 + cl.vy * dt;
}

/** Logic test: is p inside the cloud's elliptical shadow at time tAbs? (Assumes the cloud is alive.) */
export function cloudShades(
  cl: Cloud,
  tAbs: number,
  px: number,
  py: number,
  ux: number,
  uy: number,
  cot: number,
): boolean {
  const dt = tAbs - cl.t0;
  const r = cloudOffset(cl.z, cot);
  const ex = (px + ux * r - (cl.x0 + cl.vx * dt)) / cl.rx;
  const ey = (py + uy * r - (cl.y0 + cl.vy * dt)) / cl.ry;
  return ex * ex + ey * ey <= 1;
}

/** Glare spot center: ball + u·min(40·cot, 160). Writes [x, y] into out. */
export function glareCenter(b: GazingBall, ux: number, uy: number, cot: number, out: Float64Array): void {
  const g = glareOffset(cot);
  out[0] = b.x + ux * g;
  out[1] = b.y + uy * g;
}

/** Logic test: is p inside the ball's glare spot? Caller checks glareActive(ε). */
export function inGlare(b: GazingBall, px: number, py: number, ux: number, uy: number, cot: number): boolean {
  const g = glareOffset(cot);
  const dx = px - (b.x + ux * g);
  const dy = py - (b.y + uy * g);
  return dx * dx + dy * dy <= GLARE_R2;
}

const slabScratch = new Float64Array(32);

/**
 * Render geometry of a part's ground shadow.
 * - prism/slab: writes a CCW convex polygon into `out` (flat x,y; needs 2·(n+2) slots, 16 is
 *   always enough) and returns its vertex count;
 * - disc: writes [cx, cy, r] of the shadow circle into out and returns −1.
 * The polygon/circle is exactly the set where partShades() is true.
 */
export function partShadow(part: Part, ux: number, uy: number, cot: number, out: Float64Array): number {
  if (part.t === 'prism') {
    const l = shadowLength(part.h, cot);
    return sweepConvex(part.pts, part.n, -ux * l, -uy * l, out);
  }
  if (part.t === 'slab') {
    const r0 = shadowLength(part.z0, cot);
    const r1 = shadowLength(part.z1, cot);
    const n = part.n;
    for (let i = 0; i < n; i++) {
      slabScratch[2 * i] = (part.pts[2 * i] as number) - ux * r0;
      slabScratch[2 * i + 1] = (part.pts[2 * i + 1] as number) - uy * r0;
    }
    return sweepConvex(slabScratch, n, -ux * (r1 - r0), -uy * (r1 - r0), out);
  }
  const r = shadowLength(part.z, cot);
  out[0] = part.cx - ux * r;
  out[1] = part.cy - uy * r;
  out[2] = part.r;
  return -1;
}

/** Render geometry of a cloud's shadow at tAbs: writes [cx, cy, rx, ry] (axis-aligned ellipse). */
export function cloudShadow(cl: Cloud, tAbs: number, ux: number, uy: number, cot: number, out: Float64Array): void {
  const dt = tAbs - cl.t0;
  const r = cloudOffset(cl.z, cot);
  out[0] = cl.x0 + cl.vx * dt - ux * r;
  out[1] = cl.y0 + cl.vy * dt - uy * r;
  out[2] = cl.rx;
  out[3] = cl.ry;
}
