// Day table, post-Day-6 ramp and onboarding profiles (V1_PLAN §4.2, §6).
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
   * effectiveDrain(s), which prefers RunConfig.drain (the endless onboarding ramp) when it is set;
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
  /**
   * Validator floor override for Day 1 (0 = use the day table). Currently non-binding: profile 0's
   * Day 1 (εnoon 40°, drain 30, the authored tutorial chunk and the parked noon cloud) never needs a
   * rescue at its floor, so 70 and the table's 50 give byte-identical worlds and sim output
   * (verified with `node scripts/sim.ts` and the golden hashes). Kept as the knob for a harder p0.
   */
  readonly day1Floor: number;
  /** A cloud rides with Nubs over 11 AM-1 PM on Day 1, reachable with the sun roughly north. */
  readonly parkedNoonCloud: boolean;
  /** The first Day-1 cloud is always an overtaker (tutorial beat). */
  readonly firstCloudOvertakes: boolean;
  readonly phewT: number;
  readonly guideAlways: boolean;
}

/**
 * Onboarding profiles (V1_PLAN §6). Daily and challenge runs always use profile 3. Drains step
 * 30 / 40 / 47 / 55 (K2) so the run-3 jump to the full drain is no longer a cliff; endless runs also
 * cap it per lifetime run with endlessDrain() below.
 */
export const PROFILES: readonly ProfileParams[] = Object.freeze([
  Object.freeze({ drain: 30, day1EpsNoon: 40, day1Floor: 70, parkedNoonCloud: true, firstCloudOvertakes: true, phewT: 20, guideAlways: true }),
  Object.freeze({ drain: 40, day1EpsNoon: 44, day1Floor: 0, parkedNoonCloud: false, firstCloudOvertakes: false, phewT: 20, guideAlways: false }),
  Object.freeze({ drain: 47, day1EpsNoon: 48, day1Floor: 0, parkedNoonCloud: false, firstCloudOvertakes: false, phewT: 20, guideAlways: false }),
  Object.freeze({ drain: 55, day1EpsNoon: 48, day1Floor: 0, parkedNoonCloud: false, firstCloudOvertakes: false, phewT: 15, guideAlways: false }),
]);

/**
 * Endless onboarding drain ramp (K2 addendum): run n (0-based lifetime runs) drains at most
 * start + perRun·n Chill/s, never above max or its profile's drain.
 */
export const ONBOARD_DRAIN = Object.freeze({ start: 30, perRun: 3, max: 55 });

/**
 * Drain (Chill/s at f = 1) for an endless run started after `lifetimeRuns` finished runs:
 * min(PROFILES[min(3, n)].drain, start + perRun·n, max) with n = max(0, floor(runs)).
 * Runs 0..9 give 30, 33, 36, 39, 42, 45, 48, 51, 54, 55; 9 and later give 55. The session passes it
 * as RunConfig.drain for endless runs only; daily, challenge and bots keep the profile drain.
 */
export function endlessDrain(lifetimeRuns: number): number {
  const n = lifetimeRuns > 0 ? Math.floor(lifetimeRuns) : 0;
  const prof = (PROFILES[n < 3 ? n : 3] as ProfileParams).drain;
  const ramp = ONBOARD_DRAIN.start + ONBOARD_DRAIN.perRun * n;
  return Math.min(prof, ramp, ONBOARD_DRAIN.max);
}

interface Row {
  epsNoon: number;
  v: number;
  dayLen: number;
  spacing: number;
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
  { epsNoon: 48, v: 70, dayLen: 50, spacing: 45, latMin: 20, latMax: 46, clouds: [9, 19, 38], ballStart: 0, ballEvery: 0, flakes: 3, floor: 50 },
  { epsNoon: 58, v: 80, dayLen: 50, spacing: 60, latMin: 20, latMax: 55, clouds: [8, 24, 40], ballStart: 6, ballEvery: 14, flakes: 3, floor: 45 },
  { epsNoon: 66, v: 90, dayLen: 50, spacing: 65, latMin: 20, latMax: 60, clouds: [6, 19, 32, 45], ballStart: 0, ballEvery: 0, flakes: 4, floor: 40 },
  { epsNoon: 72, v: 100, dayLen: 50, spacing: 70, latMin: 20, latMax: 65, clouds: [5, 16, 27, 38, 49], ballStart: 5, ballEvery: 10, flakes: 4, floor: 40 },
  { epsNoon: 76, v: 110, dayLen: 50, spacing: 75, latMin: 20, latMax: 70, clouds: [4, 13, 22, 31, 40, 49], ballStart: 0, ballEvery: 0, flakes: 4, floor: 35 },
  { epsNoon: 76, v: 120, dayLen: 45, spacing: 75, latMin: 20, latMax: 70, clouds: evenly(6, 4, 44), ballStart: 4, ballEvery: 8, flakes: 4, floor: 35 },
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
    latMin: row.latMin,
    latMax: row.latMax,
    clouds: Object.freeze(row.clouds.slice()),
    // Gazing balls are Old Town objects only.
    ballStart: oldTown ? row.ballStart : 0,
    ballEvery: oldTown ? row.ballEvery : 0,
    flakesPerCluster: row.flakes,
    floor: d === 1 && prof.day1Floor > 0 ? prof.day1Floor : row.floor,
    drain: prof.drain,
    phewT: prof.phewT,
    gateAtNoon: d === 2,
  });
  cache.set(key, params);
  return params;
}
