// v1.4 gamification (docs/V1_4_PLAN.md): the player's Sun Rank (XP and levels), rewards and the
// Snow Globes that hold them, the 7-day daily streak, what is waiting to be claimed (the menu dots),
// trophies' progress and which features a new player has unlocked. CONTRACT FILE: the shapes of the
// first block are fixed for the v1.4 builders; everything else is additive. Pure: functions that
// change the save return a new one and never mutate their input.

import { chapterOf, FORECAST_IDS, LEVELS_PER_CHAPTER } from '../core/index.ts';
import { ACHIEVEMENTS, COSMETICS, getCosmetic, type AchievementId, type Cosmetic, type CosmeticId } from './content.ts';
import { daysBetween, localDate } from './daily.ts';
import type { GamifyState, Save } from './saveTypes.ts';

/** Menu features a new player unlocks one at a time (progressive disclosure). */
export type Feature = 'endless' | 'daily' | 'missions' | 'wardrobe' | 'profile';

export type RewardKind = 'snow' | 'cosmetic' | 'globe';

/** One reward to reveal: Snow, a cosmetic, or a Snow Globe (opened later, or at once by the reveal). */
export interface Reward {
  kind: RewardKind;
  /** Snow amount ('snow'), or the number of globes ('globe'); 1 for a cosmetic. */
  amount: number;
  cosmetic?: CosmeticId;
  /** Short headline for the reveal: "Rank 5!", "Chapter 2 complete", "Week streak". */
  title: string;
}

export interface RankView {
  /** 1-based rank level. */
  level: number;
  /** The rank's name ("Puddle", "Snowball", …). */
  title: string;
  /** Lifetime XP. */
  xp: number;
  /** XP into this level, and the XP this level needs. */
  into: number;
  need: number;
  /** into / need, 0..1. */
  fraction: number;
}

/** What waits for the player: drives the red dots on the Title tray and the Profile. */
export interface Claimables {
  /** Today's daily reward is ready to claim. */
  daily: boolean;
  /** Finished missions whose reward is unclaimed (0 when missions pay out automatically). */
  missions: number;
  /** Unopened Snow Globes. */
  globes: number;
  /** Wardrobe items new since the Wardrobe was last opened (bought, unlocked or now affordable). */
  wardrobe: number;
  /** Trophies (achievements) unlocked since the Profile was last opened. */
  trophies: number;
  total: number;
}

/** The gamification part of a finished run's outcome (RunOutcome.gamify). */
export interface GamifyOutcome {
  xpBefore: number;
  xpGained: number;
  /** Rank level before and after the run (rankAfter > rankBefore: rank up). */
  rankBefore: number;
  rankAfter: number;
  /** Rewards earned by this run (rank-ups, chapter complete, all missions, …), in reveal order. */
  rewards: Reward[];
  /** Features this run unlocked. */
  featuresUnlocked: Feature[];
}

// ---------------------------------------------------------------------------------------------
// XP and the Sun Rank
// ---------------------------------------------------------------------------------------------

/** XP of a finished run's parts (runXp). */
export const XP = {
  /** Every finished run. */
  run: 10,
  /** Endless, Daily and challenge runs: per in-game hour survived, capped. */
  hour: 1,
  hourCap: 30,
  /** A scored Daily try. */
  daily: 10,
  /** A passed Journey level, plus per star, plus its first pass. */
  pass: 15,
  star: 5,
  firstPass: 10,
  /** A new best. */
  best: 10,
  /** Each mission completed. */
  mission: 15,
} as const;

/** What a run did, for its XP. */
export interface RunXpInput {
  minutes: number;
  campaign: boolean;
  passed: boolean;
  stars: number;
  firstPass: boolean;
  dailyScored: boolean;
  newBest: boolean;
  missions: number;
  trophies: readonly AchievementId[];
}

/** A finished run's XP (see XP; trophies pay their tier's TROPHY_XP). */
export function runXp(i: RunXpInput): number {
  let xp = XP.run + XP.mission * i.missions + (i.newBest ? XP.best : 0) + (i.dailyScored ? XP.daily : 0);
  if (i.campaign) {
    if (i.passed) xp += XP.pass + XP.star * i.stars + (i.firstPass ? XP.firstPass : 0);
  } else {
    xp += Math.min(XP.hourCap, Math.floor(Math.max(0, i.minutes) / 60) * XP.hour);
  }
  for (const t of i.trophies) xp += TROPHY_XP[trophyTier(t)];
  return xp;
}

/** XP from Rank 1 to 2; each later rank needs RANK_STEP more, up to RANK_NEED_MAX. */
const RANK_NEED_1 = 100;
const RANK_STEP = 50;
const RANK_NEED_MAX = 800;
/** The first rank whose need is capped, and the lifetime XP it starts at. */
const CAP_LEVEL = 1 + (RANK_NEED_MAX - RANK_NEED_1) / RANK_STEP;
const CAP_XP = (CAP_LEVEL - 1) * RANK_NEED_1 + (RANK_STEP * (CAP_LEVEL - 1) * (CAP_LEVEL - 2)) / 2;
export const RANK_MAX = 999;

/** XP rank `level` needs to reach the next one: 100, 150, 200 … 800. */
export function rankNeed(level: number): number {
  return Math.min(RANK_NEED_MAX, RANK_NEED_1 + RANK_STEP * (Math.max(1, level) - 1));
}

/** Lifetime XP at which rank `level` begins. */
export function rankStartXp(level: number): number {
  const l = Math.max(1, Math.min(RANK_MAX, Math.floor(level)));
  if (l >= CAP_LEVEL) return CAP_XP + RANK_NEED_MAX * (l - CAP_LEVEL);
  return (l - 1) * RANK_NEED_1 + (RANK_STEP * (l - 1) * (l - 2)) / 2;
}

/** The rank lifetime `xp` reaches. */
export function rankForXp(xp: number): number {
  if (xp >= CAP_XP) return Math.min(RANK_MAX, CAP_LEVEL + Math.floor((xp - CAP_XP) / RANK_NEED_MAX));
  let l = 1;
  while (rankStartXp(l + 1) <= xp) l++;
  return l;
}

/** The Sun Rank names, Rank 1 first; later ranks keep the last. */
export const RANK_NAMES: readonly string[] = [
  'Puddle', 'Slush', 'Snowflake', 'Flurry', 'Snowball', 'Snow Angel', 'Frost', 'Icicle', 'Snowdrift', 'Igloo',
  'Glacier', 'Blizzard', 'Avalanche', 'Polar Star', 'Aurora', 'Ice Palace', 'Frost Giant', 'Winter King', 'Eternal Snow', 'Snow Legend',
];

export function rankTitle(level: number): string {
  return RANK_NAMES[Math.min(RANK_NAMES.length, Math.max(1, level)) - 1] as string;
}

export function rankView(save: Save): RankView {
  const xp = save.gamify.xp;
  const level = rankForXp(xp);
  const into = xp - rankStartXp(level);
  const need = rankNeed(level);
  return { level, title: rankTitle(level), xp, into, need, fraction: Math.min(1, into / need) };
}

/** Every RANK_GLOBE_EVERY-th rank pays a Snow Globe; the others pay Snow. */
export const RANK_GLOBE_EVERY = 5;

/** What reaching rank `level` pays: a Snow Globe every 5th rank, else 10 + 5 × level Snow (60 at most). */
export function rankReward(level: number): Reward {
  const title = `Rank ${level}!`;
  if (level % RANK_GLOBE_EVERY === 0) return { kind: 'globe', amount: 1, title };
  return { kind: 'snow', amount: Math.min(60, 10 + 5 * level), title };
}

/** The rank road: the current rank and the next `count − 1`, each with its reward. */
export function rankRoad(save: Save, count = 6): { level: number; title: string; reward: Reward; reached: boolean }[] {
  const now = rankForXp(save.gamify.xp);
  return Array.from({ length: count }, (_, i) => {
    const level = Math.min(RANK_MAX, now + i);
    return { level, title: rankTitle(level), reward: rankReward(level), reached: i === 0 };
  });
}

/** The next rank that pays a Snow Globe. */
export function nextGlobeRank(save: Save): number {
  const now = rankForXp(save.gamify.xp);
  return (Math.floor(now / RANK_GLOBE_EVERY) + 1) * RANK_GLOBE_EVERY;
}

// ---------------------------------------------------------------------------------------------
// Trophies (the achievements): tiers, XP and progress
// ---------------------------------------------------------------------------------------------

export type TrophyTier = 'bronze' | 'silver' | 'gold';

const GOLD = new Set<AchievementId>(['seventh-sun', 'forecaster', 'journey-100', 'stars-300', 'stars-600']);
const SILVER = new Set<AchievementId>([
  'high-noon', 'solstice', 'phew-nomenal', 'rematch', 'sunny-week', 'glare-proof', 'ice-cold', 'night-gardener', 'three-star-20',
  'stars-75', 'stars-150',
]);

export function trophyTier(id: AchievementId): TrophyTier {
  return GOLD.has(id) ? 'gold' : SILVER.has(id) ? 'silver' : 'bronze';
}

export const TROPHY_XP: Readonly<Record<TrophyTier, number>> = { bronze: 20, silver: 35, gold: 60 };

const bits = (n: number): number => {
  let c = 0;
  for (let b = n; b > 0; b >>>= 1) c += b & 1;
  return c;
};
const passedIn = (save: Save, n: number): number => save.campaign.stars.slice(0, n).filter((x) => x > 0).length;
const FORECASTER_MASK = (['breezy', 'overcast', 'heat', 'long'] as const).reduce((m, id) => m | (1 << FORECAST_IDS.indexOf(id)), 0);

/** How far the player is toward a trophy: `value` of `target` (full once unlocked; 0/1 for one-run feats). */
export function trophyProgress(save: Save, id: AchievementId): { value: number; target: number } {
  const st = save.stats;
  const def = ACHIEVEMENTS.find((a) => a.id === id);
  const stars = save.campaign.stars.reduce((n, x) => n + x, 0);
  const of = (value: number, target: number): { value: number; target: number } => ({ value: Math.min(target, Math.max(0, value)), target });
  let p: { value: number; target: number };
  if (def?.stars !== undefined) p = of(stars, def.stars);
  else {
    switch (id) {
      case 'first-light': p = of(st.runs, 1); break;
      case 'night-owl': p = of(st.reachedNight ? 1 : 0, 1); break;
      case 'high-noon': p = of(Math.max(st.bestMinutes, st.easedBest), 1830); break;
      case 'solstice': p = of(st.maxDay, 5); break;
      case 'seventh-sun': p = of(st.maxDay, 7); break;
      case 'phew-nomenal': p = of(st.phews, 25); break;
      case 'daily-habit': p = of(st.dailyDaysPlayed, 7); break;
      case 'sunny-week': p = of(bits(save.week.days), 7); break;
      case 'forecaster': p = of(bits(st.forecastNoons & FORECASTER_MASK), 4); break;
      case 'journey-10': p = of(passedIn(save, 10), 10); break;
      case 'journey-100': p = of(passedIn(save, 100), 100); break;
      case 'three-star-20': p = of(save.campaign.stars.filter((x) => x >= 3).length, 20); break;
      default: p = of(0, 1);
    }
  }
  return save.unlocks.achievements.includes(id) ? { value: p.target, target: p.target } : p;
}

// ---------------------------------------------------------------------------------------------
// Rarity and Snow Globes
// ---------------------------------------------------------------------------------------------

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

const GLOBE_EPIC = new Set<string>(['scarf-candy', 'shades-sunset']);

/** A cosmetic's rarity: by price, by the tier of the trophy that grants it, or by globe exclusive. */
export function rarity(c: Cosmetic): Rarity {
  switch (c.unlock.kind) {
    case 'default':
      return 'common';
    case 'snow':
      return c.unlock.cost >= 1000 ? 'legendary' : c.unlock.cost >= 400 ? 'epic' : c.unlock.cost >= 200 ? 'rare' : 'common';
    case 'globe':
      return GLOBE_EPIC.has(c.id) ? 'epic' : 'rare';
    case 'achievement': {
      const tier = trophyTier(c.unlock.achievement);
      return tier === 'gold' ? 'legendary' : tier === 'silver' ? 'epic' : 'rare';
    }
  }
}

/** A globe's pick weight per rarity (commons come up most). */
const RARITY_WEIGHT: Readonly<Record<Rarity, number>> = { common: 6, rare: 4, epic: 2, legendary: 1 };
/** What a globe holds once every globe item is owned. */
export const GLOBE_SNOW = 100;

/** Items a Snow Globe can hold: unowned Snow-priced and globe-only cosmetics (trophy items stay trophies'). */
export function globePool(save: Save): Cosmetic[] {
  const owned = new Set(save.unlocks.cosmetics);
  return COSMETICS.filter((c) => (c.unlock.kind === 'snow' || c.unlock.kind === 'globe') && !owned.has(c.id));
}

/** A 32-bit mix of two integers (deterministic globe picks). */
function mix(a: number, b: number): number {
  let x = Math.imul((a >>> 0) ^ 0x9e3779b9, 0x85ebca6b) ^ (b >>> 0);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}

/** The pick of the save's next globe: seeded by its creation time and the globes opened so far. */
function globeRoll(save: Save): number {
  return mix(mix(save.createdAt % 4294967296, Math.floor(save.createdAt / 4294967296)), save.gamify.opened);
}

/**
 * Opens one Snow Globe: a seeded, rarity-weighted pick of an item the player doesn't own (added to
 * the Wardrobe, not worn), or GLOBE_SNOW Snow once there is none. Null when no globe is waiting.
 */
export function openGlobe(save: Save): { save: Save; reward: Reward } | null {
  if (save.gamify.globes <= 0) return null;
  const next = structuredClone(save);
  const g = next.gamify;
  const pool = globePool(save);
  let reward: Reward;
  if (pool.length === 0) {
    next.stats.wallet += GLOBE_SNOW;
    next.stats.lifetimeSnow += GLOBE_SNOW;
    reward = { kind: 'snow', amount: GLOBE_SNOW, title: 'Snow Globe' };
  } else {
    const total = pool.reduce((n, c) => n + RARITY_WEIGHT[rarity(c)], 0);
    let roll = globeRoll(save) % total;
    let pick = pool[0] as Cosmetic;
    for (const c of pool) {
      roll -= RARITY_WEIGHT[rarity(c)];
      if (roll < 0) {
        pick = c;
        break;
      }
    }
    const owned = new Set([...next.unlocks.cosmetics, pick.id]);
    next.unlocks.cosmetics = COSMETICS.filter((c) => owned.has(c.id)).map((c) => c.id);
    reward = { kind: 'cosmetic', amount: 1, cosmetic: pick.id, title: 'Snow Globe' };
  }
  g.globes -= 1;
  g.opened += 1;
  storeFeatures(next);
  return { save: next, reward };
}

// ---------------------------------------------------------------------------------------------
// The daily streak (replaces Morning Snow and Sunny Week's Snow)
// ---------------------------------------------------------------------------------------------

/** Days 1-7 of the streak calendar: Snow that grows, then a Snow Globe. */
export const STREAK_REWARDS: readonly Reward[] = [15, 20, 25, 30, 40, 50].map((amount, i): Reward => ({
  kind: 'snow', amount, title: `Day ${i + 1} streak`,
})).concat([{ kind: 'globe', amount: 1, title: 'Week streak!' }]);
export const STREAK_DAYS = STREAK_REWARDS.length;

/** The calendar day (1-7) of the `days`-th day in a row. */
const calendarDay = (days: number): number => ((Math.max(1, days) - 1) % STREAK_DAYS) + 1;

/**
 * The streak after a claim today, or null when today is claimed already (or the clock went back).
 * A missed day keeps the streak once per 7-day cycle (the frozen day); otherwise it restarts at Day 1.
 */
function streakAfterClaim(st: GamifyState['streak'], today: string): { days: number; freezeUsed: boolean; froze: boolean } | null {
  if (st.last === '' || st.days <= 0) return { days: 1, freezeUsed: false, froze: false };
  const gap = daysBetween(st.last, today);
  if (gap <= 0) return null;
  const froze = gap === 2 && !st.freezeUsed;
  if (gap !== 1 && !froze) return { days: 1, freezeUsed: false, froze: false };
  const days = st.days + 1;
  // A new cycle starts with its frozen day unused (unless it was spent reaching it).
  return { days, freezeUsed: calendarDay(days) === 1 ? froze : st.freezeUsed || froze, froze };
}

export interface StreakView {
  /** The calendar day (1-7) today's claim pays, or paid. */
  day: number;
  /** Today's reward is waiting. */
  claimable: boolean;
  /** Days in a row so far (claimed). */
  count: number;
  best: number;
  /** This cycle's frozen day is spent. */
  freezeUsed: boolean;
  /** Claiming today restarts the streak (a day was missed). */
  broken: boolean;
  /** Claiming today spends the frozen day. */
  freezing: boolean;
  /** Each calendar day's reward and state. */
  days: { day: number; reward: Reward; state: 'claimed' | 'today' | 'future' }[];
}

export function streakView(save: Save, today: string): StreakView {
  const st = save.gamify.streak;
  const after = streakAfterClaim(st, today);
  const claimable = after !== null;
  const broken = after !== null && after.days === 1 && st.days > 0;
  const day = calendarDay(after ? after.days : st.days);
  return {
    day,
    claimable,
    count: broken ? 0 : st.days,
    best: st.best,
    freezeUsed: after ? after.freezeUsed : st.freezeUsed,
    broken,
    freezing: after?.froze ?? false,
    days: STREAK_REWARDS.map((reward, i) => ({
      day: i + 1,
      reward,
      state: i + 1 < day || (i + 1 === day && !claimable && st.days > 0) ? 'claimed' : i + 1 === day && claimable ? 'today' : 'future',
    })),
  };
}

/** Claims today's streak reward (Snow to the wallet, or a globe to open). Null when nothing is due. */
export function claimDaily(save: Save, today: string): { save: Save; rewards: Reward[] } | null {
  const after = streakAfterClaim(save.gamify.streak, today);
  if (!after) return null;
  const next = structuredClone(save);
  const st = next.gamify.streak;
  st.last = today;
  st.days = after.days;
  st.freezeUsed = after.freezeUsed;
  st.best = Math.max(st.best, after.days);
  const reward = { ...(STREAK_REWARDS[calendarDay(after.days) - 1] as Reward) };
  if (reward.kind === 'snow') {
    next.stats.wallet += reward.amount;
    next.stats.lifetimeSnow += reward.amount;
  } else {
    next.gamify.globes += reward.amount;
  }
  storeFeatures(next);
  return { save: next, rewards: [reward] };
}

// ---------------------------------------------------------------------------------------------
// Features (progressive disclosure)
// ---------------------------------------------------------------------------------------------

export const FEATURES: readonly Feature[] = ['endless', 'missions', 'wardrobe', 'daily', 'profile'];

/** Journey levels to pass first; twice as many finished runs also do it (a player stuck on a level). */
const LEVEL_GATE: Readonly<Partial<Record<Feature, number>>> = { endless: 3, missions: 5, daily: 8 };
/** The Wardrobe (or the first Snow Globe) and the Profile open at this rank. */
const RANK_GATE = 2;

const FEATURE_NAMES: Readonly<Record<Feature, string>> = {
  endless: 'Endless', daily: 'Daily Solstice', missions: 'Missions', wardrobe: 'Wardrobe', profile: 'Profile',
};

export function featureName(f: Feature): string {
  return FEATURE_NAMES[f];
}

/** The feature's progress gate is met (stored or not). */
function gateMet(save: Save, f: Feature): boolean {
  const lv = LEVEL_GATE[f];
  // A stored Daily entry also opens the Daily (a save that played one under older rules).
  if (lv !== undefined) return save.campaign.unlocked > lv || save.stats.runs >= lv * 2 || (f === 'daily' && Object.keys(save.daily).length > 0);
  const ranked = rankForXp(save.gamify.xp) >= RANK_GATE;
  return f === 'wardrobe' ? ranked || save.gamify.opened + save.gamify.globes > 0 : ranked;
}

/**
 * The feature is open: its gate was met (and stored), or Settings > Unlock all levels (testing) is
 * on. Saves from before v1.4 with any progress have every feature v1.3 showed stored.
 */
export function featureUnlocked(save: Save, f: Feature): boolean {
  return save.settings.unlockAll || save.gamify.features.includes(f) || gateMet(save, f);
}

/** The feature was unlocked by progress and its button hasn't been seen since ("NEW" ribbon). */
export function featureIsNew(save: Save, f: Feature): boolean {
  return save.gamify.features.includes(f) && !save.gamify.seenFeatures.includes(f);
}

/** "Unlocks at Rank 2" / "Pass Level 3 to unlock" for a locked feature's button. */
export function featureHint(f: Feature): string {
  const lv = LEVEL_GATE[f];
  return lv !== undefined ? `Pass Level ${lv} to unlock` : `Unlocks at Rank ${RANK_GATE}`;
}

/** Stores every feature whose gate is met; returns those new to the list. Mutates `save`. */
function storeFeatures(save: Save): Feature[] {
  const fresh = FEATURES.filter((f) => !save.gamify.features.includes(f) && gateMet(save, f));
  if (fresh.length > 0) save.gamify.features = FEATURES.filter((f) => save.gamify.features.includes(f) || fresh.includes(f));
  return fresh;
}

// ---------------------------------------------------------------------------------------------
// Claimables and seen marks
// ---------------------------------------------------------------------------------------------

/** Wardrobe items owned or affordable that the player hasn't seen in the Wardrobe yet. */
export function newItems(save: Save): CosmeticId[] {
  const seen = new Set(save.gamify.seenItems);
  const owned = new Set(save.unlocks.cosmetics);
  return COSMETICS.filter(
    (c) => c.unlock.kind !== 'default' && !seen.has(c.id) && (owned.has(c.id) || (c.unlock.kind === 'snow' && save.stats.wallet >= c.unlock.cost)),
  ).map((c) => c.id);
}

export function isNewItem(save: Save, id: string): boolean {
  return newItems(save).includes(id as CosmeticId);
}

/** The streak can be claimed today (from the second visit on: a first Title shows Play only). */
function dailyDue(save: Save, today: string): boolean {
  return save.stats.runs > 0 && streakAfterClaim(save.gamify.streak, today) !== null;
}

export function claimables(save: Save, today: string = localDate()): Claimables {
  const daily = dailyDue(save, today);
  const globes = save.gamify.globes;
  const wardrobe = featureUnlocked(save, 'wardrobe') ? newItems(save).length : 0;
  const trophies = featureUnlocked(save, 'profile') ? Math.max(0, save.unlocks.achievements.length - save.gamify.seenTrophies) : 0;
  return { daily, missions: 0, globes, wardrobe, trophies, total: (daily ? 1 : 0) + globes + wardrobe + trophies };
}

/** The Wardrobe was opened: every owned or affordable item is seen. Returns `save` when nothing changes. */
export function markItemsSeen(save: Save): Save {
  const fresh = newItems(save);
  if (fresh.length === 0) return save;
  const next = structuredClone(save);
  const seen = new Set([...next.gamify.seenItems, ...fresh]);
  next.gamify.seenItems = COSMETICS.filter((c) => seen.has(c.id)).map((c) => c.id);
  return next;
}

/** The Profile was opened: every unlocked trophy is seen. */
export function markTrophiesSeen(save: Save): Save {
  if (save.gamify.seenTrophies === save.unlocks.achievements.length) return save;
  const next = structuredClone(save);
  next.gamify.seenTrophies = next.unlocks.achievements.length;
  return next;
}

/** A newly unlocked feature's button was seen (its "NEW" ribbon goes). */
export function markFeatureSeen(save: Save, f: Feature): Save {
  if (!featureIsNew(save, f)) return save;
  const next = structuredClone(save);
  next.gamify.seenFeatures = FEATURES.filter((x) => x === f || next.gamify.seenFeatures.includes(x));
  return next;
}

// ---------------------------------------------------------------------------------------------
// Runs (progression.ts applyRunResult) and saves from before v1.4 (save.ts)
// ---------------------------------------------------------------------------------------------

/** Missions per Snow Globe. */
export const MISSIONS_PER_GLOBE = 3;

export interface RunAwardInput {
  /** The save before the run (rank and features are compared with it). */
  before: Save;
  xp: number;
  /** A Journey level passed with this run: its id (chapter-complete check). */
  passedLevel: number | null;
  missionsCompleted: number;
  /** Trophies unlocked by this run (their cosmetics are revealed). */
  trophies: readonly AchievementId[];
}

/** All levels of `chapter` are passed. */
function chapterDone(save: Save, chapter: number): boolean {
  const from = (chapter - 1) * LEVELS_PER_CHAPTER;
  const stars = save.campaign.stars;
  if (stars.length < from + LEVELS_PER_CHAPTER) return false;
  for (let i = from; i < from + LEVELS_PER_CHAPTER; i++) if ((stars[i] ?? 0) <= 0) return false;
  return true;
}

/**
 * Folds a run's gamification into `next` (the save after the run's progress; mutated): XP and rank
 * rewards, the chapter-complete and mission-set globes, trophy items for the reveal and features
 * unlocked. Returns the outcome and the Snow it paid (the caller adds it to the wallet).
 */
export function awardRun(next: Save, input: RunAwardInput): { outcome: GamifyOutcome; snow: number } {
  const g = next.gamify;
  const xpBefore = g.xp;
  const rankBefore = rankForXp(xpBefore);
  g.xp += Math.max(0, Math.floor(input.xp));
  const rankAfter = rankForXp(g.xp);
  const rewards: Reward[] = [];
  let snow = 0;
  for (let l = rankBefore + 1; l <= rankAfter; l++) rewards.push(rankReward(l));
  const lv = input.passedLevel;
  if (lv !== null && chapterDone(next, chapterOf(lv)) && !chapterDone(input.before, chapterOf(lv))) {
    rewards.push({ kind: 'globe', amount: 1, title: `Chapter ${chapterOf(lv)} complete` });
  }
  const set = g.missionSet + input.missionsCompleted;
  g.missionSet = set % MISSIONS_PER_GLOBE;
  const sets = Math.floor(set / MISSIONS_PER_GLOBE);
  if (sets > 0) rewards.push({ kind: 'globe', amount: sets, title: 'Missions complete' });
  for (const r of rewards) {
    if (r.kind === 'snow') snow += r.amount;
    else if (r.kind === 'globe') g.globes += r.amount;
  }
  for (const id of input.trophies) {
    const a = ACHIEVEMENTS.find((x) => x.id === id);
    if (a?.reward) rewards.push({ kind: 'cosmetic', amount: 1, cosmetic: a.reward, title: a.name });
  }
  const fresh = storeFeatures(next).filter((f) => !featureUnlocked(input.before, f));
  if (next.settings.unlockAll) g.seenFeatures = FEATURES.filter((f) => g.seenFeatures.includes(f) || g.features.includes(f));
  return { outcome: { xpBefore, xpGained: g.xp - xpBefore, rankBefore, rankAfter, rewards, featuresUnlocked: fresh }, snow };
}

/** A fresh save's gamification. */
export function emptyGamify(): GamifyState {
  return {
    xp: 0,
    globes: 0,
    opened: 0,
    missionSet: 0,
    streak: { last: '', days: 0, best: 0, freezeUsed: false },
    features: [],
    seenFeatures: [],
    seenItems: [],
    seenTrophies: 0,
  };
}

/**
 * XP for a save from before v1.4, from its lifetime record: 10 per run, 12 per night survived, 25
 * per Journey level passed and 5 per star, 10 per Daily played, and each trophy's XP.
 */
export function backfillXp(save: Pick<Save, 'stats' | 'campaign' | 'unlocks'>): number {
  const st = save.stats;
  const passed = save.campaign.stars.filter((x) => x > 0).length;
  const stars = save.campaign.stars.reduce((n, x) => n + x, 0);
  let xp = 10 * st.runs + 12 * st.daysSurvived + 25 * passed + 5 * stars + 10 * st.dailyDaysPlayed;
  for (const id of save.unlocks.achievements) xp += TROPHY_XP[trophyTier(id as AchievementId)];
  return xp;
}

/**
 * The v3 → v4 step on a validated save (mutated): XP back-filled, a Snow Globe per 5 ranks reached,
 * every feature v1.3 showed unlocked and seen when the save has any progress (the Daily from 3
 * runs, as it was), and the items and trophies it holds marked seen.
 */
export function upgradeToV4(save: Save): void {
  const g = save.gamify;
  g.xp = backfillXp(save);
  g.globes = Math.floor(rankForXp(g.xp) / RANK_GLOBE_EVERY);
  if (save.stats.runs > 0) {
    const daily = save.stats.runs >= 3 || Object.keys(save.daily).length > 0;
    g.features = FEATURES.filter((f) => f !== 'daily' || daily);
  }
  storeFeatures(save);
  g.seenFeatures = [...g.features];
  g.seenItems = [];
  g.seenItems = newItems(save);
  g.seenTrophies = save.unlocks.achievements.length;
}

/** The cosmetic a reward holds, if any. */
export function rewardItem(r: Reward): Cosmetic | undefined {
  return r.cosmetic ? getCosmetic(r.cosmetic) : undefined;
}
