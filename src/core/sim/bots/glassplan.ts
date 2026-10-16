// v1.6 glass plan for the oracle (docs/V1_6_PLAN.md §2.3; CORE-2): which bins save the glass flakes
// in their melt windows over the next 1.6 s. Read by the oracle's glass term (bots/world.ts) and the
// Feat-seeking oracle's brittle Dare (bots/dares.ts). No allocation per call.

import { TUNING } from '../../../config/tuning.ts';
import { tanD } from '../../dmath.ts';
import { worldElevation } from '../../gen/plan.ts';
import { gatherScene, lowerBound } from '../../gen/store.ts';
import { slidingMaxCircular } from '../../gen/validator.ts';
import { BINS, createMaskScene, glareMask, shadeMask } from '../../intervals.ts';
import { PICKUP_ALIVE, type Pickup } from '../../objects.ts';
import type { SimState } from '../types.ts';

const scene = createMaskScene();
const tmp = new Uint8Array(BINS);
const mask = new Uint8Array(BINS);
const glassV = new Float64Array(BINS);
/** The glass plan looks this many 0.1 s steps ahead (the melt window is ~1.5 s long). */
const GLASS_H = 16;
/** The oracle turns this many degrees in a step (its rate × 0.1 s). */
const GLASS_TURN = Math.round(TUNING.bots.oracle.rate * TUNING.validator.stepTicks / 60);
const glassHits = new Float64Array(GLASS_H * BINS);
const glassNext = new Float64Array(BINS);
const glassWin = new Float64Array(BINS);
let glassState: SimState | null = null;
let glassTick = -1;
let glassAny = false;

/**
 * The glass value of each bin, 0..1, cached per tick: a short plan over the glass flakes' melt
 * windows. For each of the next GLASS_H 0.1 s steps, the hits of a bin are the urgency-weighted
 * glass flakes it shades at Nubs' place then (alive, 14 u < dy ≤ meltAheadSec of walking; glare bins
 * excluded; weight 1 + 4·(melt so far / budget), so the one nearest to melting leads, and every flake
 * of a cluster counts, not just the nearest); a backward DP with the oracle's turn per step gives
 * each bin the most hits a path from it can still collect, normalised to its best. Null when no glass
 * flake will be in its window within the plan.
 */
export function glassValue(s: SimState): Float64Array | null {
  if (s === glassState && s.tick === glassTick) return glassAny ? glassV : null;
  glassState = s;
  glassTick = s.tick;
  glassAny = false;
  if (s.eclipseOn || !s.sunUp) return null;
  const w = s.world;
  const ps = w.pickups;
  const y = s.nubs.y;
  const v = s.params.v;
  const dt = TUNING.validator.stepTicks / 60;
  const ahead = TUNING.pickups.meltAheadSec * v;
  const near0 = TUNING.nubs.collectRadius;
  const budget = TUNING.brittle.meltBudget;
  let i0 = lowerBound(ps, y + near0);
  let any = false;
  for (let i = i0; i < ps.length; i++) {
    const p = ps[i] as Pickup;
    if (p.y - y > ahead + GLASS_H * dt * v) break;
    if (p.brittle && p.state === PICKUP_ALIVE) any = true;
  }
  if (!any) return null;
  glassHits.fill(0);
  for (let h = 0; h < GLASS_H; h++) {
    const yh = y + (h + 1) * dt * v;
    const tick = s.tickAbs + (h + 1) * TUNING.validator.stepTicks;
    const eps = worldElevation(w, tick);
    if (eps <= 0) continue;
    const cot = 1 / tanD(eps);
    const o = h * BINS;
    i0 = lowerBound(ps, yh + near0);
    for (let i = i0; i < ps.length; i++) {
      const p = ps[i] as Pickup;
      if (p.y - yh > ahead) break;
      if (!p.brittle || p.state !== PICKUP_ALIVE || p.y - yh <= near0) continue;
      const wt = 1 + (4 * p.melt) / budget;
      gatherScene(w, scene, p.x, p.y, 1, s.tAbs + (h + 1) * dt, eps, cot);
      shadeMask(scene, p.x, p.y, false, tmp);
      glareMask(scene, p.x, p.y, mask);
      for (let b = 0; b < BINS; b++) if (tmp[b] === 1 && mask[b] === 0) glassHits[o + b] = (glassHits[o + b] as number) + wt;
      glassAny = true;
    }
  }
  if (!glassAny) return null;
  glassNext.fill(0);
  for (let h = GLASS_H - 1; h >= 0; h--) {
    slidingMaxCircular(glassNext, GLASS_TURN, glassWin);
    const o = h * BINS;
    for (let b = 0; b < BINS; b++) glassNext[b] = (glassHits[o + b] as number) + (glassWin[b] as number);
  }
  // The first planned step is reached within one turn of the bin chosen now.
  slidingMaxCircular(glassNext, GLASS_TURN, glassWin);
  let best = 0;
  for (let b = 0; b < BINS; b++) if ((glassWin[b] as number) > best) best = glassWin[b] as number;
  if (best <= 0) {
    glassAny = false;
    return null;
  }
  for (let b = 0; b < BINS; b++) glassV[b] = (glassNext[b] as number) / best;
  return glassV;
}

