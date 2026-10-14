// Pure label logic for the screens (no DOM), so it can be unit-tested: Results' Daily labels, the
// Retry label, the stats tile for the multiplier, the screen-reader summary of a run, the Sun
// Strip, the cue line, forecast lines, the Journal chart and the Journey's labels.

import {
  COMFORT_MAX,
  CONCEPTS,
  FORECASTS,
  formatScore,
  MINUTES_PER_DAY,
  PLAN_START_DATE,
  planDay,
  type BiomeId,
  type DayPlan,
  type ForecastInfo,
  type HourGlyph,
  type LevelDef,
  type RunStats,
} from '../core/index.ts';
import { challengeVerdict } from '../meta/challenge.ts';
import type { Rarity } from '../meta/gamify.ts';
import { DAILY_TRIES, dailySeed } from '../meta/daily.ts';
import { dailyStatus } from '../meta/progression.ts';
import type { Save } from '../meta/saveTypes.ts';
import { scoreText } from '../meta/share.ts';
import type { CueId, ResultsCampaign, ResultsView } from './types.ts';

const NBSP = '\u00a0';

/**
 * The challenge banner's goal, "Beat Day 2 · 2:40 PM", which may wrap after "Beat" only: the score
 * is one unbreakable unit, so narrow phones show "Beat" over "Day 2 · 2:40 PM" (never "Beat Day 2 ·"
 * over "2:40 PM") instead of running under Play.
 */
export function challengeGoalText(minutes: number): string {
  return `Beat ${formatScore(minutes).replace(/ /g, NBSP)}`;
}

export const NOT_COUNTED_NOTE = 'Melted before 6:30 AM, so no try was used';
export const RETRY = 'Retry';
export const RETRY_PRACTICE = 'Retry · practice';

/**
 * How a Daily run counted: 'Try n/3' (a counted try), 'Not counted' (eligible, but it melted before
 * 6:30 AM so no try was used) or 'Practice' (a past date, or all tries were used when it started).
 */
export function dailyRunLabel(dailyTry: number | null | undefined, dailyScored: boolean | undefined): string {
  if (dailyTry != null) return `Try ${dailyTry}/${DAILY_TRIES}`;
  if (dailyScored === true) return 'Not counted';
  return 'Practice';
}

/** The Daily date of a Results view, if it is a Daily run. */
export function viewDailyDate(view: ResultsView): string | undefined {
  if (view.result.mode !== 'daily') return undefined;
  return view.dailyDate ?? view.result.dailyDate;
}

/**
 * Retry's label: 'Retry · practice' when Retry would replay a Daily that can no longer count (its
 * date isn't today, or all 3 tries are used); otherwise 'Retry'.
 */
export function retryLabel(view: ResultsView, save: Save, today: string): string {
  if (view.debug) return RETRY;
  const date = viewDailyDate(view);
  if (date === undefined) return RETRY;
  return date !== today || dailyStatus(save, date).tries >= DAILY_TRIES ? RETRY_PRACTICE : RETRY;
}

/** The multiplier tile: seconds held at ×5 when there were any, else the best multiplier reached. */
export function multiplierTile(stats: Pick<RunStats, 'x5HoldBest' | 'maxMult'>): { value: string; caption: string } {
  if (stats.x5HoldBest > 0) return { value: `${stats.x5HoldBest.toFixed(1)} s`, caption: 'longest ×5' };
  return { value: `×${Math.max(1, Math.floor(stats.maxMult))}`, caption: 'best multiplier' };
}

/** What the live region says when Results open, e.g. "Nubs melted at Day 2 · 2:40 PM. New best!". */
export function resultsAnnouncement(view: ResultsView): string {
  const c = view.campaign;
  if (c) {
    const how = c.passed ? `passed with ${starsLabel(c.stars)}` : 'not passed';
    return `Level ${c.id}, ${c.name}: ${how}. ${c.passed ? c.goalLine : view.result.death.line}`;
  }
  const parts = [`Nubs melted at ${formatScore(view.result.minutes)}.`];
  if (view.outcome.newBest) parts.push('New best!');
  if (view.challengeTarget !== undefined) {
    parts.push(challengeVerdict(view.result.minutes, view.challengeTarget).win ? 'Challenge beaten.' : 'Challenge not beaten.');
  }
  if (viewDailyDate(view) !== undefined && !view.debug) {
    const label = dailyRunLabel(view.dailyTry, view.dailyScored);
    parts.push(view.dailyTry != null ? `Daily try ${view.dailyTry} of ${DAILY_TRIES}.` : `Daily ${label.toLowerCase()}.`);
  }
  if (view.debug) parts.push('Debug run, not saved.');
  return parts.join(' ');
}

// ---------------------------------------------------------------------------------------------
// Results: the Sun Strip (one row of hour tiles per day, V1_1_PLAN UM8)
// ---------------------------------------------------------------------------------------------

/** Daylight hours shown per day: 6 AM to 5 PM. */
export const STRIP_HOURS = 12;
/** The light of each daylight hour, dawn to dusk, under the glyph colour. */
export const HOUR_TINTS: readonly string[] = [
  '#FFD9B8', '#FFE4C2', '#FFEBCF', '#FFF0D9', '#FFF4E0', '#FFF6E6', '#FFF6E6', '#FFF3DF', '#FFEED6', '#FFE6CC', '#FFDCC4', '#FFCFC0',
];
const GLYPH_COLORS: Readonly<Record<HourGlyph, string>> = { cool: '#9AD8FF', warm: '#FFD36B', hot: '#FF6A3D', melt: '#2EC4B6' };
/** Share of the hour's light mixed into a tile's glyph colour. */
const TINT_MIX = 0.35;

const hexRgb = (hex: string): number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** A tile's fill: the glyph colour with the hour's light mixed in. */
export function tileFill(hour: number, glyph: HourGlyph): string {
  const tint = hexRgb(HOUR_TINTS[Math.max(0, Math.min(STRIP_HOURS - 1, hour))] as string);
  const base = hexRgb(GLYPH_COLORS[glyph]);
  return `#${base.map((c, i) => Math.round(c * (1 - TINT_MIX) + (tint[i] as number) * TINT_MIX).toString(16).padStart(2, '0')).join('')}`;
}

export interface SunStripRow {
  day: number;
  /** The day's forecast on Day Plan runs; null otherwise. */
  forecast: ForecastInfo | null;
  /** STRIP_HOURS slots: an hour's glyph, or null for the hours after the melt (ghost outlines). */
  tiles: (HourGlyph | null)[];
  /** The day was completed: a night pill ends the row. */
  night: boolean;
}

export interface SunStrip {
  rows: SunStripRow[];
  /** Earlier days folded into the '+N days' chip. */
  hidden: number;
}

/**
 * The Sun Strip of a run: its last `maxRows` days, each with the hour glyphs the share strip
 * prints (dayStripLines) and ghost slots after the melt. The last row is Day `lastDay` (a run
 * started past Day 1 records glyphs from its start only). `plan` is the run's Day Plan (null when
 * the run had none).
 */
export function sunStrip(
  hourGlyphs: readonly (readonly HourGlyph[])[],
  plan: readonly DayPlan[] | null,
  maxRows: number,
  lastDay: number = hourGlyphs.length,
): SunStrip {
  const first = Math.max(0, hourGlyphs.length - Math.max(1, maxRows));
  const dayOf = (i: number): number => lastDay - (hourGlyphs.length - 1) + i;
  const rows = hourGlyphs.slice(first).map((hours, k): SunStripRow => {
    const i = first + k;
    const p = plan?.[dayOf(i) - 1];
    const tiles: (HourGlyph | null)[] = hours.slice(0, STRIP_HOURS);
    while (tiles.length < STRIP_HOURS) tiles.push(null);
    return { day: dayOf(i), forecast: p ? FORECASTS[p.forecast] : null, tiles, night: i < hourGlyphs.length - 1 };
  });
  return { rows, hidden: first };
}

// ---------------------------------------------------------------------------------------------
// Title, Daily, cues
// ---------------------------------------------------------------------------------------------

export const BIOME_NAMES: Readonly<Record<BiomeId, string>> = { meadow: 'Meadow', oldtown: 'Old Town' };

/** "🌬️ Breezy · Old Town": a day's weather and place. */
export function planText(p: DayPlan): string {
  const f = FORECASTS[p.forecast];
  return `${f.emoji} ${f.name} · ${BIOME_NAMES[p.biome]}`;
}

/** Day 1 of a Daily's world: the Day Plan from PLAN_START_DATE on, the classic clear Meadow before. */
export function dailyPlan(date: string): DayPlan {
  return date >= PLAN_START_DATE ? planDay(dailySeed(date), 1) : { biome: 'meadow', forecast: 'clear' };
}

/** "Snowbot made it to 11:20 AM", or the waiting line while the par is being computed. */
export function parLine(par: number | null): string {
  return par === null ? 'Snowbot is warming up…' : `Snowbot made it to ${scoreText(par)}`;
}

const CUE_ARROW = { [-1]: '←', 1: '→' } as const;

/** The cue line's copy (ui.showCue). Keyboard players hold a key instead of dragging. */
export function cueText(id: CueId, dir: -1 | 1 | undefined, keyboard: boolean): string {
  const arrow = CUE_ARROW[dir ?? 1];
  const verb = keyboard ? 'Hold' : 'Drag';
  switch (id) {
    case 'keep-shade':
      return 'Keep Nubs in the shade';
    case 'drag':
      return `${verb} ${arrow} to swing the sun`;
    case 'shade-found':
      return 'Shade! Thick teal = safe';
    case 'melting':
      // In the lesson the warning keeps the drag instruction (it never hides it).
      return dir === undefined ? 'Melting! Find thick teal' : `Melting! ${verb} ${arrow} to the thick teal`;
    case 'swing':
      // The first SWING ever: what just happened, so it can happen on purpose.
      return 'SWING! Straight into the next shade: +Snow';
    case 'snap-ready':
      // v1.5: the frost meter is full.
      return keyboard ? 'Frost full! Press ↓ for a Cold Snap' : 'Frost full! Swipe ↓ for a Cold Snap';
  }
}

/** How long a cue stays up (ms); null = until replaced or cleared. */
export function cueDuration(id: CueId, dir: -1 | 1 | undefined): number | null {
  switch (id) {
    case 'keep-shade':
      return 2000;
    case 'shade-found':
      return 1400;
    case 'melting':
      return dir === undefined ? 1600 : null;
    case 'swing':
    case 'snap-ready':
      return 2400;
    case 'drag':
      return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Journal (V1_1_PLAN UM10)
// ---------------------------------------------------------------------------------------------

export interface JournalBar {
  minutes: number;
  /** Day reached (1-based). */
  day: number;
  /** Height in [0, 1] of the tallest bar. */
  height: number;
  /** The best run of the window. */
  best: boolean;
  /** Played below the standard rung (comfort ladder): hatched. */
  eased: boolean;
}

export interface JournalChart {
  bars: JournalBar[];
  /** Mean score of the last 10 runs, or null without runs. */
  average: number | null;
  /** Last-10 mean minus the mean of the 10 before (minutes), or null with under 5 runs before. */
  delta: number | null;
  /** Runs in the window the delta compares with. */
  previous: number;
}

const avg = (xs: readonly number[]): number => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);

/** The Journal's chart of the last 30 endless runs (save.history, oldest first). */
export function journalChart(history: Save['history']): JournalChart {
  const top = history.reduce((m, e) => Math.max(m, e.m), 0);
  let bestAt = -1;
  history.forEach((e, i) => {
    if (top > 0 && e.m === top) bestAt = i;
  });
  const bars = history.map((e, i) => ({
    minutes: e.m,
    day: Math.floor(e.m / MINUTES_PER_DAY) + 1,
    height: top > 0 ? e.m / top : 0,
    best: i === bestAt,
    eased: e.r < COMFORT_MAX || e.w === 1,
  }));
  const last = history.slice(-10).map((e) => e.m);
  const before = history.slice(-20, -10).map((e) => e.m);
  return {
    bars,
    average: last.length > 0 ? avg(last) : null,
    delta: last.length > 0 && before.length >= 5 ? avg(last) - avg(before) : null,
    previous: before.length,
  };
}

/** "+42 min", "−1 h 5 min": a difference in score minutes. */
export function minutesDelta(d: number): string {
  const a = Math.abs(d);
  const text = a < 60 ? `${a} min` : a % 60 === 0 ? `${a / 60} h` : `${Math.floor(a / 60)} h ${a % 60} min`;
  return `${d < 0 ? '−' : '+'}${text}`;
}

/** Time played as "3 h 12 m" (or "12 m"). */
export function playTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} m` : `${m} m`;
}

/** The chart's text summary for screen readers. */
export function journalSummary(c: JournalChart): string {
  if (c.bars.length === 0) return 'No runs yet.';
  const best = c.bars.find((b) => b.best);
  const parts = [`Last ${c.bars.length} runs.`];
  if (best) parts.push(`Best: ${scoreText(best.minutes)}.`);
  if (c.average !== null) parts.push(`Last 10 average: ${scoreText(c.average)}.`);
  if (c.delta !== null) parts.push(`${minutesDelta(c.delta)} against the ${c.previous} runs before.`);
  return parts.join(' ');
}

// ---------------------------------------------------------------------------------------------
// Journey (CAMPAIGN_PLAN §5)
// ---------------------------------------------------------------------------------------------

/** "2 of 3 stars". */
export function starsLabel(stars: number, max = 3): string {
  return `${stars} of ${max} star${max === 1 ? '' : 's'}`;
}

/** "Continue · Level 12". */
export function continueLabel(id: number): string {
  return `Continue · Level ${id}`;
}

/** "Chapter 2 · Cobbles". */
export function chapterTitle(id: number, name: string): string {
  return `Chapter ${id} · ${name}`;
}

/**
 * A level tile's accessible name: "Level 6, Glass Garden. Teaches Glare: gazing balls throw light
 * back. 2 of 3 stars." or "Level 45, Quiet Lane. Locked."
 */
export function levelTileLabel(level: Pick<LevelDef, 'id' | 'name' | 'introduces'>, stars: number, playable: boolean): string {
  const concept = level.introduces ? CONCEPTS[level.introduces] : null;
  const parts = [`Level ${level.id}, ${level.name}.`];
  if (concept) parts.push(concept.name === level.name ? `Teaches: ${concept.blurb}` : `Teaches ${concept.name}: ${concept.blurb}`);
  parts.push(playable ? (stars > 0 ? `${starsLabel(stars)}.` : 'Not passed yet.') : 'Locked.');
  return parts.join(' ');
}

/** The Results kicker of a Journey run: "Level 12 · Passed" (short: it shares its line with Share). */
export function campaignKicker(c: Pick<ResultsCampaign, 'id' | 'passed'>): string {
  return `Level ${c.id} · ${c.passed ? 'Passed' : 'Not passed'}`;
}

/** A cosmetic's rarity (meta/gamify.ts rarity) as a word. */
export const RARITY_LABEL: Readonly<Record<Rarity, string>> = { common: 'Common', rare: 'Rare', epic: 'Epic', legendary: 'Legendary' };
