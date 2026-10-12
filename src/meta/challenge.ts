// Serverless challenge links (V1_PLAN §11.4, V1_1_PLAN UM2 with A1): base64url of compact JSON in
// the URL hash, in a fixed key order.
//   endless: {"v":1,"k":"e","seed":N,"m":M,"s":S,"p":P,"dr":D,"nc":C,"pl":L,"n":"Sam"}
//   daily:   {"v":1,"k":"d","d":"YYYY-MM-DD","m":M,"s":S,"n":"Sam"}
// m = target score in in-game minutes (Day 2 · 2:40 PM is 1240), s = the sender's run Snow. An
// endless code carries the sender's rules (profile p, drain dr, noon cloud nc, Day Plan pl); a v1.0
// code has none of them and decodes to the v1.0 world's rules. n (the sender's name) is optional.

import type { NoonCloud, ProfileId } from '../core/index.ts';
import { formatScore, formatTimeOfDay, splitMinutes } from '../core/format.ts';
import { decodeBase64Url, encodeBase64Url } from './base64url.ts';
import { addDays, DAILY_EPOCH, isDateString, localDate } from './daily.ts';

export type Challenge =
  | { v: 1; k: 'e'; seed: number; m: number; s: number; p?: ProfileId; dr?: number; nc?: NoonCloud; pl?: 0 | 1; n?: string }
  | { v: 1; k: 'd'; d: string; m: number; s: number; n?: string };

/** The rules of a v1.0 endless code (no p): the v1.0 world exactly. */
const LEGACY_RULES = { p: 3, dr: 55, nc: 0, pl: 0 } as const;
/** Codes longer than this are rejected before decoding (a v1.1 one with a name is ~130 chars). */
const MAX_CODE_LENGTH = 320;
/** Generous upper bound for a score (about 1,400 in-game days). */
const MAX_MINUTES = 1_000_000;
const MAX_SNOW = 10_000_000;
const UINT32_MAX = 0xffffffff;
/** Names are at most this many code points. */
const NAME_MAX = 12;
/** Bidi controls (LRM, RLM, embeddings and overrides, isolates) can reorder the text around a name. */
const BIDI = /[‎‏‪-‮⁦-⁩]/u;
const NAME_CHARS = /^[\p{L}\p{M}\p{N} ._'-]+$/u;

/**
 * A player name as it may travel in a link and show on screen: NFC, trimmed, 1-12 code points of
 * letters (with their combining marks), digits, spaces and . _ ' -, and no bidi controls; '' for
 * anything else. Names are rendered only through textContent, inside <bdi>.
 */
export function sanitizeName(raw: string): string {
  const name = raw.normalize('NFC').trim();
  if (name === '' || BIDI.test(name) || !NAME_CHARS.test(name)) return '';
  return [...name].length <= NAME_MAX ? name : '';
}

/** Encodes with a fixed key order so the same challenge always yields the same link. */
export function encodeChallenge(c: Challenge): string {
  const n = c.n ? { n: c.n } : {};
  if (c.k === 'd') return encodeBase64Url(JSON.stringify({ v: 1, k: 'd', d: c.d, m: c.m, s: c.s, ...n }));
  const r = c.p === undefined ? LEGACY_RULES : { p: c.p, dr: c.dr ?? 55, nc: c.nc ?? 0, pl: c.pl ?? (c.p === 3 ? 1 : 0) };
  return encodeBase64Url(JSON.stringify({ v: 1, k: 'e', seed: c.seed, m: c.m, s: c.s, p: r.p, dr: r.dr, nc: r.nc, pl: r.pl, ...n }));
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
 * An invalid optional field (p, dr, nc, pl, n) is dropped and the challenge stays valid. Endless
 * challenges always come back with their resolved rules: a code without p is a v1.0 one ({p 3,
 * dr 55, nc 0, pl 0}); without pl, the Day Plan is on for profile 3.
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
  const name = typeof o.n === 'string' ? sanitizeName(o.n) : '';
  const n = name !== '' ? { n: name } : {};
  if (o.k === 'e' && isIntIn(o.seed, 0, UINT32_MAX)) {
    const base = { v: 1, k: 'e', seed: o.seed, m: o.m, s: o.s } as const;
    if (!('p' in o)) return { ...base, ...LEGACY_RULES, ...n };
    const p: ProfileId = isIntIn(o.p, 0, 3) ? (o.p as ProfileId) : 3;
    const pl = o.pl === 0 || o.pl === 1 ? o.pl : p === 3 ? 1 : 0;
    return { ...base, p, dr: isIntIn(o.dr, 25, 60) ? o.dr : 55, nc: isIntIn(o.nc, 0, 2) ? (o.nc as NoonCloud) : 0, pl, ...n };
  }
  if (o.k === 'd' && typeof o.d === 'string' && dailyDateInRange(o.d, today)) return { v: 1, k: 'd', d: o.d, m: o.m, s: o.s, ...n };
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
