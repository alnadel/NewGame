// Safe-arc guide masks (V1_PLAN §6.3, archive/TECH_SPEC §4 step 11): every 6 ticks, on the absolute 0.1 s
// grid shared with the validator, compute which sun azimuths fully shade Nubs now (strict: all 5
// samples shaded, no glare), 0.6 s ahead, and where glare would touch him.
//
// v1.6 dial layers (docs/V1_6_PLAN.md §4; CORE-2): guide.deep (deep shade now, the snap excluded),
// guide.flake (the bins that shade the nearest alive glass flake in its melt window) and, during a
// flare's warning, guide.flare (full shade at the flare's first hold tick) with guide.flareTicks.
//
// Elementals (docs/ELEMENTALS.md §4.8): on a Trial heroGuide fills the masks per hero instead, so
// guide.now is each hero's safe set (a duo's AND band): the single source of "safe" for the dial,
// the ghost hint and the bots.

import { TUNING } from '../../config/tuning.ts';
import { dayStartTick, dayTicks, elevation, TICK_HZ } from '../clock.ts';
import { tanD } from '../dmath.ts';
import { meltTicksOf } from '../gen/contest.ts';
import { liftElevation, liftingFlare, worldElevation, worldYAtDayTick, worldYAtTick } from '../gen/plan.ts';
import { gatherScene, lowerBound } from '../gen/store.ts';
import { eclipseAt } from '../gen/world.ts';
import { BINS, createMaskScene, glareMask, litMask, shadeMask } from '../intervals.ts';
import type { HeroId } from '../../config/heroes.ts';
import { PICKUP_ALIVE, SNAP_ID_BASE, type Flare, type Pickup } from '../objects.ts';
import { trailX } from '../trail.ts';
import { heroMask, nextTagHero, nextTagTicks } from './heroes.ts';
import { updateBudGuide, updateLandGuide } from './mechanics.ts';
import { meltBudgetOf } from './pickups.ts';
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
  if (s.trial !== null) {
    heroGuide(s);
    return;
  }
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

/** guide.flake's steps: the validator's grid, as many as a flake's melt window holds. */
const FLAKE_STEP = TUNING.validator.stepTicks;
const FLAKE_MAX_STEPS = Math.ceil((P.meltAheadSec * TICK_HZ) / FLAKE_STEP) + 2;
/** The glass flake's lit weight (0 shaded, 1 lit, 2 glare) per bin at each step of its window ahead, and the flare melt rate per step. */
const flakeRows = new Uint8Array(FLAKE_MAX_STEPS * BINS);
const flakeMul = new Float64Array(FLAKE_MAX_STEPS);
/** guide.flake's cache: the flake (−1: none), the tick of its first row, its rows, and the world and bloom count they were made with. */
let flakeFor = -1;
let flakeAt = 0;
let flakeN = 0;
let flakeBlooms = -1;
let flakeWorld: object | null = null;

/**
 * guide.flake (§2.3): for the nearest alive glass flake in its melt window, the bins where the sun,
 * held from now until Nubs reaches it, leaves it lit for less than its remaining melt budget (glare
 * ×2, a flare's rise and hold ×meltMul, as updatePickups melts it): the angles that save it, not
 * just the ones that shade it this instant (fix round 2: a one-step point mask flickered and its
 * detours often lost the flake anyway). Else all 0. The flake's rows are computed once (one point
 * mask a step of its window) and again only when a sunflower blooms.
 */
function flakeGuide(s: SimState): void {
  const g = s.guide;
  g.flake.fill(0);
  if (s.eclipseOn) return;
  const p = glassInWindow(s);
  if (!p) {
    flakeFor = -1;
    return;
  }
  const w = s.world;
  const blooms = s.stats.blooms ?? 0;
  if (p.id !== flakeFor || blooms !== flakeBlooms || w !== flakeWorld) {
    flakeFor = p.id;
    flakeBlooms = blooms;
    flakeWorld = w;
    flakeAt = s.tickAbs;
    flakeN = 0;
    for (let k = 0; k < FLAKE_MAX_STEPS; k++) {
      const t = flakeAt + k * FLAKE_STEP;
      if (p.y - worldYAtTick(w, t) <= COLLECT) break;
      const row = flakeRows.subarray(k * BINS, (k + 1) * BINS);
      const eps = worldElevation(w, t);
      if (eps <= 0) {
        row.fill(0);
      } else {
        gatherScene(w, pointScene, p.x, p.y, 1, t / TICK_HZ, eps, 1 / tanD(eps));
        shadeMask(pointScene, p.x, p.y, false, tmp);
        for (let b = 0; b < BINS; b++) row[b] = tmp[b] === 1 ? 0 : 1;
        if (pointScene.glareOn && pointScene.nBalls > 0) {
          glareMask(pointScene, p.x, p.y, tmp);
          for (let b = 0; b < BINS; b++) if (tmp[b] === 1) row[b] = 2;
        }
      }
      const f = liftingFlare(w, t);
      flakeMul[k] = f !== null && t >= f.riseTick && t < f.fallTick ? TUNING.flare.meltMul : 1;
      flakeN = k + 1;
    }
  }
  const k0 = Math.max(0, Math.round((s.tickAbs - flakeAt) / FLAKE_STEP));
  // In whole weighted lit ticks, as the sim melts it (pickups.ts): the flake is lost once they reach
  // its budget, so an angle that lights it for exactly the ticks it has left does not save it.
  const left = meltTicksOf(meltBudgetOf(s, p)) - Math.round(p.melt * TICK_HZ);
  for (let b = 0; b < BINS; b++) {
    let lit = 0;
    for (let k = k0; k < flakeN && lit < left; k++) lit += (flakeRows[k * BINS + b] as number) * (flakeMul[k] as number) * FLAKE_STEP;
    g.flake[b] = lit < left ? 1 : 0;
  }
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

const DUO_DX = TUNING.heroes.duoDx;
/** heroGuide's scratch: another body's lit sums, Drip's centre weights, a shade row and a mask. */
const heroLit = new Uint8Array(BINS);
const heroW0 = new Uint8Array(BINS);
const heroOut = new Uint8Array(BINS);

/** Drip's centre-sample weights per bin at (x, y) in the gathered scene, into heroW0 (0 shade, 1 lit, 2 glare). */
function centreWeights(x: number, y: number): void {
  shadeMask(scene, x, y, false, tmp);
  glareMask(scene, x, y, heroW0);
  for (let b = 0; b < BINS; b++) heroW0[b] = heroW0[b] === 1 ? 2 : tmp[b] === 1 ? 0 : 1;
}

/**
 * Hero `h`'s safe mask for a body at (x, y) in the gathered scene (its lit sums in `lit`, already
 * filled unless `fill`), with Volt's last strike and Drip's side (the run's own, unless given).
 */
function bodyGuide(s: SimState, h: HeroId, x: number, y: number, lit: Uint8Array, fill: boolean, out: Uint8Array, vTheta = s.voltTheta, cool = s.dripCool): void {
  if (fill) litMask(scene, x, y, false, lit, null);
  if (h === 'drip') centreWeights(x, y);
  heroMask(s, h, lit, heroW0, out, vTheta, cool);
}

/**
 * The guide on a Trial (§4.8), after the bud and land guides: the scene at the lead (a duo's at the
 * pair's midpoint, margin + duoDx); guide.lit and guide.glare at the lead's centre with today's
 * meaning; guide.lead the lead hero's safe mask, guide.mate the mate's, guide.now their AND (the
 * lead's alone without a mate); guide.next the same 0.6 s ahead; guide.tag the incoming hero's mask
 * (from the lead's lit sums, its state reset) during a TAG's telegraph. Volt's masks leave out its
 * dead zone; Drip's read its centre sample and side. A Blaze or a Cloudburst does not change them
 * (they show where the light is). deep, flake and flare stay 0 (a Trial has no deep shade, glass or
 * flares), and a Trial ends before night.
 */
function heroGuide(s: SimState): void {
  const g = s.guide;
  g.tag.fill(0);
  const nb = s.nubs;
  const m = s.mate;
  const w = s.world;
  const margin = m !== null ? MARGIN + DUO_DX : MARGIN;
  const px = m !== null ? nb.x + DUO_DX : nb.x;
  gatherScene(w, scene, px, nb.y, margin, s.tAbs, s.eps, s.cot);
  litMask(scene, nb.x, nb.y, false, g.lit, g.glare);
  bodyGuide(s, nb.hero, nb.x, nb.y, g.lit, false, g.lead);
  const to = nextTagHero(s);
  const n = nextTagTicks(s);
  if (to !== null && n >= 0 && n <= TUNING.heroes.tagSoonTicks) bodyGuide(s, to, nb.x, nb.y, g.lit, false, g.tag, -1, true);
  if (m !== null) {
    bodyGuide(s, m.hero, m.x, m.y, heroLit, true, g.mate);
    for (let b = 0; b < BINS; b++) g.now[b] = (g.lead[b] as number) & (g.mate[b] as number);
  } else {
    g.mate.fill(0);
    g.now.set(g.lead);
  }
  const t = s.dayTick + AHEAD;
  if (t >= dayTicks(s.day)) {
    g.next.fill(0);
    return;
  }
  const y = worldYAtDayTick(w, s.day, t);
  const x = trailX(w.trail, y);
  const eps = liftElevation(w, s.params, dayStartTick(s.day) + t, elevation(s.params, t / TICK_HZ));
  gatherScene(w, scene, x, y, margin, s.tAbs + AHEAD / TICK_HZ, eps, 1 / tanD(eps));
  bodyGuide(s, nb.hero, m !== null ? x - DUO_DX : x, y, heroLit, true, g.next);
  if (m === null) return;
  bodyGuide(s, m.hero, x + DUO_DX, y, heroLit, true, heroOut);
  for (let b = 0; b < BINS; b++) g.next[b] = (g.next[b] as number) & (heroOut[b] as number);
}
