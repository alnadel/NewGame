// v1.6 economy terms of the bots (docs/V1_6_PLAN.md §2.1, §2.2, §2.4; CORE-1 owns this file):
// the reactive bot's fresh-SWING preference and policies (plain, chase, naive, safe), its snap rule
// (panic or plan, the overflow charge, the Garden's gold and guide.land) and the oracle's snap and
// landing terms. bots.ts calls these hooks at fixed points with the bot's BotOptions; every term
// keys off the world's v1.6 rules (World.v16), so `sim --off` measures the bots without them.
// No allocation per call.

import { TUNING } from '../../../config/tuning.ts';
import { dayStartTick, dayTicks, minutesOfDay } from '../../clock.ts';
import { tanD } from '../../dmath.ts';
import { keptFlares, worldElevation, worldYAtDayTick } from '../../gen/plan.ts';
import { lowerBound } from '../../gen/store.ts';
import { BINS, binOf, markCaster } from '../../intervals.ts';
import type { Caster, Flare } from '../../objects.ts';
import { casterReach, distToCasterBounds, shadowLength } from '../../shadows.ts';
import { trailX } from '../../trail.ts';
import type { BotHookCtx } from '../bots.ts';
import type { SimState } from '../types.ts';

const RB = TUNING.bots.reactive;
const OB = TUNING.bots.oracle;
const MAX_R = TUNING.world.maxCasterRadius;

/** The economy bots' constants (tooling only: they shape the bots, never the game). */
export const ECON_BOTS = Object.freeze({
  /** Reactive, ring on: +freshBonus on now-safe bins shaded by a source that was not an end of the last SWING, while Chill ≥ freshChill. */
  freshBonus: 0.5,
  freshChill: 60,
  /** chase/naive: any gold bin is worth chaseGold (a safe bin is nowWeight + nextWeight = 3) while Chill ≥ chaseChill… */
  chaseGold: 3.5,
  chaseChill: 45,
  /** …chase only outside 9:20 AM-2:40 PM (minutes after 6:00 AM). */
  chaseFrom: 200,
  chaseTo: 520,
  /** Bank on: spend an overflow charge at frostH ≥ overflowH, only when lit with Chill < overflowChill. */
  overflowH: 190,
  overflowChill: 70,
  /** 'plan' snaps at a gap's mouth: no now ∪ next bin within ±planNearDeg, ring ≥ x planMult. */
  planNearDeg: 45,
  planMult: 3,
  /** …lit, and only below planChill (a full tank swings out of a gap instead). */
  planChill: 50,
  /** Garden: under a snap the reactive bot scores gold only, then guide.land for the last landTicks. */
  landTicks: 36,
  /** …aiming up to landDepth° inside a guide.land arc, +ownLand where a sunflower bloomed under this snap shades the landing spot. */
  landDepth: 15,
  ownLand: 8,
  /** …and +landNext where guide.next (already past the snap's end in its last 0.6 s) is shaded too. */
  landNext: 10,
  /** Oracle under a Garden snap: the bud bonus reaches oracleBudReach°; guide.land bins get oracleLandBonus in the last landTicks. */
  oracleBudReach: 180,
  oracleLandBonus: 12,
  oracleLandReach: 150,
  /** …and on now-safe bins for afterSnapTicks after the snap ends. */
  afterSnapTicks: 40,
  /** Oracle, Bank on: keeps a charge for the next kept flare of lift ≥ flareD (looked for flareAheadTicks ahead) while it has fewer than two. */
  flareD: 8,
  flareAheadTicks: 1800,
});
const E = ECON_BOTS;

/** True when a Cold Snap can be cast this tick (same rule as bots.ts). */
function snapReady(s: SimState): boolean {
  return s.world.mech.snap && s.nubs.frost >= 1 && s.snapTicks === 0 && s.phase === 'day' && s.sunUp && s.ready === 0;
}

/**
 * True while a chase/naive policy chases gold (and, for CORE-2's glass term, glass): 'chase' (timed
 * greed) while Chill ≥ chaseChill and only outside 9:20 AM-2:40 PM; 'naive' always (no timing of
 * either kind). False for 'plain' and 'safe'.
 */
export function econChasing(ctx: BotHookCtx, s: SimState): boolean {
  const p = ctx.opts.policy;
  if (!ctx.mech || (p !== 'chase' && p !== 'naive')) return false;
  // Naive greed has no timing at all: neither the hour nor the tank.
  if (p === 'naive') return true;
  if (s.nubs.chill < E.chaseChill) return false;
  const m = minutesOfDay(s.day, s.dayTick);
  return m < E.chaseFrom || m > E.chaseTo;
}

// Nearest caster shading Nubs' center sample, per bin (bots only).
const srcBins = new Int32Array(BINS);
const srcDist = new Float64Array(BINS);
const srcMask = new Uint8Array(BINS);

/** srcBins[b] = the nearest caster shading Nubs' center sample with the sun at b° (−1 none; clouds are not looked at). */
function binSources(s: SimState): void {
  srcBins.fill(-1);
  srcDist.fill(Infinity);
  if (!s.sunUp) return;
  const w = s.world;
  const x = s.nubs.x;
  const y = s.nubs.y;
  const cot = s.cot;
  const reach = shadowLength(w.maxZ, cot);
  const cs = w.casters;
  for (let i = lowerBound(cs, y - reach - MAX_R); i < cs.length; i++) {
    const c = cs[i] as Caster;
    if (c.y > y + reach + MAX_R) break;
    if (distToCasterBounds(c, x, y) > casterReach(c, cot)) continue;
    srcMask.fill(0);
    markCaster(srcMask, c, x, y, cot);
    const d = (c.x - x) * (c.x - x) + (c.y - y) * (c.y - y);
    for (let b = 0; b < BINS; b++) {
      if (srcMask[b] === 1 && d < (srcDist[b] as number)) {
        srcDist[b] = d;
        srcBins[b] = c.id;
      }
    }
  }
}

/** The two ends of the last SWING (−1 when none). */
function lastEnds(s: SimState, out: Int32Array): void {
  const nb = s.nubs;
  const n = nb.swFreshN;
  const slots = TUNING.ring.freshSlots;
  out[0] = n >= 1 ? (nb.swFresh[2 * ((n - 1) % slots)] as number) : -1;
  out[1] = n >= 2 ? (nb.swFresh[2 * ((n - 2) % slots)] as number) : -1;
}
const ends = new Int32Array(2);

const depth = new Float64Array(BINS);

/** out[b] = 1 where a sunflower bloomed under this snap shades Nubs' center at the snap's end (his scheduled spot, ε then). */
function ownLandBins(s: SimState, out: Uint8Array): void {
  out.fill(0);
  const n = Math.min(s.snapBlooms, s.snapBloomIds.length);
  if (n === 0) return;
  const w = s.world;
  const t = s.dayTick + s.snapTicks;
  if (t >= dayTicks(s.day)) return;
  const eps = worldElevation(w, dayStartTick(s.day) + t);
  if (eps <= 0) return;
  const y = worldYAtDayTick(w, s.day, t);
  const x = trailX(w.trail, y);
  const cot = 1 / tanD(eps);
  for (let i = 0; i < n; i++) {
    const c = w.byId.get(s.snapBloomIds[i] as number);
    if (c) markCaster(out, c, x, y, cot);
  }
}

/** out[b] = distance (bins) from b to the nearest bin outside `mask` (0 outside it; BINS when the mask is full). */
function landDepth(mask: Uint8Array, out: Float64Array): void {
  let full = true;
  for (let b = 0; b < BINS; b++) {
    out[b] = mask[b] === 1 ? BINS : 0;
    if (mask[b] !== 1) full = false;
  }
  if (full) return;
  for (let pass = 0; pass < 2; pass++) {
    for (let b = 0; b < BINS; b++) {
      const p = out[(b + BINS - 1) % BINS] as number;
      if (p + 1 < (out[b] as number)) out[b] = p + 1;
    }
    for (let b = BINS - 1; b >= 0; b--) {
      const n = out[(b + 1) % BINS] as number;
      if (n + 1 < (out[b] as number)) out[b] = n + 1;
    }
  }
}

/** Reactive bot, each guide refresh: add economy terms to `score` (360 bins, already holding now/next/gold). */
export function econReactiveScore(ctx: BotHookCtx, s: SimState, score: Float64Array): void {
  if (!ctx.mech) return;
  const w = s.world;
  const g = s.guide;
  // Garden: under the snap every angle is safe; grow gold, then line up the landing.
  if (w.v16.garden && s.snapTicks > 0) {
    let gold = false;
    if (s.snapTicks > E.landTicks) for (let b = 0; b < BINS && !gold; b++) if (g.bud[b] === 1) gold = true;
    if (gold) {
      for (let b = 0; b < BINS; b++) score[b] = g.bud[b] as number;
      return;
    }
    // The landing: land well inside a guide.land arc (its edge slides away as Nubs walks on).
    landDepth(g.land, depth);
    ownLandBins(s, srcMask);
    // In the snap's last 0.6 s guide.next already looks past its end: land where the shade lasts.
    for (let b = 0; b < BINS; b++) {
      if (g.land[b] !== 1) {
        score[b] = 0;
        continue;
      }
      score[b] = Math.min(depth[b] as number, E.landDepth) + (g.next[b] === 1 ? E.landNext : 0) + (srcMask[b] === 1 ? E.ownLand : 0);
    }
    return;
  }
  const policy = ctx.opts.policy ?? 'plain';
  const spare = s.nubs.chill >= RB.budChill;
  if (policy === 'safe') {
    // Never chases gold: take back the v1.5 gold term.
    for (let b = 0; b < BINS; b++) if (g.bud[b] === 1 && (g.now[b] === 1 || spare)) score[b] = (score[b] as number) - RB.budWeight;
  } else if (econChasing(ctx, s)) {
    // Gold outweighs safe arcs: every gold bin is worth chaseGold (on top of its own now/next).
    for (let b = 0; b < BINS; b++) {
      if (g.bud[b] !== 1) continue;
      const had = g.now[b] === 1 || spare ? RB.budWeight : 0;
      score[b] = (score[b] as number) + E.chaseGold - had;
    }
  }
  // Ring: prefer safe shade from a source that is not an end of the last SWING (a fresh SWING).
  if (w.v16.ring && s.nubs.chill >= E.freshChill) {
    binSources(s);
    lastEnds(s, ends);
    for (let b = 0; b < BINS; b++) {
      const src = srcBins[b] as number;
      if (g.now[b] === 1 && src >= 0 && src !== ends[0] && src !== ends[1]) score[b] = (score[b] as number) + E.freshBonus;
    }
  }
}

/** True when some bin within ±deg of θ is set in now or next. */
function safeNearEither(s: SimState, deg: number): boolean {
  const b0 = binOf(s.sun.theta);
  const g = s.guide;
  for (let k = -deg; k <= deg; k++) {
    const b = (b0 + k + BINS) % BINS;
    if (g.now[b] === 1 || g.next[b] === 1) return true;
  }
  return false;
}

/** Reactive bot, every tick: whether to cast a snap (`snap` is the v1.5 panic rule's answer). */
export function econReactiveSnap(ctx: BotHookCtx, s: SimState, snap: boolean): boolean {
  if (!ctx.mech || snap || !snapReady(s)) return snap;
  const nb = s.nubs;
  // 'plan': snap at the mouth of a gap while the ring is worth cashing.
  if (ctx.opts.snap === 'plan' && nb.mult >= E.planMult && nb.f > 0 && nb.chill < E.planChill && !safeNearEither(s, E.planNearDeg)) return true;
  // Bank: an overflowing meter spends a charge when lit and not comfortable.
  if (s.world.v16.bank && nb.frostH >= E.overflowH && nb.f > 0 && nb.chill < E.overflowChill) return true;
  return false;
}

// Oracle: gold distance under a Garden snap (cached per plan tick).
const goldDist = new Float64Array(BINS);
let goldTick = -1;
let goldAny = false;
let goldState: SimState | null = null;

/** goldDist[b] = circular distance (bins) to the nearest gold bin; false when there is none. */
function goldDistances(s: SimState): boolean {
  if (goldTick === s.tick && goldState === s) return goldAny;
  goldTick = s.tick;
  goldState = s;
  goldAny = distToSet(s.guide.bud, goldDist);
  return goldAny;
}

/** Per oracle: the tick its last snap ended (the landing window it plans for). */
const oracleSnapEnd = new WeakMap<BotHookCtx, { on: boolean; end: number }>();

/** Oracle, each plan: a bonus (Chill units) for bin `b` with this slack, added to its value. */
export function econOracleBonus(ctx: BotHookCtx, s: SimState, b: number, slack: number): number {
  if (!ctx.mech || !s.world.v16.garden) return 0;
  let st = oracleSnapEnd.get(ctx);
  if (!st) {
    st = { on: false, end: -1e9 };
    oracleSnapEnd.set(ctx, st);
  }
  if (s.snapTicks <= 0) {
    if (st.on) {
      st.on = false;
      st.end = s.tick;
    }
    // The landing: head for (and stay in) the shade that takes over from the snap.
    return s.tick - st.end <= E.afterSnapTicks ? landPull(s, s.guide.now, b) : 0;
  }
  st.on = true;
  let v = 0;
  // The bud bonus reaches oracleBudReach° under the snap (bots.ts already pays it within budReachDeg).
  if (slack >= OB.budSlack && goldDistances(s)) {
    const d = goldDist[b] as number;
    const wide = d < E.oracleBudReach ? OB.budBonus * (1 - d / E.oracleBudReach) : 0;
    const base = d < OB.budReachDeg ? OB.budBonus * (1 - d / OB.budReachDeg) : 0;
    if (wide > base) v += wide - base;
  }
  if (s.snapTicks <= E.landTicks) v += landPull(s, s.guide.land, b);
  return v;
}

// Oracle: distance to the landing shade (guide.land in the snap's last landTicks, guide.now after it)
// and depth inside it, cached per plan tick.
const landDist = new Float64Array(BINS);
const landIn = new Float64Array(BINS);
let landTick = -1;
let landState: SimState | null = null;
let landAny = false;

/**
 * The landing pull on bin b: up to oracleLandBonus well inside the shade of `mask` (landDepth° or
 * more from its edge), fading outside it to 0 oracleLandReach° away (the plan's one-step reach still
 * feels the slope).
 */
function landPull(s: SimState, mask: Uint8Array, b: number): number {
  if (landTick !== s.tick || landState !== s) {
    landTick = s.tick;
    landState = s;
    landAny = distToSet(mask, landDist);
    if (landAny) landDepth(mask, landIn);
  }
  if (!landAny) return 0;
  const d = landDist[b] as number;
  if (d > 0) return d < E.oracleLandReach ? 0.5 * E.oracleLandBonus * (1 - d / E.oracleLandReach) : 0;
  return E.oracleLandBonus * (0.5 + (0.5 * Math.min(landIn[b] as number, E.landDepth)) / E.landDepth);
}

/** out[b] = circular distance (bins) from b to the nearest set bin of `mask`; false when none is set. */
function distToSet(mask: Uint8Array, out: Float64Array): boolean {
  let any = false;
  for (let b = 0; b < BINS; b++) {
    out[b] = mask[b] === 1 ? 0 : BINS;
    if (mask[b] === 1) any = true;
  }
  if (!any) return false;
  for (let pass = 0; pass < 2; pass++) {
    for (let b = 0; b < BINS; b++) {
      const p = out[(b + BINS - 1) % BINS] as number;
      if (p + 1 < (out[b] as number)) out[b] = p + 1;
    }
    for (let b = BINS - 1; b >= 0; b--) {
      const n = out[(b + 1) % BINS] as number;
      if (n + 1 < (out[b] as number)) out[b] = n + 1;
    }
  }
  return true;
}

const flareBuf: Flare[] = [];

/** Oracle, each plan: whether to snap next tick (`snap` is the v1.5 rule's answer, `slack` the best bin's). */
export function econOracleSnap(ctx: BotHookCtx, s: SimState, snap: boolean, slack: number): boolean {
  if (!ctx.mech || !s.world.v16.bank || !snapReady(s)) return snap;
  const nb = s.nubs;
  // Keep a charge for the next big kept flare while holding fewer than two (never at the cost of a
  // negative slack); in its rise and hold, spend one when lit.
  if (s.world.v16.flares) {
    const n = keptFlares(s.world, s.tickAbs, s.tickAbs + E.flareAheadTicks, flareBuf);
    let big = false;
    for (let i = 0; i < n; i++) if ((flareBuf[i] as Flare).d >= E.flareD) big = true;
    flareBuf.length = 0;
    if (big && (s.flarePhase === 2 || s.flarePhase === 3) && nb.f > 0) return true;
    if (big && snap && slack >= 0 && nb.frostH < 2 * TUNING.bank.costH) return false;
  }
  if (!snap && nb.frostH >= E.overflowH && nb.f > 0) return true;
  return snap;
}
