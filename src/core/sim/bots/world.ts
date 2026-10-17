// v1.6 world and Journey terms of the bots (docs/V1_6_PLAN.md §2.3, §2.5, §2.6; CORE-2 owns this
// file): the reactive bot's glass terms and preAim (the nearest guide.flare bin in a warning's last
// 18 ticks), the oracle's Noon Heat and flare step costs, glass and Feat terms, and humanFeat's Dare
// focus. bots.ts calls these hooks at fixed points. No allocation per call.

import { splitmix32 } from '../../../config/rng.ts';
import { TUNING } from '../../../config/tuning.ts';
import { dayAtTick, dayStartTick, DT, minutesOfDay } from '../../clock.ts';
import { liftingFlare, noonHeatAt } from '../../gen/plan.ts';
import { chillDeltaTable, slidingMaxCircular, stepLitLive } from '../../gen/validator.ts';
import { BINS, binOf } from '../../intervals.ts';
import { FLARE_KEPT, type Flare } from '../../objects.ts';
import type { BotHookCtx } from '../bots.ts';
import { glassValue } from './glassplan.ts';
import type { SimState } from '../types.ts';

const STEP = TUNING.validator.stepTicks;
/** The oracle weighs a lit step in a kept flare's hold this many times (§2.5 "weights lit hold steps x3"). */
const HOLD_WEIGHT = 3;

/**
 * Reactive glass term (§2.3): the chase and naive policies add this on guide.flake bins while Chill ≥
 * GLASS_CHILL. Measured (240 seeds): 4, enough to outweigh a safe bin (3), cost chase 30 min mean
 * against plain (+47 vs +79): the glass detour costs more than it pays, so the policy keeps 1.5.
 */
const GLASS_WEIGHT = 1.5;
const GLASS_CHILL = 45;
/** The chase policy's calm hours: it chases outside 9:20 AM-2:40 PM (minutes after 6:00 AM). */
const CHASE_FROM = 200;
const CHASE_TO = 520;
/** preAim (§2.5): the last ticks of a flare's warning in which the reactive bot slides to guide.flare. */
const PREAIM_TICKS = 18;
/**
 * Oracle glass term (§2.3): a Chill-equivalent bonus × the glass plan's value (bots/dares.ts
 * glassValue: every glass flake in its melt window, the most urgent first) while the slack is at
 * least ORACLE_GLASS_SLACK. Measured (16 seeds, Days 1-3): ×4 on guide.flake saved 31% of the glass
 * flakes, this 73%.
 */
const ORACLE_GLASS = 45;
const ORACLE_GLASS_SLACK = 10;

/** Reactive bot, each guide refresh: add world terms to `score` (360 bins, already holding now/next/gold). */
export function worldReactiveScore(ctx: BotHookCtx, s: SimState, score: Float64Array): void {
  const pol = ctx.opts.policy;
  if (!ctx.mech || (pol !== 'chase' && pol !== 'naive') || s.nubs.chill < GLASS_CHILL) return;
  if (pol === 'chase') {
    const m = minutesOfDay(s.day, s.dayTick);
    if (m >= CHASE_FROM && m <= CHASE_TO) return;
  }
  const g = s.guide.flake;
  for (let b = 0; b < BINS; b++) if (g[b] === 1) score[b] = (score[b] as number) + GLASS_WEIGHT;
}

/**
 * Reactive bot, every tick: the bin to steer to (`target` is the score's pick). preAim (with the
 * mechanics): in a flare warning's last PREAIM_TICKS, if θ's bin is not in guide.flare it targets
 * the nearest guide.flare bin (θ stays put when it already is, unless the pick is too).
 */
export function worldReactiveAim(ctx: BotHookCtx, s: SimState, target: number): number {
  if (!ctx.opts.preAim || !ctx.mech || s.flarePhase !== 1 || s.flareTicks > PREAIM_TICKS) return target;
  const g = s.guide.flare;
  const b0 = binOf(s.sun.theta);
  if (g[b0] === 1) return g[binOf(target)] === 1 ? target : b0;
  for (let k = 1; k <= 180; k++) {
    if (g[(b0 + k) % BINS] === 1) return (b0 + k) % BINS;
    if (g[(b0 - k + BINS) % BINS] === 1) return (b0 - k + BINS) % BINS;
  }
  return target;
}

/**
 * Oracle, each plan: the Chill-delta table it plans step `tick` (absolute) with, for the run's
 * `drain` and `regen`: × Noon Heat (noonHeatAt, the validator's own rule), and × HOLD_WEIGHT on the
 * hold steps of a kept flare (the lift itself is already in the step's lit counts). Outside both it
 * is the v1.5 table.
 */
export function worldOracleDelta(_ctx: BotHookCtx, s: SimState, tick: number, drain: number, regen: number): Float64Array {
  const w = s.world;
  const day = dayAtTick(tick);
  let d = drain * noonHeatAt(w, day, tick - dayStartTick(day));
  if (w.flares.length > 0) {
    const f = liftingFlare(w, tick);
    if (f && tick >= f.holdTick && tick < f.fallTick) d *= HOLD_WEIGHT;
  }
  if (d !== memoDrain || regen !== memoRegen) {
    memoDrain = d;
    memoRegen = regen;
    memoTable = chillDeltaTable(d, regen);
  }
  return memoTable as Float64Array;
}

// The last table worldOracleDelta returned (the drain changes only at Noon Heat's edges and flare holds).
let memoDrain = NaN;
let memoRegen = NaN;
let memoTable: Float64Array | null = null;

// Oracle parry plan (§2.5): for the kept flare whose hold lies within the plan's horizon, the most
// shaded hold steps a turn-limited path can still get from each bin of the next step (validator
// rows with the lift, the 3-step rule), recomputed once per plan.
const PARRY_W = 6;
const PARRY_SLACK = 4;
const PARRY_HORIZON = TUNING.bots.oracle.horizonSteps * STEP;
const PARRY_REACH = Math.round(TUNING.bots.oracle.rate * STEP * DT);
/** Turn per step the parry plan allows inside the hold (bins). */
const PARRY_HOLD_REACH = 6;
const HOLD_STEPS = Math.round(TUNING.flare.holdTicks / STEP);
const parryRows = new Uint8Array((HOLD_STEPS + 4 + TUNING.bots.oracle.horizonSteps) * BINS);
const parryRow = new Uint8Array(BINS);
const parryV = new Float64Array(BINS);
const parryWin = new Float64Array(BINS);
const parryCore = new Uint8Array(BINS);
/** Bins of margin either side a parry step's bin must be shaded on. */
const PARRY_CORE = 2;
let parryState: SimState | null = null;
let parryTick = -1;
let parryOn = false;

/** Fills parryV (the best shaded hold steps reachable from each bin at the oracle's next step), or clears parryOn. */
function planParry(s: SimState): void {
  parryState = s;
  parryTick = s.tick;
  parryOn = false;
  const w = s.world;
  if (w.flares.length === 0 || !s.sunUp) return;
  const t = s.tickAbs;
  let f: Flare | null = null;
  for (let i = s.flareIdx; i < w.flares.length; i++) {
    const c = w.flares[i] as Flare;
    if (c.holdTick - t > PARRY_HORIZON) break;
    if (c.state === FLARE_KEPT && c.fallTick > t + STEP) {
      f = c;
      break;
    }
  }
  if (!f) return;
  const j1 = Math.round(t / STEP) + 1;
  const jh = f.holdTick / STEP;
  const jf = f.fallTick / STEP;
  const lo = Math.max(j1, jh) - 1;
  // The hold's ticks run to fallTick − 1, so the step at fallTick counts too (the bot moves toward a
  // step's bin during the ticks before it).
  for (let j = lo; j <= jf + 1; j++) {
    stepLitLive(w, j, parryRow);
    parryRows.set(parryRow, (j - lo) * BINS);
  }
  parryV.fill(0);
  for (let j = jf; j >= j1; j--) {
    // Through the hold the path stays in one moving shade (a hand-off mid-hold costs lit ticks).
    slidingMaxCircular(parryV, j >= jh ? PARRY_HOLD_REACH : PARRY_REACH, parryWin);
    const o = (j - lo) * BINS;
    if (j >= jh) {
      // Shaded (3-step rule) on the bin and PARRY_CORE bins either side: the middle of the arc, so
      // the ticks between two steps stay shaded too.
      for (let b = 0; b < BINS; b++) {
        const lh = Math.max(parryRows[o - BINS + b] as number, parryRows[o + b] as number, parryRows[o + BINS + b] as number);
        parryCore[b] = lh === 0 ? 1 : 0;
      }
      for (let b = 0; b < BINS; b++) {
        let ok = true;
        for (let k = -PARRY_CORE; k <= PARRY_CORE && ok; k++) if (parryCore[(b + k + BINS) % BINS] === 0) ok = false;
        parryV[b] = (parryWin[b] as number) + (ok ? 1 : 0);
      }
    } else {
      parryV.set(parryWin);
    }
  }
  for (let b = 0; b < BINS; b++) if ((parryV[b] as number) > 0) parryOn = true;
}

/** Oracle, each plan: a bonus (Chill units) for bin `b` with this slack, added to its value. */
export function worldOracleBonus(ctx: BotHookCtx, s: SimState, b: number, slack: number): number {
  if (s !== parryState || s.tick !== parryTick) planParry(s);
  let v = 0;
  // Flares (§2.5): steer for the shade that holds through the coming hold.
  if (parryOn && slack >= PARRY_SLACK) v += PARRY_W * (parryV[b] as number);
  // Glass (§2.3): the bins that shade the glass flakes in their melt window (the most urgent first), while comfortable.
  if (ctx.mech && slack >= ORACLE_GLASS_SLACK) {
    const gv = glassValue(s);
    if (gv) v += ORACLE_GLASS * (gv[b] as number);
  }
  // §2.6: the level's unmet verb goal, and the Feat-seeking oracle's unmet Dares.
  if (s.level && ctx.opts.dares) v += ctx.opts.dares.bonus(s, b, slack, ctx.opts.feats === true);
  return v;
}

/** Oracle, each plan: the Cold Snap decision after the economy's (the Feat-seeking oracle's snapSave Dare, §2.6). */
export function worldOracleSnap(ctx: BotHookCtx, s: SimState, snap: boolean, slack: number): boolean {
  return ctx.opts.dares ? ctx.opts.dares.snap(s, snap, slack, ctx.opts.feats === true) : snap;
}

/** humanFeat's share of decisions that aim for the level's Dare (§2.6: a seeded 50% focus). */
const FEAT_FOCUS = 0.5;

/** humanFeat's focus coin is drawn per window of this many ticks (about one decision). */
const FOCUS_TICKS = 30;

/**
 * humanFeat, each decision: the aim target (`target` is humanDial's pick, −1 while it would not
 * move). In FEAT_FOCUS of the half-second windows (a coin from the run's seed, the window and the
 * player's salt: its own stream, independent of humanDial's, and another player's on another salt)
 * it aims for the level's first unmet Dare instead (bots/dares.ts), when the dial shows one; its
 * lag and aim error still apply.
 */
export function worldHumanTarget(ctx: BotHookCtx, s: SimState, target: number): number {
  if (!s.level) return target;
  const key = (s.cfg.seed ^ Math.imul(Math.floor(s.tick / FOCUS_TICKS) + 1, 0x9e3779b1) ^ Math.imul(ctx.salt, 0x85ebca6b)) >>> 0;
  const coin = (splitmix32(key) >>> 0) / 4294967296;
  if (coin >= FEAT_FOCUS) return target;
  const t = ctx.opts.dares ? ctx.opts.dares.target(s, s.sun.theta) : -1;
  return t >= 0 ? t : target;
}
