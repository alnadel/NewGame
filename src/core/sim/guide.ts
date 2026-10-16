// Safe-arc guide masks (V1_PLAN §6.3, archive/TECH_SPEC §4 step 11): every 6 ticks, on the absolute 0.1 s
// grid shared with the validator, compute which sun azimuths fully shade Nubs now (strict: all 5
// samples shaded, no glare), 0.6 s ahead, and where glare would touch him.
//
// v1.6 dial layers (docs/V1_6_PLAN.md §4; CORE-2): guide.deep (deep shade now, the snap excluded),
// guide.flake (the bins that shade the nearest alive glass flake in its melt window) and, during a
// flare's warning, guide.flare (full shade at the flare's first hold tick) with guide.flareTicks.

import { TUNING } from '../../config/tuning.ts';
import { dayStartTick, dayTicks, elevation, TICK_HZ } from '../clock.ts';
import { tanD } from '../dmath.ts';
import { liftElevation, worldElevation, worldYAtDayTick, worldYAtTick } from '../gen/plan.ts';
import { gatherScene, lowerBound } from '../gen/store.ts';
import { eclipseAt } from '../gen/world.ts';
import { BINS, createMaskScene, glareMask, litMask, markCaster, markEllipse, shadeMask } from '../intervals.ts';
import { PICKUP_ALIVE, SNAP_ID_BASE, type Caster, type Flare, type Pickup } from '../objects.ts';
import { trailX } from '../trail.ts';
import { updateBudGuide, updateLandGuide } from './mechanics.ts';
import type { SimState } from './types.ts';

const scene = createMaskScene();
const pointScene = createMaskScene();
const litNext = new Uint8Array(BINS);
const tmp = new Uint8Array(BINS);
const sources = new Uint8Array(BINS);
const MARGIN = TUNING.nubs.sampleOffset + 1;
const AHEAD = Math.round(TUNING.guide.aheadSec * TICK_HZ);
const P = TUNING.pickups;
const COLLECT = TUNING.nubs.collectRadius;
/** Floats per cloud in MaskScene.clouds (intervals.ts). */
const CLOUD_STRIDE = 6;

/** Recomputes the guide masks at the current state. */
export function updateGuide(s: SimState): void {
  const g = s.guide;
  g.tick = s.tick;
  g.sunUp = s.sunUp;
  updateBudGuide(s);
  // v1.6 Garden (CORE-1): the landing mask at the snap's end.
  updateLandGuide(s);
  if (!s.sunUp) {
    g.now.fill(0);
    g.next.fill(0);
    g.glare.fill(0);
    g.lit.fill(0);
    g.deep.fill(0);
    g.flake.fill(0);
    g.flare.fill(0);
    g.flareTicks = -1;
    return;
  }
  const nb = s.nubs;
  if (s.eclipseOn) {
    // The eclipse shades everything: every angle is safe now (and none of it is deep).
    g.lit.fill(0);
    g.glare.fill(0);
    g.now.fill(1);
    g.deep.fill(0);
  } else {
    gatherScene(s.world, scene, nb.x, nb.y, MARGIN, s.tAbs, s.eps, s.cot);
    litMask(scene, nb.x, nb.y, false, g.lit, g.glare);
    for (let b = 0; b < BINS; b++) g.now[b] = g.lit[b] === 0 ? 1 : 0;
    deepGuide(s);
  }
  flakeGuide(s);
  flareGuide(s);
  nextGuide(s);
}

/** guide.next: 0.6 s ahead (Nubs' position, the elevation and the clouds then; today's daylight only). */
function nextGuide(s: SimState): void {
  const g = s.guide;
  const t = s.dayTick + AHEAD;
  if (t >= dayTicks(s.day)) {
    g.next.fill(0);
    return;
  }
  if (eclipseAt(s.world, dayStartTick(s.day) + t)) {
    g.next.fill(1);
    return;
  }
  const y = worldYAtDayTick(s.world, s.day, t);
  const x = trailX(s.world.trail, y);
  const eps = liftElevation(s.world, s.params, dayStartTick(s.day) + t, elevation(s.params, t / TICK_HZ));
  gatherScene(s.world, scene, x, y, MARGIN, s.tAbs + AHEAD / TICK_HZ, eps, 1 / tanD(eps));
  litMask(scene, x, y, false, litNext, null);
  for (let b = 0; b < BINS; b++) g.next[b] = litNext[b] === 0 ? 1 : 0;
}

/**
 * guide.deep (§2.6): bins of guide.now where two or more sources (casters, this run's sunflowers,
 * clouds; never the Cold Snap's cloud) are over the center sample. Reads the scene updateGuide just
 * gathered at Nubs. All 0 without the deep-shade mechanic.
 */
function deepGuide(s: SimState): void {
  const g = s.guide;
  g.deep.fill(0);
  if (!s.world.mech.deep) return;
  const x = s.nubs.x;
  const y = s.nubs.y;
  sources.fill(0);
  for (let i = 0; i < scene.nCasters; i++) {
    tmp.fill(0);
    markCaster(tmp, scene.casters[i] as Caster, x, y, scene.cot);
    for (let b = 0; b < BINS; b++) sources[b] = (sources[b] as number) + (tmp[b] as number);
  }
  const cl = scene.clouds;
  for (let i = 0; i < scene.nClouds; i++) {
    const o = i * CLOUD_STRIDE;
    if ((cl[o + 4] as number) >= SNAP_ID_BASE) continue;
    tmp.fill(0);
    markEllipse(tmp, x, y, cl[o + 5] as number, cl[o] as number, cl[o + 1] as number, cl[o + 2] as number, cl[o + 3] as number);
    for (let b = 0; b < BINS; b++) sources[b] = (sources[b] as number) + (tmp[b] as number);
  }
  for (let b = 0; b < BINS; b++) if (g.now[b] === 1 && (sources[b] as number) >= 2) g.deep[b] = 1;
}

/**
 * The nearest alive glass flake ahead of Nubs in its melt window (14 u < dy ≤ meltAheadSec of
 * walking), or null.
 */
export function glassInWindow(s: SimState): Pickup | null {
  const ps = s.world.pickups;
  const y = s.nubs.y;
  const ahead = P.meltAheadSec * s.params.v;
  for (let i = lowerBound(ps, y + COLLECT); i < ps.length; i++) {
    const p = ps[i] as Pickup;
    if (p.y - y > ahead) break;
    if (p.brittle && p.state === PICKUP_ALIVE && p.y - y > COLLECT) return p;
  }
  return null;
}

/** guide.flake (§2.3): the bins that shade the nearest alive glass flake in its melt window, glare bins removed; else all 0. */
function flakeGuide(s: SimState): void {
  const g = s.guide;
  g.flake.fill(0);
  if (s.eclipseOn) return;
  const p = glassInWindow(s);
  if (!p) return;
  gatherScene(s.world, pointScene, p.x, p.y, 1, s.tAbs, s.eps, s.cot);
  shadeMask(pointScene, p.x, p.y, false, g.flake);
  glareMask(pointScene, p.x, p.y, tmp);
  for (let b = 0; b < BINS; b++) if (tmp[b] === 1) g.flake[b] = 0;
}

/**
 * guide.flare (§2.5): during a flare's warning, the bins of full shade at Nubs' scheduled position,
 * the lifted elevation and the clouds of the flare's first hold tick; guide.flareTicks counts the
 * ticks to its rise. Otherwise all 0 and −1.
 */
function flareGuide(s: SimState): void {
  const g = s.guide;
  if (s.flarePhase !== 1) {
    g.flare.fill(0);
    g.flareTicks = -1;
    return;
  }
  const w = s.world;
  const f = w.flares[s.flareIdx] as Flare;
  g.flareTicks = s.flareTicks;
  const t = f.holdTick;
  const y = worldYAtTick(w, t);
  const x = trailX(w.trail, y);
  const eps = worldElevation(w, t);
  if (eps <= 0) {
    g.flare.fill(0);
    return;
  }
  gatherScene(w, scene, x, y, MARGIN, t / TICK_HZ, eps, 1 / tanD(eps));
  litMask(scene, x, y, false, litNext, null);
  for (let b = 0; b < BINS; b++) g.flare[b] = litNext[b] === 0 ? 1 : 0;
}

/** True on ticks where the guide refreshes (absolute 0.1 s grid). */
export function guideDue(s: SimState): boolean {
  return s.tickAbs % TUNING.guide.everyTicks === 0;
}
