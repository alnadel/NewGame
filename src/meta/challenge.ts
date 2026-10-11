// Serverless challenge links (V1_PLAN §11.4): base64url of compact JSON in the URL hash.
//   endless: {"v":1,"k":"e","seed":N,"m":M,"s":S}
//   daily:   {"v":1,"k":"d","d":"YYYY-MM-DD","m":M,"s":S}
// m = target score in in-game minutes (Day 2 · 2:40 PM is 1240), s = the sender's run Snow.

import { formatScore, formatTimeOfDay, splitMinutes } from '../core/format.ts';
import { decodeBase64Url, encodeBase64Url } from './base64url.ts';
import { addDays, DAILY_EPOCH, isDateString, localDate } from './daily.ts';

export type Challenge =
  | { v: 1; k: 'e'; seed: number; m: number; s: number }
  | { v: 1; k: 'd'; d: string; m: number; s: number };

/** Codes longer than this are rejected before decoding (a real one is ~60 chars). */
const MAX_CODE_LENGTH = 200;
/** Generous upper bound for a score (about 1,400 in-game days). */
const MAX_MINUTES = 1_000_000;
const MAX_SNOW = 10_000_000;
const UINT32_MAX = 0xffffffff;

/** Encodes with a fixed key order so the same challenge always yields the same link. */
export function encodeChallenge(c: Challenge): string {
  const json =
    c.k === 'e'
      ? JSON.stringify({ v: 1, k: 'e', seed: c.seed, m: c.m, s: c.s })
      : JSON.stringify({ v: 1, k: 'd', d: c.d, m: c.m, s: c.s });
  return encodeBase64Url(json);
}

function isIntIn(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
}

/**
 * A Daily date a link may name: a real calendar date from Daily #1 up to tomorrow (a sender a time
 * zone ahead may already be on it). ISO dates compare lexicographically. The game applies the same
 * bounds to `?mode=daily&date=`.
 */
function dailyDateInRange(date: string, today: string): boolean {
  return isDateString(date) && date >= DAILY_EPOCH && date <= addDays(today, 1);
}

/**
 * Decodes and validates a code; null for anything malformed, out of range or of an unknown version.
 * @param today the local date ('YYYY-MM-DD') that bounds a daily challenge's date.
 */
export function decodeChallenge(code: string, today: string = localDate()): Challenge | null {
  if (code.length === 0 || code.length > MAX_CODE_LENGTH) return null;
  const json = decodeBase64Url(code);
  if (json === null) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== 1 || !isIntIn(o.m, 0, MAX_MINUTES) || !isIntIn(o.s, 0, MAX_SNOW)) return null;
  if (o.k === 'e' && isIntIn(o.seed, 0, UINT32_MAX)) return { v: 1, k: 'e', seed: o.seed, m: o.m, s: o.s };
  if (o.k === 'd' && typeof o.d === 'string' && dailyDateInRange(o.d, today)) return { v: 1, k: 'd', d: o.d, m: o.m, s: o.s };
  return null;
}

/** Reads `c=<code>` from a location hash such as "#c=eyJ2Ijox..." (other `&`-joined params are ignored). */
export function challengeFromHash(hash: string, today: string = localDate()): Challenge | null {
  const body = hash.startsWith('#') ? hash.slice(1) : hash;
  for (const part of body.split('&')) {
    if (part.startsWith('c=')) return decodeChallenge(part.slice(2), today);
  }
  return null;
}

/** `<origin><path>#c=<code>`; `baseUrl` is origin + path, e.g. "https://example.com/shady/". */
export function challengeUrl(baseUrl: string, c: Challenge): string {
  const clean = baseUrl.replace(/#.*$/, '');
  return `${clean}#c=${encodeChallenge(c)}`;
}

/** Clock-time gap on one day: "40 min", "2 h", "2 h 17 min". */
function clockGap(minutes: number): string {
  const hh = Math.floor(minutes / 60);
  const mm = minutes % 60;
  if (hh === 0) return `${mm} min`;
  return mm === 0 ? `${hh} h` : `${hh} h ${mm} min`;
}

/**
 * The Results verdict for a challenge run, in score terms. Score minutes count daylight only, so a
 * gap across days is not a duration anyone lived through: across days the line names the target
 * ("Short of Day 2 · 2:40 PM"); on the target's own day it is a clock gap ("40 min short of 2:40 PM").
 */
export function challengeVerdict(reached: number, target: number): { text: string; win: boolean } {
  const r = splitMinutes(reached);
  const t = splitMinutes(target);
  const label = formatScore(target);
  if (reached === target) return { text: `Dead heat with ${label}!`, win: true };
  if (reached > target) {
    return r.day === t.day ? { text: `Beat ${label} by ${clockGap(reached - target)}!`, win: true } : { text: `Beat ${label}!`, win: true };
  }
  if (r.day === t.day) return { text: `${clockGap(target - reached)} short of ${formatTimeOfDay(t.minute)} on Day ${t.day}`, win: false };
  return { text: `Short of the target: ${label}`, win: false };
}
