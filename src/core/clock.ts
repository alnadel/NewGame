// Day/night clock, sun elevation, and the time ↔ y mapping (V1_PLAN §4.1).
//
// Time is kept in integer ticks so it never drifts: a day's daylight and night are whole numbers of
// ticks (e.g. 3000 + 480). "Absolute ticks" count from Day 1 dawn and are the same in every run of
// a seed, whichever day the run starts on; clouds and the validator's 0.1 s steps use them.
//
// Nubs' y is a pure function of (day, dayTick): v·t in daylight, then 8·v spread over the night.
// Day and night lengths never depend on the profile, so this mapping is global.

import { dayParams, type DayParams } from '../config/days.ts';
import { TUNING } from '../config/tuning.ts';
import { sinD } from './dmath.ts';
import { formatTimeOfDay, formatTimeOfDay10, MINUTES_PER_DAY } from './format.ts';

export const TICK_HZ = TUNING.tick.hz;
export const DT = TUNING.tick.dt;

/** Elevation at dawn and dusk (°). */
export const EPS_DAWN = 6;

/** Night distance is always NIGHT_WALK·v, whatever the night length. */
export const NIGHT_WALK = 8;

/**
 * The clock's day rows (profile 3, the legacy plan: only dayLen, nightLen and v are read, which
 * depend on the day alone), memoised per whole day: the sim asks for them several times a tick.
 */
const rows: DayParams[] = [];
function row(day: number): DayParams {
  const d = Math.max(1, Math.floor(day));
  let p = rows[d];
  if (p === undefined) rows[d] = p = dayParams(d, 3);
  return p;
}

/** Daylight length of `day` in ticks. */
export function dayTicks(day: number): number {
  return Math.round(row(day).dayLen * TICK_HZ);
}

/** Night length of `day` in ticks. */
export function nightTicks(day: number): number {
  return Math.round(row(day).nightLen * TICK_HZ);
}

/** Daylight length (s). */
export function dayLength(day: number): number {
  return row(day).dayLen;
}

/** Night length (s). */
export function nightLength(day: number): number {
  return row(day).nightLen;
}

// Cumulative tables indexed by day (index 0 unused): absolute tick and y at each dawn.
const startTick: number[] = [0, 0];
const startY: number[] = [0, 0];

function ensureDay(day: number): void {
  while (startTick.length <= day) {
    const d = startTick.length - 1; // last known day
    const p = row(d);
    startTick.push((startTick[d] as number) + dayTicks(d) + nightTicks(d));
    startY.push((startY[d] as number) + p.v * p.dayLen + NIGHT_WALK * p.v);
  }
}

/** Absolute tick of Day `day` dawn (Day 1 dawn = 0). */
export function dayStartTick(day: number): number {
  ensureDay(day);
  return startTick[day] as number;
}

/** y at Day `day` dawn (Day 1 dawn = 0). */
export function dayStartY(day: number): number {
  ensureDay(day);
  return startY[day] as number;
}

/** The day containing absolute tick `tickAbs` (daylight or night). Ticks before 0 map to Day 1. */
export function dayAtTick(tickAbs: number): number {
  if (tickAbs < 0) return 1;
  let d = 1;
  for (;;) {
    ensureDay(d + 1);
    if ((startTick[d + 1] as number) > tickAbs) return d;
    d++;
  }
}

/** Nubs' y at `dayTick` ticks after Day `day` dawn (0 ≤ dayTick ≤ day + night ticks). */
export function yAtDayTick(day: number, dayTick: number): number {
  const p = row(day);
  const dl = dayTicks(day);
  const y0 = dayStartY(day);
  if (dayTick <= dl) return y0 + (p.v * dayTick) / TICK_HZ;
  return y0 + p.v * p.dayLen + (NIGHT_WALK * p.v * (dayTick - dl)) / nightTicks(day);
}

/** Nubs' y at an absolute tick. */
export function yAtTick(tickAbs: number): number {
  const d = dayAtTick(tickAbs);
  return yAtDayTick(d, tickAbs - dayStartTick(d));
}

/** Result of timeAtY(): day, fractional ticks since that day's dawn, and whether it is night. */
export interface YTime {
  day: number;
  dayTick: number;
  night: boolean;
}

/** Inverse of yAtDayTick. y < 0 maps to Day 1 with a negative dayTick. */
export function timeAtY(y: number, out: YTime): YTime {
  let d = 1;
  if (y >= 0) {
    for (;;) {
      ensureDay(d + 1);
      if ((startY[d + 1] as number) > y) break;
      d++;
    }
  }
  const p = row(d);
  const dy = y - dayStartY(d);
  const dayY = p.v * p.dayLen;
  out.day = d;
  if (dy <= dayY) {
    out.dayTick = (dy * TICK_HZ) / p.v;
    out.night = false;
  } else {
    out.dayTick = dayTicks(d) + ((dy - dayY) * nightTicks(d)) / (NIGHT_WALK * p.v);
    out.night = true;
  }
  return out;
}

/** y of a clock time: `t` seconds after Day `day` dawn. */
export function yAtTime(day: number, t: number): number {
  return yAtDayTick(day, t * TICK_HZ);
}

/**
 * Sun elevation ε (°) at `tDay` seconds into `day`: 6° + (εnoon − 6°)·sin(π·t/Dl). 0 at night.
 * Exact at dawn (6) and noon (εnoon).
 */
export function elevation(params: DayParams, tDay: number): number {
  if (tDay < 0 || tDay > params.dayLen) return 0;
  return EPS_DAWN + (params.epsNoon - EPS_DAWN) * sinD((180 * tDay) / params.dayLen);
}

/**
 * Absolute tick of an in-game minute count (minutes since Day 1 6:00 AM; nights have no minutes):
 * minute 360 is Day 1 noon, 720 the last daylight tick of Day 1 (6:00 PM, before the night), 1080
 * Day 2 noon. Campaign levels place their start, midpoint and finish with it.
 */
export function tickAtMinute(minutes: number): number {
  const m = Math.max(0, minutes);
  const day = m <= 0 ? 1 : Math.floor((m - 1) / MINUTES_PER_DAY) + 1;
  const frac = (m - (day - 1) * MINUTES_PER_DAY) / MINUTES_PER_DAY;
  return dayStartTick(day) + Math.round(frac * dayTicks(day));
}

/** In-game minutes since 6:00 AM, 0..720 (720 = 6:00 PM, also used through the night). */
export function minutesOfDay(day: number, dayTick: number): number {
  const dl = dayTicks(day);
  if (dayTick >= dl) return MINUTES_PER_DAY;
  if (dayTick <= 0) return 0;
  return Math.floor((MINUTES_PER_DAY * dayTick) / dl);
}

/** Score M = (N−1)·720 + floor(720·t/Dl). */
export function scoreMinutes(day: number, dayTick: number): number {
  return (day - 1) * MINUTES_PER_DAY + minutesOfDay(day, dayTick);
}

/** HUD clock in 10-minute steps, e.g. "2:40 PM". */
export function hudClock(day: number, dayTick: number): string {
  return formatTimeOfDay10(minutesOfDay(day, dayTick));
}

/** Exact clock, e.g. "2:47 PM" (death line, results). */
export function exactClock(day: number, dayTick: number): string {
  return formatTimeOfDay(minutesOfDay(day, dayTick));
}

/** Ticks per in-game hour of `day` (12 daylight hours). */
export function hourTicks(day: number): number {
  return dayTicks(day) / TUNING.glyph.hoursPerDay;
}

/** Day tick of the NOON banner (Dl/2 − 2 s). */
export function noonBannerTick(day: number): number {
  return Math.round((dayLength(day) / 2 - 2) * TICK_HZ);
}

/** Day tick after which noon counts as passed (0.6·Dl). */
export function noonPassedTick(day: number): number {
  return Math.round(0.6 * dayLength(day) * TICK_HZ);
}
