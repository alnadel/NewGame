// Local fallbacks for v1.1 contracts that the core batch provides (docs/V1_1_BUILD.md CC-n / A-n).
// Each one has the contract's exact signature and documents the real name it stands for;
// integration replaces every `V11-SHIM` with the real import or field (grep -rn V11-SHIM src tests
// must come back empty) and deletes this file. On the v1.0 core every world is plan-off, there is
// no lesson floor, SWING or lessonDone event, and the sun ignores the fine-key flag.

import { angleDiff, biomeAtY, type BiomeId, type DayParams, type ProfileId, type RunConfig, type RunResult, type RunStats, type SimEvent, type SimState, type World } from '../core/index.ts';

// V11-SHIM: CC-3 — `export type ForecastId` from src/core/index.ts.
export type ForecastId = 'clear' | 'breezy' | 'overcast' | 'heat' | 'long' | 'dazzle' | 'market';

// V11-SHIM: CC-3 — `export const FORECAST_IDS` (also the forecastNoons bit order).
export const FORECAST_IDS: readonly ForecastId[] = ['clear', 'breezy', 'overcast', 'heat', 'long', 'dazzle', 'market'];

// V11-SHIM: CC-3 — `export interface ForecastInfo` and `FORECASTS` (display data).
export interface ForecastInfo {
  readonly id: ForecastId;
  readonly name: string;
  readonly emoji: string;
  readonly blurb: string;
  readonly biome: BiomeId | null;
}
export const FORECASTS: Readonly<Record<ForecastId, ForecastInfo>> = {
  clear: { id: 'clear', name: 'Clear', emoji: '☀️', blurb: 'Plain sunshine.', biome: null },
  breezy: { id: 'breezy', name: 'Breezy', emoji: '🌬️', blurb: 'More clouds, moving fast.', biome: null },
  overcast: { id: 'overcast', name: 'Overcast', emoji: '☁️', blurb: 'Big slow clouds, sparse cover.', biome: null },
  heat: { id: 'heat', name: 'Heat Wave', emoji: '🌡️', blurb: 'A higher sun. Extra flakes, Snow ×1.5.', biome: null },
  long: { id: 'long', name: 'Long Shadows', emoji: '🍂', blurb: 'A low sun all day.', biome: null },
  dazzle: { id: 'dazzle', name: 'Dazzle', emoji: '✨', blurb: 'Gazing balls in the meadow.', biome: 'meadow' },
  market: { id: 'market', name: 'Market Day', emoji: '🧺', blurb: 'Stalls and gate arches.', biome: 'oldtown' },
};

// V11-SHIM: CC-3 — `export interface DayPlan`.
export interface DayPlan {
  readonly biome: BiomeId;
  readonly forecast: ForecastId;
}

// V11-SHIM: CC-3 — `DayParams.forecast: ForecastId` (read as `s.params.forecast`).
export function forecastOf(p: DayParams): ForecastId {
  return (p as DayParams & { forecast?: ForecastId }).forecast ?? 'clear';
}

// V11-SHIM: CC-3 — `World.planOn: boolean` (read as `w.planOn`).
export function planOnOf(w: World): boolean {
  return (w as World & { planOn?: boolean }).planOn ?? false;
}

// V11-SHIM: CC-3 — `worldPlan(w: World, day: number): DayPlan` (plan-off worlds: odd days Meadow,
// even days Old Town, 'clear').
export function worldPlan(_w: World, day: number): DayPlan {
  return { biome: day % 2 === 0 ? 'oldtown' : 'meadow', forecast: 'clear' };
}

// V11-SHIM: CC-3 — `biomeAtY(w: World, y: number): BiomeId` replaces biomeAtY(y).
export function biomeAtWorld(_w: World, y: number): BiomeId {
  return biomeAtY(y);
}

// V11-SHIM: CC-1/A1 — RunConfig gains `noonCloud?: NoonCloud`, `lesson?: boolean`,
// `forecast?: ForecastId` and `plan?: boolean` (read and write them on RunConfig directly).
export type NoonCloud = 0 | 1 | 2;
export type RunConfigV11 = RunConfig & { noonCloud?: NoonCloud; lesson?: boolean; forecast?: ForecastId; plan?: boolean };

// V11-SHIM: CO1 — `effectiveNoonCloud(cfg)`.
export function effectiveNoonCloud(cfg: RunConfig): NoonCloud {
  return (cfg as RunConfigV11).noonCloud ?? (cfg.profile <= 2 ? 1 : 0);
}

// V11-SHIM: A1 — `export const PLAN_START_DATE = '2026-10-14'`.
export const PLAN_START_DATE = '2026-10-14';

// V11-SHIM: A2 — `COMFORT_MAX = 4` and `rungConfig(rung, { tutorialDone })` from src/core.
export const COMFORT_MAX = 4;
const RUNGS: readonly { profile: ProfileId; drain: number; noonCloud: NoonCloud }[] = [
  { profile: 0, drain: 30, noonCloud: 1 },
  { profile: 2, drain: 40, noonCloud: 1 },
  { profile: 3, drain: 44, noonCloud: 1 },
  { profile: 3, drain: 50, noonCloud: 2 },
  { profile: 3, drain: 55, noonCloud: 0 },
];
export function rungConfig(
  rung: number,
  opts: { tutorialDone: boolean },
): { profile: ProfileId; drain: number; noonCloud: NoonCloud; tutorial: boolean; lesson: boolean } {
  const r = RUNGS[Math.max(0, Math.min(COMFORT_MAX, Math.floor(rung)))] as (typeof RUNGS)[number];
  return { profile: r.profile, drain: r.drain, noonCloud: r.noonCloud, tutorial: rung === 0, lesson: !opts.tutorialDone && rung <= 1 };
}

// V11-SHIM: CC-5 — `SimState.lessonOn: boolean` (read as `s.lessonOn`). On the v1.0 core the
// lesson (CO4/A5, without its Chill floor) is emulated here by lessonShimTick, called by the session
// after each step(); integration deletes both and that call.
interface LessonEmu {
  on: boolean;
  armed: boolean;
  litTheta: number;
  swung: boolean;
  shade: number;
  daylight: number;
}
const lessonEmu = new WeakMap<SimState, LessonEmu>();
export function lessonOnOf(s: SimState): boolean {
  const real = (s as SimState & { lessonOn?: boolean }).lessonOn;
  return real ?? lessonEmu.get(s)?.on ?? false;
}
/** One tick of the emulated lesson; true on the tick it passes (the sim's 'lessonDone'). */
export function lessonShimTick(s: SimState): boolean {
  if ('lessonOn' in s || (s.cfg as RunConfigV11).lesson !== true) return false;
  let e = lessonEmu.get(s);
  if (!e) {
    e = { on: false, armed: false, litTheta: 0, swung: false, shade: 0, daylight: 0 };
    lessonEmu.set(s, e);
  }
  for (const ev of s.events) {
    if (ev.e === 'go') e.on = true;
    if (ev.e === 'nightStart') e.on = false;
  }
  if (!e.on || s.phase !== 'day' || s.ready > 0) return false;
  if (++e.daylight >= 1500) {
    e.on = false;
    return false;
  }
  const lit = s.nubs.f > 0;
  if (lit && (!e.armed || e.shade > 0)) {
    e.litTheta = s.sun.theta;
    e.swung = false;
  }
  if (lit) e.armed = true;
  e.shade = lit ? 0 : e.shade + 1;
  if (e.armed && Math.abs(angleDiff(s.sun.theta, e.litTheta)) >= 15) e.swung = true;
  if (e.armed && e.swung && e.shade >= 15) {
    e.on = false;
    return true;
  }
  return false;
}

// V11-SHIM: CC-4/CC-5 — SimEvent adds `{ e: 'swing'; deg; chain; snow; x; y }` and `{ e: 'lessonDone' }`.
export type SwingEvent = { e: 'swing'; deg: number; chain: number; snow: number; x: number; y: number };
export type SimEventV11 = SimEvent | SwingEvent | { e: 'lessonDone' };

// V11-SHIM: CC-4 — RunStats adds `swings`, `swingChainBest`, `phewMinChill`.
export type RunStatsV11 = RunStats & { swings?: number; swingChainBest?: number; phewMinChill?: number };

// V11-SHIM: CC-7 — RunResult adds `drain`, `noonCloud`, `plan: DayPlan[]`.
export type RunResultV11 = RunResult & { drain?: number; noonCloud?: NoonCloud; plan?: DayPlan[] };
