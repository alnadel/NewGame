// Pure progression rules (V1_PLAN §11, V1_1_PLAN UM3-UM6, GDD §6-§8). Every function takes a save
// and returns a new one; inputs are never mutated, so the session can diff, test and persist freely.

import type { HourGlyph, RunResult } from '../core/sim/events.ts';
import { MINUTES_PER_DAY } from '../core/format.ts';
import type { DailyEntry, Save } from './saveTypes.ts';
import {
  ACHIEVEMENTS,
  COSMETICS,
  ERRAND_REWARD,
  getAchievement,
  getCosmetic,
  type AchievementId,
  type CosmeticId,
} from './content.ts';
import {
  errandState,
  getErrand,
  errandValue,
  errandViewOf,
  missionTarget,
  missionValue,
  missionView,
  parseMissionId,
  refillMissions,
  swapSlot,
  type ErrandView,
  type MissionView,
} from './missions.ts';
import { cloneSave, defaults, HISTORY_KEEP, pruneDaily, prunePars, recentBest } from './save.ts';
import { DAILY_TRIES, dailyNumber, daysBetween } from './daily.ts';
import { dayStripLines, scoreText } from './share.ts';
import { markSunnyDay } from './week.ts';
import { comfortAfterRun, COMFORT_MAX, FORECAST_IDS, v11Result, type RunResultV11 } from './shims.ts';

export { recentBest } from './save.ts';

/**
 * The Daily unlocks after this many completed lifetime runs (V1_PLAN §11.3), i.e. once onboarding
 * is over. A save that already holds a Daily entry keeps it unlocked.
 */
export const DAILY_UNLOCK_RUNS = 3;
/** The iOS "Add to Home Screen" sheet is offered once after this many runs. */
export const INSTALL_SHEET_RUNS = 3;
/** Bests (and the next-goal line) count from this lifetime run on: onboarding runs set none. */
export const BEST_FROM_RUNS = 3;
/** High Noon: 12:30 PM on Day 3. */
const HIGH_NOON_MINUTES = 2 * 720 + 390;
/** Surviving a day's noon: 12:30 PM, 390 minutes after 6 AM. */
const NOON_MINUTES = 390;
const MORNING_SNOW = 15;
/** Welcome back: run Snow ×2 after this many days away, the extra capped. */
const WELCOME_BACK_DAYS = 3;
const WELCOME_BACK_CAP = 100;
/** Breezy, Overcast, Heat Wave and Long Shadows (forecastNoons bits). */
const FORECASTER_MASK = (['breezy', 'overcast', 'heat', 'long'] as const).reduce((m, id) => m | (1 << FORECAST_IDS.indexOf(id)), 0);
/** A mission this far along is the Title's next goal. */
const SO_CLOSE = 0.6;
/** Pace lines need this many recent runs (this one included); the window is the last 10. */
const PACE_MIN_RUNS = 5;
const PACE_WINDOW = 10;

/** Score milestones for the Title's next-goal line, in score minutes. */
export const MILESTONES: readonly number[] = [180, 390, 720, 1110, 1440, 1830, 2880, 4320, 6480];
const MILESTONE_TEXT: Readonly<Record<number, string>> = {
  180: 'reach 9:00 AM',
  390: 'survive noon',
  720: 'reach Day 2',
  1110: "survive Day 2's noon",
  1440: 'reach Day 3',
  1830: 'High Noon on Day 3',
  2880: 'reach Day 5',
  4320: 'reach Day 7',
  6480: 'reach Day 10',
};

export type ToastIcon = 'trophy' | 'gift' | 'snow' | 'calendar' | 'info' | 'warn' | 'check' | 'share' | 'lock';
export type ToastTone = 'ink' | 'accent' | 'gold' | 'danger';

export interface ToastSpec {
  text: string;
  icon?: ToastIcon;
  tone?: ToastTone;
}

export interface RunOutcome {
  /** Beat a previous best (bests count from lifetime run BEST_FROM_RUNS on; never the first). */
  newBest: boolean;
  prevBestMinutes: number;
  /** Snow collected during the run, with the Welcome back ×2 extra. */
  runSnow: number;
  /** Snow paid by missions completed this run. */
  missionSnow: number;
  /** Morning Snow, Sunny Week and errand rewards. */
  bonusSnow: number;
  /** runSnow + missionSnow + bonusSnow, all added to the wallet. */
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
  /** Award chips for the results screen, in display order. */
  toasts: ToastSpec[];
  /** Endless runs: how this run compares with the recent ones (null when there's nothing to say). */
  pace: string | null;
  /** Today's errand after this run. */
  errand: ErrandView | null;
  /** recentBest before this run (the gold ruler flag the run was played against). */
  recentBestBefore: number;
  /** The comfort rung of the next endless run. */
  comfortAfter: number;
}

export interface ApplyRunOptions {
  /** Local date of the device ('YYYY-MM-DD') at run end: history, errand, Sunny Week, Morning Snow. */
  today: string;
  /** Daily runs: the try number counted at 6:30 AM by dailyTryStarted, or null/undefined if unscored. */
  dailyTry?: number | null;
  /** Challenge runs: the target score (Rematch). */
  challengeTarget?: number;
  /** Seconds played this run. */
  playSeconds?: number;
  /** Endless runs: the comfort rung played (0..4; standard when absent). */
  rung?: number;
}

type AchievementCheck = (save: Save, run: RunResultV11, options: ApplyRunOptions) => boolean;

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
  sundancer: (_s, r) => r.stats.swingChainBest >= 3,
  rematch: (_s, r, o) => r.mode === 'challenge' && o.challengeTarget !== undefined && r.minutes >= o.challengeTarget,
  'sunny-week': (s) => s.week.days === 127,
  'close-shave': (_s, r) => r.stats.phewMinChill < 5,
  'glare-proof': (_s, r) => r.stats.ballsPassedClean >= 10 && !r.stats.ballGlared,
  'ice-cold': (_s, r) => r.hourGlyphs.some((day) => day.filter((g) => g === 'cool').length >= 9),
  'night-gardener': (_s, r) => r.stats.flowers >= 30,
  forecaster: (s) => (s.stats.forecastNoons & FORECASTER_MASK) === FORECASTER_MASK,
};

/**
 * Unlocked after DAILY_UNLOCK_RUNS completed runs. Any stored Daily entry also counts, so players
 * who unlocked it under the old "first night" rule (or restored such a backup) keep it.
 */
export function isDailyUnlocked(save: Save): boolean {
  return save.stats.runs >= DAILY_UNLOCK_RUNS || Object.keys(save.daily).length > 0;
}

/** Cheapest Snow-priced cosmetic the player doesn't own yet. */
function cheapestUnowned(save: Save): { name: string; cost: number } | null {
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
 * How this endless run compares with the recent ones (tutorial runs left out): its best in the
 * last 10, better than most of them, or below their median; null otherwise or with under 5 runs.
 */
function paceLine(history: Save['history']): string | null {
  const recent = history.filter((e) => e.r !== 0).slice(-PACE_WINDOW);
  if (recent.length < PACE_MIN_RUNS) return null;
  const m = (recent[recent.length - 1] as Save['history'][number]).m;
  const others = recent.slice(0, -1).map((e) => e.m).sort((a, b) => a - b);
  const beaten = others.filter((o) => m > o).length;
  if (beaten === others.length) return `Your best in ${recent.length} runs!`;
  if (beaten >= 5) return `Better than ${beaten} of your last ${recent.length} runs`;
  const mid = others.length >> 1;
  const median = others.length % 2 ? (others[mid] as number) : Math.round(((others[mid - 1] as number) + (others[mid] as number)) / 2);
  return m < median ? `Below your usual (${scoreText(median)})` : null;
}

/** Bits of the forecasts whose noon this run survived (FORECAST_IDS order; Clear never counts). */
function forecastNoonBits(r: RunResultV11): number {
  let bits = 0;
  r.plan.forEach((p, i) => {
    if (p.forecast !== 'clear' && r.minutes >= i * MINUTES_PER_DAY + NOON_MINUTES) bits |= 1 << FORECAST_IDS.indexOf(p.forecast);
  });
  return bits;
}

/**
 * Folds a finished, non-debug run into the save: stats and bests, history and comfort, wallet and
 * bonuses (Morning Snow, Welcome back, Sunny Week, Today's errand), missions (progress, staleness),
 * the Daily best, achievements and their cosmetic rewards. Pure.
 */
export function applyRunResult(save: Save, result: RunResult, options: ApplyRunOptions): { save: Save; outcome: RunOutcome } {
  const r = v11Result(result); // V11-SHIM: CC-7 (use `result` directly)
  const today = options.today;
  const next = cloneSave(save);
  const s = next.stats;
  const runsBefore = s.runs;
  const dailyWasUnlocked = isDailyUnlocked(save);
  const recentBestBefore = recentBest(save);
  const rawSnow = Math.max(0, Math.floor(r.stats.snow));

  // Bests: endless and challenge runs from lifetime run 3 on; Dailies keep their own per-date best.
  const prevBestMinutes = s.bestMinutes;
  const countsForBest = r.mode !== 'daily' && runsBefore >= BEST_FROM_RUNS;
  const newBest = countsForBest && prevBestMinutes > 0 && r.minutes > prevBestMinutes;
  if (countsForBest && r.minutes > prevBestMinutes) s.bestMinutes = r.minutes;

  // Endless runs: the history and the comfort ladder (Daily and challenge runs never touch them).
  let pace: string | null = null;
  if (r.mode === 'endless') {
    next.history.push({ m: r.minutes, s: rawSnow, r: options.rung ?? COMFORT_MAX, d: today });
    next.history = next.history.slice(-HISTORY_KEEP);
    if (next.settings.comfort) s.comfort = comfortAfterRun(options.rung ?? s.comfort, r.minutes);
    pace = paceLine(next.history);
  }

  s.runs += 1;
  s.bestSnowRun = Math.max(s.bestSnowRun, rawSnow);
  s.phews += r.stats.phews;
  s.flakes += r.stats.flakes;
  s.daysSurvived += r.stats.nightsReached;
  s.maxDay = Math.max(s.maxDay, r.day);
  s.cloudSeconds += r.stats.cloudSeconds;
  s.playSeconds += Math.max(0, options.playSeconds ?? 0);
  s.swings += r.stats.swings;
  s.forecastNoons |= forecastNoonBits(r);
  // Death only happens in daylight, so a score past 6:00 PM of Day 1 means a night was reached.
  if (r.minutes >= MINUTES_PER_DAY || r.stats.nightsReached > 0) s.reachedNight = true;

  // Missions: progress is the best single run; completion pays out immediately. A slot that gains
  // nothing grows staler (Swap at 5).
  let missionSnow = 0;
  const missions: MissionView[] = [];
  const missionsCompleted: MissionView[] = [];
  for (const slot of next.missions.active) {
    const parsed = parseMissionId(slot.id);
    if (!parsed) continue;
    let justCompleted = false;
    if (!slot.done) {
      const before = slot.progress;
      slot.progress = Math.max(before, missionValue(parsed.def, r));
      if (slot.progress >= missionTarget(parsed.def, parsed.tier)) {
        slot.done = true;
        justCompleted = true;
      }
      slot.stale = slot.done || slot.progress > before ? 0 : slot.stale + 1;
    }
    const view = missionView(slot, justCompleted);
    if (!view) continue;
    missions.push(view);
    if (justCompleted) {
      missionsCompleted.push(view);
      missionSnow += view.reward;
    }
  }

  if (r.mode === 'daily' && r.dailyDate !== undefined && options.dailyTry != null) {
    const glyphs = dayStripLines(r.hourGlyphs, r.assisted).join('\n');
    recordDailyBest(next, r.dailyDate, r.minutes, rawSnow, glyphs);
  }

  // Bonuses: the day's first run, a return after days away, the Sunny Week and Today's errand.
  const chips: ToastSpec[] = [];
  let bonusSnow = 0;
  let welcomeExtra = 0;
  if (next.lastPlay !== '' && daysBetween(next.lastPlay, today) >= WELCOME_BACK_DAYS) {
    welcomeExtra = Math.min(WELCOME_BACK_CAP, rawSnow);
    chips.push({ text: 'Welcome back ×2', icon: 'snow', tone: 'gold' });
  }
  if (next.lastPlay !== today) {
    bonusSnow += MORNING_SNOW;
    chips.push({ text: `Morning Snow +${MORNING_SNOW}`, icon: 'snow', tone: 'ink' });
  }
  const week = markSunnyDay(next.week, today, r.day);
  if (week.closedSunny) s.sunnyWeeks += 1;
  for (const p of week.paid) {
    bonusSnow += p.snow;
    chips.push({ text: `Sunny Week: ${p.days} days +${p.snow}`, icon: 'calendar', tone: 'gold' });
  }
  const errand = { ...errandState(next.missions.errand, today, dailyWasUnlocked) };
  const errandDef = getErrand(errand.id);
  let errandDone = false;
  if (errandDef && !errand.done) {
    errand.progress += errandValue(errandDef.id, r, options.dailyTry);
    errandDone = errand.done = errand.progress >= errandDef.target;
  }
  if (errandDone) {
    bonusSnow += ERRAND_REWARD;
    chips.push({ text: `Errand done +${ERRAND_REWARD}`, icon: 'check', tone: 'accent' });
  }
  next.missions.errand = errand;
  next.lastPlay = today;

  const runSnow = rawSnow + welcomeExtra;
  const snowEarned = runSnow + missionSnow + bonusSnow;
  const walletBefore = s.wallet;
  s.wallet += snowEarned;
  s.lifetimeSnow += snowEarned;

  // Achievements and their cosmetic rewards.
  const achievementsUnlocked: AchievementId[] = [];
  const cosmeticsUnlocked: CosmeticId[] = [];
  for (const a of ACHIEVEMENTS) {
    if (next.unlocks.achievements.includes(a.id) || !ACHIEVEMENT_CHECKS[a.id](next, r, options)) continue;
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
  toasts.push(...chips);
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
      bonusSnow,
      snowEarned,
      walletBefore,
      walletAfter: s.wallet,
      missions,
      missionsCompleted,
      achievementsUnlocked,
      cosmeticsUnlocked,
      dailyUnlocked,
      toasts,
      pace,
      errand: errandViewOf(errand, errandDone),
      recentBestBefore,
      comfortAfter: s.comfort,
    },
  };
}

/**
 * Results data for a debug run (sim-altering URL params such as ?day=, ?bot=, ?chill=): nothing is
 * earned, unlocked or saved, so the outcome only mirrors the save as it is.
 */
export function debugRunOutcome(save: Save, result: RunResult): RunOutcome {
  const wallet = save.stats.wallet;
  return {
    newBest: false,
    prevBestMinutes: save.stats.bestMinutes,
    runSnow: Math.max(0, Math.floor(result.stats.snow)),
    missionSnow: 0,
    bonusSnow: 0,
    snowEarned: 0,
    walletBefore: wallet,
    walletAfter: wallet,
    missions: activeMissionViews(save),
    missionsCompleted: [],
    achievementsUnlocked: [],
    cosmeticsUnlocked: [],
    dailyUnlocked: false,
    toasts: [],
    pace: null,
    errand: null,
    recentBestBefore: recentBest(save),
    comfortAfter: save.stats.comfort,
  };
}

/** Call when a run starts: completed missions are swapped for fresh ones (V1_PLAN §11.1). Pure. */
export function beginRun(save: Save): { save: Save; dealt: MissionView[] } {
  if (!save.missions.active.some((m) => m.done)) return { save, dealt: [] };
  const next = cloneSave(save);
  const dealt = refillMissions(next.missions, recentBest(next));
  return { save: next, dealt: dealt.map((slot) => missionView(slot)).filter((v): v is MissionView => v !== null) };
}

/** Missions > Swap on a stale slot: its mission waits in the deferred queue, a fresh one is dealt. Pure. */
export function swapMission(save: Save, slotId: string): Save {
  const next = cloneSave(save);
  return swapSlot(next.missions, slotId, recentBest(next)) ? next : save;
}

/** Views of the 3 active missions (Title pips, Missions screen). */
export function activeMissionViews(save: Save): MissionView[] {
  return save.missions.active.map((slot) => missionView(slot)).filter((v): v is MissionView => v !== null);
}

/** Today's errand as it stands (a new date shows a fresh one). */
export function errandView(save: Save, today: string): ErrandView {
  return errandViewOf(errandState(save.missions.errand, today, isDailyUnlocked(save))) as ErrandView;
}

/** The first milestone above the recent best, or null past the last one. */
export function nextMilestone(save: Save): number | null {
  const best = recentBest(save);
  return MILESTONES.find((m) => m > best) ?? null;
}

/**
 * The Title's next-goal line, from lifetime run BEST_FROM_RUNS on: a mission that is nearly done,
 * else a fresh Daily, else the next milestone. `minutes` is the score it points at, when it has one.
 */
export function nextGoal(save: Save, today: string): { text: string; minutes: number | null } | null {
  if (save.stats.runs < BEST_FROM_RUNS) return null;
  let close: MissionView | null = null;
  for (const m of activeMissionViews(save)) if (!m.done && m.fraction >= SO_CLOSE && (!close || m.fraction > close.fraction)) close = m;
  if (close) {
    const p = parseMissionId(close.id);
    const minutes = p && p.def.scale === 'reach' ? missionTarget(p.def, p.tier) : null;
    return { text: `So close: ${close.label} (${close.progressText})`, minutes };
  }
  if (isDailyUnlocked(save) && !dailyStatus(save, today).played) return { text: `Daily #${dailyNumber(today)} is fresh`, minutes: null };
  const m = nextMilestone(save);
  return m === null ? null : { text: `Next: ${MILESTONE_TEXT[m]}`, minutes: m };
}

/** True when the next run pays Welcome back ×2 (the last run was 3 or more days ago). */
export function welcomeBackDue(save: Save, today: string): boolean {
  return save.lastPlay !== '' && daysBetween(save.lastPlay, today) >= WELCOME_BACK_DAYS;
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
  /** Snowbot's score on this Daily (CC-17), or null until it has been computed. */
  par: number | null;
}

function emptyEntry(): DailyEntry {
  return { tries: 0, bestMinutes: 0, bestSnow: 0, glyphs: '' };
}

export function dailyStatus(save: Save, date: string): DailyStatus {
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
    par: save.pars[date] ?? null,
  };
}

/** Stores Snowbot's par for a Daily (the latest 14 dates are kept). Pure. */
export function setDailyPar(save: Save, date: string, minutes: number): Save {
  if (save.pars[date] === minutes) return save;
  const next = cloneSave(save);
  next.pars[date] = Math.max(0, Math.floor(minutes));
  prunePars(next.pars);
  return next;
}

/**
 * Call when a daily run passes 6:30 AM, and persist the result immediately (flush), so quitting a
 * bad run can't refund the try. Returns the counted try number, or null when the run is practice.
 */
export function dailyTryStarted(save: Save, date: string): { save: Save; tryNumber: number | null } {
  const current = save.daily[date] ?? emptyEntry();
  if (current.tries >= DAILY_TRIES) return { save, tryNumber: null };
  const next = cloneSave(save);
  const entry = { ...current, tries: current.tries + 1 };
  if (current.tries === 0) next.stats.dailyDaysPlayed += 1;
  next.daily[date] = entry;
  pruneDaily(next.daily);
  return { save: next, tryNumber: entry.tries };
}

function recordDailyBest(save: Save, date: string, minutes: number, snow: number, glyphs?: string): void {
  const entry = save.daily[date] ?? emptyEntry();
  const better = minutes > entry.bestMinutes || (minutes === entry.bestMinutes && snow >= entry.bestSnow);
  if (!better) return;
  entry.bestMinutes = minutes;
  entry.bestSnow = snow;
  if (glyphs !== undefined) entry.glyphs = glyphs;
  save.daily[date] = entry;
}

/** The run's hour glyphs so far, for a daily checkpoint (same data applyRunResult stores at the end). */
export interface DailyStripSource {
  hourGlyphs: readonly (readonly HourGlyph[])[];
  assisted: boolean;
}

/**
 * Hourly checkpoint for a scored daily run (call only after dailyTryStarted returned a try number),
 * so progress survives the app being killed mid-run. With `strip`, a new best also stores the run's
 * glyph strip so far (in applyRunResult's format), so the Daily history never shows the best time
 * next to an older try's strip.
 */
export function dailyProgress(save: Save, date: string, minutes: number, snow: number, strip?: DailyStripSource): Save {
  const entry = save.daily[date];
  if (!entry || entry.tries === 0) return save;
  const runSnow = Math.max(0, Math.floor(snow));
  if (minutes < entry.bestMinutes || (minutes === entry.bestMinutes && runSnow <= entry.bestSnow)) return save;
  const next = cloneSave(save);
  const glyphs = strip ? dayStripLines(strip.hourGlyphs, strip.assisted).join('\n') : undefined;
  recordDailyBest(next, date, minutes, runSnow, glyphs);
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

export function isOwned(save: Save, id: string): boolean {
  return save.unlocks.cosmetics.includes(id);
}

export function itemState(save: Save, id: CosmeticId): ItemState {
  const c = getCosmetic(id);
  if (!c) return 'locked';
  if (save.equipped[c.slot] === id) return 'equipped';
  if (isOwned(save, id)) return 'owned';
  if (c.unlock.kind === 'snow') return save.stats.wallet >= c.unlock.cost ? 'buyable' : 'expensive';
  return 'locked';
}

export type BuyResult =
  | { ok: true; save: Save }
  | { ok: false; reason: 'unknown' | 'owned' | 'locked' | 'poor' };

/** Spends Snow on a cosmetic and equips it right away. */
export function buyCosmetic(save: Save, id: CosmeticId): BuyResult {
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

export type EquipResult = { ok: true; save: Save } | { ok: false; reason: 'unknown' | 'notOwned' };

export function equipCosmetic(save: Save, id: CosmeticId): EquipResult {
  const c = getCosmetic(id);
  if (!c) return { ok: false, reason: 'unknown' };
  if (!isOwned(save, id)) return { ok: false, reason: 'notOwned' };
  if (save.equipped[c.slot] === id) return { ok: true, save };
  const next = cloneSave(save);
  next.equipped[c.slot] = id;
  return { ok: true, save: next };
}

/** Settings > Reset progress: a fresh save that keeps the player's settings and device flags. */
export function resetProgress(save: Save, now: number = Date.now()): Save {
  const fresh = defaults(now);
  fresh.settings = { ...save.settings };
  fresh.flags.installSheetShown = save.flags.installSheetShown;
  fresh.flags.persistRequested = save.flags.persistRequested;
  return fresh;
}

export interface InstallEnv {
  ios: boolean;
  standalone: boolean;
  /** A social/search app's embedded browser (platform/lifecycle isInAppBrowser): it can't install. */
  inApp?: boolean;
}

/**
 * iOS browsers only: offer the "Add to Home Screen" sheet once, after run 3 (V1_PLAN §11.5). Never
 * inside an in-app browser, which has no Add to Home Screen.
 */
export function shouldShowInstallSheet(save: Save, env: InstallEnv): boolean {
  return env.ios && !env.standalone && env.inApp !== true && save.stats.runs >= INSTALL_SHEET_RUNS && !save.flags.installSheetShown;
}

/**
 * The iOS Home Screen app keeps its own storage, apart from the browser's. On its first launch with
 * no runs yet, offer to restore the progress copied in the browser (the install sheet's step 1).
 * Nothing needs saving: once a run finishes the condition is false for good.
 */
export function shouldOfferRestoreSheet(save: Save, env: InstallEnv): boolean {
  return env.ios && env.standalone && save.stats.runs === 0;
}
