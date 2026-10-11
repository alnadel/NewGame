// Pure progression rules (V1_PLAN §11, GDD §6-§8). Every function takes a save and returns a new one;
// inputs are never mutated, so the session can diff, test and persist freely.

import type { RunResult } from '../core/sim/events.ts';
import type { DailyEntry, SaveV1 } from './saveTypes.ts';
import {
  ACHIEVEMENTS,
  COSMETICS,
  getAchievement,
  getCosmetic,
  type AchievementId,
  type CosmeticId,
} from './content.ts';
import { missionTarget, missionValue, missionView, parseMissionId, refillMissions, type MissionView } from './missions.ts';
import { cloneSave, defaults, pruneDaily } from './save.ts';
import { DAILY_TRIES, dailyNumber } from './daily.ts';
import { dayStripLines } from './share.ts';

/** Daily unlocks after this many lifetime runs (or after the first night). */
export const DAILY_UNLOCK_RUNS = 3;
/** The iOS "Add to Home Screen" sheet is offered once after this many runs. */
export const INSTALL_SHEET_RUNS = 3;
/** High Noon: 12:30 PM on Day 3. */
const HIGH_NOON_MINUTES = 2 * 720 + 390;

export type ToastIcon = 'trophy' | 'gift' | 'snow' | 'calendar' | 'info' | 'warn' | 'check' | 'share' | 'lock';
export type ToastTone = 'ink' | 'accent' | 'gold' | 'danger';

export interface ToastSpec {
  text: string;
  icon?: ToastIcon;
  tone?: ToastTone;
}

export interface RunOutcome {
  /** Beat a previous endless best (never on the very first run). */
  newBest: boolean;
  prevBestMinutes: number;
  /** Snow collected during the run. */
  runSnow: number;
  /** Snow paid by missions completed this run. */
  missionSnow: number;
  /** runSnow + missionSnow, all added to the wallet. */
  snowEarned: number;
  walletBefore: number;
  walletAfter: number;
  /** The 3 active missions after this run (completed ones stay until the next run starts). */
  missions: MissionView[];
  missionsCompleted: MissionView[];
  achievementsUnlocked: AchievementId[];
  cosmeticsUnlocked: CosmeticId[];
  /** The Daily became available with this run. */
  dailyUnlocked: boolean;
  /** Celebration toasts for the results screen, in display order. */
  toasts: ToastSpec[];
}

export interface ApplyRunOptions {
  /** Local date of the device ('YYYY-MM-DD'), for "Play today's Daily". */
  today: string;
  /** Daily runs: the try number counted at 6:30 AM by dailyTryStarted, or null/undefined if unscored. */
  dailyTry?: number | null;
}

type AchievementCheck = (save: SaveV1, run: RunResult) => boolean;

/** Evaluated after the run's stats are merged into the save. */
const ACHIEVEMENT_CHECKS: Readonly<Record<AchievementId, AchievementCheck>> = {
  'first-light': (s) => s.stats.runs >= 1,
  'night-owl': (s) => s.stats.reachedNight,
  'high-noon': (s, r) => r.minutes >= HIGH_NOON_MINUTES || s.stats.bestMinutes >= HIGH_NOON_MINUTES,
  solstice: (s) => s.stats.maxDay >= 5,
  'seventh-sun': (s) => s.stats.maxDay >= 7,
  'phew-nomenal': (s) => s.stats.phews >= 25,
  'cloud-rider': (_s, r) => r.stats.cloudRideBest >= 10,
  'daily-habit': (s) => s.stats.dailyDaysPlayed >= 7,
};

export function isDailyUnlocked(save: SaveV1): boolean {
  return save.stats.runs >= DAILY_UNLOCK_RUNS || save.stats.reachedNight;
}

/** Cheapest Snow-priced cosmetic the player doesn't own yet. */
function cheapestUnowned(save: SaveV1): { name: string; cost: number } | null {
  let best: { name: string; cost: number } | null = null;
  for (const c of COSMETICS) {
    if (c.unlock.kind !== 'snow' || save.unlocks.cosmetics.includes(c.id)) continue;
    if (!best || c.unlock.cost < best.cost) best = { name: c.name, cost: c.unlock.cost };
  }
  return best;
}

function sortedIds<T extends string>(catalog: readonly { id: T }[], owned: Iterable<string>): T[] {
  const set = new Set(owned);
  return catalog.filter((c) => set.has(c.id)).map((c) => c.id);
}

/**
 * Folds a finished run into the save: stats and bests, wallet, mission progress/completion,
 * daily best, achievements and their cosmetic rewards. Pure.
 */
export function applyRunResult(
  save: SaveV1,
  result: RunResult,
  options: ApplyRunOptions,
): { save: SaveV1; outcome: RunOutcome } {
  const next = cloneSave(save);
  const s = next.stats;
  const dailyWasUnlocked = isDailyUnlocked(save);

  // Bests: endless and challenge runs count; dailies keep their own per-date best.
  const prevBestMinutes = s.bestMinutes;
  const countsForBest = result.mode !== 'daily';
  const newBest = countsForBest && s.runs > 0 && result.minutes > prevBestMinutes;
  if (countsForBest && result.minutes > prevBestMinutes) s.bestMinutes = result.minutes;

  const runSnow = Math.max(0, Math.floor(result.stats.snow));
  s.runs += 1;
  s.bestSnowRun = Math.max(s.bestSnowRun, runSnow);
  s.phews += result.stats.phews;
  s.flakes += result.stats.flakes;
  s.daysSurvived += result.stats.nightsReached;
  s.maxDay = Math.max(s.maxDay, result.day);
  s.cloudSeconds += result.stats.cloudSeconds;
  // Death only happens in daylight, so a score past 6:00 PM of Day 1 means a night was reached.
  if (result.minutes >= 720 || result.stats.nightsReached > 0) s.reachedNight = true;

  // Missions: progress is the best single run; completion pays out immediately.
  let missionSnow = 0;
  const missions: MissionView[] = [];
  const missionsCompleted: MissionView[] = [];
  for (const slot of next.missions.active) {
    const parsed = parseMissionId(slot.id);
    if (!parsed) continue;
    let justCompleted = false;
    if (!slot.done) {
      slot.progress = Math.max(slot.progress, missionValue(parsed.def, result, options.today));
      if (slot.progress >= missionTarget(parsed.def, parsed.tier)) {
        slot.done = true;
        justCompleted = true;
      }
    }
    const view = missionView(slot, justCompleted);
    if (!view) continue;
    missions.push(view);
    if (justCompleted) {
      missionsCompleted.push(view);
      missionSnow += view.reward;
    }
  }

  if (result.mode === 'daily' && result.dailyDate !== undefined && options.dailyTry != null) {
    const glyphs = dayStripLines(result.hourGlyphs, result.assisted).join('\n');
    recordDailyBest(next, result.dailyDate, result.minutes, runSnow, glyphs);
  }

  const walletBefore = s.wallet;
  s.wallet += runSnow + missionSnow;
  s.lifetimeSnow += runSnow + missionSnow;

  // Achievements and their cosmetic rewards.
  const achievementsUnlocked: AchievementId[] = [];
  const cosmeticsUnlocked: CosmeticId[] = [];
  for (const a of ACHIEVEMENTS) {
    if (next.unlocks.achievements.includes(a.id) || !ACHIEVEMENT_CHECKS[a.id](next, result)) continue;
    achievementsUnlocked.push(a.id);
    if (a.reward && !next.unlocks.cosmetics.includes(a.reward)) cosmeticsUnlocked.push(a.reward);
  }
  next.unlocks.achievements = sortedIds(ACHIEVEMENTS, [...next.unlocks.achievements, ...achievementsUnlocked]);
  next.unlocks.cosmetics = sortedIds(COSMETICS, [...next.unlocks.cosmetics, ...cosmeticsUnlocked]);

  const dailyUnlocked = !dailyWasUnlocked && isDailyUnlocked(next);

  const toasts: ToastSpec[] = [];
  for (const id of achievementsUnlocked) {
    toasts.push({ text: `Achievement: ${getAchievement(id)?.name ?? id}`, icon: 'trophy', tone: 'gold' });
  }
  for (const id of cosmeticsUnlocked) {
    toasts.push({ text: `Unlocked: ${getCosmetic(id)?.name ?? id}`, icon: 'gift', tone: 'accent' });
  }
  if (dailyUnlocked) toasts.push({ text: 'Daily Solstice unlocked!', icon: 'calendar', tone: 'accent' });
  const cheapest = cheapestUnowned(next);
  if (cheapest && walletBefore < cheapest.cost && s.wallet >= cheapest.cost) {
    toasts.push({ text: `You can afford the ${cheapest.name}!`, icon: 'snow', tone: 'accent' });
  }

  return {
    save: next,
    outcome: {
      newBest,
      prevBestMinutes,
      runSnow,
      missionSnow,
      snowEarned: runSnow + missionSnow,
      walletBefore,
      walletAfter: s.wallet,
      missions,
      missionsCompleted,
      achievementsUnlocked,
      cosmeticsUnlocked,
      dailyUnlocked,
      toasts,
    },
  };
}

/** Call when a run starts: completed missions are swapped for fresh ones (V1_PLAN §11.1). Pure. */
/**
 * Results data for a debug run (sim-altering URL params such as ?day=, ?bot=, ?chill=): nothing is
 * earned, unlocked or saved, so the outcome only mirrors the save as it is.
 */
export function debugRunOutcome(save: SaveV1, result: RunResult): RunOutcome {
  const wallet = save.stats.wallet;
  return {
    newBest: false,
    prevBestMinutes: save.stats.bestMinutes,
    runSnow: Math.max(0, Math.floor(result.stats.snow)),
    missionSnow: 0,
    snowEarned: 0,
    walletBefore: wallet,
    walletAfter: wallet,
    missions: activeMissionViews(save),
    missionsCompleted: [],
    achievementsUnlocked: [],
    cosmeticsUnlocked: [],
    dailyUnlocked: false,
    toasts: [],
  };
}

export function beginRun(save: SaveV1): { save: SaveV1; dealt: MissionView[] } {
  if (!save.missions.active.some((m) => m.done)) return { save, dealt: [] };
  const next = cloneSave(save);
  const dealt = refillMissions(next.missions);
  return { save: next, dealt: dealt.map((slot) => missionView(slot)).filter((v): v is MissionView => v !== null) };
}

/** Views of the 3 active missions (Title pips, Missions screen). */
export function activeMissionViews(save: SaveV1): MissionView[] {
  return save.missions.active.map((slot) => missionView(slot)).filter((v): v is MissionView => v !== null);
}

// ---------------------------------------------------------------------------------------------
// Daily bookkeeping (V1_PLAN §11.3, CRITIQUE #30)
// ---------------------------------------------------------------------------------------------

export interface DailyStatus {
  date: string;
  number: number;
  /** Scored tries used (0-3). */
  tries: number;
  /** The next run would be scored (tries < 3); otherwise it is practice. */
  scored: boolean;
  bestMinutes: number;
  bestSnow: number;
  /** Glyph strip lines of the best try ('\n'-joined), '' if none finished yet. */
  glyphs: string;
  played: boolean;
}

function emptyEntry(): DailyEntry {
  return { tries: 0, bestMinutes: 0, bestSnow: 0, glyphs: '' };
}

export function dailyStatus(save: SaveV1, date: string): DailyStatus {
  const e = save.daily[date] ?? emptyEntry();
  return {
    date,
    number: dailyNumber(date),
    tries: e.tries,
    scored: e.tries < DAILY_TRIES,
    bestMinutes: e.bestMinutes,
    bestSnow: e.bestSnow,
    glyphs: e.glyphs,
    played: e.tries > 0,
  };
}

/**
 * Call when a daily run passes 6:30 AM, and persist the result immediately (flush), so quitting a
 * bad run can't refund the try. Returns the counted try number, or null when the run is practice.
 */
export function dailyTryStarted(save: SaveV1, date: string): { save: SaveV1; tryNumber: number | null } {
  const current = save.daily[date] ?? emptyEntry();
  if (current.tries >= DAILY_TRIES) return { save, tryNumber: null };
  const next = cloneSave(save);
  const entry = { ...current, tries: current.tries + 1 };
  if (current.tries === 0) next.stats.dailyDaysPlayed += 1;
  next.daily[date] = entry;
  pruneDaily(next.daily);
  return { save: next, tryNumber: entry.tries };
}

function recordDailyBest(save: SaveV1, date: string, minutes: number, snow: number, glyphs?: string): void {
  const entry = save.daily[date] ?? emptyEntry();
  const better = minutes > entry.bestMinutes || (minutes === entry.bestMinutes && snow >= entry.bestSnow);
  if (!better) return;
  entry.bestMinutes = minutes;
  entry.bestSnow = snow;
  if (glyphs !== undefined) entry.glyphs = glyphs;
  save.daily[date] = entry;
}

/**
 * Hourly checkpoint for a scored daily run (call only after dailyTryStarted returned a try number),
 * so progress survives the app being killed mid-run.
 */
export function dailyProgress(save: SaveV1, date: string, minutes: number, snow: number): SaveV1 {
  const entry = save.daily[date];
  if (!entry || entry.tries === 0) return save;
  if (minutes < entry.bestMinutes || (minutes === entry.bestMinutes && snow <= entry.bestSnow)) return save;
  const next = cloneSave(save);
  recordDailyBest(next, date, minutes, Math.max(0, Math.floor(snow)));
  return next;
}

// ---------------------------------------------------------------------------------------------
// Wallet and Wardrobe
// ---------------------------------------------------------------------------------------------

/**
 * - `equipped`: worn now. `owned`: can be equipped.
 * - `buyable`: Snow-priced and affordable. `expensive`: Snow-priced, not enough Snow yet.
 * - `locked`: earned through an achievement that isn't unlocked.
 */
export type ItemState = 'equipped' | 'owned' | 'buyable' | 'expensive' | 'locked';

export function isOwned(save: SaveV1, id: string): boolean {
  return save.unlocks.cosmetics.includes(id);
}

export function itemState(save: SaveV1, id: CosmeticId): ItemState {
  const c = getCosmetic(id);
  if (!c) return 'locked';
  if (save.equipped[c.slot] === id) return 'equipped';
  if (isOwned(save, id)) return 'owned';
  if (c.unlock.kind === 'snow') return save.stats.wallet >= c.unlock.cost ? 'buyable' : 'expensive';
  return 'locked';
}

export type BuyResult =
  | { ok: true; save: SaveV1 }
  | { ok: false; reason: 'unknown' | 'owned' | 'locked' | 'poor' };

/** Spends Snow on a cosmetic and equips it right away. */
export function buyCosmetic(save: SaveV1, id: CosmeticId): BuyResult {
  const c = getCosmetic(id);
  if (!c) return { ok: false, reason: 'unknown' };
  if (isOwned(save, id)) return { ok: false, reason: 'owned' };
  if (c.unlock.kind !== 'snow') return { ok: false, reason: 'locked' };
  if (save.stats.wallet < c.unlock.cost) return { ok: false, reason: 'poor' };
  const next = cloneSave(save);
  next.stats.wallet -= c.unlock.cost;
  next.unlocks.cosmetics = sortedIds(COSMETICS, [...next.unlocks.cosmetics, id]);
  next.equipped[c.slot] = id;
  return { ok: true, save: next };
}

export type EquipResult = { ok: true; save: SaveV1 } | { ok: false; reason: 'unknown' | 'notOwned' };

export function equipCosmetic(save: SaveV1, id: CosmeticId): EquipResult {
  const c = getCosmetic(id);
  if (!c) return { ok: false, reason: 'unknown' };
  if (!isOwned(save, id)) return { ok: false, reason: 'notOwned' };
  if (save.equipped[c.slot] === id) return { ok: true, save };
  const next = cloneSave(save);
  next.equipped[c.slot] = id;
  return { ok: true, save: next };
}

/** Settings > Reset progress: a fresh save that keeps the player's settings and device flags. */
export function resetProgress(save: SaveV1, now: number = Date.now()): SaveV1 {
  const fresh = defaults(now);
  fresh.settings = { ...save.settings };
  fresh.flags.installSheetShown = save.flags.installSheetShown;
  fresh.flags.persistRequested = save.flags.persistRequested;
  return fresh;
}

/** iOS Safari only: offer the "Add to Home Screen" sheet once, after run 3 (V1_PLAN §11.5). */
export function shouldShowInstallSheet(save: SaveV1, env: { ios: boolean; standalone: boolean }): boolean {
  return env.ios && !env.standalone && save.stats.runs >= INSTALL_SHEET_RUNS && !save.flags.installSheetShown;
}
