// The Day Plan (V1_1_PLAN CO2): every day of a plan-on world draws its biome and forecast. Day 1's
// biome is a coin flip, then biomes alternate; forecasts are weighted draws (config/forecasts.ts)
// that never repeat a non-clear forecast on consecutive days. Plan-off worlds (v1.0 links, old
// Dailies, onboarding profiles) keep the alternating clear days. Every reader of a day's knobs goes
// through worldPlan / paramsAt, so nothing derives the biome from day parity.

import { dayParams, dayPlan, legacyPlan, type BiomeId, type DayParams, type DayPlan } from '../../config/days.ts';
import { FORECAST_IDS, forecastFits, PLAN_WEIGHTS, type ForecastId } from '../../config/forecasts.ts';
import { timeAtY, type YTime } from '../clock.ts';
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
 * the biome and makes the other days clear; the biomes still come from planDay.
 */
export function worldPlan(w: World, day: number): DayPlan {
  const d = Math.max(1, Math.floor(day));
  if (!w.planOn) return legacyPlan(d);
  const memo = w.plan;
  while (memo.length < d) memo.push(drawPlan(w.seed, memo.length + 1, memo.length > 0 ? (memo[memo.length - 1] as DayPlan) : null));
  const p = memo[d - 1] as DayPlan;
  const f = w.forcedForecast;
  if (f === null) return p;
  return dayPlan(p.biome, forecastFits(f, p.biome) ? f : 'clear');
}

/** The knobs of `day` in world `w`: its profile and its Day Plan entry. */
export function paramsAt(w: World, day: number): DayParams {
  return dayParams(day, w.profile, worldPlan(w, day));
}

/** The first Old Town day ≥ 2: it gets the guaranteed noon gate arch (Day 2 or Day 3). */
export function firstTownDay(w: World): number {
  return worldPlan(w, 2).biome === 'oldtown' ? 2 : 3;
}

const yt: YTime = { day: 1, dayTick: 0, night: false };

/** Day whose daylight or night contains y (Day 1 for y < 0). */
export function dayAtY(y: number): number {
  return timeAtY(y, yt).day;
}

/** Biome of the ground at y in world `w` (the night keeps its day's biome). */
export function biomeAtY(w: World, y: number): BiomeId {
  return worldPlan(w, dayAtY(y)).biome;
}
