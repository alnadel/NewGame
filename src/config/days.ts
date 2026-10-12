// Day table, post-Day-6 ramp, onboarding profiles and the comfort ladder (V1_PLAN §4.2, §6).
// Pure data + arithmetic: this module imports nothing. All per-day difficulty knobs live here.

export type BiomeId = 'meadow' | 'oldtown';
export type ProfileId = 0 | 1 | 2 | 3;

export interface DayParams {
  readonly day: number;
  readonly biome: BiomeId;
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
  /** Cloud spawn times (s into the day). */
  readonly clouds: readonly number[];
  /** Gazing balls: first at ballStart s, then every ballEvery s while t < dayLen. ballEvery 0 = none. */
  readonly ballStart: number;
  readonly ballEvery: number;
  readonly flakesPerCluster: number;
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
  /** Day 2 gets a guaranteed gate arch at noon (V1_PLAN §7.2). */
  readonly gateAtNoon: boolean;
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
 */
export const COMFORT_RUNGS: readonly ComfortRung[] = Object.freeze([
  Object.freeze({ profile: 0, drain: 30, noonCloud: 1 }),
  Object.freeze({ profile: 2, drain: 40, noonCloud: 1 }),
  Object.freeze({ profile: 3, drain: 44, noonCloud: 1 }),
  Object.freeze({ profile: 3, drain: 50, noonCloud: 2 }),
  Object.freeze({ profile: 3, drain: 55, noonCloud: 0 }),
] satisfies ComfortRung[]);

export const COMFORT_MAX = 4;

/** comfortAfterRun thresholds (score minutes): a jump to standard, one rung up, one rung down. */
export const COMFORT_STEPS = Object.freeze({ standard: 1440, up: 390, down: 240, tutorialUp: 720 });

const clampRung = (r: number, lo: number): number => (r >= lo ? (r <= COMFORT_MAX ? Math.floor(r) : COMFORT_MAX) : lo);

/**
 * The rung of the next endless run after a run at `rung` that scored `minutes`. From the tutorial
 * (rung 0): Day 3 → standard, the first night → 2, else 1. From rung ≥ 1: Day 3 → standard, past
 * 12:30 PM → one up, before 10:00 AM → one down, else the same. Never back to the tutorial.
 */
export function comfortAfterRun(rung: number, minutes: number): number {
  const S = COMFORT_STEPS;
  const r = clampRung(rung, 0);
  if (minutes >= S.standard) return COMFORT_MAX;
  if (r === 0) return minutes >= S.tutorialUp ? 2 : 1;
  return clampRung(minutes >= S.up ? r + 1 : minutes < S.down ? r - 1 : r, 1);
}

/** The RunConfig fields of an endless run at `rung` (the session and the career sim both use it). */
export interface RungConfig extends ComfortRung {
  readonly tutorial: boolean;
  readonly lesson: boolean;
}

export function rungConfig(rung: number, opts: { readonly tutorialDone: boolean }): RungConfig {
  const r = clampRung(rung, 0);
  const c = COMFORT_RUNGS[r] as ComfortRung;
  return { profile: c.profile, drain: c.drain, noonCloud: c.noonCloud, tutorial: r === 0, lesson: !opts.tutorialDone && r <= 1 };
}

// V11-SHIM: CC-1 endlessDrain(lifetimeRuns) — src/game/session.ts still imports it until GR7 moves
// endless runs to rungConfig(); delete at integration (CC-1 removes it).
export function endlessDrain(lifetimeRuns: number): number {
  const n = lifetimeRuns > 0 ? Math.floor(lifetimeRuns) : 0;
  return Math.min((PROFILES[n < 3 ? n : 3] as ProfileParams).drain, 30 + 3 * n, 55);
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

/** Day ≥ 7: keep daylight at 45 s and ramp danger instead (critique #7). */
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

/** Night length (s): 8 s through Day 6, then 0.5 s shorter per day (min 5 s). */
export function nightLength(day: number): number {
  return day <= 6 ? 8 : Math.max(5, 8 - 0.5 * (day - 6));
}

const cache = new Map<number, DayParams>();

/**
 * Parameters for day `day` (1-based) under onboarding profile `profile`.
 * Only Day 1's εnoon/floor and the drain/PHEW threshold depend on the profile, so day and night
 * lengths (and therefore the time ↔ y mapping) are identical in every profile.
 */
export function dayParams(day: number, profile: ProfileId): DayParams {
  const d = Math.max(1, Math.floor(day));
  const key = d * 4 + profile;
  const hit = cache.get(key);
  if (hit) return hit;
  const row = d <= TABLE.length ? (TABLE[d - 1] as Row) : rampRow(d);
  const prof = PROFILES[profile] as ProfileParams;
  const oldTown = d % 2 === 0;
  const params: DayParams = Object.freeze({
    day: d,
    biome: oldTown ? 'oldtown' : 'meadow',
    epsNoon: d === 1 ? prof.day1EpsNoon : row.epsNoon,
    v: row.v,
    dayLen: row.dayLen,
    nightLen: nightLength(d),
    spacing: row.spacing,
    waveA: row.waveA,
    waveB: row.waveB,
    latMin: row.latMin,
    latMax: row.latMax,
    clouds: Object.freeze(row.clouds.slice()),
    // Gazing balls are Old Town objects only.
    ballStart: oldTown ? row.ballStart : 0,
    ballEvery: oldTown ? row.ballEvery : 0,
    flakesPerCluster: row.flakes,
    floor: row.floor,
    drain: prof.drain,
    phewT: prof.phewT,
    gateAtNoon: d === 2,
  });
  cache.set(key, params);
  return params;
}
