// Day table, post-Day-6 ramp, onboarding profiles and the comfort ladder (V1_PLAN §4.2, §6), and
// dayParams(): one day's knobs under a profile and its Day Plan entry (biome and forecast).
// Pure data + arithmetic over the other config tables. All per-day difficulty knobs live here.

import { foldTuning, type ConceptId } from './concepts.ts';
import { FORECAST_IDS, FORECAST_TUNING, type ForecastId } from './forecasts.ts';
import { TUNING } from './tuning.ts';

export type BiomeId = 'meadow' | 'oldtown';
export type ProfileId = 0 | 1 | 2 | 3;

/** One day of the Day Plan (core planDay / worldPlan). */
export interface DayPlan {
  readonly biome: BiomeId;
  readonly forecast: ForecastId;
}

/** Cloud spawn ranges of a day (U(min, max); speeds are multiples of v). */
export interface SkyParams {
  readonly rxMin: number;
  readonly rxMax: number;
  /** Drift across the trail, U(−drift, drift) u/s. */
  readonly drift: number;
  readonly overtakeMin: number;
  readonly overtakeMax: number;
  readonly waitMin: number;
  readonly waitMax: number;
}

export interface DayParams {
  readonly day: number;
  /** The day's biome and forecast (from the Day Plan; plan-off worlds alternate clear days). */
  readonly biome: BiomeId;
  readonly forecast: ForecastId;
  /** Sun elevation at noon (°). */
  readonly epsNoon: number;
  /** Walk speed in daylight (u/s). At night Nubs covers 8·v in total. */
  readonly v: number;
  /** Daylight length Dl (s); always a whole number of ticks. */
  readonly dayLen: number;
  /** Night length (s); always a whole number of ticks. */
  readonly nightLen: number;
  /** Mean caster gap along y (u). */
  readonly spacing: number;
  /**
   * Daylight difficulty wave on caster spacing: the gap after a caster at daylight time t is
   * spacing · (waveA + waveB · sin⁴(180°·t/Dl)) · U(gapMin, gapMax); nights use 1. Day 1 is
   * 0.75 / 0.65 (dense at dawn and dusk, 1.4× sparser at noon, day mean 0.75 + 0.65·3/8 ≈ 0.994, so
   * noon is the boss from the very first day); later days are 1 / 0 (flat).
   */
  readonly waveA: number;
  readonly waveB: number;
  /** Lateral distance from the centerline to the nearest footprint point, U(latMin, latMax) (u). */
  readonly latMin: number;
  readonly latMax: number;
  /** Cloud spawn times (s into the day) and spawn ranges. */
  readonly clouds: readonly number[];
  readonly sky: SkyParams;
  /** Gazing balls: first at ballStart s, then every ballEvery s while t < dayLen. ballEvery 0 = none. */
  readonly ballStart: number;
  readonly ballEvery: number;
  readonly flakesPerCluster: number;
  /** Flake and crystal Snow multiplier (Snow = round(base · snowMult)). */
  readonly snowMult: number;
  /** Validator floor: the best achievable Chill must stay at or above this. */
  readonly floor: number;
  /**
   * Profile drain (Chill/s at f = 1). Persists for the whole run. The sim reads the drain through
   * effectiveDrain(s), which prefers RunConfig.drain (an endless run's comfort rung) when it is set;
   * the validator always uses this profile value.
   */
  readonly drain: number;
  /** PHEW fires below this Chill. */
  readonly phewT: number;

  // Concept tuning (config/concepts.ts), at their plain values when no concept is active.
  /** Caster part heights × (catalog time). */
  readonly heightScale: number;
  /** Every cloud is a waiter (none overtakes). */
  readonly waitersOnly: boolean;
  /** Flake cluster spacing ×. */
  readonly clusterGap: number;
  /** Lit seconds until a flake or crystal melts (Infinity: never). */
  readonly meltBudget: number;
  /** Drain × on top of the run's drain (effectiveDrain). */
  readonly drainMul: number;
  /** Daylight regeneration at f = 0 (Chill/s). */
  readonly regen: number;
  /** Max Chill (Chill starts there). */
  readonly maxChill: number;
  /** Sun follow-rate cap (°/s; 0 = none beyond sunMaxRate). */
  readonly sunFollow: number;
  /** Coasting factor per tick (0 = the sun never coasts). */
  readonly sunFriction: number;
  /**
   * Walk-speed multiplier: `v` already includes it. The global clock (core/clock.ts) maps time to
   * y at ×1; a world scales that map by walkMul (core/gen/plan.ts worldYAtDayTick, worldTimeAtY), so the
   * clock, the placer, the validator, the guide and the sim agree.
   */
  readonly walkMul: number;

  // v1.6 (docs/V1_6_PLAN.md §2.5; CORE-2 owns the values and their readers).
  /**
   * Noon Heat: the drain × this between 11:00 AM and 1:00 PM (Endless and Daily; the Journey reads
   * it as 1 through noonHeatAt). 1 on Day 1, 1.1 on Days 2-3, 1.2 from Day 4 (profile 3; profiles
   * 0-2 one day later). Calibrated down from the plan's 1.15 / 1.25, which put the heat forecast's
   * rescues per chunk at 0.80 (40 seeds).
   */
  readonly noonHeat: number;
  /** Heat Flares drawn for the day (profile 3: 0, 1, then 2 from Day 3; profiles 0-2: 1 from Day 3). */
  readonly flareCount: number;
  /**
   * A flare's elevation lift d (°): 12 on Days 2-3, 10 from Day 4 (0 when the day has none). Fix round
   * 2 raised it from the plan's 10 / 8 (§11 range 6-12): with the keep test's fixed-angle parry the
   * shade must still move, and 10 / 8 kept 67.5% of the Days 2-4 candidates, 12 / 10 72.5% (40 seeds).
   */
  readonly flareD: number;
}

export interface ProfileParams {
  readonly drain: number;
  readonly day1EpsNoon: number;
  readonly phewT: number;
}

/**
 * Onboarding profiles (V1_PLAN §6): drain, Day-1 noon elevation and PHEW threshold. Daily and
 * challenge runs always use profile 3. Endless runs pick a profile through the comfort ladder below.
 */
export const PROFILES: readonly ProfileParams[] = Object.freeze([
  Object.freeze({ drain: 30, day1EpsNoon: 40, phewT: 20 }),
  Object.freeze({ drain: 40, day1EpsNoon: 44, phewT: 20 }),
  Object.freeze({ drain: 47, day1EpsNoon: 48, phewT: 20 }),
  Object.freeze({ drain: 55, day1EpsNoon: 48, phewT: 15 }),
]);

/**
 * Day-1 parked training cloud (part of a world's identity): 1 rides with Nubs 300-420 min after
 * 6 AM (11:00 AM-1:00 PM), 2 only 330-390 min (11:30 AM-12:30 PM), 0 none. With it, the first Day-1
 * cloud is always an overtaker. Windows: TUNING.cloud.parkedWindows.
 */
export type NoonCloud = 0 | 1 | 2;

/** The noon cloud a run's world uses: RunConfig.noonCloud, else 1 for profiles 0-2 and 0 for 3. */
export function effectiveNoonCloud(cfg: { readonly profile: ProfileId; readonly noonCloud?: NoonCloud }): NoonCloud {
  return cfg.noonCloud ?? (cfg.profile <= 2 ? 1 : 0);
}

/** One rung of the comfort ladder: the rules an endless run is played at. */
export interface ComfortRung {
  readonly profile: ProfileId;
  readonly drain: number;
  readonly noonCloud: NoonCloud;
}

/**
 * The comfort ladder. Rung 0 is the tutorial (lifetime run 0 only); rung 4 is standard (the Daily's
 * rules). Endless runs climb after a good run and step down after a rough one (comfortAfterRun).
 *
 * Each assisted rung eases the morning, where a struggling player melts (about 10 AM), not only the
 * noon such a player never reaches: R1 is a gentle floor (profile 1's lower Day-1 sun, drain 35),
 * R2 keeps the classic clear days (profile 2, drain 38), R3 has the Day Plan at drain 42, and all
 * three park the noon cloud. On the humanDial model the share reaching 11:00 AM falls rung by rung
 * (about 84% → 70% → 58% → 27% over 200 seeds). A run that reaches 11 AM on an assisted rung usually
 * rides the cloud into the afternoon, so per-rung medians jump between ~18 s and ~65 s.
 */
export const COMFORT_RUNGS: readonly ComfortRung[] = Object.freeze([
  Object.freeze({ profile: 0, drain: 30, noonCloud: 1 }),
  Object.freeze({ profile: 1, drain: 35, noonCloud: 1 }),
  Object.freeze({ profile: 2, drain: 38, noonCloud: 1 }),
  Object.freeze({ profile: 3, drain: 42, noonCloud: 1 }),
  Object.freeze({ profile: 3, drain: 55, noonCloud: 0 }),
] satisfies ComfortRung[]);

export const COMFORT_MAX = 4;

/** comfortAfterRun thresholds (score minutes): Day 3, one rung up, one rung down. */
export const COMFORT_STEPS = Object.freeze({ standard: 1440, up: 390, down: 300 });

/**
 * The first endless run at standard after the climb from R3 (comfortAfterRun's promotion): the
 * standard world, but drain 48 with the noon cloud parked, a step between R3 (42) and R4 (55). It
 * counts as eased (never a standard best); the run after it plays the full standard rules.
 */
export const STANDARD_WARMUP: ComfortRung = Object.freeze({ profile: 3, drain: 48, noonCloud: 1 });

/** The previous endless run: the rung it was played at and its score. */
export interface ComfortPrev {
  readonly rung: number;
  readonly minutes: number;
}

const clampRung = (r: number, lo: number): number => (r >= lo ? (r <= COMFORT_MAX ? Math.floor(r) : COMFORT_MAX) : lo);

/**
 * The rung of the next endless run after a run at `rung` that scored `minutes` (`prev`: the
 * endless run before it, if any). Never back to the tutorial; standard rules only from R3:
 * - from the tutorial (rung 0): Day 3 → R3, else R1;
 * - from R1-R2: Day 3 → R3, past 12:30 PM → one up, before 11:00 AM → one down (not below R1);
 * - from R3: up to standard (R4) after two R3 runs in a row past 12:30 PM, or one into Day 3;
 *   before 11:00 AM → R2;
 * - from R4: before 11:00 AM → R3, else R4.
 *
 * Calibrated with the career sim on the humanDial and novice models (V1_1_PLAN §0): the two-run
 * climb and the STANDARD_WARMUP run stop players bouncing R3 ↔ R4, and 88% of humanDial careers
 * still reach standard within 20 runs.
 */
export function comfortAfterRun(rung: number, minutes: number, prev: ComfortPrev | null = null): number {
  const S = COMFORT_STEPS;
  const r = clampRung(rung, 0);
  if (r === 0) return minutes >= S.standard ? 3 : 1;
  if (r < 3 && minutes >= S.standard) return 3;
  if (r === 3 && minutes >= S.up) {
    const twice = prev !== null && clampRung(prev.rung, 0) === 3 && prev.minutes >= S.up;
    return minutes >= S.standard || twice ? COMFORT_MAX : 3;
  }
  return clampRung(minutes >= S.up ? r + 1 : minutes < S.down ? r - 1 : r, 1);
}

/** True when an endless run at `rung` right after one at `prevRung` is the STANDARD_WARMUP run. */
export function isWarmup(rung: number, prevRung: number): boolean {
  return clampRung(rung, 0) === COMFORT_MAX && prevRung === COMFORT_MAX - 1;
}

/** The RunConfig fields of an endless run at `rung` (the session and the career sim both use it). */
export interface RungConfig extends ComfortRung {
  readonly tutorial: boolean;
  readonly lesson: boolean;
  /** The STANDARD_WARMUP run (`opts.warmup` at rung 4). */
  readonly warmup: boolean;
}

export function rungConfig(rung: number, opts: { readonly tutorialDone: boolean; readonly warmup?: boolean }): RungConfig {
  const r = clampRung(rung, 0);
  const warmup = r === COMFORT_MAX && opts.warmup === true;
  const c = warmup ? STANDARD_WARMUP : (COMFORT_RUNGS[r] as ComfortRung);
  return { profile: c.profile, drain: c.drain, noonCloud: c.noonCloud, tutorial: r === 0, lesson: !opts.tutorialDone && r <= 1, warmup };
}

interface Row {
  epsNoon: number;
  v: number;
  dayLen: number;
  spacing: number;
  waveA: number;
  waveB: number;
  latMin: number;
  latMax: number;
  clouds: readonly number[];
  ballStart: number;
  ballEvery: number;
  flakes: number;
  floor: number;
}

/** Standard table for Days 1-6 (profile 3). Day 7+ use the ramp in rampRow(). */
const TABLE: readonly Row[] = [
  { epsNoon: 48, v: 70, dayLen: 50, spacing: 45, waveA: 0.75, waveB: 0.65, latMin: 20, latMax: 46, clouds: [9, 19, 38], ballStart: 0, ballEvery: 0, flakes: 3, floor: 50 },
  { epsNoon: 58, v: 80, dayLen: 50, spacing: 60, waveA: 1, waveB: 0, latMin: 20, latMax: 55, clouds: [8, 24, 40], ballStart: 6, ballEvery: 14, flakes: 3, floor: 45 },
  { epsNoon: 66, v: 90, dayLen: 50, spacing: 65, waveA: 1, waveB: 0, latMin: 20, latMax: 60, clouds: [6, 19, 32, 45], ballStart: 0, ballEvery: 0, flakes: 4, floor: 40 },
  { epsNoon: 72, v: 100, dayLen: 50, spacing: 70, waveA: 1, waveB: 0, latMin: 20, latMax: 65, clouds: [5, 16, 27, 38, 49], ballStart: 5, ballEvery: 10, flakes: 4, floor: 40 },
  { epsNoon: 76, v: 110, dayLen: 50, spacing: 75, waveA: 1, waveB: 0, latMin: 20, latMax: 70, clouds: [4, 13, 22, 31, 40, 49], ballStart: 0, ballEvery: 0, flakes: 4, floor: 35 },
  { epsNoon: 76, v: 120, dayLen: 45, spacing: 75, waveA: 1, waveB: 0, latMin: 20, latMax: 70, clouds: evenly(6, 4, 44), ballStart: 4, ballEvery: 8, flakes: 4, floor: 35 },
];

/** n spawn times evenly spaced over [a, b]. */
function evenly(n: number, a: number, b: number): number[] {
  if (n <= 1) return [a];
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(a + ((b - a) * i) / (n - 1));
  return out;
}

/** Day ≥ 7: keep daylight at 45 s and ramp danger instead (archive/CRITIQUE #7). */
function rampRow(day: number): Row {
  const n = day - 6;
  return {
    epsNoon: day >= 10 ? 80 : 76,
    v: 130,
    dayLen: 45,
    spacing: 75 + 4 * n,
    waveA: 1,
    waveB: 0,
    latMin: 20,
    latMax: 70 + 4 * n,
    clouds: evenly(Math.max(3, 6 - n), 4, 44),
    ballStart: 4,
    ballEvery: Math.max(5, 8 - n),
    flakes: 4,
    floor: Math.max(25, 35 - 2 * n),
  };
}

/** v1.6 Noon Heat of day d (profile 3; profiles 0-2 take each step one day later). */
function noonHeatOf(d: number, profile: ProfileId): number {
  const k = profile === 3 ? d : d - 1;
  return k >= 4 ? 1.2 : k >= 2 ? 1.1 : 1;
}

/** v1.6 Heat Flares of day d: how many, and their lift (°). */
function flareCountOf(d: number, profile: ProfileId): number {
  if (profile === 3) return d >= 3 ? 2 : d === 2 ? 1 : 0;
  return d >= 3 ? 1 : 0;
}

/** Night length (s): 8 s through Day 6, then 0.5 s shorter per day (min 5 s). */
export function nightLength(day: number): number {
  return day <= 6 ? 8 : Math.max(5, 8 - 0.5 * (day - 6));
}

const C = TUNING.cloud;
const CLEAR_SKY: SkyParams = Object.freeze({
  rxMin: C.rxMin,
  rxMax: C.rxMax,
  drift: C.driftMax,
  overtakeMin: C.overtakeSpeedMin,
  overtakeMax: C.overtakeSpeedMax,
  waitMin: C.waitSpeedMin,
  waitMax: C.waitSpeedMax,
});

/** Index of each forecast in FORECAST_IDS (cache keys). */
const FIDX = Object.freeze(Object.fromEntries(FORECAST_IDS.map((id, i) => [id, i])) as Record<ForecastId, number>);
const plans = new Map<number, DayPlan>();

/** The interned DayPlan of (biome, forecast): equal plans are the same object. */
export function dayPlan(biome: BiomeId, forecast: ForecastId): DayPlan {
  const key = (biome === 'oldtown' ? 8 : 0) + FIDX[forecast];
  let p = plans.get(key);
  if (!p) {
    p = Object.freeze({ biome, forecast });
    plans.set(key, p);
  }
  return p;
}

const LEGACY_MEADOW = dayPlan('meadow', 'clear');
const LEGACY_TOWN = dayPlan('oldtown', 'clear');

/** The plan of a plan-off (v1.0) world's day: odd days Meadow, even days Old Town, always clear. */
export function legacyPlan(day: number): DayPlan {
  return Math.floor(day) % 2 === 0 ? LEGACY_TOWN : LEGACY_MEADOW;
}

function tableRow(d: number): Row {
  return d <= TABLE.length ? (TABLE[d - 1] as Row) : rampRow(d);
}

const NO_BALLS: readonly [number, number] = Object.freeze([0, 0]);

/** Gazing balls of a day: the forecast's, else Old Town days ≥ 2 take row 2k's on their k-th such day. */
function ballsOf(d: number, plan: DayPlan): readonly [number, number] {
  const set = FORECAST_TUNING[plan.forecast].balls;
  if (set) return set;
  if (plan.biome !== 'oldtown' || d < 2) return NO_BALLS;
  const row = tableRow(2 * Math.floor(d / 2));
  return [row.ballStart, row.ballEvery];
}

function skyOf(plan: DayPlan): SkyParams {
  const ft = FORECAST_TUNING[plan.forecast];
  if (!ft.cloudRx && ft.cloudDrift === undefined && !ft.overtake && !ft.wait) return CLEAR_SKY;
  return Object.freeze({
    rxMin: ft.cloudRx ? ft.cloudRx[0] : CLEAR_SKY.rxMin,
    rxMax: ft.cloudRx ? ft.cloudRx[1] : CLEAR_SKY.rxMax,
    drift: ft.cloudDrift ?? CLEAR_SKY.drift,
    overtakeMin: ft.overtake ? ft.overtake[0] : CLEAR_SKY.overtakeMin,
    overtakeMax: ft.overtake ? ft.overtake[1] : CLEAR_SKY.overtakeMax,
    waitMin: ft.wait ? ft.wait[0] : CLEAR_SKY.waitMin,
    waitMax: ft.wait ? ft.wait[1] : CLEAR_SKY.waitMax,
  });
}

const cache = new Map<number, DayParams>();
const modCache = new Map<string, DayParams>();

/** Cloud spawn times: k × the row's count, evenly spaced over the row's first..last time (0 = none). */
function cloudTimes(row: Row, k: number): readonly number[] {
  const n = row.clouds.length;
  if (k === 1) return Object.freeze(row.clouds.slice());
  const m = Math.round(n * k);
  return Object.freeze(m <= 0 ? [] : evenly(m, row.clouds[0] as number, row.clouds[n - 1] as number));
}

/**
 * Parameters for day `day` (1-based) under onboarding profile `profile` and Day Plan entry `plan`
 * (default: the plan-off alternation of clear days). Only Day 1's εnoon and the drain/PHEW threshold
 * depend on the profile, and forecasts never touch dayLen, nightLen or v, so the time ↔ y mapping is
 * the same in every world. Gazing balls stand on Old Town days ≥ 2, the k-th such day using the
 * table row of day 2k (Old Town keeps its rhythm whichever biome Day 1 drew), unless the forecast
 * sets them (dazzle brings them to the Meadow, market clears them).
 *
 * `mods` (campaign concepts, CAMPAIGN_PLAN §3) apply their tunes on top of the forecast: spacing,
 * latMax, heightScale, cloud count and radii, waiters, gazing balls, flakes per cluster and cluster
 * spacing, melt budget, drain and regen multipliers, max Chill, the sun's follow cap and friction,
 * the walk multiplier and the noon elevation. Without mods the result is the same object as before.
 */
export function dayParams(day: number, profile: ProfileId, plan: DayPlan = legacyPlan(day), mods?: readonly ConceptId[]): DayParams {
  const d = Math.max(1, Math.floor(day));
  const key = ((d * 4 + profile) * 2 + (plan.biome === 'oldtown' ? 1 : 0)) * 8 + FIDX[plan.forecast];
  const tune = mods && mods.length > 0 ? foldTuning(mods) : null;
  const mkey = tune ? `${key}|${mods ? mods.join(',') : ''}` : '';
  const hit = tune ? modCache.get(mkey) : cache.get(key);
  if (hit) return hit;
  const row = tableRow(d);
  const prof = PROFILES[profile] as ProfileParams;
  const ft = FORECAST_TUNING[plan.forecast];
  const k = (ft.clouds ?? 1) * (tune?.cloudCount ?? 1);
  const balls = ballsOf(d, plan);
  const sky = skyOf(plan);
  const rxMul = tune?.cloudRx;
  const walkMul = tune?.walkMul ?? 1;
  const ballEvery = tune?.ballEvery;
  const params: DayParams = Object.freeze({
    day: d,
    biome: plan.biome,
    forecast: plan.forecast,
    epsNoon: tune?.epsNoon ?? ((d === 1 ? prof.day1EpsNoon : row.epsNoon) + (ft.epsNoon ?? 0)),
    v: tune ? row.v * walkMul : row.v,
    dayLen: row.dayLen,
    nightLen: nightLength(d),
    spacing: row.spacing * (ft.spacing ?? 1) * (tune?.spacing ?? 1),
    waveA: row.waveA,
    waveB: row.waveB,
    latMin: row.latMin,
    latMax: row.latMax + (ft.latMax ?? 0) + (tune?.latMax ?? 0),
    clouds: cloudTimes(row, k),
    sky: rxMul !== undefined ? Object.freeze({ ...sky, rxMin: sky.rxMin * rxMul, rxMax: sky.rxMax * rxMul }) : sky,
    ballStart: ballEvery !== undefined ? ballEvery / 2 : balls[0],
    ballEvery: ballEvery !== undefined ? ballEvery : balls[1],
    flakesPerCluster: tune?.flakesPerCluster ?? row.flakes + (ft.flakes ?? 0),
    snowMult: ft.snow ?? 1,
    floor: row.floor,
    drain: prof.drain,
    phewT: prof.phewT,
    heightScale: tune?.heightScale ?? 1,
    waitersOnly: tune?.waitersOnly ?? false,
    clusterGap: tune?.clusterGap ?? 1,
    meltBudget: tune?.meltBudget ?? TUNING.pickups.meltBudget,
    drainMul: tune?.drainMul ?? 1,
    regen: TUNING.nubs.regen * (tune?.regenMul ?? 1),
    maxChill: tune?.maxChill ?? TUNING.nubs.maxChill,
    sunFollow: tune?.sunFollow ?? 0,
    sunFriction: tune?.sunFriction ?? TUNING.sun.friction,
    walkMul,
    noonHeat: noonHeatOf(d, profile),
    flareCount: flareCountOf(d, profile),
    flareD: flareCountOf(d, profile) === 0 ? 0 : d >= 4 ? 10 : 12,
  });
  if (tune) modCache.set(mkey, params);
  else cache.set(key, params);
  return params;
}
