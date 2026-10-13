// Spoiler-free share text with hour glyphs (GDD §9 with the V1_PLAN §5.5 glyph set, V1_1_PLAN UM7).
//
// Endless:                                         Daily:
//   SHADY: Nubs made it to Day 3 · 2:40 PM ☀️🌬️🌡️     SHADY Daily #284: Day 2 · 2:40 PM (try 2/3) ☀️🍂
//   <final day's strip>                              <day 1 strip>🌙
//   Snow 112 · 4 PHEWs                               <day 2 strip ending in 💧>
//   Beat Sam’s run: <link>                           Beat Snowbot’s 11:20 AM ✓
//                                                    <link>
// Day Plan runs add one forecast emoji per day reached to the header. 🧭 is appended to the last
// strip when the guide was forced on ("Always"). Without a canonical base URL (a file: or native
// build with no VITE_SHARE_URL) the link line is left out.
//
// Journey (v1.2):                                   SHADY Journey · Level 12 ★★☆ · Glass Garden
//                                                   <link>            (the plain link, no challenge code)

import { FORECASTS, formatScore, formatTimeOfDay, levelDef, MINUTES_PER_DAY, PLAN_START_DATE, type DayPlan, type HourGlyph, type RunResult } from '../core/index.ts';
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

/** One forecast emoji per day of a Day Plan run (e.g. "☀️🌬️🌡️"). */
export function forecastEmojis(plan: readonly DayPlan[]): string {
  return plan.map((p) => FORECASTS[p.forecast].emoji).join('');
}

/** A score as its clock below Day 2 ("11:20 AM"), else with its day ("Day 2 · 9:10 AM"). */
export function scoreText(minutes: number): string {
  return minutes < MINUTES_PER_DAY ? formatTimeOfDay(minutes) : formatScore(minutes);
}

export interface EndlessShareInput {
  minutes: number;
  hourGlyphs: readonly (readonly HourGlyph[])[];
  snow: number;
  phews: number;
  assisted: boolean;
  /** Forecast emojis for the header ('' for runs without a Day Plan). */
  forecasts: string;
  /** The sender's name ('' for none). */
  name: string;
  /** The challenge link, or null to leave the link line out. */
  link: string | null;
}

export function endlessShareText(p: EndlessShareInput): string {
  const lines = dayStripLines(p.hourGlyphs, p.assisted);
  const out = [
    `SHADY: Nubs made it to ${formatScore(p.minutes)}${p.forecasts ? ` ${p.forecasts}` : ''}`,
    lines[lines.length - 1] as string,
    `Snow ${p.snow} · ${plural(p.phews, 'PHEW')}`,
  ];
  if (p.link !== null) out.push(`Beat ${p.name ? `${p.name}’s` : 'my'} run: ${p.link}`);
  return out.join('\n');
}

export interface DailyShareInput {
  dailyNumber: number;
  minutes: number;
  /** Counted try (1-3), or null for an unscored practice run. */
  tryNumber: number | null;
  hourGlyphs: readonly (readonly HourGlyph[])[];
  assisted: boolean;
  /** Forecast emojis for the header ('' for Dailies without a Day Plan). */
  forecasts: string;
  /** Snowbot's par minutes, or null while unknown (no par line). */
  par: number | null;
  /** The challenge link, or null to leave the link line out. */
  link: string | null;
}

export function dailyShareText(p: DailyShareInput): string {
  const attempt = p.tryNumber === null ? 'practice' : `try ${p.tryNumber}/${DAILY_TRIES}`;
  const out = [
    `SHADY Daily #${p.dailyNumber}: ${formatScore(p.minutes)} (${attempt})${p.forecasts ? ` ${p.forecasts}` : ''}`,
    ...dayStripLines(p.hourGlyphs, p.assisted),
  ];
  if (p.par !== null) out.push(p.minutes > p.par ? `Beat Snowbot’s ${scoreText(p.par)} ✓` : `Snowbot made ${scoreText(p.par)}`);
  if (p.link !== null) out.push(p.link);
  return out.join('\n');
}

export const STAR_ON = '\u2605'; // ★
export const STAR_OFF = '\u2606'; // ☆

/** "★★☆": `stars` of 3 lit. */
export function starText(stars: number, max = 3): string {
  const n = Math.max(0, Math.min(max, Math.floor(stars)));
  return STAR_ON.repeat(n) + STAR_OFF.repeat(max - n);
}

export interface CampaignShareInput {
  id: number;
  name: string;
  /** Stars earned (0-3). */
  stars: number;
  /** The game's link, or null to leave the link line out. */
  link: string | null;
}

/** "SHADY Journey · Level 12 ★★☆ · Glass Garden" and the link (no challenge code for a level). */
export function campaignShareText(p: CampaignShareInput): string {
  const out = [`SHADY Journey · Level ${p.id} ${starText(p.stars)} · ${p.name}`];
  if (p.link !== null) out.push(p.link);
  return out.join('\n');
}

const legacyBiome = (day: number): DayPlan['biome'] => (day % 2 === 0 ? 'oldtown' : 'meadow');

/**
 * Whether a run's world had the Day Plan (A1): Daily worlds (a Daily or a replayed one) from
 * PLAN_START_DATE on, endless runs at profile 3; a challenge run unless every day it reached
 * matches the classic alternating clear days. The session knows for sure (World.planOn) and can
 * pass it to buildShare as `plan`.
 */
export function runPlanOn(r: RunResult): boolean {
  if (r.dailyDate !== undefined && r.mode !== 'endless') return r.dailyDate >= PLAN_START_DATE;
  if (r.profile !== 3) return false;
  return r.mode === 'endless' || r.plan.some((p, i) => p.forecast !== 'clear' || p.biome !== legacyBiome(i + 1));
}

export interface SharePayload {
  text: string;
  /** The challenge link (also the last line of `text`), or null when there is no base URL. */
  url: string | null;
  /** The encoded run, or null for a Journey level (its link is the plain game address). */
  challenge: Challenge | null;
}

export interface ShareExtra {
  /** The player's name for challenge links ('' or absent = none). */
  name?: string;
  /** Daily runs: Snowbot's par minutes, or null while unknown. */
  par?: number | null;
  /** The run's world had the Day Plan (World.planOn); derived from the result when absent. */
  plan?: boolean;
}

/**
 * Builds the share text and challenge link for a finished run. The link carries the run's rules
 * (profile, drain, noon cloud, Day Plan), so the friend plays exactly this world.
 * @param baseUrl where links point (see shareBase()), or null to share the text without a link.
 * @param tryNumber for daily runs: the counted try, or null for practice.
 */
export function buildShare(r: RunResult, baseUrl: string | null, tryNumber: number | null = null, extra: ShareExtra = {}): SharePayload {
  if (r.mode === 'campaign' && r.level !== undefined) {
    const lv = r.level;
    const name = levelDef(lv.id)?.name ?? `Level ${lv.id}`;
    return { text: campaignShareText({ id: lv.id, name, stars: lv.passed ? lv.stars : 0, link: baseUrl }), url: baseUrl, challenge: null };
  }
  const snow = Math.max(0, Math.floor(r.stats.snow));
  const n = extra.name ? { n: extra.name } : {};
  const planOn = extra.plan ?? runPlanOn(r);
  const forecasts = planOn ? forecastEmojis(r.plan) : '';
  // Daily runs (and challenges replaying a date's daily) share that date; everything else its seed.
  const challenge: Challenge =
    r.dailyDate !== undefined && r.mode !== 'endless'
      ? { v: 1, k: 'd', d: r.dailyDate, m: r.minutes, s: snow, ...n }
      : { v: 1, k: 'e', seed: r.seed >>> 0, m: r.minutes, s: snow, p: r.profile, dr: r.drain, nc: r.noonCloud, pl: planOn ? 1 : 0, ...n };
  const url = baseUrl === null ? null : challengeUrl(baseUrl, challenge);
  const text =
    challenge.k === 'd'
      ? dailyShareText({
          dailyNumber: dailyNumber(challenge.d),
          minutes: r.minutes,
          tryNumber: r.mode === 'daily' ? tryNumber : null,
          hourGlyphs: r.hourGlyphs,
          assisted: r.assisted,
          forecasts,
          par: extra.par ?? null,
          link: url,
        })
      : endlessShareText({
          minutes: r.minutes,
          hourGlyphs: r.hourGlyphs,
          snow,
          phews: r.stats.phews,
          assisted: r.assisted,
          forecasts,
          name: extra.name ?? '',
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

/**
 * A link as people read it on the postcard: no scheme, no www., no challenge code, query or
 * index.html, no trailing slash ("https://alnadel.github.io/NewGame/#c=eyJ2…" → "alnadel.github.io/NewGame").
 * The full link travels in the share text beside the image.
 */
export function linkLabel(url: string): string {
  return url
    .replace(/[#?].*$/s, '')
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/index\.html?$/i, '')
    .replace(/\/+$/, '');
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
