// Cheap snapshots for render interpolation (archive/TECH_SPEC §9.1): the loop snapshots the state before
// each step; the renderer blends (prev, curr) by the accumulator fraction so 90/120 Hz screens stay
// smooth while the sim runs at 60 Hz.

import { angleDiff, cosD, sinD, tanD, wrapDeg } from '../dmath.ts';
import type { Phase, SimState } from './types.ts';

export interface RenderSnap {
  tick: number;
  tAbs: number;
  day: number;
  dayTick: number;
  phase: Phase;
  nubsX: number;
  nubsY: number;
  /** Sun azimuth θ (°) and vector u. */
  theta: number;
  ux: number;
  uy: number;
  /** Elevation ε (°), tan ε and cot ε (0 at night). */
  eps: number;
  tanEps: number;
  cot: number;
  chill: number;
  f: number;
  mult: number;
  /** s.relayIdx: a TAG changes the hero and resets the meter (never blended across). */
  relay: number;
}

export function createSnap(): RenderSnap {
  return { tick: 0, tAbs: 0, day: 1, dayTick: 0, phase: 'hold', nubsX: 0, nubsY: 0, theta: 0, ux: 1, uy: 0, eps: 0, tanEps: 0, cot: 0, chill: 0, f: 0, mult: 1, relay: 0 };
}

export function takeSnap(s: SimState, out: RenderSnap): void {
  out.tick = s.tick;
  out.tAbs = s.tAbs;
  out.day = s.day;
  out.dayTick = s.dayTick;
  out.phase = s.phase;
  out.nubsX = s.nubs.x;
  out.nubsY = s.nubs.y;
  out.theta = s.sun.theta;
  out.ux = s.ux;
  out.uy = s.uy;
  out.eps = s.eps;
  out.tanEps = s.tanEps;
  out.cot = s.cot;
  out.chill = s.nubs.chill;
  out.f = s.nubs.f;
  out.mult = s.nubs.mult;
  out.relay = s.relayIdx;
}

/**
 * Blends two snapshots: positions, time, Chill and ε linearly; θ along the short arc. Discrete
 * fields (day, phase, mult, relay) come from `b`, and so does Chill across a TAG (another element's meter).
 * Shadows should be rebuilt from out.ux/uy/cot.
 */
export function lerpSnap(a: RenderSnap, b: RenderSnap, alpha: number, out: RenderSnap): void {
  const t = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
  out.tick = b.tick;
  out.day = b.day;
  out.dayTick = b.dayTick;
  out.phase = b.phase;
  out.mult = b.mult;
  out.relay = b.relay;
  out.tAbs = a.tAbs + (b.tAbs - a.tAbs) * t;
  out.nubsX = a.nubsX + (b.nubsX - a.nubsX) * t;
  out.nubsY = a.nubsY + (b.nubsY - a.nubsY) * t;
  out.chill = a.relay === b.relay ? a.chill + (b.chill - a.chill) * t : b.chill;
  out.f = a.f + (b.f - a.f) * t;
  out.theta = wrapDeg(a.theta + angleDiff(b.theta, a.theta) * t);
  out.ux = cosD(out.theta);
  out.uy = sinD(out.theta);
  // Across sunset/sunrise use the newer elevation instead of blending through the night value 0.
  out.eps = a.eps > 0 && b.eps > 0 ? a.eps + (b.eps - a.eps) * t : b.eps;
  out.tanEps = out.eps > 0 ? tanD(out.eps) : 0;
  out.cot = out.eps > 0 ? 1 / out.tanEps : 0;
}
