// Spoiler-free share text with hour glyphs (GDD §9 with the V1_PLAN §5.5 glyph set).
//
// Endless:                                   Daily:
//   SHADY: Nubs made it to Day 3 · 2:40 PM     SHADY Daily #284: Day 2 · 2:40 PM (try 2/3)
//   <final day's strip>                        <day 1 strip>🌙
//   Snow 112 · 4 PHEWs                         <day 2 strip ending in 💧>
//   Beat my run: <link>                        <link>
// 🧭 is appended to the last strip when the guide was forced on ("Always"). Without a canonical
// base URL (a file: or native build with no VITE_SHARE_URL) the link line is left out.

import type { HourGlyph, RunResult } from '../core/sim/events.ts';
import { formatScore } from '../core/format.ts';
import { isNative } from '../platform/native.ts';
import { challengeUrl, type Challenge } from './challenge.ts';
import { dailyNumber, DAILY_TRIES } from './daily.ts';

export const GLYPHS: Readonly<Record<HourGlyph, string>> = {
  cool: '❄️', // ❄️ snowflake (shape differs from the squares: colorblind-safe)
  warm: '\u{1F7E8}', // 🟨
  hot: '\u{1F525}', // 🔥
  melt: '\u{1F4A7}', // 💧
};
export const MOON = '\u{1F319}'; // 🌙 after each completed day
export const COMPASS = '\u{1F9ED}'; // 🧭 assisted (guide "Always")

/** One glyph per daylight hour, no separators. */
export function glyphStrip(hours: readonly HourGlyph[]): string {
  let out = '';
  for (const h of hours) out += GLYPHS[h];
  return out;
}

/**
 * One line per day: completed days end with 🌙, the final day is as recorded (ending in 💧).
 * `assisted` appends 🧭 to the last line.
 */
export function dayStripLines(hourGlyphs: readonly (readonly HourGlyph[])[], assisted: boolean): string[] {
  const lines = hourGlyphs.map((day, i) => glyphStrip(day) + (i < hourGlyphs.length - 1 ? MOON : ''));
  if (lines.length === 0) lines.push('');
  if (assisted) lines[lines.length - 1] += COMPASS;
  return lines;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export interface EndlessShareInput {
  minutes: number;
  hourGlyphs: readonly (readonly HourGlyph[])[];
  snow: number;
  phews: number;
  assisted: boolean;
  /** The challenge link, or null to leave the link line out. */
  link: string | null;
}

export function endlessShareText(p: EndlessShareInput): string {
  const lines = dayStripLines(p.hourGlyphs, p.assisted);
  const out = [
    `SHADY: Nubs made it to ${formatScore(p.minutes)}`,
    lines[lines.length - 1] as string,
    `Snow ${p.snow} · ${plural(p.phews, 'PHEW')}`,
  ];
  if (p.link !== null) out.push(`Beat my run: ${p.link}`);
  return out.join('\n');
}

export interface DailyShareInput {
  dailyNumber: number;
  minutes: number;
  /** Counted try (1-3), or null for an unscored practice run. */
  tryNumber: number | null;
  hourGlyphs: readonly (readonly HourGlyph[])[];
  assisted: boolean;
  /** The challenge link, or null to leave the link line out. */
  link: string | null;
}

export function dailyShareText(p: DailyShareInput): string {
  const attempt = p.tryNumber === null ? 'practice' : `try ${p.tryNumber}/${DAILY_TRIES}`;
  const out = [`SHADY Daily #${p.dailyNumber}: ${formatScore(p.minutes)} (${attempt})`, ...dayStripLines(p.hourGlyphs, p.assisted)];
  if (p.link !== null) out.push(p.link);
  return out.join('\n');
}

export interface SharePayload {
  text: string;
  /** The challenge link (also the last line of `text`), or null when there is no base URL. */
  url: string | null;
  challenge: Challenge;
}

/**
 * Builds the share text and challenge link for a finished run.
 * @param baseUrl where links point (see shareBase()), or null to share the text without a link.
 * @param tryNumber for daily runs: the counted try, or null for practice.
 */
export function buildShare(result: RunResult, baseUrl: string | null, tryNumber: number | null = null): SharePayload {
  const snow = Math.max(0, Math.floor(result.stats.snow));
  // Daily runs (and challenges replaying a date's daily) share that date; everything else its seed.
  const challenge: Challenge =
    result.dailyDate !== undefined && result.mode !== 'endless'
      ? { v: 1, k: 'd', d: result.dailyDate, m: result.minutes, s: snow }
      : { v: 1, k: 'e', seed: result.seed >>> 0, m: result.minutes, s: snow };
  const url = baseUrl === null ? null : challengeUrl(baseUrl, challenge);
  const text =
    challenge.k === 'd'
      ? dailyShareText({
          dailyNumber: dailyNumber(challenge.d),
          minutes: result.minutes,
          tryNumber: result.mode === 'daily' ? tryNumber : null,
          hourGlyphs: result.hourGlyphs,
          assisted: result.assisted,
          link: url,
        })
      : endlessShareText({
          minutes: result.minutes,
          hourGlyphs: result.hourGlyphs,
          snow,
          phews: result.stats.phews,
          assisted: result.assisted,
          link: url,
        });
  return { text, url, challenge };
}

// ---------------------------------------------------------------------------------------------
// Canonical share URL (V1_PLAN §11.4)
// ---------------------------------------------------------------------------------------------

export interface ShareBaseInput {
  /** location.protocol, e.g. 'https:', 'file:', 'capacitor:'. */
  protocol: string;
  /** location.origin ('null' for file: pages). */
  origin: string;
  pathname: string;
  /** Running inside a native (Capacitor) shell. */
  native: boolean;
  /** The build's VITE_SHARE_URL (the deployed web game); '' or undefined when unset. */
  configured: string | undefined;
}

/**
 * Where challenge links point. A web page served over http(s) links to itself, so links from any
 * deploy (Pages, a preview, localhost) open that same deploy. A page that is not on the web (a
 * file: single-file build, a native shell's capacitor:// or https://localhost) would hand out links
 * nobody else can open, so it uses the configured canonical URL, or shares no link at all.
 */
export function resolveShareBase(p: ShareBaseInput): string | null {
  if ((p.protocol === 'http:' || p.protocol === 'https:') && !p.native) return p.origin + p.pathname;
  const configured = p.configured?.trim() ?? '';
  return configured !== '' ? configured : null;
}

/** resolveShareBase for this page: location, isNative() and the build's VITE_SHARE_URL. */
export function shareBase(): string | null {
  if (typeof location === 'undefined') return null;
  return resolveShareBase({
    protocol: location.protocol,
    origin: location.origin,
    pathname: location.pathname,
    native: isNative(),
    configured: import.meta.env.VITE_SHARE_URL,
  });
}
