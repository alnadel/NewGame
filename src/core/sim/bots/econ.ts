// v1.6 economy terms of the bots (docs/V1_6_PLAN.md §2.1, §2.2, §2.4; CORE-1 owns this file):
// the reactive bot's fresh-SWING preference and policies (plain, chase, naive, safe), its snap rule
// (panic or plan, the overflow charge, the Garden's gold and guide.land) and the oracle's snap and
// landing terms. bots.ts calls these hooks at fixed points with the bot's BotOptions; every term
// keys off the world's v1.6 rules (World.v16), so `sim --off` measures the bots without them.
// No allocation per call. The constants are plain module constants (tooling only: they shape the
// bots, never the game) so the bundle inlines them.

import { TUNING } from '../../../config/tuning.ts';
import { dayStartTick, dayTicks, DT, minutesOfDay } from '../../clock.ts';
import { tanD } from '../../dmath.ts';
import { keptFlares, noonHeatAt, worldElevation, worldYAtDayTick } from '../../gen/plan.ts';
import { effectiveDrain } from '../nubs.ts';
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

/** Reactive, ring on: +FRESH_BONUS on now-safe bins shaded by a source that is not an end of the last SWING, while Chill ≥ FRESH_CHILL. */
const FRESH_BONUS = 0.5;
const FRESH_CHILL = 60;
/** chase/naive: any gold bin is worth CHASE_GOLD (a safe bin is nowWeight + nextWeight = 3); chase while Chill ≥ CHASE_CHILL… */
const CHASE_GOLD = 3.5;
const CHASE_CHILL = 45;
/** …and outside 9:20 AM-2:40 PM (minutes after 6:00 AM). */
const CHASE_FROM = 200;
const CHASE_TO = 520;
/** Bank on: spend an overflow charge at frostH ≥ OVERFLOW_H, only when lit (reactive: with Chill < OVERFLOW_CHILL). */
const OVERFLOW_H = 190;
const OVERFLOW_CHILL = 70;
/** 'plan' snaps at a gap's mouth: lit, ring ≥ x PLAN_MULT, Chill < PLAN_CHILL, no now ∪ next bin within ±PLAN_NEAR°. */
const PLAN_NEAR = 45;
const PLAN_MULT = 3;
const PLAN_CHILL = 50;
/** Garden: under a snap the reactive bot scores gold only, then guide.land for the last LAND_TICKS… */
const LAND_TICKS = 36;
/** …up to LAND_DEPTH° inside a land arc, +LAND_NEXT where guide.next agrees, +OWN_LAND where this snap's sunflower shades the spot. */
const LAND_DEPTH = 15;
const LAND_NEXT = 10;
const OWN_LAND = 8;
/** Oracle under a Garden snap: the bud bonus reaches ORACLE_BUD_REACH°; a landing pull of up to ORACLE_LAND fading over ORACLE_LAND_REACH°… */
const ORACLE_BUD_REACH = 180;
const ORACLE_LAND = 12;
const ORACLE_LAND_REACH = 150;
/** …on guide.land in the snap's last LAND_TICKS and on guide.now for AFTER_SNAP ticks after it. */
const AFTER_SNAP = 40;
/** Oracle, Bank and flares on: holding two charges, it keeps one for a kept flare of lift ≥ FLARE_D and casts it in the rise or hold when lit. */
const FLARE_D = 8;
/** Oracle, Bank on, outside the Journey: snaps before the red when this drain would cross coolChill + ORACLE_RED_MARGIN within ORACLE_RED_STEPS plan steps while its slack is under ORACLE_RED_SLACK. */
const ORACLE_RED_STEPS = 2;
const ORACLE_RED_SLACK = 20;
const ORACLE_RED_MARGIN = 2;
const STEP_TICKS = TUNING.validator.stepTicks;

/** True when a Cold Snap can be cast this tick (same rule as bots.ts). */
function snapReady(s: SimState): boolean {
  return s.world.mech.snap && s.nubs.frost >= 1 && s.snapTicks === 0 && s.phase === 'day' && s.sunUp && s.ready === 0;
}

/**
 * True while a chase/naive policy chases gold (and, for CORE-2's glass term, glass): 'chase' (timed
 * greed) while Chill ≥ 45 and only outside 9:20 AM-2:40 PM; 'naive' always (no timing of either
 * kind). False for 'plain' and 'safe'.
 */
export function econChasing(ctx: BotHookCtx, s: SimState): boolean {
  const p = ctx.opts.policy;
  if (!ctx.mech || (p !== 'chase' && p !== 'naive')) return false;
  if (p === 'naive') return true;
  const m = minutesOfDay(s.day, s.dayTick);
  return s.nubs.chill >= CHASE_CHILL && (m < CHASE_FROM || m > CHASE_TO);
}

const src = new Int32Array(BINS);
const tmp = new Float64Array(BINS);
const mask = new Uint8Array(BINS);
const depth = new Float64Array(BINS);
const dist = new Float64Array(BINS);

/**
 * out[b] = circular distance (bins) from b to the nearest bin where `m` is (inside false: set;
 * inside true: unset, i.e. the depth inside the set). False when there is no such bin.
 */
function distTo(m: Uint8Array, out: Float64Array, inside: boolean): boolean {
  let any = false;
  for (let b = 0; b < BINS; b++) {
    const zero = (m[b] === 1) !== inside;
    out[b] = zero ? 0 : BINS;
    if (zero) any = true;
  }
  if (any) {
    for (let pass = 0; pass < 2; pass++) {
      for (let b = 0; b < BINS; b++) out[b] = Math.min(out[b] as number, (out[(b + BINS - 1) % BINS] as number) + 1);
      for (let b = BINS - 1; b >= 0; b--) out[b] = Math.min(out[b] as number, (out[(b + 1) % BINS] as number) + 1);
    }
  }
  return any;
}

/** Reactive bot, each guide refresh: add economy terms to `score` (360 bins, already holding now/next/gold). */
export function econReactiveScore(ctx: BotHookCtx, s: SimState, score: Float64Array): void {
  if (!ctx.mech) return;
  const w = s.world;
  const g = s.guide;
  const nb = s.nubs;
  // Garden: under the snap every angle is safe; grow gold, then line up the landing.
  if (w.v16.garden && s.snapTicks > 0) {
    let gold = false;
    if (s.snapTicks > LAND_TICKS) for (let b = 0; b < BINS; b++) if (g.bud[b] === 1) gold = true;
    if (gold) {
      for (let b = 0; b < BINS; b++) score[b] = g.bud[b] as number;
      return;
    }
    // Land well inside a guide.land arc (its edge slides away as Nubs walks on), where guide.next (in
    // the snap's last 0.6 s already past its end) agrees, best under this snap's own sunflower.
    distTo(g.land, depth, true);
    ownLandBins(s);
    for (let b = 0; b < BINS; b++) {
      score[b] = g.land[b] === 1 ? Math.min(depth[b] as number, LAND_DEPTH) + (g.next[b] as number) * LAND_NEXT + (mask[b] as number) * OWN_LAND : 0;
    }
    return;
  }
  const policy = ctx.opts.policy;
  const spare = nb.chill >= RB.budChill;
  const chase = econChasing(ctx, s);
  if (policy === 'safe' || chase) {
    for (let b = 0; b < BINS; b++) {
      if (g.bud[b] !== 1) continue;
      // Take back the v1.5 gold term (safe never chases gold); chase makes every gold bin worth CHASE_GOLD more.
      score[b] = (score[b] as number) - (g.now[b] === 1 || spare ? RB.budWeight : 0) + (chase ? CHASE_GOLD : 0);
    }
  }
  // Ring: prefer safe shade from a source that is not an end of the last SWING (a fresh SWING).
  if (w.v16.ring && nb.chill >= FRESH_CHILL && s.sunUp) {
    binSources(s);
    const n = nb.swFreshN;
    const slots = TUNING.ring.freshSlots;
    const e0 = n >= 1 ? (nb.swFresh[2 * ((n - 1) % slots)] as number) : -1;
    const e1 = n >= 2 ? (nb.swFresh[2 * ((n - 2) % slots)] as number) : -1;
    for (let b = 0; b < BINS; b++) {
      const id = src[b] as number;
      if (g.now[b] === 1 && id >= 0 && id !== e0 && id !== e1) score[b] = (score[b] as number) + FRESH_BONUS;
    }
  }
}

/** src[b] = the nearest caster shading Nubs' center sample with the sun at b° (−1 none; clouds are not looked at). */
function binSources(s: SimState): void {
  src.fill(-1);
  tmp.fill(Infinity);
  const w = s.world;
  const { x, y } = s.nubs;
  const cot = s.cot;
  const reach = shadowLength(w.maxZ, cot) + MAX_R;
  const cs = w.casters;
  for (let i = lowerBound(cs, y - reach); i < cs.length; i++) {
    const c = cs[i] as Caster;
    if (c.y > y + reach) break;
    if (distToCasterBounds(c, x, y) > casterReach(c, cot)) continue;
    mask.fill(0);
    markCaster(mask, c, x, y, cot);
    const d = (c.x - x) * (c.x - x) + (c.y - y) * (c.y - y);
    for (let b = 0; b < BINS; b++) {
      if (mask[b] === 1 && d < (tmp[b] as number)) {
        tmp[b] = d;
        src[b] = c.id;
      }
    }
  }
}

/** mask[b] = 1 where a sunflower bloomed under this snap shades Nubs' center at the snap's end (his scheduled spot, ε then). */
function ownLandBins(s: SimState): void {
  mask.fill(0);
  const n = Math.min(s.snapBlooms, s.snapBloomIds.length);
  const w = s.world;
  const t = s.dayTick + s.snapTicks;
  if (n === 0 || t >= dayTicks(s.day)) return;
  const eps = worldElevation(w, dayStartTick(s.day) + t);
  if (eps <= 0) return;
  const y = worldYAtDayTick(w, s.day, t);
  for (let i = 0; i < n; i++) {
    const c = w.byId.get(s.snapBloomIds[i] as number);
    if (c) markCaster(mask, c, trailX(w.trail, y), y, 1 / tanD(eps));
  }
}

/** True when some bin within ±deg of θ is set in `m`. */
function nearMask(m: Uint8Array, theta: number, deg: number): boolean {
  const b0 = binOf(theta);
  for (let k = -deg; k <= deg; k++) if (m[(b0 + k + BINS) % BINS] === 1) return true;
  return false;
}

/** Reactive bot, every tick: whether to cast a snap (`snap` is the v1.5 panic rule's answer). */
export function econReactiveSnap(ctx: BotHookCtx, s: SimState, snap: boolean): boolean {
  if (!ctx.mech || !snapReady(s)) return snap;
  const o = ctx.opts;
  const nb = s.nubs;
  const g = s.guide;
  // 'hoard': only when lit below its bar (the panic rule's last resort by default), never an overflow.
  if (o.snap === 'hoard') return nb.f > 0 && nb.chill < (o.snapChill ?? RB.snapLast);
  const plan = o.snap === 'plan';
  // The panic rule at another Chill bar (sim --decisions' snap-bar sweep; for 'plan' it is the plan's bar).
  if (!plan && o.snapChill !== undefined) snap = nb.f > 0 && (nb.chill < RB.snapLast || (nb.chill < o.snapChill && !nearMask(g.now, s.sun.theta, RB.snapNearDeg)));
  if (snap) return true;
  // The x5 farm (sim --decisions): a cool snap at ring ≥ farm with a bud in reach, needed or not.
  if (o.farm !== undefined && nb.mult >= o.farm && nb.chill >= TUNING.bank.coolChill && nearMask(g.bud, 0, 180)) return true;
  if (nb.f === 0) return false;
  // 'plan': snap at the mouth of a gap while the ring is worth cashing.
  if (plan && nb.mult >= PLAN_MULT && nb.chill < (o.snapChill ?? PLAN_CHILL)) {
    let near = false;
    const b0 = binOf(s.sun.theta);
    for (let k = -PLAN_NEAR; k <= PLAN_NEAR; k++) {
      const b = (b0 + k + BINS) % BINS;
      if (g.now[b] === 1 || g.next[b] === 1) near = true;
    }
    if (!near) return true;
  }
  // Bank: an overflowing meter spends a charge when lit and not comfortable.
  return s.world.v16.bank && nb.frostH >= OVERFLOW_H && nb.chill < OVERFLOW_CHILL;
}

/** Per oracle: whether it saw a snap on, and the tick its last snap ended (the landing it plans for). */
const oracleSnapEnd = new WeakMap<BotHookCtx, number[]>();
// Per plan (s, tick): distances to gold and to the landing shade, and the depth inside it.
let prepState: SimState | null = null;
let prepTick = -1;
let goldAny = false;
let landAny = false;

/** Oracle, each plan: a bonus (Chill units) for bin `b` with this slack, added to its value. */
export function econOracleBonus(ctx: BotHookCtx, s: SimState, b: number, slack: number): number {
  if (!ctx.mech || !s.world.v16.garden) return 0;
  let st = oracleSnapEnd.get(ctx);
  if (!st) oracleSnapEnd.set(ctx, (st = [0, -1e9]));
  const snapping = s.snapTicks > 0;
  if (!snapping && st[0] === 1) st[1] = s.tick;
  st[0] = snapping ? 1 : 0;
  const landing = snapping ? s.snapTicks <= LAND_TICKS : s.tick - (st[1] as number) <= AFTER_SNAP;
  if (prepState !== s || prepTick !== s.tick) {
    prepState = s;
    prepTick = s.tick;
    goldAny = snapping && distTo(s.guide.bud, tmp, false);
    const m = snapping ? s.guide.land : s.guide.now;
    landAny = landing && distTo(m, dist, false);
    if (landAny) distTo(m, depth, true);
  }
  let v = 0;
  // The bud bonus reaches ORACLE_BUD_REACH° under the snap (bots.ts already pays it within budReachDeg).
  if (goldAny && slack >= OB.budSlack) {
    const d = tmp[b] as number;
    v += Math.max(0, OB.budBonus * (1 - d / ORACLE_BUD_REACH) - Math.max(0, OB.budBonus * (1 - d / OB.budReachDeg)));
  }
  // The landing pull: up to ORACLE_LAND well inside the shade, fading outside it.
  if (landAny) {
    const d = dist[b] as number;
    v += d > 0 ? Math.max(0, 0.5 * ORACLE_LAND * (1 - d / ORACLE_LAND_REACH)) : ORACLE_LAND * (0.5 + (0.5 * Math.min(depth[b] as number, LAND_DEPTH)) / LAND_DEPTH);
  }
  return v;
}

const flareBuf: Flare[] = [];

/** Oracle, each plan: whether to snap next tick (`snap` is the v1.5 rule's answer). */
export function econOracleSnap(ctx: BotHookCtx, s: SimState, snap: boolean, slack: number): boolean {
  if (!ctx.mech || !s.world.v16.bank || !snapReady(s)) return snap;
  // Bank on, outside the Journey (economy iteration 2): frost is earned, so a snap waits for a
  // squeezed plan (the v1.5 "lit next step below snapChill" spent a meter that refilled itself and
  // left the oracle empty on Day 7, seed 181), or, with the plan tight, for the last plan steps
  // before this drain would take Nubs red-hot (a red snap refills nothing: seeds 97, 126).
  if (s.level === null) {
    const nb = s.nubs;
    const drop = ORACLE_RED_STEPS * STEP_TICKS * DT * effectiveDrain(s) * noonHeatAt(s.world, s.day, s.dayTick) * nb.f;
    snap = slack < OB.snapSlack || (nb.f > 0 && slack < ORACLE_RED_SLACK && nb.chill - drop < TUNING.bank.coolChill + ORACLE_RED_MARGIN);
  }
  if (snap) return true;
  if (s.nubs.f === 0) return false;
  // Holding two charges, one is kept for the current big kept flare: cast in its rise or hold.
  if (s.world.v16.flares && (s.flarePhase === 2 || s.flarePhase === 3) && s.nubs.frostH >= 2 * TUNING.bank.costH) {
    const n = keptFlares(s.world, s.tickAbs, s.tickAbs + 1, flareBuf);
    let big = false;
    for (let i = 0; i < n; i++) if ((flareBuf[i] as Flare).d >= FLARE_D) big = true;
    flareBuf.length = 0;
    if (big) return true;
  }
  return s.nubs.frostH >= OVERFLOW_H;
}
