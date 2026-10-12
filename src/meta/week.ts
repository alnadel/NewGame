// Sunny Week (V1_1_PLAN UM5): a Monday-to-Sunday week of local dates. A day is sunny once a run
// finishes on it; 3, 5 and 7 sunny days pay once each. Dates are 'YYYY-MM-DD' strings, so DST never
// moves a day. No streaks, no countdowns: a missed day costs nothing (GDD §16).

import type { WeekState } from './saveTypes.ts';
import { addDays, daysBetween, weekday } from './daily.ts';
import { emptyWeek } from './save.ts';

/** Sunny-day thresholds and their one-time rewards (paid bit i for SUNNY_REWARDS[i]). */
export const SUNNY_REWARDS: readonly { readonly days: number; readonly snow: number }[] = [
  { days: 3, snow: 30 },
  { days: 5, snow: 50 },
  { days: 7, snow: 80 },
];
/** A week that closes with this many sunny days counts in stats.sunnyWeeks. */
export const SUNNY_WEEK_DAYS = 5;

/** The Monday of a date's week. */
export function mondayOf(date: string): string {
  return addDays(date, -((weekday(date) + 6) % 7));
}

/** Sunny days so far in a week. */
export function sunnyDays(week: WeekState): number {
  let n = 0;
  for (let b = week.days; b > 0; b >>= 1) n += b & 1;
  return n;
}

export interface SunnyDayResult {
  /** The previous week just closed with SUNNY_WEEK_DAYS or more sunny days. */
  closedSunny: boolean;
  /** Thresholds paid by this day. */
  paid: { days: number; snow: number }[];
}

/**
 * Marks `today` sunny with a run that reached Day `day`, rolling the week over on a new Monday and
 * paying the thresholds crossed. Mutates `week`.
 */
export function markSunnyDay(week: WeekState, today: string, day: number): SunnyDayResult {
  const start = mondayOf(today);
  let closedSunny = false;
  // A device clock set back into an older week leaves the newer week alone.
  if (start < week.start) return { closedSunny, paid: [] };
  if (week.start !== start) {
    closedSunny = week.start !== '' && sunnyDays(week) >= SUNNY_WEEK_DAYS;
    Object.assign(week, emptyWeek(), { start });
  }
  const i = daysBetween(start, today);
  week.days |= 1 << i;
  week.best[i] = Math.max(week.best[i] ?? 0, Math.min(99, day));
  const n = sunnyDays(week);
  const paid: { days: number; snow: number }[] = [];
  SUNNY_REWARDS.forEach((r, bit) => {
    if (n < r.days || week.paid & (1 << bit)) return;
    week.paid |= 1 << bit;
    paid.push({ ...r });
  });
  return { closedSunny, paid };
}

/** The current week as the Missions card shows it: the stored one, or an empty week from today's Monday. */
export function weekFor(week: WeekState, today: string): WeekState {
  const start = mondayOf(today);
  return week.start === start ? week : { ...emptyWeek(), start };
}
