// v1.6 Brittle (glass) flake clusters: the contest test (docs/V1_6_PLAN.md §2.3; CORE-2).
//
// A glass cluster melts after TUNING.brittle.meltBudget lit seconds, so greed must sit on a
// different angle from safety. Placement runs two chunks behind the casters (gen/placer.ts) and
// reads only the finished validation job of the cluster's chunk (its lit rows and DP Chill rows), so
// the validator and the world's fairness are untouched. For the cluster's last flake P (the longest
// exposed) and its melt window W (the 0.1 s steps while 14 u < P.y − Nubs' y ≤ meltAheadSec of
// walking), with need = |W| − (budget in steps) shaded steps to save it:
//   - M(j): the bins that shade P at step j (validator scene, clouds as circles of ry, glare bins
//     removed);
//   - S_free: the most steps of W with the bin in M that a turn-limited path (turnBins a step) can
//     get while staying on zero-lit bins (3-step rule);
//   - C0: the best Chill tailSec after W (the job's own rows); C1: the same best with ≥ need steps of
//     W in M forced, from a DP over (bin, hits ≤ need) seeded with the job's row before W.
// Contested ⇔ S_free ≤ need − 2 (the safe line can't save it), C1 ≥ floor + marginChill (never a
// trap), costMin ≤ C0 − C1 ≤ costMax (never free, never brutal), and the first flake is savable
// too (its own C1 ≥ floor + marginChill). Per-call work is O(|W| · need · 360); no allocation.

import { levelGlassShare } from '../../config/campaign.ts';
import type { DayParams } from '../../config/days.ts';
import { TUNING } from '../../config/tuning.ts';
import { dayStartTick, TICK_HZ } from '../clock.ts';
import { BINS, createMaskScene, glareMask, shadeMask } from '../intervals.ts';
import { FLARE_KEPT, FLARE_PENDING, type Flare } from '../objects.ts';
import { paramsAt } from './plan.ts';
import { gatherScene, type World } from './store.ts';
import { deltaForSlot, eclipseTouches, slidingMaxCircular, type ValidationJob } from './validator.ts';

const B = TUNING.brittle;
const STEP = TUNING.validator.stepTicks;
const TURN = TUNING.validator.turnBins;
const DEAD = -1e9;
const COLLECT = TUNING.nubs.collectRadius;
const TAIL = Math.round((B.tailSec * TICK_HZ) / STEP);
/** Melt window steps at most (meltAheadSec in 0.1 s steps, plus slack). */
const MAX_W = Math.ceil((TUNING.pickups.meltAheadSec * TICK_HZ) / STEP) + 4;
const MAX_NEED = MAX_W;
/** A pending flare may still move by up to this (ticks) when the validator decides it. */
const FLARE_SHIFT_MAX = Math.round(Math.max(...TUNING.flare.shiftsSec.map(Math.abs)) * TICK_HZ);

const scene = createMaskScene();
const glare = new Uint8Array(BINS);
/** M rows of the melt window (MAX_W × 360). */
const mRows = new Uint8Array(MAX_W * BINS);
const fRow = new Float64Array(BINS);
const fWin = new Float64Array(BINS);
/** C1 layers: (need + 1) × 360, current and next. */
const layA = new Float64Array((MAX_NEED + 1) * BINS);
const layB = new Float64Array((MAX_NEED + 1) * BINS);
const win = new Float64Array(BINS);
/** The Chill delta of each bin at the current step (3-step lit count looked up once). */
const dRow = new Float64Array(BINS);

/** The result of contestFlake: the melt window, need, S_free, C0 and C1 (Chill), or eligible false. */
export interface FlakeContest {
  eligible: boolean;
  /** Slots of the melt window [w0, w1] in the job. */
  w0: number;
  w1: number;
  need: number;
  sFree: number;
  c0: number;
  c1: number;
  floor: number;
}

const out: FlakeContest = { eligible: false, w0: 0, w1: 0, need: 0, sFree: 0, c0: 0, c1: 0, floor: 0 };

/** Slot s's absolute tick. */
function slotTick(job: ValidationJob, s: number): number {
  return (job.j0 + s - 1 - job.pre) * STEP;
}

/** Lit count of slot s at bin b under the 3-step rule. */
function litH(job: ValidationJob, s: number, b: number): number {
  const l = job.lit;
  const a = l[(s - 1) * BINS + b] as number;
  const m = l[s * BINS + b] as number;
  const c = l[(s + 1) * BINS + b] as number;
  return a > m ? (a > c ? a : c) : m > c ? m : c;
}

/**
 * True when a kept flare's window touches ticks [a, b], or a pending flare may still land there. A
 * pending flare is decided by a later job, whose range starts at most prefixSteps before this job's
 * last own step, so only the end of this job is at risk.
 */
function nearFlare(w: World, job: ValidationJob, a: number, b: number): boolean {
  const risk = (job.j0 + job.n - TUNING.validator.prefixSteps) * STEP;
  for (const f of w.flares as readonly Flare[]) {
    if (f.state === FLARE_KEPT && f.riseTick <= b && f.endTick >= a) return true;
    if (f.state === FLARE_PENDING && b >= risk && f.riseTick - FLARE_SHIFT_MAX <= b) return true;
  }
  return false;
}

/**
 * The melt window of a flake at y against the finished job `job` (the validation job of its chunk)
 * into `out` (w0, w1, need, floor); false when it plus tailSec does not lie inside the job's own
 * computed slots in plain daylight (no flare near), or when the flake cannot melt (need ≤ 0).
 */
function meltWindow(w: World, job: ValidationJob, py: number, budget: number): boolean {
  out.eligible = false;
  const last = job.pre + job.n;
  let w0 = -1;
  let w1 = -1;
  for (let s = 1; s <= last; s++) {
    const dy = py - (job.sy[s] as number);
    const v = paramsAt(w, job.sDay[s] as number).v;
    if (dy > COLLECT && dy <= TUNING.pickups.meltAheadSec * v) {
      if (w0 < 0) w0 = s;
      w1 = s;
    } else if (w0 >= 0) break;
  }
  if (w0 < 2 || w1 + TAIL > last || w1 - w0 + 1 > MAX_W) return false;
  const need = w1 - w0 + 1 - Math.round((budget * TICK_HZ) / STEP);
  if (need <= 0) return false;
  for (let s = w0 - 1; s <= w1 + TAIL; s++) {
    if ((job.sEps[s] as number) <= 0 || (job.sy[s] as number) > w.finishY) return false;
    if (w.startTick > 0 && slotTick(job, s) - STEP < w.startTick) return false;
  }
  if (nearFlare(w, job, slotTick(job, w0 - 1), slotTick(job, w1 + TAIL))) return false;
  // Nothing melts in the eclipse (pointLitWeight is 0), and the validator's rows do not model it:
  // a window it touches could be free glass.
  if (eclipseTouches(w, slotTick(job, w0 - 1) - STEP, slotTick(job, w1 + TAIL))) return false;
  const maxC = paramsAt(w, 1).maxChill;
  out.floor = (paramsAt(w, job.sDay[w0] as number).floor * maxC) / TUNING.nubs.maxChill;
  out.w0 = w0;
  out.w1 = w1;
  out.need = need;
  out.eligible = true;
  return true;
}

/** M rows of the window in `out`: the bins that shade (px, py) at each step (clouds as circles of ry), glare bins removed. */
function computeM(w: World, job: ValidationJob, px: number, py: number): void {
  for (let s = out.w0; s <= out.w1; s++) {
    const m = mRows.subarray((s - out.w0) * BINS, (s - out.w0 + 1) * BINS);
    gatherScene(w, scene, px, py, 1, job.sT[s] as number, job.sEps[s] as number, job.sCot[s] as number, false);
    shadeMask(scene, px, py, true, m);
    if (scene.glareOn && scene.nBalls > 0) {
      glareMask(scene, px, py, glare);
      for (let b = 0; b < BINS; b++) if (glare[b] === 1) m[b] = 0;
    }
  }
}

/** S_free of the window in `out`: the most M hits a turn-limited path gets on zero-lit bins (3-step rule); −1 when no such path exists. */
function freeHits(job: ValidationJob): number {
  const w0 = out.w0;
  for (let b = 0; b < BINS; b++) fRow[b] = litH(job, w0 - 1, b) === 0 ? 0 : DEAD;
  for (let s = w0; s <= out.w1; s++) {
    slidingMaxCircular(fRow, TURN, fWin);
    const mo = (s - w0) * BINS;
    for (let b = 0; b < BINS; b++) {
      const v = fWin[b] as number;
      fRow[b] = litH(job, s, b) === 0 && v > DEAD / 2 ? v + (mRows[mo + b] as number) : DEAD;
    }
  }
  let best = DEAD;
  for (let b = 0; b < BINS; b++) if ((fRow[b] as number) > best) best = fRow[b] as number;
  return best < 0 ? -1 : best;
}

/**
 * The Chill DP over the window in `out` plus tailSec, seeded with the job's row before the window:
 * `layers` = need + 1 tracks the M hits so far (saturating at need) and returns the best Chill at
 * the end with ≥ need hits; `layers` = 1 ignores M (the best Chill at the end). `capped` clamps at
 * the tank like the validator; uncapped it sums the Chill deltas (the true price of a detour even
 * when the tank is full).
 */
function chillDP(w: World, job: ValidationJob, layers: number, capped: boolean): number {
  const need = layers - 1;
  const maxC = capped ? paramsAt(w, 1).maxChill : Infinity;
  let cur = layA;
  let nxt = layB;
  cur.fill(DEAD, 0, layers * BINS);
  cur.set(job.c.subarray((out.w0 - 1) * BINS, out.w0 * BINS), 0);
  // Layer k can only be alive after k steps of the window: lo..hi are the live layers.
  let hi = 0;
  for (let s = out.w0; s <= out.w1 + TAIL; s++) {
    const inW = s <= out.w1;
    const mo = (s - out.w0) * BINS;
    const day = job.sDay[s] as number;
    const delta = deltaForSlot(w, day, slotTick(job, s) - dayStartTick(day));
    for (let b = 0; b < BINS; b++) dRow[b] = delta[litH(job, s, b)] as number;
    const lo = inW ? 0 : need;
    const top = inW && hi < need ? hi + 1 : hi;
    nxt.fill(DEAD, lo * BINS, (top + 1) * BINS);
    for (let k = lo; k <= hi; k++) {
      slidingMaxCircular(cur, TURN, win, k * BINS);
      const up = inW && k < need;
      for (let b = 0; b < BINS; b++) {
        const from = win[b] as number;
        if (from <= DEAD / 2) continue;
        let v = from + (dRow[b] as number);
        if (v <= 0) continue;
        if (v > maxC) v = maxC;
        const o = (up && mRows[mo + b] === 1 ? k + 1 : k) * BINS + b;
        if (v > (nxt[o] as number)) nxt[o] = v;
      }
    }
    hi = top;
    const t = cur;
    cur = nxt;
    nxt = t;
  }
  let best = DEAD;
  if (hi < need) return best;
  const o = need * BINS;
  for (let b = 0; b < BINS; b++) if ((cur[o + b] as number) > best) best = cur[o + b] as number;
  return best;
}

/**
 * The contest numbers of a flake at (px, py) against the finished job `job` (tests and tools; the
 * placer calls contestCluster): its melt window, need, S_free, the uncapped best Chill tailSec
 * after the window without (C0) and with (C1) the flake saved, and the capped C1 (cappedC1).
 */
export function contestFlake(w: World, job: ValidationJob, px: number, py: number, budget: number): FlakeContest & { cappedC1: number } {
  if (!meltWindow(w, job, py, budget)) return { ...out, cappedC1: DEAD };
  computeM(w, job, px, py);
  out.sFree = freeHits(job);
  out.c0 = chillDP(w, job, 1, false);
  out.c1 = chillDP(w, job, out.need + 1, false);
  return { ...out, cappedC1: chillDP(w, job, out.need + 1, true) };
}

/** The contest verdict of a cluster: eligible (its drawn spot's window fits the job), contested, and its detour cost C0 − C1 (Chill). */
export interface ClusterContest {
  eligible: boolean;
  contested: boolean;
  cost: number;
}

const verdict: ClusterContest = { eligible: false, contested: false, cost: 0 };

/** True when the cluster whose last flake is at y would be eligible (its melt window plus tail lies inside the job). Cheap: no masks. */
export function clusterEligible(w: World, job: ValidationJob, y: number): boolean {
  return meltWindow(w, job, y, B.meltBudget);
}

/**
 * The contest test of a cluster whose first flake is at (x0, y0) and last at (x1, y1), against the
 * job of its chunk: the last flake's S_free ≤ need − 2, the uncapped detour cost C0 − C1 within
 * [costMin, costMax], the capped C1 ≥ floor + marginChill, and the first flake's capped C1 too.
 * `savableOnly` (the Glass Flakes lesson's fallback) keeps only the last two: a perfect player can
 * save it without risking the floor.
 */
export function contestCluster(w: World, job: ValidationJob, x0: number, y0: number, x1: number, y1: number, savableOnly = false): ClusterContest {
  verdict.eligible = false;
  verdict.contested = false;
  verdict.cost = 0;
  if (!meltWindow(w, job, y1, B.meltBudget)) return verdict;
  verdict.eligible = true;
  computeM(w, job, x1, y1);
  let cost = 0;
  if (!savableOnly) {
    if (freeHits(job) > out.need - 2) return verdict;
    cost = chillDP(w, job, 1, false) - chillDP(w, job, out.need + 1, false);
    if (cost < B.costMin || cost > B.costMax) return verdict;
  }
  const floor = out.floor + B.marginChill;
  if (chillDP(w, job, out.need + 1, true) < floor) return verdict;
  // The first flake must be savable too.
  if (meltWindow(w, job, y0, B.meltBudget)) {
    computeM(w, job, x0, y0);
    if (chillDP(w, job, out.need + 1, true) < floor) return verdict;
  }
  verdict.contested = true;
  verdict.cost = cost;
  return verdict;
}

/**
 * The glass quota (share of eligible clusters) of `day` in world `w`: none without World.v16.brittle
 * and Mechanics.brittle, in the tutorial, on profiles 0-1, or where the day's meltBudget is not above
 * the glass budget (Quick Melt) or is Infinity (Hardy Flakes); RunConfig.brittleShare overrides it.
 * Profile 3: quotaDay1 on Day 1, quotaLater after (profile 2: half). A Journey level takes
 * levelGlassShare (config/campaign.ts: the brittle concept's 60%, capped on flake levels).
 */
export function glassQuota(w: World, day: number, p: DayParams): number {
  if (!w.v16.brittle || !w.mech.brittle || w.tutorial) return 0;
  if (!(p.meltBudget > B.meltBudget) || p.meltBudget === Infinity) return 0;
  if (w.brittleShare !== null) return w.brittleShare;
  if (w.level) return levelGlassShare(w.level);
  const q = day <= 1 ? B.quotaDay1 : B.quotaLater;
  return w.profile === 3 ? q : w.profile === 2 ? q / 2 : 0;
}
