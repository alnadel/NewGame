// Safe-arc guide masks (V1_PLAN §6.3, archive/TECH_SPEC §4 step 11): every 6 ticks, on the absolute 0.1 s
// grid shared with the validator, compute which sun azimuths fully shade Nubs now (strict: all 5
// samples shaded, no glare), 0.6 s ahead, and where glare would touch him.

import { TUNING } from '../../config/tuning.ts';
import { dayTicks, elevation, TICK_HZ, yAtDayTick } from '../clock.ts';
import { tanD } from '../dmath.ts';
import { gatherScene } from '../gen/store.ts';
import { BINS, createMaskScene, litMask } from '../intervals.ts';
import { trailX } from '../trail.ts';
import type { SimState } from './types.ts';

const scene = createMaskScene();
const litNext = new Uint8Array(BINS);
const MARGIN = TUNING.nubs.sampleOffset + 1;
const AHEAD = Math.round(TUNING.guide.aheadSec * TICK_HZ);

/** Recomputes the guide masks at the current state. */
export function updateGuide(s: SimState): void {
  const g = s.guide;
  g.tick = s.tick;
  g.sunUp = s.sunUp;
  if (!s.sunUp) {
    g.now.fill(0);
    g.next.fill(0);
    g.glare.fill(0);
    g.lit.fill(0);
    return;
  }
  const nb = s.nubs;
  gatherScene(s.world, scene, nb.x, nb.y, MARGIN, s.tAbs, s.eps, s.cot);
  litMask(scene, nb.x, nb.y, false, g.lit, g.glare);
  for (let b = 0; b < BINS; b++) g.now[b] = g.lit[b] === 0 ? 1 : 0;

  // 0.6 s ahead: Nubs' position, the elevation and the clouds then (still today's daylight only).
  const t = s.dayTick + AHEAD;
  if (t >= dayTicks(s.day)) {
    g.next.fill(0);
    return;
  }
  const y = yAtDayTick(s.day, t);
  const x = trailX(s.world.trail, y);
  const eps = elevation(s.params, t / TICK_HZ);
  gatherScene(s.world, scene, x, y, MARGIN, s.tAbs + AHEAD / TICK_HZ, eps, 1 / tanD(eps));
  litMask(scene, x, y, false, litNext, null);
  for (let b = 0; b < BINS; b++) g.next[b] = litNext[b] === 0 ? 1 : 0;
}

/** True on ticks where the guide refreshes (absolute 0.1 s grid). */
export function guideDue(s: SimState): boolean {
  return s.tickAbs % TUNING.guide.everyTicks === 0;
}
