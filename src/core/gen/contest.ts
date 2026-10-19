// v1.6 Brittle (glass) flake clusters: the contest test (docs/V1_6_PLAN.md §2.3; CORE-2).
//
// A glass cluster melts after TUNING.brittle.meltBudget lit seconds, so greed must sit on a
// different angle from safety. Placement runs two chunks behind the casters (gen/placer.ts) and
// reads only the finished validation job of the cluster's chunk (its lit rows and DP Chill rows), so
// the validator and the world's fairness are untouched. For a flake P and its melt window W (the
// 0.1 s steps while 14 u < P.y − Nubs' y ≤ meltAheadSec of walking):
//   - its melt rows m(j): what each bin melts P at step j, as the sim melts it (pickups.ts
//     pointLitWeight): 0 shaded, 1 lit, 2 in glare (validator scene, clouds as circles of ry);
//   - it survives a path whose melt over W stays at most `safe` = safeSteps(budget): one step under
//     its budget in steps, so a flake lit exactly its budget (0.8 s: 48 lit ticks) counts as melted,
//     as in the sim (pickups.ts melts at weighted lit ticks ≥ the budget's);
//   - freeMelt: the least melt a turn-limited path (turnBins a step) gets while staying on zero-lit
//     bins (3-step rule): the safe line;
//   - C0: the best Chill tailSec after W (the job's own rows); C1: the same best with P saved, from
//     a DP over (bin, melt so far ≤ safe) seeded with the job's row before W.
// Contested ⇔ for the cluster's last flake (the longest exposed): freeMelt ≥ safe + 2 (the safe line
// can't save it), costMin ≤ C0 − C1 ≤ costMax (never free, never brutal) and C1 ≥ floor +
// marginChill (never a trap); and every other flake of the cluster is savable too (its own window
// lies in the job and its capped C1 ≥ floor + marginChill; a flake whose window cannot be checked
// fails the cluster). Per-call work is O(|W| · safe · 360); no allocation. The placer runs the test
// in stages (ContestRun, contestStage), at most one per idle-generation slice.

import { levelGlassShare } from '../../config/campaign.ts';
import type { DayParams } from '../../config/days.ts';
import { TUNING } from '../../config/tuning.ts';
import { dayStartTick, TICK_HZ } from '../clock.ts';
import { BINS, createMaskScene, glareMask, shadeMask } from '../intervals.ts';
import { FLARE_KEPT, FLARE_PENDING, type Flare } from '../objects.ts';
import { trailX } from '../trail.ts';
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
/** A pending flare may still move by up to this (ticks) when the validator decides it. */
const FLARE_SHIFT_MAX = Math.round(Math.max(...TUNING.flare.shiftsSec.map(Math.abs)) * TICK_HZ);

/**
 * Weighted lit ticks (1 a lit tick, 2 in glare) that melt a flake of `budget` lit seconds: the sim
 * melts it once its weighted lit ticks reach this (pickups.ts), guide.flake and the contest count
 * against it.
 */
export function meltTicksOf(budget: number): number {
  return Math.round(budget * TICK_HZ);
}

/**
 * The most weighted lit steps (a lit 0.1 s step 1, a glare step 2) a flake of `budget` lit seconds
 * survives in the contest's step model: one step fewer than its budget in steps, so a path lit for
 * exactly its budget loses it, as in the sim.
 */
export function safeSteps(budget: number): number {
  return Math.ceil(meltTicksOf(budget) / STEP) - 1;
}

const scene = createMaskScene();
const glare = new Uint8Array(BINS);
/** Melt rows of the window under test (MAX_W × 360): 0 shaded, 1 lit, 2 glare. */
const mRows = new Uint8Array(MAX_W * BINS);
const fRow = new Float64Array(BINS);
const fWin = new Float64Array(BINS);
const win = new Float64Array(BINS);
/** The Chill delta of each bin at the current step (3-step lit count looked up once). */
const dRow = new Float64Array(BINS);

/** The result of contestFlake: the melt window, safe, freeMelt, C0 and C1 (Chill), or eligible false. */
export interface FlakeContest {
  eligible: boolean;
  /** Slots of the melt window [w0, w1] in the job. */
  w0: number;
  w1: number;
  /** The most weighted lit steps the flake survives (safeSteps). */
  safe: number;
  /** The least melt of the safe line (Infinity: no zero-lit path). */
  freeMelt: number;
  c0: number;
  c1: number;
  floor: number;
}

/** A melt window: its slots [w0, w1] in the job, the melt the flake survives and the day's floor (Chill). */
interface MeltWin {
  w0: number;
  w1: number;
  safe: number;
  floor: number;
}

const out: FlakeContest = { eligible: false, w0: 0, w1: 0, safe: 0, freeMelt: 0, c0: 0, c1: 0, floor: 0 };

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
 * into `mw` (w0, w1, safe, floor); false when it plus tailSec does not lie inside the job's own
 * computed slots in plain daylight (no flare near, no eclipse), when it starts before slot `minW0`
 * (the safe line reads two rows before the window, the Chill DP one), or when the flake cannot melt
 * in plain sun (the window is not longer than `safe`).
 */
function meltWindow(w: World, job: ValidationJob, py: number, budget: number, mw: MeltWin, minW0: number): boolean {
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
  if (w0 < minW0 || w1 + TAIL > last || w1 - w0 + 1 > MAX_W) return false;
  const safe = safeSteps(budget);
  if (w1 - w0 + 1 <= safe) return false;
  for (let s = w0 - 1; s <= w1 + TAIL; s++) {
    if ((job.sEps[s] as number) <= 0 || (job.sy[s] as number) > w.finishY) return false;
    if (w.startTick > 0 && slotTick(job, s) - STEP < w.startTick) return false;
  }
  if (nearFlare(w, job, slotTick(job, w0 - 1), slotTick(job, w1 + TAIL))) return false;
  // Nothing melts in the eclipse (pointLitWeight is 0), and the validator's rows do not model it:
  // a window it touches could be free glass.
  if (eclipseTouches(w, slotTick(job, w0 - 1) - STEP, slotTick(job, w1 + TAIL))) return false;
  const maxC = paramsAt(w, 1).maxChill;
  mw.floor = (paramsAt(w, job.sDay[w0] as number).floor * maxC) / TUNING.nubs.maxChill;
  mw.w0 = w0;
  mw.w1 = w1;
  mw.safe = safe;
  return true;
}

/**
 * Melt rows of window `mw` into `m` for the flake at (px, py): at each step, what each bin melts it
 * (the sim's pointLitWeight: 2 where a ball's glare covers it, else 0 where shaded, else 1; clouds as
 * circles of ry, the validator's rule).
 */
export function meltRows(w: World, job: ValidationJob, px: number, py: number, w0: number, w1: number, m: Uint8Array): void {
  for (let s = w0; s <= w1; s++) {
    const row = m.subarray((s - w0) * BINS, (s - w0 + 1) * BINS);
    gatherScene(w, scene, px, py, 1, job.sT[s] as number, job.sEps[s] as number, job.sCot[s] as number, false);
    shadeMask(scene, px, py, true, row);
    for (let b = 0; b < BINS; b++) row[b] = row[b] === 1 ? 0 : 1;
    if (scene.glareOn && scene.nBalls > 0) {
      glareMask(scene, px, py, glare);
      for (let b = 0; b < BINS; b++) if (glare[b] === 1) row[b] = 2;
    }
  }
}

/** freeMelt of window `mw`: the least melt a turn-limited path gets on zero-lit bins (3-step rule); Infinity when no such path exists. */
function freeMelt(job: ValidationJob, mw: MeltWin, m: Uint8Array): number {
  const w0 = mw.w0;
  // Negated melt, so the sliding maximum keeps the least melt.
  for (let b = 0; b < BINS; b++) fRow[b] = litH(job, w0 - 1, b) === 0 ? 0 : DEAD;
  for (let s = w0; s <= mw.w1; s++) {
    slidingMaxCircular(fRow, TURN, fWin);
    const mo = (s - w0) * BINS;
    for (let b = 0; b < BINS; b++) {
      const v = fWin[b] as number;
      fRow[b] = litH(job, s, b) === 0 && v > DEAD / 2 ? v - (m[mo + b] as number) : DEAD;
    }
  }
  let best = DEAD;
  for (let b = 0; b < BINS; b++) if ((fRow[b] as number) > best) best = fRow[b] as number;
  return best > DEAD / 2 ? -best : Infinity;
}

/**
 * A Chill DP over a melt window plus tailSec in progress (fix round 2 of the iteration-2 review:
 * resumable, so generation slices it by steps; review r5 measured an 8-layer DP in one piece as most
 * of the frames over 1 ms). Layers (safe + 1) × 360, current and next, swapped each step.
 */
interface ChillDP {
  readonly a: Float64Array;
  readonly b: Float64Array;
  /** The current layers are `a` (else `b`). */
  curA: boolean;
  /** The next step to run and the last one (w1 + TAIL). */
  s: number;
  end: number;
  /** The top live layer, the layer count, the tank (Infinity uncapped), and whether the flake's melt is tracked. */
  hi: number;
  layers: number;
  maxC: number;
  save: boolean;
}

function newChillDP(): ChillDP {
  return { a: new Float64Array((MAX_W + 1) * BINS), b: new Float64Array((MAX_W + 1) * BINS), curA: true, s: 0, end: -1, hi: 0, layers: 1, maxC: 0, save: false };
}

/**
 * Starts the Chill DP over window `mw` plus tailSec, seeded with the job's row before the window.
 * `save` tracks the flake's melt so far (layers 0..safe; a step past safe loses it): its best Chill
 * at the end is C1 with the flake saved, without it C0. `capped` clamps at the tank like the
 * validator; uncapped it sums the Chill deltas (the true price of a detour even when the tank is full).
 */
function dpStart(w: World, job: ValidationJob, mw: MeltWin, save: boolean, capped: boolean, dp: ChillDP): void {
  dp.layers = save ? mw.safe + 1 : 1;
  dp.maxC = capped ? paramsAt(w, 1).maxChill : Infinity;
  dp.save = save;
  dp.curA = true;
  dp.a.fill(DEAD, 0, dp.layers * BINS);
  dp.a.set(job.c.subarray((mw.w0 - 1) * BINS, mw.w0 * BINS), 0);
  // Layer k can only be alive after k / 2 steps of the window (a step melts at most 2): hi is the top live layer.
  dp.hi = 0;
  dp.s = mw.w0;
  dp.end = mw.w1 + TAIL;
}

/** Runs at most `maxSteps` steps of `dp` (melt rows `m` of window `mw`); true once it is done. */
function dpAdvance(w: World, job: ValidationJob, mw: MeltWin, m: Uint8Array, dp: ChillDP, maxSteps: number): boolean {
  let cur = dp.curA ? dp.a : dp.b;
  let nxt = dp.curA ? dp.b : dp.a;
  let hi = dp.hi;
  const { layers, maxC, save } = dp;
  let s = dp.s;
  for (let n = 0; s <= dp.end && n < maxSteps; s++, n++) {
    const inW = save && s <= mw.w1;
    if (s === mw.w1 + 1 && hi > 0) {
      // Past the window every live layer has saved the flake: one layer carries on through the tail.
      for (let o = BINS; o < (hi + 1) * BINS; o++) if ((cur[o] as number) > (cur[o % BINS] as number)) cur[o % BINS] = cur[o] as number;
      hi = 0;
    }
    const mo = (s - mw.w0) * BINS;
    const day = job.sDay[s] as number;
    const delta = deltaForSlot(w, day, slotTick(job, s) - dayStartTick(day));
    for (let b = 0; b < BINS; b++) dRow[b] = delta[litH(job, s, b)] as number;
    const top = inW ? Math.min(layers - 1, hi + 2) : hi;
    nxt.fill(DEAD, 0, (top + 1) * BINS);
    for (let k = 0; k <= hi; k++) {
      slidingMaxCircular(cur, TURN, win, k * BINS);
      for (let b = 0; b < BINS; b++) {
        const from = win[b] as number;
        if (from <= DEAD / 2) continue;
        let v = from + (dRow[b] as number);
        if (v <= 0) continue;
        if (v > maxC) v = maxC;
        const k2 = inW ? k + (m[mo + b] as number) : k;
        if (k2 > top) continue;
        const o = k2 * BINS + b;
        if (v > (nxt[o] as number)) nxt[o] = v;
      }
    }
    hi = top;
    const t = cur;
    cur = nxt;
    nxt = t;
  }
  dp.s = s;
  dp.hi = hi;
  dp.curA = cur === dp.a;
  return s > dp.end;
}

/** The best Chill at the end of a finished DP. */
function dpBest(dp: ChillDP): number {
  const cur = dp.curA ? dp.a : dp.b;
  let best = DEAD;
  for (let o = 0; o < (dp.hi + 1) * BINS; o++) if ((cur[o] as number) > best) best = cur[o] as number;
  return best;
}

/** The DP of the one-call helpers (contestFlake, contestCluster's C0): started and finished within one call. */
const dp0 = newChillDP();

/** The whole Chill DP over window `mw` in one call (see dpStart). */
function chillDP(w: World, job: ValidationJob, mw: MeltWin, m: Uint8Array, save: boolean, capped: boolean, dp: ChillDP = dp0): number {
  dpStart(w, job, mw, save, capped, dp);
  dpAdvance(w, job, mw, m, dp, Infinity);
  return dpBest(dp);
}

/**
 * Work units of DP steps (a unit ≈ one validator lit row ≈ DP_LAYER_STEPS slot-layers; review r5
 * measured about 2.5 µs a slot-layer, so the old 25 charged a contest DP a third of its cost);
 * the tail runs one layer.
 */
const DP_LAYER_STEPS = 10;
function dpUnits(mw: MeltWin, layers: number): number {
  return Math.ceil(((mw.w1 - mw.w0 + 1) * layers + TAIL) / DP_LAYER_STEPS);
}
/** Slot-layers a resumable DP runs per contest stage call (about one 12-unit idle slice). */
const DP_CALL = 96;
/** Steps the next call of `dp` runs, and their units. */
function dpCallSteps(dp: ChillDP): number {
  return Math.min(dp.end - dp.s + 1, Math.max(1, Math.floor(DP_CALL / dp.layers)));
}
function dpCallUnits(dp: ChillDP): number {
  return Math.max(1, Math.ceil((dpCallSteps(dp) * dp.layers) / DP_LAYER_STEPS));
}

/**
 * The contest numbers of a flake at (px, py) against the finished job `job` (tests and tools; the
 * placer calls contestCluster): its melt window, safe, freeMelt, the uncapped best Chill tailSec
 * after the window without (C0) and with (C1) the flake saved, and the capped C1 (cappedC1).
 * `minW0` 1 checks a flake's savability only (the safe line needs 2).
 */
export function contestFlake(w: World, job: ValidationJob, px: number, py: number, budget: number, minW0 = 2): FlakeContest & { cappedC1: number } {
  out.eligible = false;
  if (!meltWindow(w, job, py, budget, out, minW0)) return { ...out, cappedC1: DEAD };
  out.eligible = true;
  meltRows(w, job, px, py, out.w0, out.w1, mRows);
  out.freeMelt = out.w0 >= 2 ? freeMelt(job, out, mRows) : Infinity;
  out.c0 = chillDP(w, job, out, mRows, false, false);
  out.c1 = chillDP(w, job, out, mRows, true, false);
  return { ...out, cappedC1: chillDP(w, job, out, mRows, true, true) };
}

/** The contest verdict of a cluster: eligible (its drawn spot's window fits the job), contested, and its detour cost C0 − C1 (Chill). */
export interface ClusterContest {
  eligible: boolean;
  contested: boolean;
  cost: number;
}

/**
 * A cluster's contest test in progress (fix round 2: the placer runs it a stage per call, so one
 * idle-generation slice holds at most one stage, each at most a few lit rows or one Chill DP).
 * Stages: 0 the last flake's window, melt rows and safe line; 1 its uncapped detour cost (C0 − C1);
 * 2 its capped C1; 3 each other flake's window, melt rows and capped C1 (from the next-to-last flake
 * down to the first, `flake`); then `done`.
 */
export interface ContestRun extends ClusterContest, MeltWin {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** The cluster's flakes (evenly spaced from (x0, y0) to (x1, y1) along the trail). */
  n: number;
  savableOnly: boolean;
  stage: number;
  /** Stage 3: the index of the flake under test. */
  flake: number;
  done: boolean;
  /** Melt rows of the flake under test (MAX_W × 360), owned by the run (runs of different worlds may interleave). */
  readonly m: Uint8Array;
  /** The Chill DP under way (resumable across stage calls) and the window of the other flake under test. */
  readonly dp: ChillDP;
  readonly fw: MeltWin;
  /** The last flake's C0 (stage 1), for its cost once its C1 is done. */
  c0: number;
}

/** A contest run with its own melt rows and DP (one per world; reused cluster after cluster). */
export function newContestRun(): ContestRun {
  return {
    x0: 0, y0: 0, x1: 0, y1: 0, n: 1, savableOnly: false, stage: 0, flake: 0, done: true, eligible: false, contested: false, cost: 0,
    w0: 0, w1: 0, safe: 0, floor: 0, m: new Uint8Array(MAX_W * BINS), dp: newChillDP(), fw: { w0: 0, w1: 0, safe: 0, floor: 0 }, c0: 0,
  };
}

/** (Re)starts `run` on the cluster of `n` flakes whose first flake is at (x0, y0) and last at (x1, y1). */
export function startContest(run: ContestRun, x0: number, y0: number, x1: number, y1: number, n: number, savableOnly = false): ContestRun {
  run.x0 = x0;
  run.y0 = y0;
  run.x1 = x1;
  run.y1 = y1;
  run.n = Math.max(1, n);
  run.savableOnly = savableOnly;
  run.stage = 0;
  run.flake = 0;
  run.done = false;
  run.eligible = false;
  run.contested = false;
  run.cost = 0;
  return run;
}

// Stages: 0 the last flake's window, melt rows and safe line; 1 its C0 (one layer); 11 its uncapped C1,
// a DP_CALL slice of it a call (then the detour cost C0 − C1); 2 its capped C1, sliced alike; 3 the
// next other flake's window and melt rows; 31 its capped C1, sliced alike. The DPs keep their state in
// the run, so where a slice ends never changes a verdict.
const S_C0 = 1;
const S_C1 = 11;
const S_CAP = 2;
const S_OTHER = 3;
const S_OTHER_CAP = 31;

/** The work units the next stage of `run` will cost about (0 when done). */
export function contestStageUnits(run: ContestRun): number {
  if (run.done) return 0;
  if (run.stage === 0 || run.stage === S_OTHER) return MAX_W + 1;
  if (run.stage === S_C0) return dpUnits(run, 1);
  return dpCallUnits(run.dp);
}

/** Contest stages run so far and their work units (tests: how generation slices them). */
export const contestStats = { stages: 0, units: 0 };

/** Runs the next stage of `run` against chunk job `job`; returns the work units it took. */
export function contestStage(w: World, job: ValidationJob, run: ContestRun): number {
  const units = stageOf(w, job, run);
  contestStats.stages++;
  contestStats.units += units;
  return units;
}

/** After the last flake's stages: the other flakes from the next-to-last down, or contested when there are none. */
function nextFlake(run: ContestRun): void {
  if (run.flake < 0) {
    run.contested = true;
    run.done = true;
  } else run.stage = S_OTHER;
}

function stageOf(w: World, job: ValidationJob, run: ContestRun): number {
  const fail = (units: number): number => {
    run.done = true;
    return units;
  };
  switch (run.stage) {
    case 0: {
      if (!meltWindow(w, job, run.y1, B.meltBudget, run, 2)) return fail(1);
      run.eligible = true;
      meltRows(w, job, run.x1, run.y1, run.w0, run.w1, run.m);
      const units = run.w1 - run.w0 + 2;
      if (!run.savableOnly && freeMelt(job, run, run.m) < run.safe + 2) return fail(units);
      if (run.savableOnly) {
        dpStart(w, job, run, true, true, run.dp);
        run.stage = S_CAP;
      } else run.stage = S_C0;
      return units;
    }
    case S_C0: {
      run.c0 = chillDP(w, job, run, run.m, false, false, run.dp);
      dpStart(w, job, run, true, false, run.dp);
      run.stage = S_C1;
      return dpUnits(run, 1);
    }
    case S_C1: {
      const units = dpCallUnits(run.dp);
      if (!dpAdvance(w, job, run, run.m, run.dp, dpCallSteps(run.dp))) return units;
      run.cost = run.c0 - dpBest(run.dp);
      if (run.cost < B.costMin || run.cost > B.costMax) return fail(units);
      dpStart(w, job, run, true, true, run.dp);
      run.stage = S_CAP;
      return units;
    }
    case S_CAP: {
      const units = dpCallUnits(run.dp);
      if (!dpAdvance(w, job, run, run.m, run.dp, dpCallSteps(run.dp))) return units;
      if (dpBest(run.dp) < run.floor + B.marginChill) return fail(units);
      run.flake = run.n - 2;
      nextFlake(run);
      return units;
    }
    case S_OTHER: {
      // Every other flake must be savable too: its own window checkable in the job, and a path that
      // saves it ending at least marginChill above its floor.
      const i = run.flake;
      const y = run.n > 1 ? run.y0 + ((run.y1 - run.y0) * i) / (run.n - 1) : run.y1;
      if (!meltWindow(w, job, y, B.meltBudget, run.fw, 1)) return fail(1);
      meltRows(w, job, trailX(w.trail, y), y, run.fw.w0, run.fw.w1, run.m);
      dpStart(w, job, run.fw, true, true, run.dp);
      run.stage = S_OTHER_CAP;
      return run.fw.w1 - run.fw.w0 + 1;
    }
    default: {
      const units = dpCallUnits(run.dp);
      if (!dpAdvance(w, job, run.fw, run.m, run.dp, dpCallSteps(run.dp))) return units;
      if (dpBest(run.dp) < run.fw.floor + B.marginChill) return fail(units);
      run.flake--;
      nextFlake(run);
      return units;
    }
  }
}

const run0 = newContestRun();
const verdict: ClusterContest = { eligible: false, contested: false, cost: 0 };

/** True when the cluster whose last flake is at y would be eligible (its melt window plus tail lies inside the job). Cheap: no masks. */
export function clusterEligible(w: World, job: ValidationJob, y: number): boolean {
  return meltWindow(w, job, y, B.meltBudget, out, 2);
}

/**
 * The contest test of a cluster of `n` flakes whose first flake is at (x0, y0) and last at (x1,
 * y1), against the job of its chunk, in one go (tests and tools; the placer runs it stage by stage):
 * the last flake's freeMelt ≥ safe + 2, the uncapped detour cost C0 − C1 within [costMin, costMax],
 * the capped C1 ≥ floor + marginChill, and every other flake's capped C1 too. `savableOnly` (the
 * Glass Flakes lesson's fallback) keeps only the savability checks: a perfect player can save every
 * flake without risking the floor.
 */
export function contestCluster(w: World, job: ValidationJob, x0: number, y0: number, x1: number, y1: number, n: number, savableOnly = false): ClusterContest {
  startContest(run0, x0, y0, x1, y1, n, savableOnly);
  while (!run0.done) contestStage(w, job, run0);
  verdict.eligible = run0.eligible;
  verdict.contested = run0.contested;
  verdict.cost = run0.contested ? run0.cost : 0;
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
