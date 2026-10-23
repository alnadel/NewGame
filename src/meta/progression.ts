// Pure progression rules (V1_PLAN §11, V1_1_PLAN UM3-UM6, CAMPAIGN_PLAN §5, GDD §6-§8). Every function
// takes a save and returns a new one; inputs are never mutated, so the session can diff, test and
// persist freely.

import {
  comfortAfterRun,
  COMFORT_MAX,
  FORECAST_IDS,
  HEROES,
  isTrialId,
  isWarmup,
  MINUTES_PER_DAY,
  TRIAL_BASE,
  TRIAL_COUNT,
  trialDef,
  TRIALS,
  type HeroId,
  type HourGlyph,
  type RunResult,
} from '../core/index.ts';
import type { CampaignState, DailyEntry, Save } from './saveTypes.ts';
import { ACHIEVEMENTS, COSMETICS, getAchievement, getCosmetic, type AchievementId, type Cosmetic, type CosmeticId } from './content.ts';
import { missionTarget, missionValue, missionView, parseMissionId, refillMissions, swapSlot, type MissionView } from './missions.ts';
import { CAMPAIGN_LEVEL_COUNT, cloneSave, defaults, HISTORY_KEEP, MAX_MISSES, pruneDaily, prunePars, recentBest, sameRules, STARS_PER_LEVEL } from './save.ts';
import { DAILY_TRIES, dailyNumber, daysBetween } from './daily.ts';
import { dayStripLines, scoreText } from './share.ts';
import { markSunnyDay } from './week.ts';
import { awardRun, featureName, featureUnlocked, runXp, type GamifyOutcome } from './gamify.ts';

export { recentBest, recentBestAt } from './save.ts';

/**
 * @deprecated v1.4: the Daily is a feature (gamify.ts featureUnlocked, featureHint): it opens with
 * Level 8 passed, or this many finished runs.
 */
export const DAILY_UNLOCK_RUNS = 16;
/** The iOS "Add to Home Screen" sheet is offered once after this many runs. */
export const INSTALL_SHEET_RUNS = 3;
/** Bests (and the next-goal line) count from this lifetime run on: onboarding runs set none. */
export const BEST_FROM_RUNS = 3;
/** High Noon: 12:30 PM on Day 3. */
const HIGH_NOON_MINUTES = 2 * 720 + 390;
/** Surviving a day's noon: 12:30 PM, 390 minutes after 6 AM. */
const NOON_MINUTES = 390;
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

export type ToastIcon = 'trophy' | 'gift' | 'snow' | 'calendar' | 'info' | 'warn' | 'check' | 'share' | 'lock' | 'star';
export type ToastTone = 'ink' | 'accent' | 'gold' | 'danger';

export interface ToastSpec {
  text: string;
  icon?: ToastIcon;
  tone?: ToastTone;
}

export interface RunOutcome {
  /**
   * Beat a previous best at the run's rules (bests count from lifetime run BEST_FROM_RUNS on; never
   * the first): the standard best, or the eased best for a run at eased rules (`bestEased`).
   */
  newBest: boolean;
  /** The best newBest compares with: the eased best when the run was played at eased rules. */
  prevBestMinutes: number;
  /** The run was played at eased rules (a comfort rung below standard, or the warm-up run). */
  bestEased: boolean;
  /** Snow collected during the run, with the Welcome back ×2 extra. */
  runSnow: number;
  /** Snow paid by missions completed this run. */
  missionSnow: number;
  /** Journey first-pass rewards and the Snow of rank-ups (v1.4). */
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
  /** Endless runs: how this run compares with recent ones at its rules (null when there's nothing to say). */
  pace: string | null;
  /** The pace line says the run was below the usual (shown in neutral ink, not as praise). */
  paceDown: boolean;
  /** recentBest before this run (any rules: missions and the Title's milestones measure from it). */
  recentBestBefore: number;
  /** The comfort rung of the next endless run. */
  comfortAfter: number;
  /** Journey runs: how the level went (absent for every other mode). */
  campaign?: CampaignOutcome;
  /** v1.4: XP, rank, rewards and unlocks (meta/gamify.ts). Absent only for debug runs (debugRunOutcome). */
  gamify?: GamifyOutcome;
}

/** A Journey level's result folded into the save. */
export interface CampaignOutcome {
  passed: boolean;
  /** Stars this run earned (0 when not passed). */
  stars: number;
  /** Stars gained beyond the level's previous record (0 when none). */
  newStars: number;
  /** The next level became playable with this run (its first pass). */
  unlockedNext: boolean;
}

export interface ApplyRunOptions {
  /** Local date of the device ('YYYY-MM-DD') at run end: history, the week's days, Welcome back. */
  today: string;
  /** Daily runs: the try number counted at 6:30 AM by dailyTryStarted, or null/undefined if unscored. */
  dailyTry?: number | null;
  /** Challenge runs: the target score (Rematch). */
  challengeTarget?: number;
  /** Seconds played this run. */
  playSeconds?: number;
  /** Endless runs: the comfort rung played (0..4; standard when absent). */
  rung?: number;
  /** Endless runs: the rung-4 run was the warm-up after the climb (days.ts STANDARD_WARMUP). */
  warmup?: boolean;
  /** v1.6 soft-fail: a Journey run reached the finish with its goal missed (counts in campaign.misses). */
  goalMiss?: boolean;
}

type AchievementCheck = (save: Save, run: RunResult, options: ApplyRunOptions) => boolean;

/** Evaluated after the run's stats are merged into the save (star rewards check their `stars`). */
const ACHIEVEMENT_CHECKS: Readonly<Partial<Record<AchievementId, AchievementCheck>>> = {
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
  'journey-10': (s) => passedThrough(s.campaign, 10),
  'journey-100': (s) => passedThrough(s.campaign, 100),
  'three-star-20': (s) => s.campaign.stars.filter((n) => n >= STARS_PER_LEVEL).length >= 20,
  // v1.5 mechanics (one-run feats; older results without the fields never count).
  'green-thumb': (_s, r) => (r.stats.blooms ?? 0) >= 5,
  'cold-front': (_s, r) => (r.stats.snaps ?? 0) >= 3,
  'deep-diver': (_s, r) => (r.stats.deepSeconds ?? 0) >= 30,
};

// ---------------------------------------------------------------------------------------------
// Journey (CAMPAIGN_PLAN §5)
// ---------------------------------------------------------------------------------------------

/** Stars the whole Journey can give (CAMPAIGN_LEVEL_COUNT × 3). */
export const CAMPAIGN_STARS_MAX = CAMPAIGN_LEVEL_COUNT * STARS_PER_LEVEL;

/** Every level 1..n has been passed (at least one star). */
function passedThrough(c: CampaignState, n: number): boolean {
  if (c.stars.length < n) return false;
  for (let i = 0; i < n; i++) if ((c.stars[i] ?? 0) <= 0) return false;
  return true;
}

/** A level can be started: it is unlocked, or the testing toggle opens them all. */
export function isLevelPlayable(save: Pick<Save, 'campaign' | 'settings'>, id: number): boolean {
  if (!Number.isInteger(id) || id < 1 || id > CAMPAIGN_LEVEL_COUNT) return false;
  return id <= save.campaign.unlocked || save.settings.unlockAll;
}

/** Stars earned so far across the Journey. */
export function totalStars(save: Pick<Save, 'campaign'>): number {
  return save.campaign.stars.reduce((n, x) => n + x, 0);
}

/** The level "Continue" plays: the highest unlocked one (the last level once everything is passed). */
export function continueLevel(save: Pick<Save, 'campaign'>): number {
  return Math.min(CAMPAIGN_LEVEL_COUNT, Math.max(1, save.campaign.unlocked));
}

// ---------------------------------------------------------------------------------------------
// Elementals Trials (docs/ELEMENTALS.md §3.0, §4.10): their own stars, apart from the Journey's
// ---------------------------------------------------------------------------------------------

/** Snow a Trial's first pass pays. */
export const TRIAL_FIRST_PASS_SNOW = 20;
/** Stars all the Trials can give. */
export const ELEMENTAL_STARS_MAX = TRIAL_COUNT * STARS_PER_LEVEL;

/** Trial n's best stars (0: not passed). */
export function trialBest(save: Pick<Save, 'elementals'>, n: number): number {
  return save.elementals?.stars[n - 1] ?? 0;
}

/** Trial n (1..8) can be played: every Trial it requires is passed, or the testing toggle opens them all. */
export function trialOpen(save: Pick<Save, 'elementals' | 'settings'>, n: number): boolean {
  const t = trialDef(TRIAL_BASE + n);
  return t !== null && (save.settings.unlockAll || t.requires.every((k) => trialBest(save, k) > 0));
}

/** A hero's roster tile is open: its intro Trial passed (Nubs always), or the testing toggle. */
export function heroUnlocked(save: Pick<Save, 'elementals' | 'settings'>, hero: HeroId): boolean {
  const n = HEROES[hero].intro;
  return n === 0 || save.settings.unlockAll || trialBest(save, n) > 0;
}

/** The next open Trial after Trial n (its number), or null. */
export function nextOpenTrial(save: Pick<Save, 'elementals' | 'settings'>, n: number): number | null {
  for (let k = n + 1; k <= TRIAL_COUNT; k++) if (trialOpen(save, k)) return k;
  return null;
}

/** The Elementals screen was opened (its Title square drops its NEW sticker). Pure. */
export function markElementalsSeen(save: Save): Save {
  return { ...save, elementals: { stars: save.elementals?.stars.slice() ?? Array<number>(TRIAL_COUNT).fill(0), seen: true } };
}

/** Stars earned across the Trials (of ELEMENTAL_STARS_MAX). */
export function elementalStars(save: Pick<Save, 'elementals'>): number {
  return save.elementals?.stars.reduce((a, b) => a + b, 0) ?? 0;
}

/** The next Journey star reward: the stars so far, the previous and next thresholds, its item. */
export interface StarGoal {
  stars: number;
  from: number;
  target: number;
  name: string;
  item: Cosmetic | undefined;
}

/** The star reward the player is working toward, or null once every one is earned. */
export function nextStarGoal(save: Pick<Save, 'campaign'>): StarGoal | null {
  const stars = totalStars(save);
  let from = 0;
  for (const a of ACHIEVEMENTS) {
    if (a.stars === undefined) continue;
    if (stars < a.stars) return { stars, from, target: a.stars, name: a.name, item: a.reward ? getCosmetic(a.reward) : undefined };
    from = a.stars;
  }
  return null;
}

/**
 * The next endless run is the warm-up after the climb to standard (days.ts STANDARD_WARMUP): comfort
 * is on, the ladder stands at standard and the last endless run was played at R3.
 */
export function warmupDue(save: Pick<Save, 'settings' | 'stats' | 'history'>): boolean {
  const last = save.history[save.history.length - 1];
  return save.settings.comfort && save.stats.runs > 0 && last !== undefined && isWarmup(save.stats.comfort, last.r);
}

/**
 * The Daily is open (gamify.ts featureUnlocked 'daily'). Saves from before v1.4 keep it from 3 runs
 * or any stored Daily entry, as it was.
 */
export function isDailyUnlocked(save: Save): boolean {
  return featureUnlocked(save, 'daily');
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
 * How this endless run (the last history entry) compares with the recent runs played at the same
 * rules (its rung, the warm-up apart; tutorial runs never): its best in the last 10, better than
 * most of them, or below their median; null otherwise or with under 5 such runs. "Below your usual"
 * also needs the run before it at the same rules: the first run after the ladder moved is new
 * ground, not a slump.
 */
function paceLine(history: Save['history']): { text: string; down: boolean } | null {
  const last = history[history.length - 1];
  if (!last || last.r === 0) return null;
  const recent = history.filter((e) => sameRules(e, last)).slice(-PACE_WINDOW);
  if (recent.length < PACE_MIN_RUNS) return null;
  const m = last.m;
  const others = recent.slice(0, -1).map((e) => e.m).sort((a, b) => a - b);
  const beaten = others.filter((o) => m > o).length;
  if (beaten === others.length) return { text: `Your best in ${recent.length} runs!`, down: false };
  if (beaten >= 5) return { text: `Better than ${beaten} of your last ${recent.length} runs`, down: false };
  const before = history[history.length - 2];
  if (!before || !sameRules(before, last)) return null;
  const mid = others.length >> 1;
  const median = others.length % 2 ? (others[mid] as number) : Math.round(((others[mid - 1] as number) + (others[mid] as number)) / 2);
  return m < median ? { text: `Below your usual (${scoreText(median)})`, down: true } : null;
}

/** The run is played at eased rules: the tutorial and comfort rungs below standard, or the warm-up. */
function easedRun(r: RunResult, options: ApplyRunOptions): boolean {
  return r.mode === 'endless' && ((options.rung ?? COMFORT_MAX) < COMFORT_MAX || options.warmup === true);
}

/**
 * The next endless run is played at eased rules (the session's ladder: the tutorial first, then the
 * comfort rung, or the warm-up after the climb; standard with Adaptive comfort off). The Title shows
 * the best of those rules.
 */
export function nextRunEased(save: Save): boolean {
  if (save.stats.runs === 0) return true;
  if (!save.settings.comfort) return false;
  return Math.max(1, save.stats.comfort) < COMFORT_MAX || warmupDue(save);
}

/** Bits of the forecasts whose noon this run survived (FORECAST_IDS order; Clear never counts). */
function forecastNoonBits(r: RunResult): number {
  let bits = 0;
  r.plan.forEach((p, i) => {
    if (p.forecast !== 'clear' && r.minutes >= i * MINUTES_PER_DAY + NOON_MINUTES) bits |= 1 << FORECAST_IDS.indexOf(p.forecast);
  });
  return bits;
}

/**
 * Folds a finished, non-debug run into the save: stats and bests, history and comfort, wallet and
 * bonuses (Welcome back, Journey first passes), missions (progress, staleness), the Daily best, the
 * week's days, achievements and their cosmetic rewards, and the gamification (XP, rank rewards,
 * Snow Globes, features: gamify.ts awardRun). Pure.
 */
export function applyRunResult(save: Save, r: RunResult, options: ApplyRunOptions): { save: Save; outcome: RunOutcome } {
  const today = options.today;
  const next = cloneSave(save);
  const s = next.stats;
  const runsBefore = s.runs;
  const dailyWasUnlocked = isDailyUnlocked(save);
  const recentBestBefore = recentBest(save);
  const rawSnow = Math.max(0, Math.floor(r.stats.snow));
  const trial = r.mode === 'campaign' && r.level !== undefined && isTrialId(r.level.id);

  // Bests, from lifetime run 3 on (Dailies keep their own per-date best): standard-rules runs
  // (challenges, endless at rung 4) set the best; endless runs at eased rules (comfort rungs below
  // standard, the warm-up) set the eased best, and so do the first runs, which never count. The
  // tutorial run is left out: under the lesson's Chill floor Nubs can't melt, so its score would be
  // a bar no comfort-rung run could reach (it shows in the Journal's bars).
  const bestEased = easedRun(r, options);
  // Journey levels are finite runs: they never set a best (nor touch the history or the ladder).
  const counts = r.mode !== 'daily' && r.mode !== 'campaign' && runsBefore >= BEST_FROM_RUNS;
  const prevBestMinutes = bestEased ? s.easedBest : s.bestMinutes;
  const newBest = counts && prevBestMinutes > 0 && r.minutes > prevBestMinutes;
  if (counts && !bestEased && r.minutes > s.bestMinutes) s.bestMinutes = r.minutes;
  const tutorial = r.mode === 'endless' && options.rung === 0;
  if (r.mode === 'endless' && !tutorial && (bestEased || !counts) && r.minutes > s.easedBest) s.easedBest = r.minutes;

  // Endless runs: the history and the comfort ladder (Daily and challenge runs never touch them).
  let pace: { text: string; down: boolean } | null = null;
  if (r.mode === 'endless') {
    const last = save.history[save.history.length - 1];
    const rung = options.rung ?? COMFORT_MAX;
    next.history.push({ m: r.minutes, s: rawSnow, r: rung, d: today, ...(options.warmup && rung === COMFORT_MAX ? { w: 1 as const } : {}) });
    next.history = next.history.slice(-HISTORY_KEEP);
    // The climb to standard looks at the endless run before this one (a warm-up never counts).
    const prev = last && last.w === undefined ? { rung: last.r, minutes: last.m } : null;
    if (next.settings.comfort) s.comfort = comfortAfterRun(options.rung ?? s.comfort, r.minutes, prev);
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
  if (!trial) s.forecastNoons |= forecastNoonBits(r);
  // Death only happens in daylight, so a score past 6:00 PM of Day 1 means a night was reached.
  if (r.minutes >= MINUTES_PER_DAY || r.stats.nightsReached > 0) s.reachedNight = true;

  // Missions: progress is the best single run; completion pays out immediately. A slot that gains
  // nothing grows staler (Swap at 5). An Elementals Trial counts toward no mission (nor trophy).
  let missionSnow = 0;
  const missions: MissionView[] = [];
  const missionsCompleted: MissionView[] = [];
  for (const slot of next.missions.active) {
    const parsed = parseMissionId(slot.id);
    if (!parsed) continue;
    let justCompleted = false;
    if (!slot.done && !trial) {
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

  // Bonuses: a return after days away. The week's days still count (the Sunny Week trophy).
  const chips: ToastSpec[] = [];
  let bonusSnow = 0;
  let welcomeExtra = 0;
  // Journey levels: the best stars are kept, a pass unlocks the next level and pays the first-pass
  // bonus (id × 2 Snow); the run's Snow, missions and achievements count as for endless.
  let campaign: CampaignOutcome | undefined;
  let firstPass = false;
  if (trial && r.level) {
    // An Elementals Trial (docs/ELEMENTALS.md §4.10): its best stars and a first-pass bonus; the
    // Journey's stars, unlocked level, misses and Continue never change.
    const lv = r.level;
    const n = lv.id - TRIAL_BASE;
    const before = trialBest(save, n);
    const stars = lv.passed ? Math.max(1, Math.min(STARS_PER_LEVEL, Math.floor(lv.stars))) : 0;
    if (stars > before) {
      const el = (next.elementals ??= { stars: Array<number>(TRIAL_COUNT).fill(0), seen: false });
      el.stars[n - 1] = stars;
    }
    if (lv.passed && before === 0) {
      firstPass = true;
      bonusSnow += TRIAL_FIRST_PASS_SNOW;
      chips.push({ text: `First pass +${TRIAL_FIRST_PASS_SNOW}`, icon: 'star', tone: 'gold' });
    }
    const opened = TRIALS.filter((t) => !trialOpen(save, t.n) && trialOpen(next, t.n));
    for (const t of opened) chips.push({ text: `New trial: ${t.name}`, icon: 'star', tone: 'accent' });
    campaign = { passed: lv.passed, stars, newStars: Math.max(0, stars - before), unlockedNext: opened.length > 0 };
  } else if (r.mode === 'campaign' && r.level !== undefined) {
    const lv = r.level;
    const c = next.campaign;
    const i = lv.id - 1;
    const inRange = i >= 0 && i < c.stars.length;
    const before = inRange ? (c.stars[i] ?? 0) : 0;
    const stars = lv.passed ? Math.max(1, Math.min(STARS_PER_LEVEL, Math.floor(lv.stars))) : 0;
    const unlockedBefore = c.unlocked;
    if (inRange) {
      c.stars[i] = Math.max(before, stars);
      if (lv.passed) c.unlocked = Math.min(CAMPAIGN_LEVEL_COUNT + 1, Math.max(c.unlocked, lv.id + 1));
      c.lastLevel = lv.id;
      if (options.goalMiss && !lv.passed) {
        const m = (c.misses = c.misses ? c.misses.slice() : Array<number>(CAMPAIGN_LEVEL_COUNT).fill(0));
        m[i] = Math.min(MAX_MISSES, (m[i] ?? 0) + 1);
      }
    }
    if (inRange && lv.passed && before === 0) {
      firstPass = true;
      const bonus = lv.id * 2;
      bonusSnow += bonus;
      chips.push({ text: `First pass +${bonus}`, icon: 'star', tone: 'gold' });
    }
    campaign = { passed: lv.passed, stars, newStars: Math.max(0, stars - before), unlockedNext: c.unlocked > unlockedBefore };
  }
  if (next.lastPlay !== '' && daysBetween(next.lastPlay, today) >= WELCOME_BACK_DAYS) {
    welcomeExtra = Math.min(WELCOME_BACK_CAP, rawSnow);
    chips.push({ text: 'Welcome back ×2', icon: 'snow', tone: 'gold' });
  }
  if (markSunnyDay(next.week, today, r.day)) s.sunnyWeeks += 1;
  next.lastPlay = today;

  // Achievements and their cosmetic rewards.
  const achievementsUnlocked: AchievementId[] = [];
  const cosmeticsUnlocked: CosmeticId[] = [];
  for (const a of trial ? [] : ACHIEVEMENTS) {
    const earned = a.stars !== undefined ? totalStars(next) >= a.stars : ACHIEVEMENT_CHECKS[a.id]?.(next, r, options) === true;
    if (next.unlocks.achievements.includes(a.id) || !earned) continue;
    achievementsUnlocked.push(a.id);
    if (a.reward && !next.unlocks.cosmetics.includes(a.reward)) cosmeticsUnlocked.push(a.reward);
  }
  next.unlocks.achievements = sortedIds(ACHIEVEMENTS, [...next.unlocks.achievements, ...achievementsUnlocked]);
  next.unlocks.cosmetics = sortedIds(COSMETICS, [...next.unlocks.cosmetics, ...cosmeticsUnlocked]);

  // XP, rank rewards, Snow Globes and features (gamify.ts); rank-up Snow joins the bonuses.
  const xp = runXp({
    minutes: r.minutes,
    campaign: r.mode === 'campaign',
    passed: campaign?.passed ?? false,
    stars: campaign?.stars ?? 0,
    firstPass,
    dailyScored: r.mode === 'daily' && options.dailyTry != null,
    newBest,
    missions: missionsCompleted.length,
    trophies: achievementsUnlocked,
  });
  const award = awardRun(next, { before: save, xp, passedLevel: campaign?.passed && r.level && !trial ? r.level.id : null, missionsCompleted: missionsCompleted.length, trophies: achievementsUnlocked });
  const gamify = award.outcome;
  bonusSnow += award.snow;
  for (const reward of gamify.rewards) if (reward.title.startsWith('Rank ')) chips.push({ text: reward.kind === 'snow' ? `${reward.title} +${reward.amount}` : `${reward.title} Snow Globe`, icon: 'star', tone: 'gold' });

  const runSnow = rawSnow + welcomeExtra;
  const snowEarned = runSnow + missionSnow + bonusSnow;
  const walletBefore = s.wallet;
  s.wallet += snowEarned;
  s.lifetimeSnow += snowEarned;

  const dailyUnlocked = !dailyWasUnlocked && isDailyUnlocked(next);

  const toasts: ToastSpec[] = [];
  for (const id of achievementsUnlocked) {
    toasts.push({ text: `Achievement: ${getAchievement(id)?.name ?? id}`, icon: 'trophy', tone: 'gold' });
  }
  for (const id of cosmeticsUnlocked) {
    toasts.push({ text: `Unlocked: ${getCosmetic(id)?.name ?? id}`, icon: 'gift', tone: 'accent' });
  }
  toasts.push(...chips);
  for (const f of gamify.featuresUnlocked) toasts.push({ text: `${featureName(f)} unlocked!`, icon: f === 'daily' ? 'calendar' : 'gift', tone: 'accent' });
  const cheapest = cheapestUnowned(next);
  if (cheapest && walletBefore < cheapest.cost && s.wallet >= cheapest.cost) {
    toasts.push({ text: `You can afford the ${cheapest.name}!`, icon: 'snow', tone: 'accent' });
  }

  return {
    save: next,
    outcome: {
      newBest,
      prevBestMinutes,
      bestEased,
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
      pace: pace?.text ?? null,
      paceDown: pace?.down ?? false,
      recentBestBefore,
      comfortAfter: s.comfort,
      ...(campaign ? { campaign } : {}),
      gamify,
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
    bestEased: false,
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
    paceDown: false,
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

/** The first milestone above the recent best, or null past the last one. */
export function nextMilestone(save: Save): number | null {
  const best = recentBest(save);
  return MILESTONES.find((m) => m > best) ?? null;
}

/**
 * "So close: …" with one pair of parentheses at most: "Survive a noon (reach 12:30 PM)" at
 * 11:00 AM reads "So close: Survive a noon · 11:00 AM of 12:30 PM", a count "· 6/10", and a
 * progress that names its day "(best Day 1 · 2:20 PM)".
 */
export function soCloseText(label: string, progress: string): string {
  const m = /^(.*?)\s*\(reach ([^)]+)\)$/.exec(label);
  const short = m ? (m[1] as string) : label;
  if (progress.includes(' · ')) return `So close: ${short} (best ${progress})`;
  return m ? `So close: ${short} · ${progress} of ${m[2] as string}` : `So close: ${short} · ${progress}`;
}

/**
 * The Title's next-goal line, from lifetime run BEST_FROM_RUNS on: a mission that is nearly done,
 * else a fresh Daily, else the next Journey star reward (once the Journey has begun), else the next
 * milestone. `minutes` is the score it points at, when it has one.
 */
export function nextGoal(save: Save, today: string): { text: string; minutes: number | null } | null {
  if (save.stats.runs < BEST_FROM_RUNS) return null;
  let close: MissionView | null = null;
  for (const m of activeMissionViews(save)) if (!m.done && m.fraction >= SO_CLOSE && (!close || m.fraction > close.fraction)) close = m;
  if (close) {
    const p = parseMissionId(close.id);
    const minutes = p && p.def.scale === 'reach' ? missionTarget(p.def, p.tier) : null;
    return { text: soCloseText(close.label, close.progressText), minutes };
  }
  if (isDailyUnlocked(save) && !dailyStatus(save, today).played) return { text: `Daily #${dailyNumber(today)} is fresh`, minutes: null };
  const stars = nextStarGoal(save);
  if (stars && stars.stars > 0) return { text: `${stars.target - stars.stars} more stars for the ${stars.item?.name ?? stars.name}`, minutes: null };
  const m = nextMilestone(save);
  return m === null ? null : { text: `Next: ${MILESTONE_TEXT[m]}`, minutes: m };
}

/** True when the next run pays Welcome back ×2 (the last run was 3 or more days ago). */
export function welcomeBackDue(save: Save, today: string): boolean {
  return save.lastPlay !== '' && daysBetween(save.lastPlay, today) >= WELCOME_BACK_DAYS;
}

// ---------------------------------------------------------------------------------------------
// Daily bookkeeping (V1_PLAN §11.3, archive/CRITIQUE #30)
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

/**
 * Settings > Reset progress: a fresh save that keeps the player's settings and device flags. Trial
 * stars are zeroed, not dropped: another tab's merge reads a missing field as unchanged.
 */
export function resetProgress(save: Save, now: number = Date.now()): Save {
  const fresh = defaults(now);
  fresh.settings = { ...save.settings };
  if (save.elementals) fresh.elementals = { stars: Array<number>(TRIAL_COUNT).fill(0), seen: false };
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
