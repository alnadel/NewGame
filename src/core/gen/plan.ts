// The Day Plan (V1_1_PLAN CO2): every day of a plan-on world draws its biome and forecast. Day 1's
// biome is a coin flip, then biomes alternate; forecasts are weighted draws (config/forecasts.ts)
// that never repeat a non-clear forecast on consecutive days. Plan-off worlds (v1.0 links, old
// Dailies, onboarding profiles) keep the alternating clear days. Every reader of a day's knobs goes
// through worldPlan / paramsAt, so nothing derives the biome from day parity.

import { dayParams, dayPlan, legacyPlan, type BiomeId, type DayParams, type DayPlan } from '../../config/days.ts';
import { FORECAST_IDS, forecastFits, PLAN_WEIGHTS, type ForecastId } from '../../config/forecasts.ts';
import { TUNING } from '../../config/tuning.ts';
import { dayAtTick, dayStartTick, dayStartY, dayTicks, elevation, TICK_HZ, timeAtY, yAtDayTick, yAtTick, yAtTime, type YTime } from '../clock.ts';
import { FLARE_KEPT, type Flare } from '../objects.ts';
import { rngFor } from '../rng.ts';
import type { World } from './store.ts';

const weights = new Float64Array(FORECAST_IDS.length);

/** Day d's plan, given the previous day's (null on Day 1), from the stream (seed, 'plan', d). */
function drawPlan(seed: number, d: number, prev: DayPlan | null): DayPlan {
  const r = rngFor(seed, 'plan', d);
  const biome: BiomeId = prev === null ? (r.next() < 0.5 ? 'meadow' : 'oldtown') : prev.biome === 'meadow' ? 'oldtown' : 'meadow';
  let total = 0;
  let last = 0;
  for (let i = 0; i < FORECAST_IDS.length; i++) {
    const id = FORECAST_IDS[i] as ForecastId;
    let wt = 0;
    if (forecastFits(id, biome)) {
      if (prev === null) wt = PLAN_WEIGHTS.day1[i] as number;
      else if (id === 'clear') wt = PLAN_WEIGHTS.laterClear;
      else if (id !== prev.forecast) wt = PLAN_WEIGHTS.later;
    }
    weights[i] = wt;
    total += wt;
    if (wt > 0) last = i;
  }
  let x = r.next() * total;
  for (let i = 0; i < FORECAST_IDS.length; i++) {
    x -= weights[i] as number;
    if (x < 0) return dayPlan(biome, FORECAST_IDS[i] as ForecastId);
  }
  return dayPlan(biome, FORECAST_IDS[last] as ForecastId);
}

/**
 * The Day Plan entry of day `day` for a plan-on world of `seed` (pure; iterates from Day 1). The UI
 * can preview any Daily with planDay(dailySeed(date), 1).
 */
export function planDay(seed: number, day: number): DayPlan {
  const n = Math.max(1, Math.floor(day));
  let p: DayPlan | null = null;
  for (let d = 1; d <= n; d++) p = drawPlan(seed >>> 0, d, p);
  return p as DayPlan;
}

/**
 * The plan of `day` in world `w` (memoised in w.plan). Plan-off: odd days Meadow, even days Old
 * Town, clear. A forced forecast (RunConfig.forecast) replaces every day's forecast where it fits
 * the biome and makes the other days clear; the biomes still come from planDay. A forced Day-1
 * biome (RunConfig.biome, campaign levels) alternates from there, every day clear unless the
 * forced forecast fits it.
 */
export function worldPlan(w: World, day: number): DayPlan {
  const d = Math.max(1, Math.floor(day));
  const fb = w.forcedBiome;
  if (fb !== null) {
    const biome: BiomeId = d % 2 === 1 ? fb : fb === 'meadow' ? 'oldtown' : 'meadow';
    const f = w.forcedForecast;
    return dayPlan(biome, f !== null && forecastFits(f, biome) ? f : 'clear');
  }
  if (!w.planOn) return legacyPlan(d);
  const memo = w.plan;
  while (memo.length < d) memo.push(drawPlan(w.seed, memo.length + 1, memo.length > 0 ? (memo[memo.length - 1] as DayPlan) : null));
  const p = memo[d - 1] as DayPlan;
  const f = w.forcedForecast;
  if (f === null) return p;
  return dayPlan(p.biome, forecastFits(f, p.biome) ? f : 'clear');
}

/** The knobs of `day` in world `w`: its profile, its Day Plan entry and its concepts (mods). */
export function paramsAt(w: World, day: number): DayParams {
  return dayParams(day, w.profile, worldPlan(w, day), w.modList);
}

// World-aware clock ↔ y mapping. The global clock (core/clock.ts) maps time to y at walk ×1; a
// world's walkMul (the 'sprint'/'stroll' concepts) scales every distance by the same factor, so
// y_world = y_clock · walkMul exactly, and every reader of the mapping in core goes through these.

/** Nubs' y in world `w` at `dayTick` ticks after Day `day` dawn. */
export function worldYAtDayTick(w: World, day: number, dayTick: number): number {
  return yAtDayTick(day, dayTick) * w.walkMul;
}

/** Nubs' y in world `w` at an absolute tick. */
export function worldYAtTick(w: World, tickAbs: number): number {
  return yAtTick(tickAbs) * w.walkMul;
}

/** y in world `w` of `t` seconds after Day `day` dawn. */
export function worldYAtTime(w: World, day: number, t: number): number {
  return yAtTime(day, t) * w.walkMul;
}

/** y in world `w` of Day `day` dawn. */
export function worldDayStartY(w: World, day: number): number {
  return dayStartY(day) * w.walkMul;
}

/** Inverse of worldYAtDayTick. */
export function worldTimeAtY(w: World, y: number, out: YTime): YTime {
  return timeAtY(y / w.walkMul, out);
}

/** The first Old Town day ≥ 2: it gets the guaranteed noon gate arch (Day 2 or Day 3). */
export function firstTownDay(w: World): number {
  return worldPlan(w, 2).biome === 'oldtown' ? 2 : 3;
}

const yt: YTime = { day: 1, dayTick: 0, night: false };

/** Day whose daylight or night contains y in world `w` (walkMul applied). */
export function worldDayAtY(w: World, y: number): number {
  return timeAtY(y / w.walkMul, yt).day;
}

/** Biome of the ground at y in world `w` (the night keeps its day's biome). */
export function biomeAtY(w: World, y: number): BiomeId {
  return worldPlan(w, worldDayAtY(w, y)).biome;
}

// v1.6 sun readers (docs/V1_6_PLAN.md §2.5). Every ε reader (syncTime, the guide, the validator's
// stepGeometry, stepLit and stepLitLive, the bots, deathcause) reads the world's elevation through
// worldElevation / liftElevation; the placer keeps the base elevation (its clouds avoid flares).

const FL = TUNING.flare;
/** The validator's step (ticks): Noon Heat's window edges snap to it. */
const NOON_STEP = TUNING.validator.stepTicks;
/** A lift window never lasts longer than this (rise + hold + fall, ticks), so a backward scan can stop. */
const LIFT_SPAN = FL.riseTicks + FL.holdTicks + FL.fallTicks;

/** Smoothstep 3x² − 2x³ on [0, 1] (polynomial: deterministic everywhere). */
function smooth01(x: number): number {
  return x * x * (3 - 2 * x);
}

/** Flare f's lift 0..1 at `tickAbs` whatever its state: the rise smoothstep, 1 through the hold, the mirrored fall. */
export function liftOf(f: Flare, tickAbs: number): number {
  if (tickAbs < f.riseTick || tickAbs >= f.endTick) return 0;
  if (tickAbs < f.holdTick) return smooth01((tickAbs - f.riseTick) / (f.holdTick - f.riseTick));
  if (tickAbs < f.fallTick) return 1;
  return 1 - smooth01((tickAbs - f.fallTick) / (f.endTick - f.fallTick));
}

/** The kept flare whose lift window [riseTick, endTick) holds `tickAbs`, or null (w.flares is sorted by rise). */
export function liftingFlare(w: World, tickAbs: number): Flare | null {
  const fl = w.flares;
  for (let i = fl.length - 1; i >= 0; i--) {
    const f = fl[i] as Flare;
    if (f.riseTick > tickAbs) continue;
    if (f.state === FLARE_KEPT && tickAbs < f.endTick) return f;
    if (f.riseTick + LIFT_SPAN < tickAbs) return null;
  }
  return null;
}

/**
 * The elevation `base` (the day's ε at that tick, params `p`) lifted by flare f at `tickAbs`:
 * base + d·lift, capped at εnoon − epsMargin (Endless) or journeyEpsCap (Journey); a cap below the
 * base leaves the base (a flare never lowers the sun).
 */
export function flareEps(w: World, p: DayParams, f: Flare, tickAbs: number, base: number): number {
  const lift = liftOf(f, tickAbs);
  if (lift <= 0 || base <= 0) return base;
  const e = base + f.d * lift;
  const cap = w.level ? FL.journeyEpsCap : p.epsNoon - FL.epsMargin;
  return e <= cap ? e : cap > base ? cap : base;
}

/** `base` (elevation(p, tDay) of the tick) with the kept flare lifting `tickAbs`, if any. */
export function liftElevation(w: World, p: DayParams, tickAbs: number, base: number): number {
  if (base <= 0 || w.flares.length === 0) return base;
  const f = liftingFlare(w, tickAbs);
  return f ? flareEps(w, p, f, tickAbs, base) : base;
}

/**
 * The sun's elevation (°) in world `w` at absolute tick `tickAbs`: the day's base ε plus d·flareLift
 * of a kept flare. 0 before Day 1 dawn and after dusk, but the dusk tick itself (dayTick =
 * dayTicks(day)) still reads ≈ EPS_DAWN, so syncTime keeps its own daylight gate (s.eps = 0 at night).
 */
export function worldElevation(w: World, tickAbs: number): number {
  const day = dayAtTick(tickAbs);
  const p = paramsAt(w, day);
  return liftElevation(w, p, tickAbs, elevation(p, (tickAbs - dayStartTick(day)) / TICK_HZ));
}

/** A kept flare's lift 0..1 at `tickAbs` (rise smoothstep, hold 1, fall); 0 outside every kept flare. */
export function flareLift(w: World, tickAbs: number): number {
  const f = liftingFlare(w, tickAbs);
  return f ? liftOf(f, tickAbs) : 0;
}

/**
 * Noon Heat (T1): the drain × this on `day` at `dayTick`: DayParams.noonHeat between 11:00 AM and
 * 1:00 PM (dayTick in [5/12, 7/12)·Dl), else 1. Endless, Daily and challenge worlds only (1 on a
 * campaign level, whose concept costs were calibrated without it) and only with World.v16.noonHeat.
 * The validator (deltaForSlot), the sim's Chill and the oracle all read it.
 */
export function noonHeatAt(w: World, day: number, dayTick: number): number {
  if (!w.v16.noonHeat || w.level !== null) return 1;
  // Exact in the validator: its DP charges a whole step (t − 6, t] at the heat of its end tick t, so
  // the window's edges sit on the step grid (absolute ticks) and a tick is heated when the step that
  // holds it ends inside them.
  const t0 = dayStartTick(day);
  const dl = dayTicks(day);
  const a = NOON_STEP * Math.round((t0 + (5 * dl) / 12) / NOON_STEP);
  const b = NOON_STEP * Math.round((t0 + (7 * dl) / 12) / NOON_STEP);
  const end = NOON_STEP * Math.ceil((t0 + dayTick) / NOON_STEP);
  if (end < a || end >= b) return 1;
  return paramsAt(w, day).noonHeat;
}

/** Fills `out` with the kept flares whose window [warnTick, endTick) overlaps [fromTick, toTick) (sorted by rise); returns the count. */
export function keptFlares(w: World, fromTick: number, toTick: number, out: Flare[]): number {
  let n = 0;
  for (const f of w.flares) {
    if (f.state !== FLARE_KEPT || f.endTick <= fromTick || f.warnTick >= toTick) continue;
    if (n < out.length) out[n] = f;
    else out.push(f);
    n++;
  }
  return n;
}
