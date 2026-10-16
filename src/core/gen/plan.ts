// The Day Plan (V1_1_PLAN CO2): every day of a plan-on world draws its biome and forecast. Day 1's
// biome is a coin flip, then biomes alternate; forecasts are weighted draws (config/forecasts.ts)
// that never repeat a non-clear forecast on consecutive days. Plan-off worlds (v1.0 links, old
// Dailies, onboarding profiles) keep the alternating clear days. Every reader of a day's knobs goes
// through worldPlan / paramsAt, so nothing derives the biome from day parity.

import { dayParams, dayPlan, legacyPlan, type BiomeId, type DayParams, type DayPlan } from '../../config/days.ts';
import { FORECAST_IDS, forecastFits, PLAN_WEIGHTS, type ForecastId } from '../../config/forecasts.ts';
import { dayAtTick, dayStartTick, dayStartY, elevation, TICK_HZ, timeAtY, yAtDayTick, yAtTick, yAtTime, type YTime } from '../clock.ts';
import type { Flare } from '../objects.ts';
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

// v1.6 sun readers (docs/V1_6_PLAN.md §2.5; CORE-2 owns the bodies). Every ε reader (syncTime, the
// guide, the validator's stepGeometry, stepLit and stepLitLive, the bots, deathcause) will read the
// world's elevation through worldElevation; the placer keeps the base elevation.

/**
 * The sun's elevation (°) in world `w` at absolute tick `tickAbs`: the day's base ε plus d·flareLift
 * of a kept flare. Contract stub: the base ε only (no flares yet). It is elevation(paramsAt(w, day),
 * tDay) exactly as the validator's stepGeometry computes it: 0 before Day 1 dawn and after dusk, but
 * the dusk tick itself (dayTick = dayTicks(day)) still reads ≈ EPS_DAWN, so syncTime keeps its own
 * daylight gate (s.eps = 0 at night).
 */
export function worldElevation(w: World, tickAbs: number): number {
  const day = dayAtTick(tickAbs);
  return elevation(paramsAt(w, day), (tickAbs - dayStartTick(day)) / TICK_HZ);
}

/** A kept flare's lift 0..1 at `tickAbs` (rise smoothstep, hold 1, fall). Contract stub: 0. */
export function flareLift(_w: World, _tickAbs: number): number {
  return 0;
}

/** Noon Heat: the drain × this on `day` at `dayTick` (Endless and Daily, 11 AM-1 PM). Contract stub: 1. */
export function noonHeatAt(_w: World, _day: number, _dayTick: number): number {
  return 1;
}

/** Fills `out` with the kept flares whose window overlaps [fromTick, toTick) (sorted by rise); returns the count. Contract stub: 0. */
export function keptFlares(_w: World, _fromTick: number, _toTick: number, _out: Flare[]): number {
  return 0;
}
