// The week's days (V1_1_PLAN UM5, v1.4): a Monday-to-Sunday week of local dates. A day is sunny once
// a run finishes on it; all seven unlock the Sunny Week trophy and a week closing with five or more
// counts in stats.sunnyWeeks. Its Snow rewards retired in v1.4 (the daily streak pays instead:
// gamify.ts claimDaily). Dates are 'YYYY-MM-DD' strings, so DST never moves a day.

import type { WeekState } from './saveTypes.ts';
import { addDays, daysBetween, weekday } from './daily.ts';
import { emptyWeek } from './save.ts';

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

/**
 * Marks `today` sunny with a run that reached Day `day`, rolling the week over on a new Monday.
 * Mutates `week`. Returns true when the previous week just closed with SUNNY_WEEK_DAYS or more.
 */
export function markSunnyDay(week: WeekState, today: string, day: number): boolean {
  const start = mondayOf(today);
  let closedSunny = false;
  // A device clock set back into an older week leaves the newer week alone.
  if (start < week.start) return false;
  if (week.start !== start) {
    closedSunny = week.start !== '' && sunnyDays(week) >= SUNNY_WEEK_DAYS;
    Object.assign(week, emptyWeek(), { start });
  }
  const i = daysBetween(start, today);
  week.days |= 1 << i;
  week.best[i] = Math.max(week.best[i] ?? 0, Math.min(99, day));
  return closedSunny;
}

/** The current week: the stored one, or an empty week from today's Monday. */
export function weekFor(week: WeekState, today: string): WeekState {
  const start = mondayOf(today);
  return week.start === start ? week : { ...emptyWeek(), start };
}
