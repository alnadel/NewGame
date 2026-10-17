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
import { BINS, createMaskScene, glareMask, litMask, shadeMask } from '../intervals.ts';
import { PICKUP_ALIVE, SNAP_ID_BASE, type Flare, type Pickup } from '../objects.ts';
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
/** guide.deep's own refresh (ticks): every other guide refresh. */
const DEEP_EVERY = 2 * TUNING.guide.everyTicks;
const P = TUNING.pickups;
const COLLECT = TUNING.nubs.collectRadius;

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
    // guide.deep (§2.6): the sources over the center sample are counted in litMask's own pass, on
    // every other refresh (DEEP_EVERY ticks: a dial layer and a Dare hint); between, the last deep
    // mask is kept where guide.now still holds.
    const deepOn = s.world.mech.deep;
    const count = deepOn && s.tickAbs % DEEP_EVERY === 0;
    litMask(scene, nb.x, nb.y, false, g.lit, g.glare, count ? sources : null, s.world.v16.garden ? SNAP_ID_BASE : Infinity);
    if (count) {
      for (let b = 0; b < BINS; b++) {
        const now = g.lit[b] === 0 ? 1 : 0;
        g.now[b] = now;
        g.deep[b] = now === 1 && (sources[b] as number) >= 2 ? 1 : 0;
      }
    } else if (deepOn) {
      for (let b = 0; b < BINS; b++) {
        const now = g.lit[b] === 0 ? 1 : 0;
        g.now[b] = now;
        g.deep[b] = (g.deep[b] as number) & now;
      }
    } else {
      for (let b = 0; b < BINS; b++) g.now[b] = g.lit[b] === 0 ? 1 : 0;
      g.deep.fill(0);
    }
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

/*
 * guide.deep (§2.6): bins of guide.now where two or more sources (casters, this run's sunflowers,
 * clouds; never the Cold Snap's cloud with the Garden on, T3, as computeCoverage) are over the center
 * sample; counted by litMask in updateGuide. All 0 without the deep-shade mechanic.
 */

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

const FL = TUNING.flare;
/** Lit hold ticks per bin while guide.flare is built (the sim's parry counts f > 0 on ticks [holdTick, fallTick)). */
const flareLit = new Uint8Array(BINS);
/** guide.flare's cache: the flare (−1: none) and the world and bloom count it was computed with. */
let flareFor = -1;
let flareBlooms = -1;
let flareWorld: object | null = null;

/**
 * guide.flare (§2.5): during a flare's warning, the angles that parry it held still: the bins where
 * the sun, held there through the whole hold, leaves Nubs lit on at most TUNING.flare.parryMaxLit
 * hold ticks (his scheduled position, the lifted elevation and the clouds tick by tick: the sim's
 * own parry count). The keep test kept the flare only if such a bin exists in the world as generated
 * (validator rules, which never shade more), so the arc is never empty and never names a miss
 * (fix round 2; before, a hold with no fixed parry showed its first tick's shade). This run's
 * sunflowers count; the Cold Snap's cloud does not (it re-aims as it goes, and a snap over the hold
 * parries at any angle anyway). guide.flareTicks counts the ticks to the rise. Otherwise all 0 and
 * −1. The mask is computed once per flare (HOLD ticks of lit masks) and again only when a sunflower
 * blooms.
 */
function flareGuide(s: SimState): void {
  const g = s.guide;
  if (s.flarePhase !== 1) {
    g.flare.fill(0);
    g.flareTicks = -1;
    flareFor = -1;
    return;
  }
  const w = s.world;
  const f = w.flares[s.flareIdx] as Flare;
  g.flareTicks = s.flareTicks;
  const blooms = s.stats.blooms ?? 0;
  if (f.id === flareFor && blooms === flareBlooms && w === flareWorld) return;
  flareFor = f.id;
  flareBlooms = blooms;
  flareWorld = w;
  flareLit.fill(0);
  for (let t = f.holdTick; t < f.fallTick; t++) {
    const eps = worldElevation(w, t);
    if (eps <= 0) continue;
    const y = worldYAtTick(w, t);
    const x = trailX(w.trail, y);
    gatherScene(w, scene, x, y, MARGIN, t / TICK_HZ, eps, 1 / tanD(eps), true, SNAP_ID_BASE);
    litMask(scene, x, y, false, litNext, null);
    for (let b = 0; b < BINS; b++) if ((litNext[b] as number) > 0) flareLit[b] = (flareLit[b] as number) + 1;
  }
  for (let b = 0; b < BINS; b++) g.flare[b] = (flareLit[b] as number) <= FL.parryMaxLit ? 1 : 0;
}

/** True on ticks where the guide refreshes (absolute 0.1 s grid). */
export function guideDue(s: SimState): boolean {
  return s.tickAbs % TUNING.guide.everyTicks === 0;
}
