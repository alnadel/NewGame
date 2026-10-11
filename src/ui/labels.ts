// Pure label logic for the screens (no DOM), so it can be unit-tested: Results' Daily labels, the
// Retry label, the stats tile for the multiplier, the screen-reader summary of a run, and which
// Settings sections show where.

import type { RunStats } from '../core/sim/events.ts';
import { formatScore } from '../core/format.ts';
import { challengeVerdict } from '../meta/challenge.ts';
import { DAILY_TRIES } from '../meta/daily.ts';
import { dailyStatus } from '../meta/progression.ts';
import type { SaveV1 } from '../meta/saveTypes.ts';
import type { ResultsView, ScreenId } from './types.ts';

const NBSP = '\u00a0';

/**
 * The challenge banner's goal, "Beat Day 2 · 2:40 PM", which may wrap after "Beat" and after "·"
 * but never inside "Day 2" or "2:40 PM": narrow phones show "Beat Day 2 ·" over "2:40 PM" instead
 * of running under Play.
 */
export function challengeGoalText(minutes: number): string {
  const [day, time] = formatScore(minutes).split(' · ');
  return time === undefined ? `Beat ${day}` : `Beat ${(day ?? '').replace(/ /g, NBSP)}${NBSP}· ${time.replace(/ /g, NBSP)}`;
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
export function retryLabel(view: ResultsView, save: SaveV1, today: string): string {
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

export interface SettingsSections {
  /** Backup code export/import. */
  backup: boolean;
  /** Reset progress. */
  danger: boolean;
  /** "Backup, restore and reset are in Settings on the Title screen." */
  backupNote: boolean;
}

/**
 * Settings opened from Pause hide Backup/Restore and Reset: replacing the save under a running run
 * would desync it. They live in the Title's Settings.
 */
export function settingsSections(origin: ScreenId): SettingsSections {
  const midRun = origin === 'pause';
  return { backup: !midRun, danger: !midRun, backupNote: midRun };
}
