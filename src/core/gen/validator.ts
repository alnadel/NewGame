// Fairness validator (V1_PLAN §7.4): a dynamic program over "best achievable Chill per sun bin"
// along Nubs' path in 0.1 s steps, with a human model (180°/s turns; a bin only counts as shaded if
// it is shaded at the previous, current and next step). When the best Chill drops below the day's
// floor it inserts a Shade Rock at the failure point (≤ 8 per chunk), then parked clouds, and
// re-runs only the steps the insertion can reach. Validation is a resumable job: each lit-mask
// computation is one work unit, so it can be time-sliced across frames.

import { TUNING } from '../../config/tuning.ts';
import { dayAtTick, dayStartTick, elevation, TICK_HZ } from '../clock.ts';
import { SUN_COS, SUN_SIN, tanD } from '../dmath.ts';
import { BINS, binOf, countPrism, createMaskScene, litMask, SAMPLE_DX, SAMPLE_DY, SAMPLES } from '../intervals.ts';
import { FLARE_DROPPED, FLARE_KEPT, FLARE_PENDING, RUNTIME_ID_BASE, type Caster, type Cloud, type Flare, type PrismPart } from '../objects.ts';
import { sunLockedAt } from '../sim/sun.ts';
import { cloudOffset, distToCasterBounds, shadowLength } from '../shadows.ts';
import { trailX } from '../trail.ts';
import { rockHeight } from './catalog.ts';
import { flareEps, liftElevation, noonHeatAt, paramsAt, worldElevation, worldYAtTick } from './plan.ts';
import { addCloud, commitRescue, findSpot, type Spot } from './placer.ts';
import { gatherScene, lowerBound, type ChunkLit, type World } from './store.ts';

const STEP = TUNING.validator.stepTicks;
const TURN = TUNING.validator.turnBins;
const DEAD = -1e9;
const CH = TUNING.world.chunkLen;
const SAMPLE_MARGIN = TUNING.nubs.sampleOffset + 1;

export interface ValidationJob {
  readonly k: number;
  /**
   * Slot s ↔ global step j0 + s − 1 − pre. Slot 0 is the entry step, slots 1..pre re-run the end of
   * the previous chunk, slots pre+1..pre+n are this chunk's steps and slot pre+n+1 is a lookahead.
   */
  readonly j0: number;
  readonly n: number;
  readonly pre: number;
  readonly sx: Float64Array;
  readonly sy: Float64Array;
  /** Absolute time (s), elevation (°) and cot ε per slot. */
  readonly sT: Float64Array;
  readonly sEps: Float64Array;
  readonly sCot: Float64Array;
  readonly sDay: Int32Array;
  /** Lit counts per slot (0..10 per bin). */
  readonly lit: Uint8Array;
  /** 1 while a slot's lit counts must be (re)computed. */
  readonly need: Uint8Array;
  /** C per slot: slot 0 is the entry carry, slot i the state after step i. */
  readonly c: Float64Array;
  dpFrom: number;
  rescues: number;
  parked: number;
  /** After an accepted (unresolved) failure, further checks wait until max C recovers. */
  accepting: boolean;
  done: boolean;
  /**
   * v1.6 keep test (§2.5): index in w.flares of the pending flare being tested (−1 none), the
   * candidate position being tried (0 = where it stands, then TUNING.flare.shiftsSec), the rows of
   * that candidate computed so far, and the flare's rise before the test.
   */
  flareQ: number;
  flareTry: number;
  flareRows: number;
  flareRise0: number;
}

const scene = createMaskScene();
const ext = new Float64Array(BINS + 2 * 64);
const blockPre = new Float64Array(BINS + 2 * 64);
const blockSuf = new Float64Array(BINS + 2 * 64);
const win = new Float64Array(BINS);

/**
 * out[b] = max over |k| ≤ r of src[srcOff + (b + k) mod 360], in O(360) (van Herk / Gil-Werman:
 * block prefix/suffix maxima over the circularly extended row). r ≤ 64.
 */
export function slidingMaxCircular(src: Float64Array, r: number, out: Float64Array, srcOff = 0): void {
  const m = 2 * r + 1;
  const len = BINS + 2 * r;
  for (let i = 0; i < len; i++) {
    let s = i - r;
    if (s < 0) s += BINS;
    else if (s >= BINS) s -= BINS;
    ext[i] = src[srcOff + s] as number;
  }
  for (let start = 0; start < len; start += m) {
    const end = start + m < len ? start + m : len;
    let acc = ext[start] as number;
    blockPre[start] = acc;
    for (let i = start + 1; i < end; i++) {
      const v = ext[i] as number;
      if (v > acc) acc = v;
      blockPre[i] = acc;
    }
    acc = ext[end - 1] as number;
    blockSuf[end - 1] = acc;
    for (let i = end - 2; i >= start; i--) {
      const v = ext[i] as number;
      if (v > acc) acc = v;
      blockSuf[i] = acc;
    }
  }
  for (let b = 0; b < BINS; b++) {
    const x = blockSuf[b] as number;
    const y = blockPre[b + m - 1] as number;
    out[b] = x > y ? x : y;
  }
}

const deltaTables = new Map<string, Float64Array>();

/** Chill change over one 0.1 s step for each lit count 0..10 (f = lit/5), under a drain and a daylight regen (default 30/s). */
export function chillDeltaTable(drain: number, regen: number = TUNING.nubs.regen): Float64Array {
  const key = `${drain}/${regen}`;
  const hit = deltaTables.get(key);
  if (hit) return hit;
  const t = new Float64Array(11);
  const dt = STEP / TICK_HZ;
  for (let c = 0; c <= 10; c++) {
    const f = c / 5;
    t[c] = (-drain * f + regen * Math.max(0, 1 - f)) * dt;
  }
  deltaTables.set(key, t);
  return t;
}

/** The drain the validator's DP charges in world `w`: the level's (or the profile's) × the concepts' drainMul. */
export function validatorDrain(w: World): number {
  return w.validatorDrain * paramsAt(w, 1).drainMul;
}

/** Per world: Chill-delta tables per (day, inside the Noon Heat window), index 2·day + window. */
const slotDeltas = new WeakMap<World, (Float64Array | undefined)[]>();

/**
 * v1.6 Noon Heat (docs/V1_6_PLAN.md §2.5, T1): the DP's Chill-delta table for the slot at (day,
 * dayTick), chillDeltaTable(validatorDrain(w) · noonHeatAt(…), regen), cached per (day, in window).
 * Outside the window (and on worlds without Noon Heat) it is the plain table.
 */
export function deltaForSlot(w: World, day: number, dayTick: number): Float64Array {
  const h = noonHeatAt(w, day, dayTick);
  const key = 2 * day + (h !== 1 ? 1 : 0);
  let memo = slotDeltas.get(w);
  if (!memo) {
    memo = [];
    slotDeltas.set(w, memo);
  }
  let t = memo[key];
  if (!t) {
    t = chillDeltaTable(validatorDrain(w) * h, paramsAt(w, 1).regen);
    memo[key] = t;
  }
  return t;
}

/** deltaForSlot of job slot s (its day and the dayTick of its absolute time). */
function slotDelta(w: World, job: ValidationJob, s: number): Float64Array {
  const day = job.sDay[s] as number;
  return deltaForSlot(w, day, Math.round((job.sT[s] as number) * TICK_HZ) - dayStartTick(day));
}

/**
 * v1.6 (§2.3): a finished job's rows for the glass pass (CORE-2): lit counts (slots × 360), the DP
 * Chill rows `c` (slots × 360; slot 0 is the entry carry), the slot count and slot 0's absolute
 * tick (slot s is at slot0Tick + s · stepTicks). Reads the job's buffers; valid until the next job
 * of the world starts (it reuses them).
 */
export function jobRows(job: ValidationJob): { lit: Uint8Array; c: Float64Array; slots: number; slot0Tick: number } {
  return { lit: job.lit, c: job.c, slots: job.pre + job.n + 2, slot0Tick: (job.j0 - 1 - job.pre) * STEP };
}

/** Fills a step's geometry: Nubs' position, time, elevation (0 at night). */
function stepGeometry(w: World, j: number, job: ValidationJob, s: number): void {
  const tick = j * STEP;
  const day = dayAtTick(tick);
  const p = paramsAt(w, day);
  const y = worldYAtTick(w, tick);
  const tDay = (tick - dayStartTick(day)) / TICK_HZ;
  const eps = j < 0 ? 0 : liftElevation(w, p, tick, elevation(p, tDay));
  job.sx[s] = trailX(w.trail, y);
  job.sy[s] = y;
  job.sT[s] = tick / TICK_HZ;
  job.sEps[s] = eps;
  job.sCot[s] = eps > 0 ? 1 / tanD(eps) : 0;
  job.sDay[s] = day;
}

/** Starts validating chunk k (the next chunk after w.validatedThrough). */
export function beginValidation(w: World, k: number): ValidationJob {
  const j0 = w.nextStep;
  const pre = w.carryN;
  let n = 0;
  while (worldYAtTick(w, (j0 + n) * STEP) < (k + 1) * CH) n++;
  const slots = pre + n + 2;
  // Reuse the previous job's buffers (one job per world at a time); all reads stay within slots.
  const old = w.lastJob && w.lastJob.need.length >= slots ? w.lastJob : null;
  const cap = old ? old.need.length : Math.max(slots, 128);
  const job: ValidationJob = {
    k,
    j0,
    n,
    pre,
    sx: old ? old.sx : new Float64Array(cap),
    sy: old ? old.sy : new Float64Array(cap),
    sT: old ? old.sT : new Float64Array(cap),
    sEps: old ? old.sEps : new Float64Array(cap),
    sCot: old ? old.sCot : new Float64Array(cap),
    sDay: old ? old.sDay : new Int32Array(cap),
    lit: old ? old.lit : new Uint8Array(cap * BINS),
    need: old ? old.need : new Uint8Array(cap),
    c: old ? old.c : new Float64Array(cap * BINS),
    dpFrom: 1,
    rescues: 0,
    parked: 0,
    accepting: false,
    done: false,
    flareQ: -1,
    flareTry: 0,
    flareRows: 0,
    flareRise0: 0,
  };
  for (let s = 0; s < slots; s++) stepGeometry(w, j0 + s - 1 - pre, job, s);
  if (w.flares.length > 0) startFlareTest(w, job, findFlareTest(w, job));
  // The entry step and the re-run prefix come from the carry (their DP rows stay valid until a
  // rescue touches them); this chunk's steps must be computed.
  job.lit.set(w.carryLit.subarray(0, (pre + 1) * BINS), 0);
  job.c.set(w.carryC.subarray(0, (pre + 1) * BINS), 0);
  job.need.fill(0, 0, pre + 1);
  job.need.fill(1, pre + 1, slots);
  job.dpFrom = pre + 1;
  return job;
}

function computeLit(w: World, job: ValidationJob, s: number): void {
  const out = job.lit.subarray(s * BINS, (s + 1) * BINS);
  if (job.sEps[s] as number <= 0) {
    out.fill(0);
    return;
  }
  const x = job.sx[s] as number;
  const y = job.sy[s] as number;
  gatherScene(w, scene, x, y, SAMPLE_MARGIN, job.sT[s] as number, job.sEps[s] as number, job.sCot[s] as number, false);
  litMask(scene, x, y, true, out, null);
}

/** Marks slots whose samples a new caster can reach; returns the first marked slot (or −1). */
function markDirtyCaster(job: ValidationJob, c: Caster): number {
  let first = -1;
  for (let s = 1; s <= job.pre + job.n + 1; s++) {
    if ((job.sEps[s] as number) <= 0) continue;
    const reach = shadowLength(c.maxZ, job.sCot[s] as number) + SAMPLE_MARGIN;
    if (distToCasterBounds(c, job.sx[s] as number, job.sy[s] as number) <= reach) {
      job.need[s] = 1;
      if (first < 0) first = s;
    }
  }
  return first;
}

function markDirtyCloud(job: ValidationJob, cl: Cloud): number {
  let first = -1;
  for (let s = 1; s <= job.pre + job.n + 1; s++) {
    const t = job.sT[s] as number;
    if (t < cl.t0 || t > cl.t0 + cl.life) continue;
    job.need[s] = 1;
    if (first < 0) first = s;
  }
  return first;
}

/**
 * Runs the DP for slot i. Returns max C after the step. `maxC` is the world's max Chill. Night
 * steps refill to maxC with the sun anywhere; so does the ground before a campaign level's start
 * and past its finish line (unused stretches), and the first step at the start holds only θ0 (the
 * run begins with the sun on the start hut), as createWorld's carry does at Day 1 dawn.
 */
function dpSlot(w: World, job: ValidationJob, i: number, delta: Float64Array, maxC: number): number {
  const c = job.c;
  const o = i * BINS;
  if ((job.sEps[i] as number) <= 0 || (job.sy[i] as number) > w.finishY) {
    c.fill(maxC, o, o + BINS); // night (or before the run): Chill refills, the sun can be anywhere
    return maxC;
  }
  if (w.startTick > 0) {
    const tick = Math.round((job.sT[i] as number) * TICK_HZ);
    if (tick < w.startTick) {
      c.fill(maxC, o, o + BINS);
      return maxC;
    }
    if (tick - STEP < w.startTick) {
      c.fill(DEAD, o, o + BINS);
      c[o + binOf(w.theta0)] = maxC;
      return maxC;
    }
  }
  slidingMaxCircular(c, TURN, win, (i - 1) * BINS);
  const lit = job.lit;
  const a = (i - 1) * BINS;
  const b0 = i * BINS;
  const c0 = (i + 1) * BINS;
  let best = DEAD;
  for (let b = 0; b < BINS; b++) {
    let lh = lit[a + b] as number;
    const l1 = lit[b0 + b] as number;
    const l2 = lit[c0 + b] as number;
    if (l1 > lh) lh = l1;
    if (l2 > lh) lh = l2;
    let v = (win[b] as number) + (delta[lh] as number);
    if (v > maxC) v = maxC;
    else if (v <= 0) v = DEAD;
    c[o + b] = v;
    if (v > best) best = v;
  }
  return best;
}

function argmaxSlot(job: ValidationJob, i: number): number {
  let best = 0;
  let bv = -Infinity;
  for (let b = 0; b < BINS; b++) {
    const v = job.c[i * BINS + b] as number;
    if (v > bv) {
      bv = v;
      best = b;
    }
  }
  return best;
}

// Rescue placement scratch.
/** Candidate rock positions along the trail: the failure point, then neighbouring wall slots. */
const RESCUE_PITCH = TUNING.rescue.d + TUNING.world.overlapMargin;
const RESCUE_DY = [0, -1, 1, -2, 2, -3, 3, -4, 4].map((k) => k * RESCUE_PITCH);
const SCORE_BEFORE = 8;
const SCORE_AFTER = 2;
const rescueW = new Float64Array(BINS);
const rescueReach = new Float64Array(BINS);
const fullMasks = new Uint8Array(BINS * (SCORE_BEFORE + SCORE_AFTER + 3));

/**
 * How much a candidate rock would help around failure slot f: over slots f−8..f+2, the bins where
 * it alone fully shades all 5 samples for three consecutive steps (the human model's rule),
 * weighted by how good those bins are for the DP (best Chill at f−1, spread by two steps of turning).
 */
function rescueScore(job: ValidationJob, f: number, rock: PrismPart): number {
  const last = job.pre + job.n + 1;
  const s0 = Math.max(0, f - SCORE_BEFORE - 1);
  const s1 = Math.min(last, f + SCORE_AFTER + 1);
  for (let s = s0; s <= s1; s++) {
    const full = fullMasks.subarray((s - s0) * BINS, (s - s0 + 1) * BINS);
    if ((job.sEps[s] as number) <= 0) {
      full.fill(0);
      continue;
    }
    const cot = job.sCot[s] as number;
    full.fill(0);
    for (let k = 0; k < SAMPLES; k++) {
      countPrism(full, rock, (job.sx[s] as number) + (SAMPLE_DX[k] as number), (job.sy[s] as number) + (SAMPLE_DY[k] as number), cot);
    }
  }
  let score = 0;
  for (let s = s0 + 1; s < s1; s++) {
    const o = (s - s0) * BINS;
    for (let b = 0; b < BINS; b++) {
      if (fullMasks[o - BINS + b] === SAMPLES && fullMasks[o + b] === SAMPLES && fullMasks[o + BINS + b] === SAMPLES) {
        score += rescueReach[b] as number;
      }
    }
  }
  return score;
}

/**
 * Inserts the most useful Shade Rock near failure slot f: same rock as V1_PLAN §7.3 (30×30,
 * h = clamp(40·tan ε + 20, 60, 160), nearest edge 20 u from the centerline), but its side and its
 * position along the trail (±108 u of the failure point) are chosen to shade the angles the DP can
 * actually be at, so consecutive rescues grow into a wall instead of piling up. Falls back to the
 * failure point itself, sides alternating.
 */
function placeRescue(w: World, job: ValidationJob, f: number): Caster | null {
  const row = job.c.subarray((f - 1) * BINS, f * BINS);
  let maxC = DEAD;
  for (let b = 0; b < BINS; b++) if ((row[b] as number) > maxC) maxC = row[b] as number;
  for (let b = 0; b < BINS; b++) {
    const v = row[b] as number;
    rescueW[b] = v > DEAD / 2 ? Math.max(0, (v - (maxC - 40)) / 40) : 0;
  }
  slidingMaxCircular(rescueW, 2 * TURN, rescueReach);
  const yF = job.sy[f] as number;
  const h = rockHeight(tanD(job.sEps[f] as number));
  const first = w.rescueSide;
  w.rescueSide = first > 0 ? -1 : 1;
  let best: Spot | null = null;
  let bestY = yF;
  let bestSide: -1 | 1 = first;
  let bestScore = 0;
  for (const dy of RESCUE_DY) {
    for (const side of [first, w.rescueSide] as const) {
      const spot = findSpot(w, 'rock', yF + dy, side, TUNING.rescue.edge, 0, h, 3);
      if (!spot) continue;
      const score = rescueScore(job, f, spot.parts[0] as PrismPart);
      if (score > bestScore) {
        best = spot;
        bestScore = score;
        bestY = yF + dy;
        bestSide = side;
      }
    }
  }
  if (!best) {
    for (const side of [first, w.rescueSide] as const) {
      best = findSpot(w, 'rock', yF, side, TUNING.rescue.edge, 0, h, TUNING.world.pushMax);
      if (best) {
        bestSide = side;
        break;
      }
    }
  }
  return best ? commitRescue(w, best, bestY, bestSide, job.k) : null;
}

/**
 * Where the DP resumes after an insertion first touching slot `first` (−1: none) during a failure
 * at slot i: one slot before the first changed lit row (the 3-step max reaches back one step), but
 * never past i, since rows after the failure were not computed in this pass.
 */
function resumeSlot(i: number, first: number): number {
  if (first < 0) return i;
  return Math.max(1, Math.min(i, first - 1));
}

/** Handles a failure at slot i; returns the DP slot to resume from. */
function onFailure(w: World, job: ValidationJob, i: number, floor: number, maxC: number): number {
  if (job.rescues < TUNING.rescue.maxPerChunk) {
    job.rescues++;
    w.stats.rescues++;
    const rock = placeRescue(w, job, i);
    const first = rock ? markDirtyCaster(job, rock) : -1;
    return resumeSlot(i, first);
  }
  if (job.parked < TUNING.rescue.maxParked) {
    job.parked++;
    w.stats.parkedClouds++;
    // Park a cloud exactly R(ε) from the path toward the best reachable bin, riding with Nubs (at v,
    // following the trail's chord) for 6 s centered on the failure.
    const b = argmaxSlot(job, i - 1);
    const R = cloudOffset(TUNING.shadow.cloudZ, job.sCot[i] as number);
    const cx = (job.sx[i] as number) + (SUN_COS[b] as number) * R;
    const cy = (job.sy[i] as number) + (SUN_SIN[b] as number) * R;
    const v = paramsAt(w, job.sDay[i] as number).v;
    const half = TUNING.rescue.parkedLife / 2;
    const yF = job.sy[i] as number;
    const vx = (trailX(w.trail, yF + v * half) - trailX(w.trail, yF - v * half)) / (2 * half);
    const cl = addCloud(w, 'parked', (job.sT[i] as number) - half, 2 * half, cx - vx * half, cy - v * half, vx, v, TUNING.cloud.rxMax);
    const first = markDirtyCloud(job, cl);
    return resumeSlot(i, first);
  }
  // Accept: count it, lift the frontier to the floor so the rest of the chunk is still checked.
  w.stats.unresolved++;
  job.accepting = true;
  const row = job.c.subarray(i * BINS, (i + 1) * BINS);
  if (maxC <= DEAD / 2) row.fill(floor);
  else for (let b = 0; b < BINS; b++) if ((row[b] as number) > DEAD / 2) row[b] = (row[b] as number) + (floor - maxC);
  return i + 1;
}

function finish(w: World, job: ValidationJob): void {
  const { pre, n } = job;
  const last = pre + n;
  // Carry the last steps (and the DP state entering them) into the next chunk's job.
  const carry = Math.min(TUNING.validator.prefixSteps, last);
  w.carryN = carry;
  w.carryC.set(job.c.subarray((last - carry) * BINS, (last + 1) * BINS));
  w.carryLit.set(job.lit.subarray((last - carry) * BINS, (last + 1) * BINS));
  w.nextStep = job.j0 + n;
  // Rescues may have changed the re-run prefix: refresh the previous chunk's cached lit rows.
  const prev = w.chunkLit[w.chunkLit.length - 1];
  if (prev) {
    for (let s = 1; s <= pre; s++) {
      const j = job.j0 + s - 1 - pre;
      if (j >= prev.j0 && j < prev.j0 + prev.n) prev.lit.set(job.lit.subarray(s * BINS, (s + 1) * BINS), (j - prev.j0) * BINS);
    }
  }
  w.chunkLit.push({ k: job.k, j0: job.j0, n, lit: job.lit.slice((pre + 1) * BINS, (last + 1) * BINS) });
  w.stats.rescuesPerChunk[job.k] = job.rescues;
  w.stats.chunksValidated++;
  w.validatedThrough = job.k;
  w.lastJob = job;
  job.done = true;
}

// ---------------------------------------------------------------------------------------------
// v1.6 Heat Flares: the keep test (docs/V1_6_PLAN.md §2.5).
//
// A pending flare is decided by the job of the chunk whose own steps hold its window [rise − 1
// step, end] (a flare straddling the chunk's end moves the least way into one chunk), before that
// chunk's lit rows are computed, so the rows, the DP, its rescues and the stepLit cache all see the
// lift. It is kept only if (a) a parry exists: some path turning ≤ turnBins per step, starting
// anywhere at rise − 1 step, is shaded (3-step rule) on ≥ keepShadedShare of the hold steps; and
// (b) the shade moves: fewer than keepMovedShare of the bins safe at the first hold step without the
// flare stay safe with it. Otherwise it is shifted by TUNING.flare.shiftsSec and retested, then
// dropped. One lit row is one work unit (KEEP_ROWS per candidate).

const FL = TUNING.flare;
/** Candidate offsets of a flare's rise (ticks): where it stands, then the shifts. */
const FLARE_TRIES: readonly number[] = [0, ...FL.shiftsSec.map((sec) => Math.round(sec * TICK_HZ))];
const HOLD_STEPS = Math.round(FL.holdTicks / STEP);
/** Lifted rows from the step before the hold to the step after it, then the hold's first step without the flare. */
export const KEEP_ROWS = HOLD_STEPS + 3;
const keepLit = new Uint8Array(KEEP_ROWS * BINS);
const keepScene = createMaskScene();
const keepG = new Float64Array(BINS);
const keepWin = new Float64Array(BINS);
const keepCand: { -readonly [K in keyof Flare]: Flare[K] } = { id: 0, day: 0, d: 0, warnTick: 0, riseTick: 0, holdTick: 0, fallTick: 0, endTick: 0, state: FLARE_PENDING };
/** Eclipse window length (ticks; gen/world.ts ECLIPSE_SEC, not imported to keep the module graph acyclic). */
const ECLIPSE_TICKS = 6 * TICK_HZ;

/** Moves every tick of flare f by dt. */
function shiftFlare(f: Flare, dt: number): void {
  f.warnTick += dt;
  f.riseTick += dt;
  f.holdTick += dt;
  f.fallTick += dt;
  f.endTick += dt;
}

/** Keeps w.flares sorted by rise after flare i moved; returns its new index. */
function resortFlare(w: World, i: number): number {
  const fl = w.flares;
  const f = fl[i] as Flare;
  let j = i;
  while (j > 0 && (fl[j - 1] as Flare).riseTick > f.riseTick) {
    fl[j] = fl[j - 1] as Flare;
    j--;
  }
  while (j < fl.length - 1 && (fl[j + 1] as Flare).riseTick < f.riseTick) {
    fl[j] = fl[j + 1] as Flare;
    j++;
  }
  fl[j] = f;
  return j;
}

/** The first tick a flare's window may touch in this job: its re-run prefix's first step (slot 1). */
function rangeFirst(job: ValidationJob): number {
  return (job.j0 - job.pre) * STEP;
}

/** The job's last own step (absolute tick). */
function ownLast(job: ValidationJob): number {
  return (job.j0 + job.n - 1) * STEP;
}

/**
 * The index of the next pending flare this job decides, or −1: the first pending flare whose
 * window ends within the job's own steps (one that runs past them waits for the next job, whose
 * re-run prefix holds its start). A level's flare that starts before the job's range moves into it.
 */
function findFlareTest(w: World, job: ValidationJob): number {
  const A = rangeFirst(job);
  const T1 = ownLast(job);
  const fl = w.flares;
  for (let i = 0; i < fl.length; i++) {
    const f = fl[i] as Flare;
    if (f.state !== FLARE_PENDING) continue;
    if (f.endTick > T1) return -1;
    if (f.riseTick - STEP < A) {
      shiftFlare(f, A + STEP - f.riseTick);
      i = resortFlare(w, i) - 1;
      continue;
    }
    return i;
  }
  return -1;
}

function startFlareTest(w: World, job: ValidationJob, i: number): void {
  job.flareQ = i;
  job.flareTry = 0;
  job.flareRows = 0;
  job.flareRise0 = i >= 0 ? (w.flares[i] as Flare).riseTick : 0;
}

/** True when a lock window of the 'lock' concept touches daylight ticks [a, b) (sun.ts sunLockedAt). */
function lockTouches(w: World, a: number, b: number): boolean {
  if (!w.mods.has('lock')) return false;
  for (let t = a; t < b; t++) if (sunLockedAt(t)) return true;
  return false;
}

/**
 * Whether candidate c of flare index i may stand there: inside the job's range (re-run prefix and
 * own steps), in daylight and clear of noon,
 * clear of its neighbours (Endless: rises TUNING.flare.gapSec apart; Journey: a warning may start
 * during the previous flare's fall, never sooner), of the eclipse window and of lock windows.
 */
function candidateFits(w: World, job: ValidationJob, i: number, c: Flare): boolean {
  if (c.riseTick - STEP < rangeFirst(job) || c.endTick > ownLast(job)) return false;
  const day = dayAtTick(c.warnTick);
  const t0 = dayStartTick(day);
  const dl = Math.round(paramsAt(w, day).dayLen * TICK_HZ);
  if (c.warnTick < t0 || c.endTick > t0 + dl) return false;
  // Flares avoid noon (the Noon Heat window 11 AM-1 PM, [5/12, 7/12) of the day).
  if (12 * (c.endTick - t0) > 5 * dl && 12 * (c.riseTick - t0) < 7 * dl) return false;
  const fl = w.flares;
  const gap = Math.round(FL.gapSec * TICK_HZ);
  for (let k = i - 1; k >= 0; k--) {
    const p = fl[k] as Flare;
    if (p.state === FLARE_DROPPED) continue;
    if (w.level ? c.warnTick < p.fallTick : c.riseTick - p.riseTick < gap) return false;
    break;
  }
  for (let k = i + 1; k < fl.length; k++) {
    const q = fl[k] as Flare;
    if (q.state === FLARE_DROPPED) continue;
    if (w.level ? q.warnTick < c.fallTick : q.riseTick - c.riseTick < gap) return false;
    break;
  }
  if (w.eclipseTick >= 0 && c.warnTick < w.eclipseTick + ECLIPSE_TICKS && c.endTick > w.eclipseTick) return false;
  if (lockTouches(w, c.riseTick - FL.riseTicks - t0, c.endTick - t0)) return false;
  return true;
}

/** Lit counts (validator rules) at absolute tick `tick` with flare c's lift (null: without) into `out`. */
function keepRow(w: World, c: Flare | null, tick: number, out: Uint8Array): void {
  const day = dayAtTick(tick);
  const p = paramsAt(w, day);
  const base = elevation(p, (tick - dayStartTick(day)) / TICK_HZ);
  const eps = c ? flareEps(w, p, c, tick, base) : base;
  if (eps <= 0) {
    out.fill(0);
    return;
  }
  const y = worldYAtTick(w, tick);
  const x = trailX(w.trail, y);
  gatherScene(w, keepScene, x, y, SAMPLE_MARGIN, tick / TICK_HZ, eps, 1 / tanD(eps), false);
  litMask(keepScene, x, y, true, out, null);
}

/**
 * The keep test's verdict over a candidate's rows (keepRows: the lifted rows from the step before
 * the hold to the step after it, then the hold's first step without the flare): the most shaded
 * hold steps a turn-limited path gets (a), the share of the bins safe without the flare that stay
 * safe with it (b), and whether the flare is kept.
 */
export function keepVerdict(rows: Uint8Array): { parry: number; moved: number; kept: boolean } {
  keepG.fill(0);
  for (let r = 1; r <= HOLD_STEPS; r++) {
    slidingMaxCircular(keepG, TURN, keepWin);
    const a = (r - 1) * BINS;
    for (let b = 0; b < BINS; b++) {
      const lh = Math.max(rows[a + b] as number, rows[a + BINS + b] as number, rows[a + 2 * BINS + b] as number);
      keepG[b] = (keepWin[b] as number) + (lh === 0 ? 1 : 0);
    }
  }
  let parry = 0;
  for (let b = 0; b < BINS; b++) if ((keepG[b] as number) > parry) parry = keepG[b] as number;
  const base = (KEEP_ROWS - 1) * BINS;
  let safe0 = 0;
  let stay = 0;
  for (let b = 0; b < BINS; b++) {
    if (rows[base + b] !== 0) continue;
    safe0++;
    if (rows[BINS + b] === 0) stay++;
  }
  // Nothing safe without the flare: whatever shade the flare offers is new, so it moved.
  const moved = safe0 > 0 ? stay / safe0 : 0;
  const kept = parry >= Math.ceil(FL.keepShadedShare * HOLD_STEPS - 1e-9) && moved < FL.keepMovedShare;
  return { parry, moved, kept };
}

/** Every keep-test row of flare f where it stands, into `out` (KEEP_ROWS × 360; tests and tools). */
export function keepRows(w: World, f: Flare, out: Uint8Array = new Uint8Array(KEEP_ROWS * BINS)): Uint8Array {
  for (let r = 0; r < KEEP_ROWS - 1; r++) keepRow(w, f, f.holdTick + (r - 1) * STEP, out.subarray(r * BINS, (r + 1) * BINS));
  keepRow(w, null, f.holdTick, out.subarray((KEEP_ROWS - 1) * BINS, KEEP_ROWS * BINS));
  return out;
}

/** One unit of the keep test: a lit row of the current candidate, or (free) a verdict and the next candidate or flare. */
function keepStep(w: World, job: ValidationJob): number {
  const f = w.flares[job.flareQ] as Flare;
  if (job.flareRows === 0) {
    // Set up the next candidate that fits; none left: drop the flare where it stood.
    for (;;) {
      if (job.flareTry >= FLARE_TRIES.length) {
        shiftFlare(f, job.flareRise0 - f.riseTick);
        f.state = FLARE_DROPPED;
        resortFlare(w, job.flareQ);
        startFlareTest(w, job, findFlareTest(w, job));
        return 0;
      }
      const dt = job.flareRise0 + (FLARE_TRIES[job.flareTry] as number) - f.riseTick;
      keepCand.d = f.d;
      keepCand.warnTick = f.warnTick + dt;
      keepCand.riseTick = f.riseTick + dt;
      keepCand.holdTick = f.holdTick + dt;
      keepCand.fallTick = f.fallTick + dt;
      keepCand.endTick = f.endTick + dt;
      if (candidateFits(w, job, job.flareQ, keepCand)) break;
      job.flareTry++;
    }
  }
  if (job.flareRows < KEEP_ROWS) {
    const r = job.flareRows;
    const lifted = r < KEEP_ROWS - 1;
    keepRow(w, lifted ? keepCand : null, lifted ? keepCand.holdTick + (r - 1) * STEP : keepCand.holdTick, keepLit.subarray(r * BINS, (r + 1) * BINS));
    job.flareRows++;
    return 1;
  }
  job.flareRows = 0;
  if (!keepVerdict(keepLit).kept) {
    job.flareTry++;
    return 0;
  }
  shiftFlare(f, keepCand.riseTick - f.riseTick);
  f.state = FLARE_KEPT;
  resortFlare(w, job.flareQ);
  // The chunk's geometry now carries the lift. Its own lit rows are computed after the test; rows of
  // the re-run prefix inside the window are recomputed, and the DP re-runs from the step before them.
  const slots = job.pre + job.n + 2;
  for (let s = 0; s < slots; s++) {
    stepGeometry(w, job.j0 + s - 1 - job.pre, job, s);
    const tick = (job.j0 + s - 1 - job.pre) * STEP;
    if (s >= 1 && s <= job.pre && tick >= f.riseTick && tick < f.endTick) {
      job.need[s] = 1;
      if (s - 1 < job.dpFrom) job.dpFrom = Math.max(1, s - 1);
    }
  }
  startFlareTest(w, job, findFlareTest(w, job));
  return 0;
}

/**
 * Advances a validation job by at most `budget` work units (one per lit computation; the DP is
 * cheap and runs in the same call). Returns the units used.
 */
export function stepValidation(w: World, job: ValidationJob, budget: number): number {
  const maxC = paramsAt(w, 1).maxChill;
  let used = 0;
  while (!job.done) {
    // 0) v1.6: the keep test of the pending flares this chunk holds, before its lit rows.
    if (job.flareQ >= 0) {
      if (used >= budget) return used;
      used += keepStep(w, job);
      continue;
    }
    // 1) (Re)compute pending lit slots in order.
    let pending = -1;
    for (let s = 1; s <= job.pre + job.n + 1; s++) {
      if (job.need[s] === 1) {
        pending = s;
        break;
      }
    }
    if (pending >= 0) {
      if (used >= budget) return used;
      computeLit(w, job, pending);
      job.need[pending] = 0;
      used++;
      continue;
    }
    // 2) DP forward from dpFrom; on failure, insert a fallback and resume.
    let i = job.dpFrom;
    let resume = -1;
    for (; i <= job.pre + job.n; i++) {
      const best = dpSlot(w, job, i, slotDelta(w, job, i), maxC);
      // The floor scales with the level's tank (ration: 50 of 100 at Day 1 keeps the ratio).
      const floor = (paramsAt(w, job.sDay[i] as number).floor * maxC) / TUNING.nubs.maxChill;
      if (job.accepting) {
        if (best >= floor) job.accepting = false;
        continue;
      }
      if (best < floor) {
        resume = onFailure(w, job, i, floor, best);
        break;
      }
    }
    if (resume < 0) {
      finish(w, job);
      break;
    }
    job.dpFrom = resume;
  }
  w.stats.work += used;
  return used;
}

const stepScene = createMaskScene();
const MAX_R = TUNING.world.maxCasterRadius;

/**
 * Like stepLit, but with what the run made (v1.5 sunflowers and the Cold Snap's cloud) counted: the
 * row is recomputed live (clouds as circles of ry) when such an object can reach the step, else it
 * is the validator's cached row. The oracle plans with it. Returns true when it recomputed.
 */
export function stepLitLive(w: World, j: number, out: Uint8Array): boolean {
  const tick = j * STEP;
  const eps = worldElevation(w, tick);
  if (eps <= 0) {
    out.fill(0);
    return false;
  }
  const y = worldYAtTick(w, tick);
  const x = trailX(w.trail, y);
  const cot = 1 / tanD(eps);
  const t = tick / TICK_HZ;
  let live = false;
  for (const cl of w.clouds) {
    if (cl.id >= RUNTIME_ID_BASE && t >= cl.t0 && t <= cl.t0 + cl.life) {
      live = true;
      break;
    }
  }
  if (!live) {
    const reach = shadowLength(w.maxZ, cot) + SAMPLE_MARGIN;
    const cs = w.casters;
    for (let i = lowerBound(cs, y - reach - MAX_R); i < cs.length; i++) {
      const c = cs[i] as Caster;
      if (c.y > y + reach + MAX_R) break;
      if (c.id >= RUNTIME_ID_BASE && distToCasterBounds(c, x, y) <= shadowLength(c.maxZ, cot) + SAMPLE_MARGIN) {
        live = true;
        break;
      }
    }
  }
  if (!live) {
    stepLit(w, j, out);
    return false;
  }
  gatherScene(w, stepScene, x, y, SAMPLE_MARGIN, t, eps, cot, true);
  litMask(stepScene, x, y, true, out, null);
  return true;
}

/**
 * Validator lit counts (0..10 per bin) for global step j (absolute tick 6·j), copied into out.
 * Reads the per-chunk cache when available, otherwise computes them (clouds as circles of ry).
 */
export function stepLit(w: World, j: number, out: Uint8Array): void {
  const cache = w.chunkLit;
  for (let i = cache.length - 1; i >= 0; i--) {
    const c = cache[i] as ChunkLit;
    if (j >= c.j0 && j < c.j0 + c.n) {
      out.set(c.lit.subarray((j - c.j0) * BINS, (j - c.j0 + 1) * BINS));
      return;
    }
    if (j >= c.j0 + c.n) break;
  }
  const tick = j * STEP;
  const eps = worldElevation(w, tick);
  if (eps <= 0) {
    out.fill(0);
    return;
  }
  const y = worldYAtTick(w, tick);
  const x = trailX(w.trail, y);
  gatherScene(w, stepScene, x, y, SAMPLE_MARGIN, tick / TICK_HZ, eps, 1 / tanD(eps), false);
  litMask(stepScene, x, y, true, out, null);
}
