// Per-point angular shade masks over 360 one-degree sun-azimuth bins (archive/TECH_SPEC §6).
//
// Bin b stands for θ = b° exactly (its center), so masks agree with the per-tick logic tests at
// whole-degree azimuths. Each occluder contributes one analytic angular interval:
//   prism: the directions of F ∩ Disk(p, L) as seen from p (convex, so one interval < 180°);
//   disc / circular cloud / glare: q = o + R·u(θ) inside a circle ⇔ cos(θ − α) ≥ κ (law of cosines);
//   slab and elliptical cloud: an analytic superset interval, then an exact test per bin inside it.
// Only bins inside an interval are touched, which keeps the validator within its time budget.
//
// Used by the guide (strict masks), the validator (lit counts) and the bots.

import { TUNING } from '../config/tuning.ts';
import { acosD, atan2D, SUN_COS, SUN_SIN } from './dmath.ts';
import { pointInConvex, segmentIntersectsConvex } from './geom.ts';
import type { Caster, Part, PrismPart } from './objects.ts';
import { glareOffset, shadowLength, cloudOffset } from './shadows.ts';

export const BINS = 360;

const OFF = TUNING.nubs.sampleOffset;
/** Coverage sample offsets: center, east, west, north (front), south (back). */
export const SAMPLE_DX: readonly number[] = Object.freeze([0, OFF, -OFF, 0, 0]);
export const SAMPLE_DY: readonly number[] = Object.freeze([0, 0, 0, OFF, -OFF]);
export const SAMPLES = 5;

/** Whole-degree bin nearest to θ, in [0, 360). */
export function binOf(theta: number): number {
  let b = Math.round(theta);
  b %= 360;
  if (b < 0) b += 360;
  return b;
}

/** Sets out[b] = 1 for every bin whose center lies in the unwrapped interval [a0, a1] (degrees). */
export function markRange(out: Uint8Array, a0: number, a1: number): void {
  const b0 = Math.ceil(a0);
  const b1 = Math.floor(a1);
  if (b1 < b0) return;
  if (b1 - b0 >= BINS - 1) {
    out.fill(1);
    return;
  }
  let idx = b0 % BINS;
  if (idx < 0) idx += BINS;
  for (let k = b0; k <= b1; k++) {
    out[idx] = 1;
    idx++;
    if (idx === BINS) idx = 0;
  }
}

/** Adds 1 to out[b] for every bin whose center lies in [a0, a1] (each bin at most once). */
function countRange(out: Uint8Array, a0: number, a1: number): void {
  let b0 = Math.ceil(a0);
  let b1 = Math.floor(a1);
  if (b1 < b0) return;
  if (b1 - b0 >= BINS - 1) {
    b0 = 0;
    b1 = BINS - 1;
  }
  let idx = b0 % BINS;
  if (idx < 0) idx += BINS;
  for (let k = b0; k <= b1; k++) {
    out[idx] = (out[idx] as number) + 1;
    idx++;
    if (idx === BINS) idx = 0;
  }
}

// Result of the last circleInterval(): kind 0 none, 1 all bins, 2 the interval [ivA0, ivA1].
let ivA0 = 0;
let ivA1 = 0;

/**
 * Directions θ for which the point o + R·u(θ) lies inside the circle (c, r).
 * Returns 0 (none), 1 (all) or 2 (interval in ivA0..ivA1).
 */
function circleInterval(ox: number, oy: number, R: number, cx: number, cy: number, r: number): number {
  const dx = cx - ox;
  const dy = cy - oy;
  const d2 = dx * dx + dy * dy;
  const r2 = r * r;
  if (R === 0 || d2 === 0) return d2 + R * R <= r2 ? 1 : 0;
  const d = Math.sqrt(d2);
  const kappa = (d2 + R * R - r2) / (2 * d * R);
  if (kappa <= -1) return 1;
  if (kappa > 1) return 0;
  const alpha = atan2D(dy, dx);
  const phi = acosD(kappa);
  ivA0 = alpha - phi;
  ivA1 = alpha + phi;
  return 2;
}

/** Marks bins where o + R·u(θ) is inside the circle (c, r). */
export function markCircle(out: Uint8Array, ox: number, oy: number, R: number, cx: number, cy: number, r: number): void {
  const k = circleInterval(ox, oy, R, cx, cy, r);
  if (k === 1) out.fill(1);
  else if (k === 2) markRange(out, ivA0, ivA1);
}

/**
 * Directions from p toward F ∩ Disk(p, L) for a CCW convex polygon F with p outside F.
 * Returns 0 (empty) or 2 (interval in ivA0..ivA1, width < 180°).
 */
function convexDiskInterval(px: number, py: number, pts: Float64Array, n: number, L: number): number {
  const l2 = L * L;
  let have = false;
  let mnx = 0;
  let mny = 0;
  let mxx = 0;
  let mxy = 0;
  // Candidates: vertices inside the disk, and edge/circle crossings. Their extreme directions bound
  // the cone of F ∩ Disk; comparisons use cross products (valid inside a < 180° cone).
  for (let i = 0; i < n; i++) {
    const ax = (pts[2 * i] as number) - px;
    const ay = (pts[2 * i + 1] as number) - py;
    const aa = ax * ax + ay * ay;
    if (aa <= l2) {
      if (!have) {
        mnx = mxx = ax;
        mny = mxy = ay;
        have = true;
      } else {
        if (mnx * ay - mny * ax < 0) {
          mnx = ax;
          mny = ay;
        }
        if (mxx * ay - mxy * ax > 0) {
          mxx = ax;
          mxy = ay;
        }
      }
    }
    const j = i + 1 === n ? 0 : i + 1;
    const ex = (pts[2 * j] as number) - (pts[2 * i] as number);
    const ey = (pts[2 * j + 1] as number) - (pts[2 * i + 1] as number);
    const qa = ex * ex + ey * ey;
    if (qa === 0) continue;
    const qb = ax * ex + ay * ey;
    const disc = qb * qb - qa * (aa - l2);
    if (disc < 0) continue;
    const sq = Math.sqrt(disc);
    for (let s = 0; s < 2; s++) {
      const t = (s === 0 ? -qb - sq : -qb + sq) / qa;
      if (t < 0 || t > 1) continue;
      const vx = ax + t * ex;
      const vy = ay + t * ey;
      if (!have) {
        mnx = mxx = vx;
        mny = mxy = vy;
        have = true;
      } else {
        if (mnx * vy - mny * vx < 0) {
          mnx = vx;
          mny = vy;
        }
        if (mxx * vy - mxy * vx > 0) {
          mxx = vx;
          mxy = vy;
        }
      }
    }
  }
  if (!have) return 0;
  ivA0 = atan2D(mny, mnx);
  ivA1 = atan2D(mxy, mxx);
  if (ivA1 < ivA0) ivA1 += 360;
  return 2;
}

/** Iterates the bins of [ivA0, ivA1] (or all bins when `all`) and marks those passing the slab test. */
function markSlabBins(
  out: Uint8Array,
  px: number,
  py: number,
  pts: Float64Array,
  n: number,
  r0: number,
  r1: number,
  all: boolean,
): void {
  let b0: number;
  let b1: number;
  if (all) {
    b0 = 0;
    b1 = BINS - 1;
  } else {
    b0 = Math.ceil(ivA0);
    b1 = Math.floor(ivA1);
    if (b1 - b0 >= BINS) b1 = b0 + BINS - 1;
  }
  let idx = b0 % BINS;
  if (idx < 0) idx += BINS;
  for (let k = b0; k <= b1; k++) {
    if (out[idx] === 0) {
      const ux = SUN_COS[idx] as number;
      const uy = SUN_SIN[idx] as number;
      if (segmentIntersectsConvex(px + ux * r0, py + uy * r0, px + ux * r1, py + uy * r1, pts, n)) out[idx] = 1;
    }
    idx++;
    if (idx === BINS) idx = 0;
  }
}

/** Distance from p to a part's ground bounds. */
function distToPartBounds(part: Part, px: number, py: number): number {
  const dx = px < part.minX ? part.minX - px : px > part.maxX ? px - part.maxX : 0;
  const dy = py < part.minY ? part.minY - py : py > part.maxY ? py - part.maxY : 0;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Marks every bin θ at which `part` shades ground point p (elevation given by cot). */
export function markPart(out: Uint8Array, part: Part, px: number, py: number, cot: number): void {
  if (part.t === 'prism') {
    const l = shadowLength(part.h, cot);
    if (distToPartBounds(part, px, py) > l) return;
    if (pointInConvex(px, py, part.pts, part.n)) {
      out.fill(1);
      return;
    }
    if (convexDiskInterval(px, py, part.pts, part.n, l) === 2) markRange(out, ivA0, ivA1);
    return;
  }
  if (part.t === 'slab') {
    const r1 = shadowLength(part.z1, cot);
    if (distToPartBounds(part, px, py) > r1) return;
    const r0 = shadowLength(part.z0, cot);
    if (pointInConvex(px, py, part.pts, part.n)) {
      markSlabBins(out, px, py, part.pts, part.n, r0, r1, true);
      return;
    }
    if (convexDiskInterval(px, py, part.pts, part.n, r1) === 2) markSlabBins(out, px, py, part.pts, part.n, r0, r1, false);
    return;
  }
  const r = shadowLength(part.z, cot);
  if (distToPartBounds(part, px, py) > r) return;
  markCircle(out, px, py, r, part.cx, part.cy, part.r);
}

/**
 * Like markPart for a single prism, but adds 1 to every bin it shades (so summing over several
 * sample points counts how many of them that prism covers at each θ).
 */
export function countPrism(out: Uint8Array, part: PrismPart, px: number, py: number, cot: number): void {
  const l = shadowLength(part.h, cot);
  if (distToPartBounds(part, px, py) > l) return;
  if (pointInConvex(px, py, part.pts, part.n)) countRange(out, 0, BINS - 1);
  else if (convexDiskInterval(px, py, part.pts, part.n, l) === 2) countRange(out, ivA0, ivA1);
}

/** Marks bins where caster c shades p. */
export function markCaster(out: Uint8Array, c: Caster, px: number, py: number, cot: number): void {
  const parts = c.parts;
  for (let i = 0; i < parts.length; i++) markPart(out, parts[i] as Part, px, py, cot);
}

/**
 * Marks bins where p lies in an elliptical cloud shadow: q = p + R·u(θ) inside the ellipse at
 * (cx, cy). Exact per bin inside the bounding-circle interval.
 */
export function markEllipse(
  out: Uint8Array,
  px: number,
  py: number,
  R: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
): void {
  const k = circleInterval(px, py, R, cx, cy, rx > ry ? rx : ry);
  if (k === 0) return;
  let b0 = 0;
  let b1 = BINS - 1;
  if (k === 2) {
    b0 = Math.ceil(ivA0);
    b1 = Math.floor(ivA1);
  }
  let idx = b0 % BINS;
  if (idx < 0) idx += BINS;
  const irx = 1 / rx;
  const iry = 1 / ry;
  for (let b = b0; b <= b1; b++) {
    if (out[idx] === 0) {
      const ex = (px + (SUN_COS[idx] as number) * R - cx) * irx;
      const ey = (py + (SUN_SIN[idx] as number) * R - cy) * iry;
      if (ex * ex + ey * ey <= 1) out[idx] = 1;
    }
    idx++;
    if (idx === BINS) idx = 0;
  }
}

// ---------------------------------------------------------------------------------------------
// Scenes: the occluders near a query point, gathered once and reused for the 5 samples.

export interface MaskScene {
  sunUp: boolean;
  cot: number;
  glareOn: boolean;
  /** Candidate casters (only the first nCasters entries are valid). */
  casters: Caster[];
  nCasters: number;
  /** Cloud shadows as (cx, cy, rx, ry, id) at the scene time; nClouds entries. */
  clouds: Float64Array;
  nClouds: number;
  /** Shadow offset R of every cloud at this elevation. */
  cloudR: number;
  /** Gazing balls as (x, y, id); nBalls entries. */
  balls: Float64Array;
  nBalls: number;
  /** Glare spot distance from its ball. */
  glareG: number;
}

export function createMaskScene(): MaskScene {
  return {
    sunUp: false,
    cot: 0,
    glareOn: false,
    casters: [],
    nCasters: 0,
    clouds: new Float64Array(5 * 32),
    nClouds: 0,
    cloudR: 0,
    balls: new Float64Array(3 * 32),
    nBalls: 0,
    glareG: 0,
  };
}

/** Resets the scene for elevation eps (°) with cot = 1/tan ε. eps ≤ 0 means the sun is down. */
export function sceneBegin(scene: MaskScene, eps: number, cot: number): void {
  scene.sunUp = eps > 0;
  scene.cot = cot;
  scene.glareOn = eps >= TUNING.glare.minEps;
  scene.nCasters = 0;
  scene.nClouds = 0;
  scene.nBalls = 0;
  scene.cloudR = eps > 0 ? cloudOffset(TUNING.shadow.cloudZ, cot) : 0;
  scene.glareG = eps > 0 ? glareOffset(cot) : 0;
}

export function sceneAddCaster(scene: MaskScene, c: Caster): void {
  if (scene.nCasters < scene.casters.length) scene.casters[scene.nCasters] = c;
  else scene.casters.push(c);
  scene.nCasters++;
}

export function sceneAddCloud(scene: MaskScene, cx: number, cy: number, rx: number, ry: number, id: number): void {
  if ((scene.nClouds + 1) * 5 > scene.clouds.length) {
    const grown = new Float64Array(scene.clouds.length * 2);
    grown.set(scene.clouds);
    scene.clouds = grown;
  }
  const o = scene.nClouds * 5;
  scene.clouds[o] = cx;
  scene.clouds[o + 1] = cy;
  scene.clouds[o + 2] = rx;
  scene.clouds[o + 3] = ry;
  scene.clouds[o + 4] = id;
  scene.nClouds++;
}

export function sceneAddBall(scene: MaskScene, x: number, y: number, id: number): void {
  if ((scene.nBalls + 1) * 3 > scene.balls.length) {
    const grown = new Float64Array(scene.balls.length * 2);
    grown.set(scene.balls);
    scene.balls = grown;
  }
  const o = scene.nBalls * 3;
  scene.balls[o] = x;
  scene.balls[o + 1] = y;
  scene.balls[o + 2] = id;
  scene.nBalls++;
}

/**
 * Shade mask of point p: out[b] = 1 where some caster or cloud shades p at θ = b.
 * Clouds are exact ellipses, or circles of radius ry when `cloudsAsCircles` (validator, conservative).
 */
export function shadeMask(scene: MaskScene, px: number, py: number, cloudsAsCircles: boolean, out: Uint8Array): void {
  out.fill(0);
  if (!scene.sunUp) return;
  const cot = scene.cot;
  for (let i = 0; i < scene.nCasters; i++) markCaster(out, scene.casters[i] as Caster, px, py, cot);
  const R = scene.cloudR;
  const cl = scene.clouds;
  for (let i = 0; i < scene.nClouds; i++) {
    const o = i * 5;
    if (cloudsAsCircles) markCircle(out, px, py, R, cl[o] as number, cl[o + 1] as number, cl[o + 3] as number);
    else markEllipse(out, px, py, R, cl[o] as number, cl[o + 1] as number, cl[o + 2] as number, cl[o + 3] as number);
  }
}

/** Glare mask of point p: out[b] = 1 where some ball's glare spot covers p at θ = b. */
export function glareMask(scene: MaskScene, px: number, py: number, out: Uint8Array): void {
  out.fill(0);
  if (!scene.sunUp || !scene.glareOn) return;
  const g = scene.glareG;
  const bl = scene.balls;
  for (let i = 0; i < scene.nBalls; i++) {
    const o = i * 3;
    // p is in glare ⇔ ball + G·u(θ) lies within the glare radius of p.
    markCircle(out, bl[o] as number, bl[o + 1] as number, g, px, py, TUNING.glare.radius);
  }
}

const sShade = new Uint8Array(BINS);
const sGlare = new Uint8Array(BINS);

/**
 * Lit-weight mask for Nubs centered at (cx, cy): outLit[b] = Σ over the 5 samples of the lit
 * weight (0 shaded, 1 lit, 2 in glare), so 0..10 and f = outLit[b] / 5. Also ORs every sample's
 * glare into outGlare when given.
 */
export function litMask(
  scene: MaskScene,
  cx: number,
  cy: number,
  cloudsAsCircles: boolean,
  outLit: Uint8Array,
  outGlare: Uint8Array | null,
): void {
  if (outGlare) outGlare.fill(0);
  if (!scene.sunUp) {
    outLit.fill(0);
    return;
  }
  const glare = scene.glareOn && scene.nBalls > 0;
  outLit.fill(SAMPLES);
  for (let s = 0; s < SAMPLES; s++) {
    const px = cx + (SAMPLE_DX[s] as number);
    const py = cy + (SAMPLE_DY[s] as number);
    shadeMask(scene, px, py, cloudsAsCircles, sShade);
    if (!glare) {
      for (let b = 0; b < BINS; b++) outLit[b] = (outLit[b] as number) - (sShade[b] as number);
      continue;
    }
    glareMask(scene, px, py, sGlare);
    for (let b = 0; b < BINS; b++) {
      // Weight 1 − shade, or 2 in glare (glare ignores shade): base 1 is already in outLit.
      const g = sGlare[b] as number;
      outLit[b] = (outLit[b] as number) + (g === 1 ? 1 : -(sShade[b] as number));
    }
    if (outGlare) for (let b = 0; b < BINS; b++) if (sGlare[b] === 1) outGlare[b] = 1;
  }
}
