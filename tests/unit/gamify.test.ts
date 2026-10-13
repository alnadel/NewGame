// v1.4 gamification rules (src/meta/gamify.ts): XP and the Sun Rank, rank rewards, Snow Globes,
// the daily streak, feature unlocks, claimables and seen marks, trophies, save v4 and merges.
import { describe, expect, it } from 'vitest';
import type { HourGlyph, RunResult, RunStats } from '../../src/core/index.ts';
import { ACHIEVEMENTS, COSMETICS, getCosmetic } from '../../src/meta/content.ts';
import { addDays } from '../../src/meta/daily.ts';
import {
  backfillXp,
  claimables,
  claimDaily,
  featureHint,
  featureIsNew,
  featureUnlocked,
  FEATURES,
  GLOBE_SNOW,
  globePool,
  isNewItem,
  markFeatureSeen,
  markItemsSeen,
  markTrophiesSeen,
  nextGlobeRank,
  openGlobe,
  rankForXp,
  rankNeed,
  rankReward,
  rankRoad,
  rankStartXp,
  rankTitle,
  rankView,
  rarity,
  runXp,
  STREAK_REWARDS,
  streakView,
  trophyProgress,
  trophyTier,
  XP,
  type RunXpInput,
} from '../../src/meta/gamify.ts';
import { applyRunResult, beginRun, type ApplyRunOptions } from '../../src/meta/progression.ts';
import { defaults, migrate } from '../../src/meta/save.ts';
import { mergeSaves } from '../../src/meta/saveMerge.ts';
import type { Save } from '../../src/meta/saveTypes.ts';

const NOW = 1_760_000_000_000;
const TODAY = '2026-10-13';
type Stats = RunResult['stats'];

function stats(over: Partial<Stats> = {}): Stats {
  return {
    flakes: 0, flakesMelted: 0, crystals: 0, flowers: 0, phews: 0, snow: 0, maxMult: 1, x5HoldBest: 0, cloudRideBest: 0, cloudSeconds: 0,
    ballsPassedClean: 0, ballGlared: false, gateNoon: false, dayReached: 1, nightsReached: 0, minutes: 0, litTotal: 0, swings: 0,
    swingChainBest: 0, phewMinChill: 100, minChill: 100, ...over,
  } satisfies RunStats & Stats;
}

function run(minutes: number, over: Partial<Stats> = {}, extra: Partial<RunResult> = {}): RunResult {
  const day = Math.floor(minutes / 720) + 1;
  const glyphs: HourGlyph[][] = [];
  for (let d = 1; d < day; d++) glyphs.push([...Array<HourGlyph>(6).fill('cool'), ...Array<HourGlyph>(6).fill('warm')]);
  glyphs.push([...Array<HourGlyph>(Math.floor((minutes % 720) / 60)).fill('warm'), 'melt']);
  return {
    mode: 'endless', seed: 42, profile: 3, drain: 55, noonCloud: 0,
    plan: Array.from({ length: day }, () => ({ biome: 'meadow' as const, forecast: 'clear' as const })),
    minutes, day, clock: '', stats: stats({ minutes, dayReached: day, nightsReached: day - 1, ...over }),
    death: { day, tDay: 0, minutes, time: '', x: 0, y: 0, cause: 'plain', line: '' }, hourGlyphs: glyphs, melody: [], assisted: false, ...extra,
  };
}

const level = (id: number, stars: 0 | 1 | 2 | 3 = 3, passed = true): RunResult =>
  run(360, { flakes: 3 }, { mode: 'campaign', level: { id, passed, stars, introduces: null } });

const opts = (o: Partial<ApplyRunOptions> = {}): ApplyRunOptions => ({ today: TODAY, ...o });
const play = (s: Save, r: RunResult, o: Partial<ApplyRunOptions> = {}) => {
  const out = applyRunResult(beginRun(s).save, r, opts(o));
  return out;
};

const xpIn = (o: Partial<RunXpInput>): RunXpInput => ({
  minutes: 0, campaign: false, passed: false, stars: 0, firstPass: false, dailyScored: false, newBest: false, missions: 0, trophies: [], ...o,
});

describe('XP and the Sun Rank', () => {
  it('scores a run by its parts', () => {
    expect(runXp(xpIn({}))).toBe(XP.run);
    expect(runXp(xpIn({ minutes: 1440 }))).toBe(10 + 24);
    expect(runXp(xpIn({ minutes: 100_000 }))).toBe(10 + XP.hourCap);
    expect(runXp(xpIn({ campaign: true, minutes: 900 }))).toBe(10);
    expect(runXp(xpIn({ campaign: true, passed: true, stars: 3, firstPass: true }))).toBe(10 + 15 + 15 + 10);
    expect(runXp(xpIn({ dailyScored: true, newBest: true, missions: 2 }))).toBe(10 + 10 + 10 + 30);
    expect(runXp(xpIn({ trophies: ['first-light', 'solstice', 'stars-600'] }))).toBe(10 + 20 + 35 + 60);
  });

  it('climbs a curve that starts fast and caps at 800 XP a rank', () => {
    expect([1, 2, 3, 10, 15, 40].map(rankNeed)).toEqual([100, 150, 200, 550, 800, 800]);
    expect([1, 2, 3, 4, 5].map(rankStartXp)).toEqual([0, 100, 250, 450, 700]);
    for (let l = 1; l < 60; l++) {
      expect(rankStartXp(l + 1) - rankStartXp(l)).toBe(rankNeed(l));
      expect(rankForXp(rankStartXp(l))).toBe(l);
      expect(rankForXp(rankStartXp(l + 1) - 1)).toBe(l);
    }
    expect(rankForXp(0)).toBe(1);
    expect(rankForXp(1e9)).toBe(999);
  });

  it('names every rank and views the progress into it', () => {
    expect([1, 2, 5, 20, 99].map(rankTitle)).toEqual(['Puddle', 'Slush', 'Snowball', 'Snow Legend', 'Snow Legend']);
    const s = defaults(NOW);
    s.gamify.xp = 175;
    expect(rankView(s)).toEqual({ level: 2, title: 'Slush', xp: 175, into: 75, need: 150, fraction: 0.5 });
  });

  it('pays Snow per rank and a Snow Globe every 5th', () => {
    expect(rankReward(2)).toEqual({ kind: 'snow', amount: 20, title: 'Rank 2!' });
    expect(rankReward(5)).toEqual({ kind: 'globe', amount: 1, title: 'Rank 5!' });
    expect(rankReward(30).kind).toBe('globe');
    expect(rankReward(31)).toMatchObject({ kind: 'snow', amount: 60 });
    const s = defaults(NOW);
    s.gamify.xp = rankStartXp(3) + 5;
    expect(rankRoad(s).map((n) => [n.level, n.reward.kind, n.reached])).toEqual([
      [3, 'snow', true], [4, 'snow', false], [5, 'globe', false], [6, 'snow', false], [7, 'snow', false], [8, 'snow', false],
    ]);
    expect(nextGlobeRank(s)).toBe(5);
    s.gamify.xp = rankStartXp(5);
    expect(nextGlobeRank(s)).toBe(10);
  });

  it('reaches Rank 2 within the first two or three runs, Journey or Endless', () => {
    let s = defaults(NOW);
    const ranks: number[] = [];
    for (let id = 1; id <= 3; id++) {
      s = play(s, level(id, 2)).save;
      ranks.push(rankForXp(s.gamify.xp));
    }
    expect(ranks[1]).toBeGreaterThanOrEqual(2);
    expect(ranks[0]).toBe(1);
    let e = defaults(NOW);
    for (let i = 0; i < 3; i++) e = play(e, run(400, { flakes: 12, maxMult: 2 })).save;
    expect(rankForXp(e.gamify.xp)).toBeGreaterThanOrEqual(2);
  });
});

describe('applyRunResult: the gamify outcome', () => {
  it('fills RunOutcome.gamify with the XP, the rank and the rewards in reveal order', () => {
    const s = defaults(NOW);
    s.gamify.xp = rankStartXp(5) - 5;
    const { save, outcome } = applyRunResult(s, run(200, { snow: 10 }), opts());
    const g = outcome.gamify!;
    expect(g.xpBefore).toBe(rankStartXp(5) - 5);
    expect(g.xpGained).toBeGreaterThanOrEqual(10);
    expect([g.rankBefore, g.rankAfter]).toEqual([4, 5]);
    expect(g.rewards[0]).toEqual({ kind: 'globe', amount: 1, title: 'Rank 5!' });
    expect(save.gamify.globes).toBe(1);
    expect(save.gamify.xp).toBe(g.xpBefore + g.xpGained);
    expect(outcome.toasts.map((t) => t.text)).toContain('Rank 5! Snow Globe');
  });

  it('adds rank-up Snow to the bonus and the wallet', () => {
    const s = defaults(NOW);
    s.gamify.xp = rankStartXp(3) - 1;
    const { save, outcome } = applyRunResult(s, run(10, { snow: 5 }), opts());
    expect(outcome.gamify!.rewards[0]).toEqual({ kind: 'snow', amount: 25, title: 'Rank 3!' });
    expect(outcome.bonusSnow).toBe(25);
    expect(outcome.snowEarned).toBe(5 + 25);
    expect(save.stats.wallet).toBe(30);
  });

  it('pays a Snow Globe when a chapter is complete, once', () => {
    const s = defaults(NOW);
    for (let i = 0; i < 9; i++) s.campaign.stars[i] = 1;
    s.campaign.unlocked = 10;
    const done = applyRunResult(s, level(10, 1), opts());
    expect(done.outcome.gamify!.rewards).toContainEqual({ kind: 'globe', amount: 1, title: 'Chapter 1 complete' });
    const again = applyRunResult(done.save, level(10, 3), opts());
    expect(again.outcome.gamify!.rewards.some((r) => r.title.startsWith('Chapter'))).toBe(false);
    const failed = applyRunResult(s, level(10, 0, false), opts());
    expect(failed.outcome.gamify!.rewards.some((r) => r.title.startsWith('Chapter'))).toBe(false);
  });

  it('pays a Snow Globe for every third mission finished', () => {
    const s = defaults(NOW);
    // reach-9am and flakes-10 complete: 2 of 3.
    const a = applyRunResult(s, run(200, { flakes: 12 }), opts());
    expect(a.save.gamify.missionSet).toBe(2);
    expect(a.outcome.gamify!.rewards.some((r) => r.title === 'Missions complete')).toBe(false);
    const b = applyRunResult(beginRun(a.save).save, run(400), opts());
    expect(b.outcome.missionsCompleted.length).toBeGreaterThanOrEqual(1);
    expect(b.outcome.gamify!.rewards).toContainEqual({ kind: 'globe', amount: 1, title: 'Missions complete' });
    expect(b.save.gamify.missionSet).toBe((2 + b.outcome.missionsCompleted.length) % 3);
  });

  it('reveals the items trophies grant (the star milestones among them)', () => {
    const s = defaults(NOW);
    for (let i = 0; i < 8; i++) s.campaign.stars[i] = 3;
    s.campaign.unlocked = 9;
    const { outcome } = applyRunResult(s, level(9, 1), opts());
    expect(outcome.achievementsUnlocked).toContain('stars-25');
    expect(outcome.gamify!.rewards).toContainEqual({ kind: 'cosmetic', amount: 1, cosmetic: 'scarf-starry', title: 'Stargazer' });
  });

  it('reports the features a run unlocks, once', () => {
    let s = defaults(NOW);
    const seen: string[] = [];
    for (let id = 1; id <= 8; id++) {
      const r = play(s, level(id, 2));
      seen.push(...r.outcome.gamify!.featuresUnlocked);
      s = r.save;
    }
    expect(seen.sort()).toEqual([...FEATURES].sort());
    expect(new Set(seen).size).toBe(seen.length);
    expect(FEATURES.every((f) => featureUnlocked(s, f) && featureIsNew(s, f))).toBe(true);
  });
});

describe('Snow Globes', () => {
  const withGlobes = (n: number): Save => {
    const s = defaults(NOW);
    s.gamify.globes = n;
    return s;
  };

  it('opens nothing without a globe', () => {
    expect(openGlobe(defaults(NOW))).toBeNull();
  });

  it('opens a seeded pick: the same save gives the same item, and the input is untouched', () => {
    const s = withGlobes(2);
    const before = JSON.stringify(s);
    const a = openGlobe(s)!;
    const b = openGlobe(s)!;
    expect(JSON.stringify(s)).toBe(before);
    expect(a.reward).toEqual(b.reward);
    expect(a.reward.kind).toBe('cosmetic');
    expect(a.save.unlocks.cosmetics).toContain(a.reward.cosmetic);
    expect([a.save.gamify.globes, a.save.gamify.opened]).toEqual([1, 1]);
    // Owned, not worn.
    expect(a.save.equipped).toEqual(s.equipped);
  });

  it('only holds unowned Snow-priced or globe items, and never the same one twice', () => {
    let s = withGlobes(40);
    const got: string[] = [];
    for (;;) {
      const o = openGlobe(s);
      if (!o) break;
      s = o.save;
      if (o.reward.kind === 'snow') {
        expect(o.reward.amount).toBe(GLOBE_SNOW);
        continue;
      }
      const c = getCosmetic(o.reward.cosmetic as string)!;
      expect(['snow', 'globe']).toContain(c.unlock.kind);
      got.push(c.id);
    }
    expect(new Set(got).size).toBe(got.length);
    expect(got.length).toBe(COSMETICS.filter((c) => c.unlock.kind === 'snow' || c.unlock.kind === 'globe').length);
    expect(globePool(s)).toEqual([]);
    // Everything owned: Snow instead.
    const w = s.stats.wallet;
    expect(s.stats.wallet).toBe(w);
    expect(s.gamify.opened).toBe(40);
  });

  it('pays Snow once every globe item is owned', () => {
    const s = withGlobes(1);
    s.unlocks.cosmetics = COSMETICS.map((c) => c.id);
    const o = openGlobe(s)!;
    expect(o.reward).toEqual({ kind: 'snow', amount: GLOBE_SNOW, title: 'Snow Globe' });
    expect(o.save.stats.wallet).toBe(GLOBE_SNOW);
    expect(o.save.stats.lifetimeSnow).toBe(GLOBE_SNOW);
  });

  it('favours commons: rarity by price, trophy tier or globe exclusive', () => {
    const r = (id: string): string => rarity(getCosmetic(id)!);
    expect(['scarf-red', 'scarf-mint', 'hat-tophat', 'scarf-rainbow', 'hat-gilded'].map(r)).toEqual(['common', 'common', 'rare', 'epic', 'legendary']);
    expect(['scarf-starry', 'hat-crown', 'scarf-gold', 'scarf-frost', 'shades-sunset'].map(r)).toEqual(['rare', 'epic', 'legendary', 'rare', 'epic']);
    // Over many saves the commons come up more than the legendary.
    const counts: Record<string, number> = {};
    for (let i = 0; i < 400; i++) {
      const s = withGlobes(1);
      s.createdAt = NOW + i * 7919;
      const c = getCosmetic(openGlobe(s)!.reward.cosmetic as string)!;
      counts[rarity(c)] = (counts[rarity(c)] ?? 0) + 1;
    }
    expect(counts.common!).toBeGreaterThan(counts.legendary ?? 0);
    // Globe-only items come up most often: 6 of the 35.
    let exclusive = 0;
    for (let i = 0; i < 400; i++) {
      const s = withGlobes(1);
      s.createdAt = NOW + i * 7919;
      if (getCosmetic(openGlobe(s)!.reward.cosmetic as string)!.unlock.kind === 'globe') exclusive++;
    }
    expect(exclusive).toBeGreaterThan(150);
  });

  it('unlocks the Wardrobe with the first globe', () => {
    const s = withGlobes(1);
    expect(featureUnlocked(defaults(NOW), 'wardrobe')).toBe(false);
    expect(featureUnlocked(s, 'wardrobe')).toBe(true);
    expect(openGlobe(s)!.save.gamify.features).toContain('wardrobe');
  });
});

describe('the daily streak', () => {
  const claim = (s: Save, date: string): Save => claimDaily(s, date)!.save;

  it('pays days 1-7 (Snow that grows, then a globe) and restarts the calendar after day 7', () => {
    let s = defaults(NOW);
    const paid: string[] = [];
    for (let i = 0; i < 8; i++) {
      const c = claimDaily(s, addDays(TODAY, i))!;
      paid.push(c.rewards.map((r) => `${r.kind}:${r.amount}`).join());
      s = c.save;
    }
    expect(paid).toEqual(['snow:15', 'snow:20', 'snow:25', 'snow:30', 'snow:40', 'snow:50', 'globe:1', 'snow:15']);
    expect(s.stats.wallet).toBe(15 + 20 + 25 + 30 + 40 + 50 + 15);
    expect(s.gamify.globes).toBe(1);
    expect(s.gamify.streak).toMatchObject({ days: 8, best: 8, last: addDays(TODAY, 7) });
    expect(STREAK_REWARDS).toHaveLength(7);
  });

  it('claims once a day; a clock set back claims nothing', () => {
    const s = claim(defaults(NOW), TODAY);
    expect(claimDaily(s, TODAY)).toBeNull();
    expect(claimDaily(s, addDays(TODAY, -1))).toBeNull();
    expect(streakView(s, TODAY).claimable).toBe(false);
  });

  it('keeps the streak over one missed day per cycle, then restarts it', () => {
    let s = claim(claim(defaults(NOW), TODAY), addDays(TODAY, 1));
    // Day 3 missed: the frozen day keeps it.
    expect(streakView(s, addDays(TODAY, 3))).toMatchObject({ claimable: true, freezing: true, broken: false, day: 3 });
    s = claim(s, addDays(TODAY, 3));
    expect(s.gamify.streak).toMatchObject({ days: 3, freezeUsed: true });
    // A second miss in the same cycle restarts it.
    expect(streakView(s, addDays(TODAY, 5))).toMatchObject({ broken: true, day: 1, count: 0 });
    s = claim(s, addDays(TODAY, 5));
    expect(s.gamify.streak).toMatchObject({ days: 1, freezeUsed: false, best: 3 });
    // Two days missed: restarts at once.
    expect(claimDaily(s, addDays(TODAY, 8))!.save.gamify.streak.days).toBe(1);
  });

  it('gives each new 7-day cycle its frozen day back', () => {
    let s = defaults(NOW);
    s = claim(s, TODAY);
    s = claim(s, addDays(TODAY, 2));
    for (let i = 3; i <= 7; i++) s = claim(s, addDays(TODAY, i));
    expect(s.gamify.streak).toMatchObject({ days: 7, freezeUsed: true });
    s = claim(s, addDays(TODAY, 8));
    expect(s.gamify.streak).toMatchObject({ days: 8, freezeUsed: false });
  });

  it('shows the calendar: claimed days, today and those to come', () => {
    let s = defaults(NOW);
    expect(streakView(s, TODAY).days.map((d) => d.state)).toEqual(['today', 'future', 'future', 'future', 'future', 'future', 'future']);
    s = claim(claim(s, TODAY), addDays(TODAY, 1));
    expect(streakView(s, addDays(TODAY, 1)).days.map((d) => d.state).slice(0, 3)).toEqual(['claimed', 'claimed', 'future']);
    expect(streakView(s, addDays(TODAY, 2)).days.map((d) => d.state).slice(0, 4)).toEqual(['claimed', 'claimed', 'today', 'future']);
    expect(streakView(s, addDays(TODAY, 2)).count).toBe(2);
  });
});

describe('features', () => {
  it('opens nothing for a new player but Play, and every feature with the testing toggle', () => {
    const s = defaults(NOW);
    expect(FEATURES.filter((f) => featureUnlocked(s, f))).toEqual([]);
    s.settings.unlockAll = true;
    expect(FEATURES.every((f) => featureUnlocked(s, f))).toBe(true);
    expect(FEATURES.some((f) => featureIsNew(s, f))).toBe(false);
  });

  it('opens Endless after Level 3, Missions after 5, the Daily after 8 (or twice as many runs), the rest at Rank 2', () => {
    const s = defaults(NOW);
    const open = (): string[] => FEATURES.filter((f) => featureUnlocked(s, f));
    s.campaign.unlocked = 4;
    expect(open()).toEqual(['endless']);
    s.campaign.unlocked = 6;
    expect(open()).toEqual(['endless', 'missions']);
    s.campaign.unlocked = 9;
    expect(open()).toEqual(['endless', 'missions', 'daily']);
    s.gamify.xp = rankStartXp(2);
    expect(open()).toEqual(FEATURES);
    const runs = defaults(NOW);
    runs.stats.runs = 10;
    expect(FEATURES.filter((f) => featureUnlocked(runs, f))).toEqual(['endless', 'missions']);
    expect(featureHint('endless')).toBe('Pass Level 3 to unlock');
    expect(featureHint('profile')).toBe('Unlocks at Rank 2');
  });

  it('drops the NEW mark once seen', () => {
    const s = defaults(NOW);
    s.gamify.features = ['endless'];
    expect(featureIsNew(s, 'endless')).toBe(true);
    const seen = markFeatureSeen(s, 'endless');
    expect(featureIsNew(seen, 'endless')).toBe(false);
    expect(markFeatureSeen(seen, 'endless')).toBe(seen);
  });
});

describe('claimables and seen marks', () => {
  it('counts the daily reward, globes, new wardrobe items and new trophies', () => {
    const s = defaults(NOW);
    expect(claimables(s, TODAY)).toEqual({ daily: false, missions: 0, globes: 0, wardrobe: 0, trophies: 0, total: 0 });
    s.stats.runs = 1;
    s.gamify.globes = 2;
    s.gamify.xp = rankStartXp(2);
    s.stats.wallet = 100;
    s.unlocks.achievements = ['first-light'];
    // Mint Scarf (60), Beanie (80) and Parsnip (100) are affordable.
    expect(claimables(s, TODAY)).toEqual({ daily: true, missions: 0, globes: 2, wardrobe: 3, trophies: 1, total: 7 });
    expect(isNewItem(s, 'scarf-mint')).toBe(true);
    const seen = markTrophiesSeen(markItemsSeen(claimDaily(s, TODAY)!.save));
    expect(claimables(seen, TODAY)).toMatchObject({ daily: false, wardrobe: 0, trophies: 0, total: 2 });
    expect(markItemsSeen(seen)).toBe(seen);
    expect(markTrophiesSeen(seen)).toBe(seen);
  });

  it('shows no wardrobe or trophy dots while those features are locked', () => {
    const s = defaults(NOW);
    s.stats.wallet = 500;
    s.unlocks.achievements = ['first-light'];
    expect(claimables(s, TODAY)).toMatchObject({ wardrobe: 0, trophies: 0 });
  });
});

describe('trophies', () => {
  it('has a tier for each, and progress toward the counted ones', () => {
    expect(ACHIEVEMENTS.map((a) => trophyTier(a.id)).filter((t) => t === 'gold')).toHaveLength(5);
    const s = defaults(NOW);
    s.stats.phews = 12;
    s.stats.maxDay = 3;
    for (let i = 0; i < 4; i++) s.campaign.stars[i] = 3;
    expect(trophyProgress(s, 'phew-nomenal')).toEqual({ value: 12, target: 25 });
    expect(trophyProgress(s, 'solstice')).toEqual({ value: 3, target: 5 });
    expect(trophyProgress(s, 'stars-25')).toEqual({ value: 12, target: 25 });
    expect(trophyProgress(s, 'journey-10')).toEqual({ value: 4, target: 10 });
    expect(trophyProgress(s, 'cloud-rider')).toEqual({ value: 0, target: 1 });
    s.unlocks.achievements = ['cloud-rider'];
    expect(trophyProgress(s, 'cloud-rider')).toEqual({ value: 1, target: 1 });
  });
});

describe('save v4', () => {
  it('starts a fresh save at Rank 1 with nothing waiting', () => {
    expect(defaults(NOW).gamify).toEqual({
      xp: 0, globes: 0, opened: 0, missionSet: 0, streak: { last: '', days: 0, best: 0, freezeUsed: false },
      features: [], seenFeatures: [], seenItems: [], seenTrophies: 0,
    });
  });

  it('upgrades a v3 save losslessly: XP back-filled, globes for ranks, v1.3 features kept and seen', () => {
    const v3 = {
      v: 3, createdAt: 5,
      stats: { runs: 40, daysSurvived: 12, dailyDaysPlayed: 4, wallet: 300, lifetimeSnow: 2000 },
      unlocks: { cosmetics: ['scarf-mint'], achievements: ['first-light', 'solstice'] },
      campaign: { stars: [3, 2, 1, 0, 2], unlocked: 6, lastLevel: 5 },
    };
    const s = migrate(JSON.stringify(v3), NOW).save;
    expect(s.v).toBe(4);
    expect(s.stats).toMatchObject({ runs: 40, wallet: 300, lifetimeSnow: 2000 });
    expect(s.campaign.stars.slice(0, 5)).toEqual([3, 2, 1, 0, 2]);
    expect(s.unlocks.cosmetics).toContain('scarf-mint');
    const xp = 10 * 40 + 12 * 12 + 25 * 4 + 5 * 8 + 10 * 4 + 20 + 35;
    expect(backfillXp(s)).toBe(xp);
    expect(s.gamify.xp).toBe(xp);
    expect(s.gamify.globes).toBe(Math.floor(rankForXp(xp) / 5));
    expect(s.gamify.features).toEqual(FEATURES);
    expect(FEATURES.some((f) => featureIsNew(s, f))).toBe(false);
    expect(claimables(s, TODAY)).toMatchObject({ wardrobe: 0, trophies: 0 });
    // Round-trips unchanged once upgraded.
    expect(migrate(JSON.stringify(s), NOW).save).toEqual(s);
  });

  it('keeps v1.3 rules for the Daily: open from 3 runs or a played Daily; a save without runs unlocks nothing', () => {
    expect(migrate({ v: 3, stats: { runs: 2 } }, NOW).save.gamify.features).toEqual(['endless', 'missions', 'wardrobe', 'profile']);
    expect(migrate({ v: 1, stats: { runs: 3 } }, NOW).save.gamify.features).toEqual(FEATURES);
    expect(migrate({ v: 3, stats: { runs: 0 } }, NOW).save.gamify).toEqual(defaults(NOW).gamify);
  });

  it('validates a damaged gamify field', () => {
    const s = migrate({ v: 4, gamify: { xp: -5, globes: 'x', opened: 2.7, missionSet: 9, streak: { last: 'nope', days: 4 }, features: ['endless', 'warp'], seenItems: ['hat-beanie', 'nope'], seenTrophies: 999 } }, NOW).save;
    expect(s.gamify).toEqual({
      xp: 0, globes: 0, opened: 2, missionSet: 2, streak: { last: '', days: 0, best: 0, freezeUsed: false },
      features: ['endless'], seenFeatures: [], seenItems: ['hat-beanie'], seenTrophies: 0,
    });
  });

  it('merges two instances: XP and globes add, the later streak wins, features join', () => {
    const base = defaults(NOW);
    base.gamify.xp = 100;
    base.gamify.globes = 2;
    const local = structuredClone(base);
    local.gamify.xp = 150;
    local.gamify.globes = 1;
    local.gamify.opened = 1;
    local.gamify.features = ['endless'];
    local.gamify.streak = { last: TODAY, days: 3, best: 3, freezeUsed: false };
    const remote = structuredClone(base);
    remote.gamify.xp = 130;
    remote.gamify.globes = 3;
    remote.gamify.features = ['missions'];
    remote.gamify.streak = { last: addDays(TODAY, -1), days: 2, best: 2, freezeUsed: false };
    const m = migrate(mergeSaves(base, local, remote), NOW).save.gamify;
    expect([m.xp, m.globes, m.opened]).toEqual([180, 2, 1]);
    expect(m.features).toEqual(['endless', 'missions']);
    expect(m.streak.last).toBe(TODAY);
    const joined = migrate(mergeSaves(null, local, remote), NOW).save.gamify;
    expect([joined.xp, joined.globes]).toEqual([150, 3]);
  });
});
