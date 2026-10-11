// Daily Solstice calendar helpers (V1_PLAN §11.3).
// Dates are local calendar dates as 'YYYY-MM-DD' strings. All day arithmetic runs on UTC
// midnights built from the date's components, so DST shifts can never skip or repeat a day.

import { hashString } from '../core/rng.ts';

/** Daily #1 is this local date. */
export const DAILY_EPOCH = '2026-01-01';
/** Scored tries per daily; later runs are unscored practice. */
export const DAILY_TRIES = 3;

const MS_PER_DAY = 86_400_000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** The local calendar date of `d` as 'YYYY-MM-DD'. */
export function localDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** UTC midnight (ms) of a 'YYYY-MM-DD' string, or null if it is not a real calendar date. */
function utcMidnight(date: string): number | null {
  const m = DATE_RE.exec(date);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const ms = Date.UTC(y, mo - 1, d);
  const back = new Date(ms);
  // Reject roll-overs such as 2026-02-31.
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return ms;
}

/** True for a real calendar date in 'YYYY-MM-DD' form. */
export function isDateString(date: string): boolean {
  return utcMidnight(date) !== null;
}

function fromUtc(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** Whole days from `a` to `b` (positive when b is later). Invalid dates count as 0. */
export function daysBetween(a: string, b: string): number {
  const ma = utcMidnight(a);
  const mb = utcMidnight(b);
  if (ma === null || mb === null) return 0;
  return Math.round((mb - ma) / MS_PER_DAY);
}

/** The date `n` days after `date` (n may be negative). */
export function addDays(date: string, n: number): string {
  const ms = utcMidnight(date);
  if (ms === null) return date;
  return fromUtc(ms + n * MS_PER_DAY);
}

/** Daily number: days since 2026-01-01 + 1, so 2026-10-11 is #284. */
export function dailyNumber(date: string): number {
  return daysBetween(DAILY_EPOCH, date) + 1;
}

/** World seed for a date's daily: xmur3("shady-daily-YYYY-MM-DD"). Same for everyone on that date. */
export function dailySeed(date: string): number {
  return hashString(`shady-daily-${date}`);
}

/** The `count` most recent dates ending at `today`, newest first. */
export function recentDates(today: string, count: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(addDays(today, -i));
  return out;
}

/**
 * True when `date` is before the local day the save was created (`createdAt`, ms): the player
 * couldn't have played that Daily, so history shows it neutrally rather than as missed.
 */
export function beforeSaveStart(date: string, createdAt: number): boolean {
  return date < localDate(new Date(createdAt));
}

/** Short human label such as "Sun, Oct 11" (English, independent of the device locale). */
export function formatDateLabel(date: string): string {
  const ms = utcMidnight(date);
  if (ms === null) return date;
  const d = new Date(ms);
  return `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}
