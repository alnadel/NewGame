// Day Plan forecasts (V1_1_PLAN CO2): display data for the UI and the tuning dayParams() applies on
// top of the day table. HARD RULE: no forecast changes dayLen, nightLen, v, drain, phewT or floor
// (the clock and the time ↔ y map are global), only what stands, floats and shines along the trail.

import type { BiomeId } from './days.ts';

export type ForecastId = 'clear' | 'breezy' | 'overcast' | 'heat' | 'long' | 'dazzle' | 'market';

/** Every forecast in a fixed order (also the bit order of the save's forecastNoons mask). */
export const FORECAST_IDS: readonly ForecastId[] = Object.freeze([
  'clear', 'breezy', 'overcast', 'heat', 'long', 'dazzle', 'market',
] as ForecastId[]);

export interface ForecastInfo {
  readonly id: ForecastId;
  readonly name: string;
  readonly emoji: string;
  readonly blurb: string;
  /** The only biome it can fall on, or null for any. */
  readonly biome: BiomeId | null;
}

const info = (id: ForecastId, name: string, emoji: string, blurb: string, biome: BiomeId | null): ForecastInfo =>
  Object.freeze({ id, name, emoji, blurb, biome });

// Emoji: ☀️ 🌬️ ☁️ 🌡️ 🍂 ✨ 🧺 (escaped so the variation selectors stay visible in review).
export const FORECASTS: Readonly<Record<ForecastId, ForecastInfo>> = Object.freeze({
  clear: info('clear', 'Clear', '☀️', 'Plain sunshine.', null),
  breezy: info('breezy', 'Breezy', '\u{1F32C}️', 'More clouds, moving fast.', null),
  overcast: info('overcast', 'Overcast', '☁️', 'Big slow clouds, sparse cover.', null),
  heat: info('heat', 'Heat Wave', '\u{1F321}️', 'A higher sun. Extra flakes, Snow ×1.5.', null),
  long: info('long', 'Long Shadows', '\u{1F342}', 'A low sun all day.', null),
  dazzle: info('dazzle', 'Dazzle', '✨', 'Gazing balls in the meadow.', 'meadow'),
  market: info('market', 'Market Day', '\u{1F9FA}', 'Stalls and gate arches.', 'oldtown'),
});

/** True when forecast `id` can fall on a `biome` day. */
export function forecastFits(id: ForecastId, biome: BiomeId): boolean {
  const only = FORECASTS[id].biome;
  return only === null || only === biome;
}

/**
 * What a forecast changes; anything left out keeps the clear (table) value. Ranges are U(min, max).
 * Cloud count ×k: round(n·k) spawn times evenly spaced over the row's first..last time.
 */
export interface ForecastTuning {
  readonly clouds?: number;
  readonly cloudRx?: readonly [number, number];
  /** Cloud drift across the trail, U(−d, d) u/s. */
  readonly cloudDrift?: number;
  /** Overtaker and waiter speeds as multiples of v. */
  readonly overtake?: readonly [number, number];
  readonly wait?: readonly [number, number];
  /** Caster spacing ×. */
  readonly spacing?: number;
  /** εnoon + (°). */
  readonly epsNoon?: number;
  /** latMax + (u). */
  readonly latMax?: number;
  /** Flakes per cluster +. */
  readonly flakes?: number;
  /** Flake and crystal Snow × (rounded). */
  readonly snow?: number;
  /** Gazing balls [first at t, then every] (s) on these days; [0, 0] = none. */
  readonly balls?: readonly [number, number];
  /** Old Town stall weight × and gate-arch chance. */
  readonly stalls?: number;
  readonly gateChance?: number;
}

export const FORECAST_TUNING: Readonly<Record<ForecastId, ForecastTuning>> = Object.freeze({
  clear: {},
  breezy: { clouds: 1.5, cloudDrift: 30, overtake: [1.35, 1.6], wait: [0.5, 0.65] },
  overcast: { clouds: 1.5, cloudRx: [80, 100], spacing: 1.3 },
  heat: { epsNoon: 3, flakes: 1, spacing: 0.92, snow: 1.5 },
  long: { epsNoon: -10, spacing: 1.15, latMax: 10 },
  dazzle: { balls: [6, 12] },
  market: { balls: [0, 0], stalls: 3, gateChance: 0.35 },
} satisfies Record<ForecastId, ForecastTuning>);

/**
 * planDay() weights in FORECAST_IDS order. Day 1: clear 40, breezy 15, overcast 10, heat 10,
 * long 15, and 10 for the biome's own forecast (dazzle in the Meadow, market in Old Town). Later
 * days: clear 30 and 14 for each forecast that fits the biome, except the previous day's when it
 * was not clear (no two identical non-clear days in a row).
 */
export const PLAN_WEIGHTS = Object.freeze({
  day1: Object.freeze([40, 15, 10, 10, 15, 10, 10]),
  laterClear: 30,
  later: 14,
});

/** Dailies from this date on are played with the Day Plan; earlier ones keep their v1.0 world. */
export const PLAN_START_DATE = '2026-10-14';
