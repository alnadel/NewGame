// Local fallbacks for v1.1 contracts that the core batch provides (docs/V1_1_BUILD.md CC-n / A-n).
// Each one has the contract's exact signature and documents the real name it stands for;
// integration replaces every `V11-SHIM` with the real import or field (grep -rn V11-SHIM src tests
// must come back empty) and deletes this file. On the v1.0 core every world is plan-off, there is
// no lesson floor, SWING or lessonDone event, and the sun ignores the fine-key flag.

import {
  angleDiff,
  BINS,
  biomeAtY,
  cosD,
  historyAt,
  historyLength,
  minutesOfDay,
  TICK_HZ,
  type BiomeId,
  type DayParams,
  type DeathCause,
  type ProfileId,
  type RunConfig,
  type RunResult,
  type RunStats,
  type SimEvent,
  type SimState,
  type World,
} from '../core/index.ts';
import type { Equipped } from '../meta/content.ts';

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

// V11-SHIM: A13 — `deathRecap(s): DeathRecap` and `deathTip(r, invert): string | null` from
// src/core (sim/recap.ts, with TUNING.recap = { exposureSec 1.5, maxAwayDeg 90, litShare 0.35,
// noonFrom 300, noonTo 420 }); this copy goes at integration.
export interface DeathRecap {
  readonly cause: DeathCause;
  readonly litShare10: number;
  readonly theta: number;
  readonly away: number | null;
  readonly exposure: number;
  readonly minuteOfDay: number;
}
const recapSample = new Float64Array(4);
function nearestBin(theta: number, a: Uint8Array, b: Uint8Array | null): number | null {
  let best: number | null = null;
  for (let bin = 0; bin < BINS; bin++) {
    if (a[bin] !== 1 || (b !== null && b[bin] !== 1)) continue;
    const d = angleDiff(bin, theta);
    if (best === null || Math.abs(d) < Math.abs(best)) best = d;
  }
  return best;
}
export function deathRecap(s: SimState): DeathRecap {
  const nb = s.nubs;
  const from = nb.y - 10 * s.params.v;
  let lit = 0;
  let n = 0;
  for (let i = historyLength(s) - 1; i >= 0; i--) {
    historyAt(s, i, recapSample);
    if ((recapSample[1] as number) < from) break;
    n++;
    if ((recapSample[3] as number) > 0) lit++;
  }
  const theta = s.sun.theta;
  return {
    cause: s.death?.cause ?? 'plain',
    litShare10: n > 0 ? lit / n : 0,
    theta,
    away: nearestBin(theta, s.guide.now, s.guide.next) ?? nearestBin(theta, s.guide.now, null),
    exposure: nb.litSince >= 0 ? (s.tick - nb.litSince) / TICK_HZ : 0,
    minuteOfDay: minutesOfDay(s.day, s.dayTick),
  };
}
export function deathTip(r: DeathRecap, invert: boolean): string | null {
  if (r.cause === 'glare') return 'Red arcs are glare. Keep the little sun out.';
  if (r.away !== null && r.exposure >= 1.5 && Math.abs(r.away) <= 90 && Math.round(Math.abs(r.away)) > 0) {
    const ccw = r.away > 0;
    const arrow = ccw !== invert ? '←' : '→';
    const dx = cosD(r.theta + r.away) - cosD(r.theta);
    const side = dx < -1e-9 ? 'left' : dx > 1e-9 ? 'right' : arrow === '←' ? 'left' : 'right';
    return `Shade was ${Math.round(Math.abs(r.away))}° ${side}. Drag ${arrow}.`;
  }
  if (r.litShare10 >= 0.35) return `In the sun ${Math.round(10 * r.litShare10)} of the last 10 s. Short dips add up.`;
  if (r.minuteOfDay >= 300 && r.minuteOfDay <= 420) return 'Noon shadows are stubs. Ride a cloud or hug tall walls.';
  return null;
}

// V11-SHIM: CC-12/A15 — `ShadesLook` and the five Sun Shades items in src/meta/content.ts, and
// `equippedLooks(e).shades` (Equipped gains `shades`, default 'shades-classic'): read
// `equippedLooks(equipped).shades` instead.
export interface ShadesLook {
  slot: 'shades';
  shape: 'classic' | 'round' | 'aviator' | 'star' | 'heart';
  frame: string;
  lens: string;
  lens2: string;
  shine: string;
}
const SHADES: Readonly<Record<string, ShadesLook>> = {
  'shades-classic': { slot: 'shades', shape: 'classic', frame: '#2B2140', lens: '#2B2140', lens2: '#4A3D6B', shine: '#FFFFFF' },
  'shades-round': { slot: 'shades', shape: 'round', frame: '#8A5A3C', lens: '#3A2F5A', lens2: '#5B4A86', shine: '#FFFFFF' },
  'shades-aviator': { slot: 'shades', shape: 'aviator', frame: '#FFC23D', lens: '#FF9F43', lens2: '#8C3B12', shine: '#FFF3C4' },
  'shades-star': { slot: 'shades', shape: 'star', frame: '#9B5DE5', lens: '#FFD93D', lens2: '#FF9F43', shine: '#FFFFFF' },
  'shades-heart': { slot: 'shades', shape: 'heart', frame: '#E8475A', lens: '#FF8FA3', lens2: '#E8475A', shine: '#FFFFFF' },
};
export function shadesLook(equipped: Equipped): ShadesLook {
  const id = (equipped as { shades?: string }).shades;
  return (id !== undefined ? SHADES[id] : undefined) ?? (SHADES['shades-classic'] as ShadesLook);
}
