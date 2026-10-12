// Local fallbacks for the v1.1 contracts the core batch provides (docs/V1_1_BUILD.md CC-1..CC-7, A1,
// A2). Each item has the contract's exact signature and names its real home; integration deletes this
// file and imports the names from '../core/index.ts' (grep -rn V11-SHIM src tests must come back empty).

import { rngFor } from '../core/rng.ts';
import type { RunResult, RunStats } from '../core/sim/events.ts';

// V11-SHIM: CC-3 — BiomeId, ForecastId, FORECAST_IDS, ForecastInfo, FORECASTS, DayPlan (core/index.ts).
export type BiomeId = 'meadow' | 'oldtown';
export type ForecastId = 'clear' | 'breezy' | 'overcast' | 'heat' | 'long' | 'dazzle' | 'market';
export const FORECAST_IDS: readonly ForecastId[] = ['clear', 'breezy', 'overcast', 'heat', 'long', 'dazzle', 'market'];
export interface ForecastInfo {
  readonly id: ForecastId;
  readonly name: string;
  readonly emoji: string;
  readonly blurb: string;
  readonly biome: BiomeId | null;
}
const info = (id: ForecastId, name: string, emoji: string, blurb: string, biome: BiomeId | null): ForecastInfo => ({ id, name, emoji, blurb, biome });
export const FORECASTS: Readonly<Record<ForecastId, ForecastInfo>> = {
  clear: info('clear', 'Clear', '☀️', 'Plain sunshine.', null),
  breezy: info('breezy', 'Breezy', '\u{1F32C}️', 'More clouds, moving fast.', null),
  overcast: info('overcast', 'Overcast', '☁️', 'Big slow clouds, sparse cover.', null),
  heat: info('heat', 'Heat Wave', '\u{1F321}️', 'A higher sun. Extra flakes, Snow ×1.5.', null),
  long: info('long', 'Long Shadows', '\u{1F342}', 'A low sun all day.', null),
  dazzle: info('dazzle', 'Dazzle', '✨', 'Gazing balls in the meadow.', 'meadow'),
  market: info('market', 'Market Day', '\u{1F9FA}', 'Stalls and gate arches.', 'oldtown'),
};
export interface DayPlan {
  readonly biome: BiomeId;
  readonly forecast: ForecastId;
}

// V11-SHIM: CC-1 — NoonCloud (core/index.ts).
export type NoonCloud = 0 | 1 | 2;

// V11-SHIM: A1 — PLAN_START_DATE (core/index.ts).
export const PLAN_START_DATE = '2026-10-14';

// V11-SHIM: A2 — COMFORT_MAX and comfortAfterRun(rung, minutes) (core/index.ts).
export const COMFORT_MAX = 4;
export function comfortAfterRun(rung: number, minutes: number): number {
  const r = Math.max(0, Math.min(COMFORT_MAX, Math.floor(rung)));
  if (minutes >= 1440) return COMFORT_MAX;
  if (r === 0) return minutes >= 720 ? 2 : 1;
  return Math.max(1, Math.min(COMFORT_MAX, minutes >= 390 ? r + 1 : minutes < 240 ? r - 1 : r));
}

// V11-SHIM: CC-3 — planDay(seed, day) (core/index.ts; the same draws as core/gen/plan.ts).
const fits = (id: ForecastId, biome: BiomeId): boolean => FORECASTS[id].biome === null || FORECASTS[id].biome === biome;
export function planDay(seed: number, day: number): DayPlan {
  let p = null as DayPlan | null;
  for (let d = 1; d <= Math.max(1, Math.floor(day)); d++) {
    const r = rngFor(seed >>> 0, 'plan', d);
    const prev: DayPlan | null = p;
    const biome: BiomeId = prev === null ? (r.next() < 0.5 ? 'meadow' : 'oldtown') : prev.biome === 'meadow' ? 'oldtown' : 'meadow';
    const w = FORECAST_IDS.map((id, i) =>
      !fits(id, biome) ? 0 : prev === null ? ([40, 15, 10, 10, 15, 10, 10][i] as number) : id === 'clear' ? 30 : id === prev.forecast ? 0 : 14,
    );
    let x = r.next() * w.reduce((a, b) => a + b, 0);
    let pick: ForecastId = 'clear';
    for (let i = 0; i < w.length; i++) {
      if ((w[i] as number) > 0) pick = FORECAST_IDS[i] as ForecastId;
      x -= w[i] as number;
      if (x < 0) break;
    }
    p = { biome, forecast: pick };
  }
  return p as DayPlan;
}

// V11-SHIM: CC-4/CC-7 — RunStats.swings/swingChainBest/phewMinChill and RunResult.drain/noonCloud/plan
// (core/sim/events.ts). Replace RunResultV11 with RunResult and v11Result(r) with r.
export type RunResultV11 = RunResult & {
  drain: number;
  noonCloud: NoonCloud;
  plan: DayPlan[];
  stats: RunStats & { swings: number; swingChainBest: number; phewMinChill: number };
};
export function v11Result(r: RunResult): RunResultV11 {
  const x = r as Partial<RunResultV11> & RunResult;
  const st = r.stats as Partial<RunResultV11['stats']> & RunStats;
  const legacy = (d: number): DayPlan => ({ biome: d % 2 === 0 ? 'oldtown' : 'meadow', forecast: 'clear' });
  return {
    ...r,
    drain: x.drain ?? ([30, 40, 47, 55][r.profile] as number),
    noonCloud: x.noonCloud ?? (r.profile <= 2 ? 1 : 0),
    plan: x.plan ?? Array.from({ length: Math.max(1, r.day) }, (_, i) => legacy(i + 1)),
    stats: { ...r.stats, swings: st.swings ?? 0, swingChainBest: st.swingChainBest ?? 0, phewMinChill: st.phewMinChill ?? 100 },
  };
}
