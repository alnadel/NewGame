import { describe, expect, it } from 'vitest';
import type { DayPlan, HourGlyph, RunResult, RunStats } from '../../src/core/index.ts';
import type { Save } from '../../src/meta/saveTypes.ts';
import { defaults } from '../../src/meta/save.ts';
import { MISSIONS } from '../../src/meta/content.ts';
import { addDays } from '../../src/meta/daily.ts';
import {
  activeMissionViews,
  applyRunResult,
  CAMPAIGN_STARS_MAX,
  continueLevel,
  isLevelPlayable,
  totalStars,
  nextRunEased,
  recentBestAt,
  warmupDue,
  beginRun,
  BEST_FROM_RUNS,
  buyCosmetic,
  dailyProgress,
  dailyStatus,
  dailyTryStarted,
  debugRunOutcome,
  equipCosmetic,
  isDailyUnlocked,
  itemState,
  MILESTONES,
  nextGoal,
  soCloseText,
  nextMilestone,
  recentBest,
  resetProgress,
  setDailyPar,
  shouldOfferRestoreSheet,
  shouldShowInstallSheet,
  welcomeBackDue,
  type ApplyRunOptions,
} from '../../src/meta/progression.ts';
import { dayStripLines } from '../../src/meta/share.ts';
import { isInAppBrowser } from '../../src/platform/lifecycle.ts';

const TODAY = '2026-10-11';
type Stats = RunResult['stats'];

function stats(over: Partial<Stats> = {}): Stats {
  return {
    flakes: 0,
    flakesMelted: 0,
    crystals: 0,
    flowers: 0,
    phews: 0,
    snow: 0,
    maxMult: 1,
    x5HoldBest: 0,
    cloudRideBest: 0,
    cloudSeconds: 0,
    ballsPassedClean: 0,
    ballGlared: false,
    gateNoon: false,
    dayReached: 1,
    nightsReached: 0,
    minutes: 0,
    litTotal: 0,
    swings: 0,
    swingChainBest: 0,
    phewMinChill: 100,
    minChill: 100,
    ...over,
  } satisfies RunStats & Stats;
}

/** Completed days are 6 cool and 6 warm hours (never "Ice Cold"); the last day ends in a melt. */
function run(minutes: number, over: Partial<Stats> = {}, extra: Partial<RunResult> = {}): RunResult {
  const day = Math.floor(minutes / 720) + 1;
  const glyphs: HourGlyph[][] = [];
  const plan: DayPlan[] = [];
  for (let d = 1; d <= day; d++) plan.push({ biome: d % 2 ? 'meadow' : 'oldtown', forecast: 'clear' });
  for (let d = 1; d < day; d++) glyphs.push([...Array<HourGlyph>(6).fill('cool'), ...Array<HourGlyph>(6).fill('warm')]);
  glyphs.push([...Array<HourGlyph>(Math.floor((minutes % 720) / 60)).fill('warm'), 'melt']);
  return {
    mode: 'endless',
    seed: 42,
    profile: 3,
    drain: 55,
    noonCloud: 0,
    plan,
    minutes,
    day,
    clock: '',
    stats: stats({ minutes, dayReached: day, nightsReached: day - 1, ...over }),
    death: { day, tDay: 0, minutes, time: '', x: 0, y: 0, cause: 'plain', line: 'Melted by You.' },
    hourGlyphs: glyphs,
    melody: [],
    assisted: false,
    ...extra,
  };
}

/**
 * A save that already played today (no Morning Snow) with today's errand done, so a test sees
 * only the rule it is about. `runs` past onboarding by default, so bests count.
 */
function quiet(runs = BEST_FROM_RUNS): Save {
  const s = defaults(1);
  s.stats.runs = runs;
  s.lastPlay = TODAY;
  s.unlocks.achievements = ['first-light'];
  s.missions.errand = { date: TODAY, id: 'e-runs-5', progress: 5, done: true };
  return s;
}

const opts = (o: Partial<ApplyRunOptions> = {}): ApplyRunOptions => ({ today: TODAY, ...o });

/** Plays a run and immediately starts the next one (mission replacement). */
function play(save: Save, result: RunResult, o: Partial<ApplyRunOptions> = {}): Save {
  return beginRun(applyRunResult(save, result, opts(o)).save).save;
}

/** A history of `n` endless runs of `m` minutes at the standard rung. */
function history(n: number, m: number): Save['history'] {
  return Array.from({ length: n }, () => ({ m, s: 0, r: 4, d: TODAY }));
}

describe('applyRunResult: stats, bests and wallet', () => {
  it('pays run Snow, mission rewards and the day\'s first-run bonus into the wallet', () => {
    const { save, outcome } = applyRunResult(defaults(1), run(200, { snow: 23, flakes: 12 }), opts());
    // reach-9am (10) + flakes-10 (10) complete; Morning Snow +15.
    expect(outcome.runSnow).toBe(23);
    expect(outcome.missionSnow).toBe(20);
    expect(outcome.bonusSnow).toBe(15);
    expect(outcome.snowEarned).toBe(58);
    expect([outcome.walletBefore, outcome.walletAfter, save.stats.wallet, save.stats.lifetimeSnow]).toEqual([0, 58, 58, 58]);
    expect(save.stats.runs).toBe(1);
    expect(save.stats.flakes).toBe(12);
    expect(save.stats.bestSnowRun).toBe(23);
    expect(outcome.toasts.map((t) => t.text)).toContain('Morning Snow +15');
  });

  it('never mutates its input', () => {
    const s0 = defaults(1);
    const before = JSON.stringify(s0);
    applyRunResult(s0, run(900, { snow: 50, phews: 3 }), opts());
    expect(JSON.stringify(s0)).toBe(before);
  });

  it('counts bests from lifetime run 3 on and never calls the first one new', () => {
    let s = defaults(1);
    for (const m of [300, 900, 1500]) {
      const r = applyRunResult(s, run(m), opts());
      expect(r.outcome.newBest).toBe(false);
      expect(r.save.stats.bestMinutes).toBe(0);
      s = r.save;
    }
    const first = applyRunResult(s, run(300), opts());
    expect(first.outcome.newBest).toBe(false);
    s = first.save;
    expect(s.stats.bestMinutes).toBe(300);
    expect(applyRunResult(s, run(250), opts()).outcome.newBest).toBe(false);
    const better = applyRunResult(s, run(301), opts());
    expect(better.outcome.newBest).toBe(true);
    expect(better.outcome.prevBestMinutes).toBe(300);
    expect(better.save.stats.bestMinutes).toBe(301);
    // Challenge runs count too.
    expect(applyRunResult(s, run(400, {}, { mode: 'challenge' }), opts()).save.stats.bestMinutes).toBe(400);
  });

  it('keeps the first runs\' best apart as an eased best (they never count as a best)', () => {
    let s = defaults(1);
    for (const m of [120, 300, 200]) s = applyRunResult(s, run(m), opts()).save;
    expect(s.stats.bestMinutes).toBe(0);
    expect(s.stats.easedBest).toBe(300);
    s = applyRunResult(s, run(232), opts()).save;
    expect(s.stats.bestMinutes).toBe(232);
    expect(s.stats.easedBest).toBe(300);
  });

  it('keeps daily scores out of the endless best', () => {
    const s = applyRunResult(quiet(), run(400, {}, { mode: 'daily', dailyDate: TODAY }), opts()).save;
    expect(s.stats.bestMinutes).toBe(0);
    expect(s.stats.runs).toBe(BEST_FROM_RUNS + 1);
  });

  it('tracks reached night, days survived, max day, play time and SWINGs', () => {
    const s = applyRunResult(defaults(1), run(1240, { swings: 4 }), opts({ playSeconds: 61.5 })).save;
    expect(s.stats.reachedNight).toBe(true);
    expect(s.stats.daysSurvived).toBe(1);
    expect(s.stats.maxDay).toBe(2);
    expect(s.stats.playSeconds).toBe(61.5);
    expect(s.stats.swings).toBe(4);
  });

  it('marks the forecasts whose noon a run survived', () => {
    const plan: DayPlan[] = [
      { biome: 'oldtown', forecast: 'breezy' },
      { biome: 'meadow', forecast: 'clear' },
      { biome: 'oldtown', forecast: 'heat' },
    ];
    // Day 3 noon is 1440 + 390 = 1830: Breezy (Day 1) counts, Heat (Day 3) not yet.
    const s = applyRunResult(quiet(), run(1829, {}, { plan }), opts()).save;
    expect(s.stats.forecastNoons).toBe(0b0000010);
    expect(applyRunResult(s, run(1830, {}, { plan }), opts()).save.stats.forecastNoons).toBe(0b0001010);
  });
});

describe('comfort, history and pace', () => {
  it('logs finished endless runs with the rung played, capped at 30', () => {
    let s = quiet();
    s.history = history(30, 100);
    s = applyRunResult(s, run(500, { snow: 7 }), opts({ rung: 2 })).save;
    expect(s.history).toHaveLength(30);
    expect(s.history.at(-1)).toEqual({ m: 500, s: 7, r: 2, d: TODAY });
    // Without a rung the run was standard; Daily and challenge runs are never logged.
    expect(applyRunResult(s, run(10), opts()).save.history.at(-1)?.r).toBe(4);
    expect(applyRunResult(s, run(10, {}, { mode: 'daily', dailyDate: TODAY }), opts()).save.history).toEqual(s.history);
    expect(applyRunResult(s, run(10, {}, { mode: 'challenge' }), opts()).save.history).toEqual(s.history);
  });

  it('moves the comfort rung through comfortAfterRun after endless runs only', () => {
    const at = (rung: number, minutes: number, mode: 'endless' | 'daily' = 'endless'): number => {
      const s = quiet();
      s.stats.comfort = rung;
      return applyRunResult(s, run(minutes, {}, { mode, dailyDate: mode === 'daily' ? TODAY : undefined }), opts({ rung })).outcome.comfortAfter;
    };
    // From the tutorial: Day 3 → R3, else 1.
    expect([at(0, 100), at(0, 720), at(0, 1440)]).toEqual([1, 1, 3]);
    // From rung ≥ 1: up past 12:30 PM, down before 11:00 AM, never below 1 or above 4; standard
    // only from R3 (one R3 run past 12:30 PM isn't enough on its own, a Day-3 one is).
    expect([at(2, 390), at(2, 389), at(2, 299), at(2, 300), at(1, 10), at(4, 400), at(3, 400), at(3, 1440)]).toEqual([3, 2, 1, 2, 1, 4, 3, 4]);
    expect(at(2, 1440, 'daily')).toBe(2);
    // The second R3 run in a row past 12:30 PM climbs (the endless run before it is in the history).
    const twice = quiet();
    twice.stats.comfort = 3;
    twice.history = [{ m: 450, s: 0, r: 3, d: TODAY }];
    const climbed = applyRunResult(twice, run(400), opts({ rung: 3 })).save;
    expect(climbed.stats.comfort).toBe(4);
    // The next run is the warm-up, recorded as such; the one after it plays standard rules.
    expect(warmupDue(climbed)).toBe(true);
    const warmed = applyRunResult(climbed, run(320), opts({ rung: 4, warmup: true })).save;
    expect(warmed.history.at(-1)).toEqual({ m: 320, s: 0, r: 4, d: TODAY, w: 1 });
    expect([warmed.stats.comfort, warmupDue(warmed)]).toEqual([4, false]);
    // A rough standard run steps down; back at R3 the climb needs two good runs again.
    const back = applyRunResult(warmed, run(100), opts({ rung: 4 })).save;
    expect(back.stats.comfort).toBe(3);
    const once = applyRunResult(back, run(500), opts({ rung: 3 })).save;
    expect(once.stats.comfort).toBe(3);
    expect(applyRunResult(once, run(420), opts({ rung: 3 })).save.stats.comfort).toBe(4);
    // Adaptive comfort switched off: the rung stays.
    const off = quiet();
    off.stats.comfort = 2;
    off.settings.comfort = false;
    expect(applyRunResult(off, run(900), opts({ rung: 4 })).save.stats.comfort).toBe(2);
  });

  it('says how a run compares with the recent ones', () => {
    const pace = (prev: number[], m: number): string | null => {
      const s = quiet();
      s.history = prev.map((x) => ({ m: x, s: 0, r: 4, d: TODAY }));
      return applyRunResult(s, run(m), opts()).outcome.pace;
    };
    expect(pace([100, 200, 300], 900)).toBeNull();
    expect(pace([100, 200, 300, 400], 900)).toBe('Your best in 5 runs!');
    expect(pace([100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100], 1200)).toBe('Your best in 10 runs!');
    expect(pace([100, 200, 300, 400, 500, 600, 700, 800, 900], 650)).toBe('Better than 6 of your last 10 runs');
    expect(pace([100, 200, 300, 400, 500, 600, 700, 800, 900], 450)).toBe('Below your usual (2:20 PM)');
    expect(pace([1000, 1100, 1200, 1300, 1400], 1000)).toBe('Below your usual (Day 2 · 2:00 PM)');
    expect(pace([100, 200, 300, 400, 500, 600, 700, 800, 900], 500)).toBeNull();
    // Tutorial runs are left out of the window.
    const s = quiet();
    s.history = [{ m: 5000, s: 0, r: 0, d: TODAY }, ...history(4, 100)];
    expect(applyRunResult(s, run(200), opts()).outcome.pace).toBe('Your best in 5 runs!');
    expect(applyRunResult(s, run(200, {}, { mode: 'challenge' }), opts()).outcome.pace).toBeNull();
  });

  it('compares pace only with runs at the same rules, never says "below" right after the ladder moved, and flags it', () => {
    const at = (h: [number, number][], m: number, o: Partial<ApplyRunOptions> = {}) => {
      const s = quiet();
      s.history = h.map(([x, r]) => ({ m: x, s: 0, r, d: TODAY }));
      const out = applyRunResult(s, run(m), opts(o)).outcome;
      return [out.pace, out.paceDown];
    };
    // Nine R2 runs, then the first R4 run: nothing to compare it with yet (no "Below your usual").
    const r2: [number, number][] = [100, 200, 300, 400, 500, 600, 700, 800, 900].map((x) => [x, 2]);
    expect(at(r2, 150, { rung: 4 })).toEqual([null, false]);
    // Five R4 runs among R2 ones: the R4 window only.
    const mixed: [number, number][] = [[2000, 2], [300, 4], [2100, 2], [320, 4], [340, 4], [360, 4], [2200, 2]];
    expect(at(mixed, 400, { rung: 4 })).toEqual(['Your best in 5 runs!', false]);
    // Below the R4 median, but the run before was at R2: the first run after a change says nothing.
    expect(at(mixed, 200, { rung: 4 })).toEqual([null, false]);
    // …and with an R4 run before it, it says so, flagged as a down line.
    expect(at([...mixed, [380, 4]], 200, { rung: 4 })).toEqual(['Below your usual (11:40 AM)', true]);
    // The warm-up is rules of its own.
    expect(at([[300, 4], [320, 4], [340, 4], [360, 4], [380, 4]], 900, { rung: 4, warmup: true })).toEqual([null, false]);
  });

  it('keeps two bests: standard rules (rung 4, challenges) and eased rules (comfort rungs, the warm-up)', () => {
    let s = quiet();
    s.stats.runs = 5;
    // An R2 run sets the eased best (the first one is never "new"); the standard best is untouched.
    let r = applyRunResult(s, run(900), opts({ rung: 2 }));
    expect([r.save.stats.easedBest, r.save.stats.bestMinutes, r.outcome.newBest, r.outcome.bestEased]).toEqual([900, 0, false, true]);
    s = r.save;
    r = applyRunResult(s, run(950), opts({ rung: 3 }));
    expect([r.save.stats.easedBest, r.outcome.newBest, r.outcome.bestEased, r.outcome.prevBestMinutes]).toEqual([950, true, true, 900]);
    s = r.save;
    // A standard run never competes with the eased best.
    r = applyRunResult(s, run(400), opts({ rung: 4 }));
    expect([r.save.stats.bestMinutes, r.save.stats.easedBest, r.outcome.newBest, r.outcome.bestEased]).toEqual([400, 950, false, false]);
    s = r.save;
    r = applyRunResult(s, run(450), opts({ rung: 4 }));
    expect([r.save.stats.bestMinutes, r.outcome.newBest, r.outcome.prevBestMinutes]).toEqual([450, true, 400]);
    // The warm-up is eased; a challenge is standard.
    expect(applyRunResult(r.save, run(1000), opts({ rung: 4, warmup: true })).save.stats).toMatchObject({ bestMinutes: 450, easedBest: 1000 });
    expect(applyRunResult(r.save, run(1000, {}, { mode: 'challenge' }), opts()).save.stats).toMatchObject({ bestMinutes: 1000, easedBest: 950 });
    // The tutorial run (the lesson's Chill floor) never sets the eased best a comfort rung must beat.
    expect(applyRunResult(defaults(1), run(1300), opts({ rung: 0 })).save.stats.easedBest).toBe(0);
  });

  it('knows whether the next endless run is eased (the Title shows that best)', () => {
    const s = quiet();
    s.stats.runs = 0;
    expect(nextRunEased(s)).toBe(true);
    s.stats.runs = 6;
    s.stats.comfort = 2;
    expect(nextRunEased(s)).toBe(true);
    s.stats.comfort = 4;
    s.history = [{ m: 500, s: 0, r: 4, d: TODAY }];
    expect(nextRunEased(s)).toBe(false);
    s.history = [{ m: 500, s: 0, r: 3, d: TODAY }];
    expect(nextRunEased(s)).toBe(true);
    s.settings.comfort = false;
    expect(nextRunEased(s)).toBe(false);
  });

  it('reads the recent best at one set of rules once 3 runs were played at them', () => {
    const s = quiet();
    s.history = [{ m: 2000, s: 0, r: 2, d: TODAY }, ...history(2, 300)];
    expect(recentBestAt(s, 4)).toBe(0);
    s.history.push({ m: 350, s: 0, r: 4, d: TODAY }, { m: 999, s: 0, r: 4, d: TODAY, w: 1 });
    expect(recentBestAt(s, 4)).toBe(350);
    expect(recentBestAt(s, 2)).toBe(0);
    expect(recentBestAt(s, 4, true)).toBe(0);
  });

  it('reads the recent best from the last 10 runs, tutorial runs ignored', () => {
    const s = quiet();
    s.stats.bestMinutes = 2000;
    s.history = history(2, 300);
    expect(recentBest(s)).toBe(2000);
    s.history = [{ m: 900, s: 0, r: 0, d: TODAY }, ...history(2, 300)];
    expect(recentBest(s)).toBe(300);
    s.history = [{ m: 1500, s: 0, r: 4, d: TODAY }, ...history(10, 300)];
    expect(recentBest(s)).toBe(300);
    s.history.push({ m: 640, s: 0, r: 1, d: TODAY });
    expect(recentBest(s)).toBe(640);
    expect(applyRunResult(s, run(10), opts()).outcome.recentBestBefore).toBe(640);
  });

  it('points at the next milestone above the recent best', () => {
    const s = quiet();
    expect(MILESTONES).toEqual([180, 390, 720, 1110, 1440, 1830, 2880, 4320, 6480]);
    for (const [best, next] of [[0, 180], [180, 390], [389, 390], [1500, 1830], [6479, 6480], [6480, null]] as const) {
      s.history = history(3, best);
      expect(nextMilestone(s), String(best)).toBe(next);
    }
  });

  it('picks the next goal: a nearly done mission, a fresh Daily, then the next milestone', () => {
    const s = quiet();
    s.history = history(3, 400);
    s.missions.active = [
      { id: 'flakes-10', progress: 5, done: false, stale: 0 },
      { id: 'two-phews', progress: 0, done: false, stale: 0 },
      { id: 'reach-day-2', progress: 0, done: false, stale: 0 },
    ];
    s.daily[TODAY] = { tries: 1, bestMinutes: 10, bestSnow: 0, glyphs: '' };
    expect(nextGoal(s, TODAY)).toEqual({ text: 'Next: reach Day 2', minutes: 720 });
    s.missions.active[0] = { id: 'flakes-10', progress: 6, done: false, stale: 0 };
    s.missions.active[2] = { id: 'reach-day-2', progress: 500, done: false, stale: 0 };
    expect(nextGoal(s, TODAY)).toEqual({ text: 'So close: Reach Day 2 (best Day 1 · 2:20 PM)', minutes: 720 });
    s.missions.active[2] = { id: 'reach-day-2', progress: 0, done: false, stale: 0 };
    expect(nextGoal(s, TODAY)).toEqual({ text: 'So close: Collect 10 flakes in one run · 6/10', minutes: null });
    // One pair of parentheses at most (the noon mission's label carries its own).
    expect(soCloseText('Survive a noon (reach 12:30 PM)', '11:00 AM')).toBe('So close: Survive a noon · 11:00 AM of 12:30 PM');
    s.missions.active[0] = { id: 'flakes-10', progress: 10, done: true, stale: 0 };
    expect(nextGoal(s, addDays(TODAY, 1))).toEqual({ text: 'Daily #285 is fresh', minutes: null });
    // Not before lifetime run 3.
    s.stats.runs = 2;
    s.daily = {};
    expect(nextGoal(s, TODAY)).toBeNull();
  });
});

describe('bonuses: Morning Snow, Welcome back, Sunny Week', () => {
  it('pays Morning Snow once per date', () => {
    const s = defaults(1);
    const a = applyRunResult(s, run(10), opts());
    const b = applyRunResult(a.save, run(10), opts());
    expect([a.outcome.bonusSnow, b.outcome.bonusSnow]).toEqual([15, 0]);
    expect(applyRunResult(b.save, run(10), opts({ today: addDays(TODAY, 1) })).outcome.bonusSnow).toBe(15);
    expect(b.save.lastPlay).toBe(TODAY);
  });

  it('doubles run Snow after 3 days away, the extra capped at +100', () => {
    const s = quiet();
    s.lastPlay = addDays(TODAY, -3);
    expect(welcomeBackDue(s, TODAY)).toBe(true);
    expect(welcomeBackDue(s, addDays(TODAY, -1))).toBe(false);
    const small = applyRunResult(s, run(10, { snow: 40 }), opts()).outcome;
    expect([small.runSnow, small.bonusSnow]).toEqual([80, 15]);
    expect(small.toasts.map((t) => t.text).slice(0, 2)).toEqual(['Welcome back ×2', 'Morning Snow +15']);
    const big = applyRunResult(s, run(10, { snow: 250 }), opts()).outcome;
    expect(big.runSnow).toBe(350);
    expect(big.snowEarned).toBe(365);
    s.lastPlay = addDays(TODAY, -2);
    expect(applyRunResult(s, run(10, { snow: 40 }), opts()).outcome.runSnow).toBe(40);
    expect(welcomeBackDue(defaults(1), TODAY)).toBe(false);
  });

  it('pays the Sunny Week thresholds once and counts sunny weeks', () => {
    // 2026-10-12 is a Monday.
    let s = quiet();
    const chips: string[] = [];
    for (let i = 0; i < 7; i++) {
      const r = applyRunResult(s, run(10), opts({ today: addDays('2026-10-12', i) }));
      chips.push(...r.outcome.toasts.map((t) => t.text).filter((t) => t.startsWith('Sunny Week')));
      s = r.save;
    }
    expect(chips).toEqual(['Sunny Week: 3 days +30', 'Sunny Week: 5 days +50', 'Sunny Week: 7 days +80']);
    expect(s.week.days).toBe(127);
    expect(s.stats.sunnyWeeks).toBe(0);
    s = applyRunResult(s, run(10), opts({ today: '2026-10-19' })).save;
    expect(s.stats.sunnyWeeks).toBe(1);
    expect(s.week).toEqual({ start: '2026-10-19', days: 1, paid: 0, best: [1, 0, 0, 0, 0, 0, 0] });
  });
});

describe('debug runs (sim-altering URL params)', () => {
  it('earn, unlock and change nothing, and the outcome mirrors the save', () => {
    const save = play(defaults(), run(300, { snow: 12, flakes: 9 }));
    const before = JSON.stringify(save);
    const o = debugRunOutcome(save, run(720 * 6 + 360, { snow: 40, phews: 30, cloudRideBest: 12 }));
    expect(JSON.stringify(save)).toBe(before);
    expect(o.newBest).toBe(false);
    expect([o.snowEarned, o.missionSnow, o.bonusSnow, o.walletBefore, o.walletAfter]).toEqual([0, 0, 0, save.stats.wallet, save.stats.wallet]);
    expect(o.runSnow).toBe(40);
    expect([o.achievementsUnlocked, o.cosmeticsUnlocked, o.toasts, o.missionsCompleted]).toEqual([[], [], [], []]);
    expect(o.missions).toEqual(activeMissionViews(save));
    expect([o.dailyUnlocked, o.pace, o.errand, o.comfortAfter]).toEqual([false, null, null, save.stats.comfort]);
  });
});

describe('missions', () => {
  it('tracks best single-run progress without completing early', () => {
    let s = applyRunResult(defaults(1), run(60, { flakes: 4 }), opts()).save;
    s = applyRunResult(s, run(30, { flakes: 7 }), opts()).save;
    const flakes = s.missions.active.find((m) => m.id === 'flakes-10');
    expect(flakes).toEqual({ id: 'flakes-10', progress: 7, done: false, stale: 0 });
    expect(activeMissionViews(s)[1]?.progressText).toBe('7/10');
    expect(activeMissionViews(s)[0]?.progressText).toBe('7:00 AM');
  });

  it('opens a fresh save with an easy, a medium and a stretch goal', () => {
    expect(defaults(1).missions.active.map((m) => m.id)).toEqual(['reach-9am', 'flakes-10', 'survive-noon']);
    expect(activeMissionViews(defaults(1)).map((v) => v.label)).toEqual([
      'Reach 9:00 AM',
      'Collect 10 flakes in one run',
      'Survive a noon (reach 12:30 PM)',
    ]);
  });

  it('stamps completions and replaces them only at the next run start', () => {
    const { save, outcome } = applyRunResult(defaults(1), run(400, { maxMult: 3 }), opts());
    expect(outcome.missionsCompleted.map((m) => m.id)).toEqual(['reach-9am', 'survive-noon']);
    expect(outcome.missions.map((m) => [m.id, m.done, m.justCompleted])).toEqual([
      ['reach-9am', true, true],
      ['flakes-10', false, false],
      ['survive-noon', true, true],
    ]);
    // Still visible (stamped) until the next run begins.
    expect(save.missions.active.map((m) => m.id)).toEqual(['reach-9am', 'flakes-10', 'survive-noon']);
    const started = beginRun(save);
    expect(started.save.missions.active.map((m) => m.id)).toEqual(['mult-3', 'flakes-10', 'cloud-ride']);
    expect(started.dealt.map((m) => m.label)).toEqual(['Reach a ×3 multiplier', "Ride a cloud's shadow for 3 s straight"]);
    expect(started.save.missions.cursor).toBe(5);
    // Nothing to replace: the same object comes back.
    expect(beginRun(started.save).save).toBe(started.save);
  });

  it('pays each mission once', () => {
    let s = defaults(1);
    const a = applyRunResult(s, run(200), opts());
    s = a.save;
    const b = applyRunResult(s, run(200), opts());
    expect(a.outcome.missionSnow).toBe(10);
    expect(b.outcome.missionSnow).toBe(0);
  });

  it('voids the gazing-ball mission on any glare contact', () => {
    let s = defaults(1);
    s.missions.active[0] = { id: 'clean-balls', progress: 0, done: false, stale: 0 };
    s = applyRunResult(s, run(10, { ballsPassedClean: 6, ballGlared: true }), opts()).save;
    expect(s.missions.active[0]).toEqual({ id: 'clean-balls', progress: 0, done: false, stale: 1 });
    s = applyRunResult(s, run(10, { ballsPassedClean: 4 }), opts()).save;
    expect(s.missions.active[0]?.done).toBe(true);
  });

  it('counts SWINGs for "Land 3 SWINGs in one run"', () => {
    const s = defaults(1);
    s.missions.active[0] = { id: 'swings-3', progress: 0, done: false, stale: 0 };
    expect(applyRunResult(s, run(10, { swings: 2 }), opts()).save.missions.active[0]).toMatchObject({ progress: 2, done: false });
    expect(applyRunResult(s, run(10, { swings: 3 }), opts()).save.missions.active[0]?.done).toBe(true);
  });

  it("measures 'Reach a ×4 multiplier' (hold-x5) by the best multiplier", () => {
    const s = defaults(1);
    s.missions.active[0] = { id: 'hold-x5', progress: 0, done: false, stale: 0 };
    s.missions.active[1] = { id: 'hold-x5@2', progress: 0, done: false, stale: 0 };
    const three = applyRunResult(s, run(10, { maxMult: 3, x5HoldBest: 0 }), opts()).save;
    expect(three.missions.active.slice(0, 2)).toEqual([
      { id: 'hold-x5', progress: 3, done: false, stale: 0 },
      { id: 'hold-x5@2', progress: 3, done: false, stale: 0 },
    ]);
    expect(activeMissionViews(three).slice(0, 2).map((v) => [v.label, v.progressText])).toEqual([
      ['Reach a ×4 multiplier', '×3/×4'],
      ['Reach a ×5 multiplier', '×3/×5'],
    ]);
    const four = applyRunResult(three, run(10, { maxMult: 4 }), opts()).save;
    expect(four.missions.active.slice(0, 2).map((m) => m.done)).toEqual([true, false]);
  });

  it('repeats the pool as tier II with scaled goals and rewards', () => {
    // A strong player (recent best Day 3) completing every tier-I mission at once.
    const all = run(1500, { flakes: 40, maxMult: 5, cloudRideBest: 30, phews: 4, crystals: 2, x5HoldBest: 20, gateNoon: true, ballsPassedClean: 9, swings: 6 });
    let s = defaults(1);
    s.history = history(3, 1500);
    for (let i = 0; i < 5; i++) s = play(s, all);
    // 13 missions in the pool, 3 per lap: the cursor has wrapped once.
    expect(s.missions.tier).toBe(2);
    expect(s.missions.active.map((m) => m.id)).toEqual(['survive-noon@2', 'mult-3@2', 'cloud-ride@2']);
    const views = activeMissionViews(s);
    expect(views.map((v) => v.label)).toEqual([
      "Survive Day 2's noon (reach 12:30 PM)",
      'Reach a ×5 multiplier',
      "Ride a cloud's shadow for 6 s straight",
    ]);
    expect(views.map((v) => v.reward)).toEqual([40, 30, 40]);
    expect(views.map((v) => v.tierLabel)).toEqual(['II', 'II', 'II']);
  });

  it('labels tier II day goals one day later', () => {
    const s = defaults(1);
    s.missions.active = [
      { id: 'reach-9am@2', progress: 0, done: false, stale: 0 },
      { id: 'reach-day-3@2', progress: 0, done: false, stale: 0 },
      { id: 'mult-3@3', progress: 0, done: false, stale: 0 },
    ];
    expect(activeMissionViews(s).map((v) => v.label)).toEqual(['Reach Day 2 · 9:00 AM', 'Reach Day 4', 'Reach a ×5 multiplier']);
    const after = applyRunResult(s, run(900), opts()).save;
    expect(after.missions.active[0]?.done).toBe(true);
    expect(after.missions.active[1]?.done).toBe(false);
  });

  it('cycles through every pool entry exactly once per tier past the skill gates', () => {
    const s = defaults(1);
    s.history = history(3, 1440);
    const seen: string[] = s.missions.active.map((m) => m.id);
    const state = structuredClone(s);
    for (let i = 0; i < MISSIONS.length - 3; i++) {
      state.missions.active[0] = { ...state.missions.active[0]!, done: true };
      const next = beginRun(state).save;
      seen.push(next.missions.active[0]!.id);
      state.missions = next.missions;
    }
    expect(new Set(seen).size).toBe(MISSIONS.length);
    expect(state.missions.tier).toBe(2);
    expect(state.missions.deferred).toEqual([]);
  });
});

describe('achievements and cosmetic unlocks', () => {
  it('unlocks First Light on the first run', () => {
    const { save, outcome } = applyRunResult(defaults(1), run(5), opts());
    expect(outcome.achievementsUnlocked).toEqual(['first-light']);
    expect(save.unlocks.achievements).toEqual(['first-light']);
    expect(outcome.toasts[0]).toEqual({ text: 'Achievement: First Light', icon: 'trophy', tone: 'gold' });
  });

  it('grants the Sun Visor, Crown and Gold scarf with their achievements', () => {
    const { save, outcome } = applyRunResult(defaults(1), run(6 * 720 + 10), opts());
    expect(outcome.achievementsUnlocked).toEqual(['first-light', 'night-owl', 'high-noon', 'solstice', 'seventh-sun']);
    expect(outcome.cosmeticsUnlocked).toEqual(['hat-visor', 'hat-crown', 'scarf-gold']);
    expect(save.unlocks.cosmetics).toContain('scarf-gold');
    expect(itemState(save, 'hat-crown')).toBe('owned');
    expect(outcome.toasts.map((t) => t.text)).toContain('Unlocked: Crown');
  });

  it('High Noon needs 12:30 PM on Day 3', () => {
    const s = defaults(1);
    expect(applyRunResult(s, run(1829), opts()).outcome.achievementsUnlocked).not.toContain('high-noon');
    expect(applyRunResult(s, run(1830), opts()).outcome.achievementsUnlocked).toContain('high-noon');
  });

  it('counts lifetime PHEWs and long cloud rides', () => {
    let s = applyRunResult(defaults(1), run(5, { phews: 20 }), opts()).save;
    const r = applyRunResult(s, run(5, { phews: 5, cloudRideBest: 10.2 }), opts());
    expect(r.outcome.achievementsUnlocked).toEqual(['phew-nomenal', 'cloud-rider']);
    s = r.save;
    expect(applyRunResult(s, run(5, { phews: 5 }), opts()).outcome.achievementsUnlocked).toEqual([]);
  });

  it('Daily Habit needs 7 different dailies', () => {
    let s = defaults(1);
    for (let i = 0; i < 7; i++) {
      const date = addDays(TODAY, -i);
      s = dailyTryStarted(s, date).save;
      s = dailyTryStarted(s, date).save; // a second try on the same date doesn't count twice
    }
    expect(s.stats.dailyDaysPlayed).toBe(7);
    const r = applyRunResult(s, run(10, {}, { mode: 'daily', dailyDate: TODAY }), opts({ dailyTry: 2 }));
    expect(r.outcome.achievementsUnlocked).toContain('daily-habit');
  });

  it('checks the eight v1.1 feats and grants their items', () => {
    const got = (r: RunResult, o: Partial<ApplyRunOptions> = {}, s: Save = quiet()): string[] => {
      s.unlocks.achievements = ['first-light'];
      return applyRunResult(s, r, opts(o)).outcome.achievementsUnlocked;
    };
    expect(got(run(10, { swingChainBest: 2 }))).toEqual([]);
    expect(got(run(10, { swingChainBest: 3 }))).toEqual(['sundancer']);
    expect(got(run(1240, {}, { mode: 'challenge' }), { challengeTarget: 1240 })).toContain('rematch');
    expect(got(run(1239, {}, { mode: 'challenge' }), { challengeTarget: 1240 })).not.toContain('rematch');
    expect(got(run(1300), { challengeTarget: 1240 })).not.toContain('rematch');
    expect(got(run(10, { phews: 1, phewMinChill: 4.9 }))).toEqual(['close-shave']);
    expect(got(run(10, { phews: 1, phewMinChill: 5 }))).toEqual([]);
    expect(got(run(10, { ballsPassedClean: 10 }))).toEqual(['glare-proof']);
    expect(got(run(10, { ballsPassedClean: 12, ballGlared: true }))).toEqual([]);
    expect(got(run(10, { flowers: 30 }))).toEqual(['night-gardener']);
    const cold = run(800);
    cold.hourGlyphs[0] = [...Array<HourGlyph>(9).fill('cool'), 'warm', 'hot', 'warm'];
    const r = applyRunResult(quiet(), cold, opts());
    expect(r.outcome.achievementsUnlocked).toContain('ice-cold');
    expect(r.outcome.cosmeticsUnlocked).toEqual(['nose-icicle']);
    const forecaster = quiet();
    forecaster.stats.forecastNoons = 0b0001110;
    const plan: DayPlan[] = [{ biome: 'meadow', forecast: 'long' }];
    expect(got(run(400, {}, { plan }), {}, forecaster)).toContain('forecaster');
    // Sunny Week: a finished run on every day of one week.
    const week = quiet();
    week.week = { start: '2026-10-12', days: 0b0111111, paid: 0b011, best: [1, 1, 1, 1, 1, 1, 0] };
    const sunny = applyRunResult(week, run(10), opts({ today: '2026-10-18' }));
    expect(sunny.outcome.achievementsUnlocked).toContain('sunny-week');
    expect(sunny.outcome.cosmeticsUnlocked).toContain('scarf-aurora');
  });

  it('announces the Daily unlock on run 3 and nudges when an item becomes affordable', () => {
    let s = quiet(0);
    s = applyRunResult(s, run(5, { snow: 20 }), opts()).save;
    s = applyRunResult(s, run(5, { snow: 20 }), opts()).save;
    expect(isDailyUnlocked(s)).toBe(false);
    const r = applyRunResult(s, run(5, { snow: 30 }), opts());
    expect(r.outcome.dailyUnlocked).toBe(true);
    expect(r.outcome.toasts.map((t) => t.text)).toEqual(['Daily Solstice unlocked!', 'You can afford the Mint Scarf!']);
  });

  it('no longer unlocks the Daily early after the first night', () => {
    const r = applyRunResult(defaults(1), run(800), opts());
    expect(r.save.stats.reachedNight).toBe(true);
    expect(r.save.stats.runs).toBe(1);
    expect(r.outcome.dailyUnlocked).toBe(false);
    expect(isDailyUnlocked(r.save)).toBe(false);
    expect(r.outcome.toasts.map((t) => t.text)).not.toContain('Daily Solstice unlocked!');
  });

  it('unlocks the Daily on the 3rd completed run, whatever the runs reached', () => {
    let s = defaults(1);
    s = applyRunResult(s, run(900), opts()).save;
    s = applyRunResult(s, run(1500), opts()).save;
    expect(s.stats.runs).toBe(2);
    expect(isDailyUnlocked(s)).toBe(false);
    const third = applyRunResult(s, run(5), opts());
    expect(third.save.stats.runs).toBe(3);
    expect(isDailyUnlocked(third.save)).toBe(true);
    expect(third.outcome.dailyUnlocked).toBe(true);
    expect(third.outcome.toasts.map((t) => t.text)).toContain('Daily Solstice unlocked!');
    // Never announced twice.
    expect(applyRunResult(third.save, run(5), opts()).outcome.dailyUnlocked).toBe(false);
  });

  it('keeps the Daily unlocked for saves that already played one', () => {
    const s = defaults(1);
    s.stats.runs = 1;
    s.stats.reachedNight = true;
    expect(isDailyUnlocked(s)).toBe(false);
    s.daily[TODAY] = { tries: 1, bestMinutes: 300, bestSnow: 4, glyphs: '' };
    expect(isDailyUnlocked(s)).toBe(true);
  });
});

describe('daily tries', () => {
  it('counts tries at 6:30 AM, then switches to practice after 3', () => {
    let s = defaults(1);
    const tries: (number | null)[] = [];
    for (let i = 0; i < 4; i++) {
      const r = dailyTryStarted(s, TODAY);
      tries.push(r.tryNumber);
      s = r.save;
    }
    expect(tries).toEqual([1, 2, 3, null]);
    expect(s.daily[TODAY]?.tries).toBe(3);
    expect(s.stats.dailyDaysPlayed).toBe(1);
    const status = dailyStatus(s, TODAY);
    expect(status).toMatchObject({ number: 284, tries: 3, scored: false, played: true, par: null });
  });

  it('stores Snowbot\'s par for the latest 14 dates', () => {
    let s = defaults(1);
    for (let i = 0; i < 16; i++) s = setDailyPar(s, addDays(TODAY, i - 15), 300 + i);
    expect(Object.keys(s.pars)).toHaveLength(14);
    expect(dailyStatus(s, TODAY).par).toBe(315);
    expect(dailyStatus(s, addDays(TODAY, -15)).par).toBeNull();
    expect(setDailyPar(s, TODAY, 315)).toBe(s);
  });

  it('stores the checkpoint strip with a new best, in applyRunResult\'s format', () => {
    let s = defaults(1);
    s.daily[TODAY] = { tries: 1, bestMinutes: 120, bestSnow: 3, glyphs: 'old try 1 strip' };
    s = dailyTryStarted(s, TODAY).save;
    expect(s.daily[TODAY]?.tries).toBe(2);
    const strip = { hourGlyphs: [Array<HourGlyph>(12).fill('cool'), ['cool', 'warm', 'hot'] as HourGlyph[]], assisted: true };
    const next = dailyProgress(s, TODAY, 900, 40, strip);
    expect(next.daily[TODAY]).toEqual({
      tries: 2,
      bestMinutes: 900,
      bestSnow: 40,
      glyphs: dayStripLines(strip.hourGlyphs, strip.assisted).join('\n'),
    });
    expect(next.daily[TODAY]?.glyphs.split('\n')).toHaveLength(2);
    // Not a new best: the stored strip stays.
    expect(dailyProgress(next, TODAY, 600, 90, { hourGlyphs: [['melt']], assisted: false })).toBe(next);
    // Without a strip the old glyphs are kept (callers that predate the strip argument).
    expect(dailyProgress(s, TODAY, 900, 40).daily[TODAY]?.glyphs).toBe('old try 1 strip');
  });

  it('saves hourly progress for scored tries only', () => {
    const s0 = defaults(1);
    expect(dailyProgress(s0, TODAY, 300, 5)).toBe(s0);
    const s1 = dailyTryStarted(s0, TODAY).save;
    const s2 = dailyProgress(s1, TODAY, 300, 5);
    expect(s2.daily[TODAY]).toMatchObject({ tries: 1, bestMinutes: 300, bestSnow: 5 });
    expect(dailyProgress(s2, TODAY, 240, 9)).toBe(s2);
  });

  it('records the best try with its glyph strip at run end', () => {
    let s = dailyTryStarted(defaults(1), TODAY).save;
    const daily = run(1240, { snow: 40 }, { mode: 'daily', dailyDate: TODAY });
    s = applyRunResult(s, daily, opts({ dailyTry: 1 })).save;
    const e = s.daily[TODAY]!;
    expect(e.bestMinutes).toBe(1240);
    expect(e.bestSnow).toBe(40);
    expect(e.glyphs.split('\n')).toHaveLength(2);
    expect(e.glyphs.endsWith('\u{1F4A7}')).toBe(true);
    // A worse later try keeps the best.
    s = dailyTryStarted(s, TODAY).save;
    s = applyRunResult(s, run(100, {}, { mode: 'daily', dailyDate: TODAY }), opts({ dailyTry: 2 })).save;
    expect(s.daily[TODAY]?.bestMinutes).toBe(1240);
  });

  it('ignores practice runs for the daily best', () => {
    const s = applyRunResult(defaults(1), run(900, {}, { mode: 'daily', dailyDate: TODAY }), opts({ dailyTry: null })).save;
    expect(s.daily[TODAY]).toBeUndefined();
  });
});

describe('wardrobe', () => {
  function rich(wallet: number): Save {
    const s = defaults(1);
    s.stats.wallet = wallet;
    return s;
  }

  it('buys, deducts and auto-equips', () => {
    const r = buyCosmetic(rich(100), 'scarf-mint');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.save.stats.wallet).toBe(40);
    expect(r.save.equipped.scarf).toBe('scarf-mint');
    expect(itemState(r.save, 'scarf-mint')).toBe('equipped');
    expect(itemState(r.save, 'scarf-red')).toBe('owned');
  });

  it('buys and equips Sun Shades in their own slot', () => {
    expect(itemState(rich(0), 'shades-classic')).toBe('equipped');
    expect(itemState(rich(119), 'shades-round')).toBe('expensive');
    expect(itemState(rich(0), 'shades-star')).toBe('locked');
    const r = buyCosmetic(rich(300), 'shades-aviator');
    if (!r.ok) throw new Error('expected purchase');
    expect(r.save.equipped).toEqual({ scarf: 'scarf-red', hat: 'hat-none', nose: 'nose-carrot', shades: 'shades-aviator' });
    expect(itemState(r.save, 'shades-classic')).toBe('owned');
    const back = equipCosmetic(r.save, 'shades-classic');
    expect(back.ok && back.save.equipped.shades).toBe('shades-classic');
  });

  it('refuses unaffordable, owned and achievement items', () => {
    expect(buyCosmetic(rich(59), 'scarf-mint')).toEqual({ ok: false, reason: 'poor' });
    expect(buyCosmetic(rich(999), 'scarf-red')).toEqual({ ok: false, reason: 'owned' });
    expect(buyCosmetic(rich(9999), 'hat-crown')).toEqual({ ok: false, reason: 'locked' });
    expect(itemState(rich(59), 'scarf-mint')).toBe('expensive');
    expect(itemState(rich(60), 'scarf-mint')).toBe('buyable');
    expect(itemState(rich(9999), 'hat-crown')).toBe('locked');
  });

  it('equips owned items only', () => {
    expect(equipCosmetic(rich(0), 'hat-beanie')).toEqual({ ok: false, reason: 'notOwned' });
    const bought = buyCosmetic(rich(200), 'hat-beanie');
    if (!bought.ok) throw new Error('expected purchase');
    const r = equipCosmetic(bought.save, 'hat-none');
    expect(r.ok && r.save.equipped.hat).toBe('hat-none');
  });
});

describe('misc', () => {
  it('reset keeps settings and device flags', () => {
    const s = applyRunResult(defaults(1), run(900, { snow: 99 }), opts()).save;
    s.settings.music = 0.1;
    s.settings.name = 'Sam';
    s.flags.installSheetShown = true;
    const r = resetProgress(s, 5);
    expect(r.stats.runs).toBe(0);
    expect(r.stats.wallet).toBe(0);
    expect(r.history).toEqual([]);
    expect(r.settings.music).toBe(0.1);
    expect(r.settings.name).toBe('Sam');
    expect(r.flags.installSheetShown).toBe(true);
    expect(r.createdAt).toBe(5);
  });

  it('gates the install and restore sheets by browser, display mode and runs', () => {
    const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
    const CRIOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.6668.69 Mobile/15E148 Safari/604.1';
    const FBAN = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/482.0.0.40.104;FBBV/650000000]';
    expect([SAFARI, CRIOS, FBAN].map((ua) => isInAppBrowser(ua))).toEqual([false, false, true]);
    expect(isInAppBrowser('Mozilla/5.0 (Linux; Android 14) Instagram 300.0')).toBe(true);
    expect(isInAppBrowser('Mozilla/5.0 (iPhone) GSA/300.0.0 Mobile/15E148 Safari/604.1')).toBe(true);
    const save = (runs: number): Save => {
      const s = defaults(1);
      s.stats.runs = runs;
      return s;
    };
    for (const ua of [SAFARI, CRIOS, FBAN]) {
      const inApp = isInAppBrowser(ua);
      for (const standalone of [false, true]) {
        for (const runs of [0, 5]) {
          const env = { ios: true, standalone, inApp };
          expect(shouldShowInstallSheet(save(runs), env), `install ${ua.slice(-20)} ${standalone} ${runs}`).toBe(!inApp && !standalone && runs === 5);
          expect(shouldOfferRestoreSheet(save(runs), env), `restore ${standalone} ${runs}`).toBe(standalone && runs === 0);
        }
      }
    }
    expect(shouldOfferRestoreSheet(save(0), { ios: false, standalone: true })).toBe(false);
  });

  it('offers the iOS install sheet once after run 3 when not standalone', () => {
    const s = defaults(1);
    s.stats.runs = 3;
    expect(shouldShowInstallSheet(s, { ios: true, standalone: false })).toBe(true);
    expect(shouldShowInstallSheet(s, { ios: true, standalone: true })).toBe(false);
    expect(shouldShowInstallSheet(s, { ios: false, standalone: false })).toBe(false);
    s.flags.installSheetShown = true;
    expect(shouldShowInstallSheet(s, { ios: true, standalone: false })).toBe(false);
  });
});

describe('Journey levels (CAMPAIGN_PLAN §5)', () => {
  /** A finished Journey level: `passed` with `stars`, melted or short of the goal otherwise. */
  const level = (id: number, passed: boolean, stars: number, over: Partial<Stats> = {}): RunResult =>
    run(360, { flakes: 12, snow: 30, ...over }, { mode: 'campaign', level: { id, passed, stars, introduces: null } });

  it('pays the run Snow plus the first-pass bonus (id × 2), once', () => {
    const first = applyRunResult(quiet(), level(6, true, 2), opts());
    expect(first.outcome.bonusSnow).toBe(12);
    expect(first.outcome.snowEarned).toBe(30 + 12 + first.outcome.missionSnow);
    expect(first.outcome.toasts.map((t) => t.text)).toContain('First pass +12');
    expect(first.outcome.campaign).toEqual({ passed: true, stars: 2, newStars: 2, unlockedNext: true });
    const again = applyRunResult(first.save, level(6, true, 3), opts());
    expect(again.outcome.bonusSnow).toBe(0);
    expect(again.outcome.toasts.map((t) => t.text)).not.toContain('First pass +12');
    expect(again.outcome.campaign).toEqual({ passed: true, stars: 3, newStars: 1, unlockedNext: false });
  });

  it('keeps the best stars, unlocks the next level on a pass and remembers the last level', () => {
    let s = applyRunResult(quiet(), level(1, true, 3), opts()).save;
    expect(s.campaign.stars[0]).toBe(3);
    expect(s.campaign.unlocked).toBe(2);
    expect(s.campaign.lastLevel).toBe(1);
    s = applyRunResult(s, level(1, true, 1), opts()).save;
    expect(s.campaign.stars[0]).toBe(3);
    // A failed level: no stars, nothing unlocked, no bonus, but it was played.
    const fail = applyRunResult(s, level(2, false, 0, { snow: 9 }), opts());
    expect(fail.save.campaign.stars[1]).toBe(0);
    expect(fail.save.campaign.unlocked).toBe(2);
    expect(fail.save.campaign.lastLevel).toBe(2);
    expect(fail.outcome.bonusSnow).toBe(0);
    expect(fail.outcome.runSnow).toBe(9);
    expect(fail.outcome.campaign).toEqual({ passed: false, stars: 0, newStars: 0, unlockedNext: false });
    // Playing ahead (the testing toggle) never locks what was unlocked, and stars clamp to 1..3.
    const ahead = applyRunResult(fail.save, level(40, true, 9), opts()).save;
    expect(ahead.campaign.unlocked).toBe(41);
    expect(ahead.campaign.stars[39]).toBe(3);
    expect(applyRunResult(ahead, level(200, true, 0), opts()).save.campaign.unlocked).toBe(201);
    // Level 0 or 999 is ignored.
    expect(applyRunResult(ahead, level(999, true, 3), opts()).save.campaign).toEqual(ahead.campaign);
  });

  it('never touches the history, the comfort ladder or the bests', () => {
    const base = quiet(10);
    base.stats.comfort = 2;
    base.stats.bestMinutes = 100;
    const { save, outcome } = applyRunResult(base, level(3, true, 3, { minutes: 700 }), opts({ rung: 4 }));
    expect(save.history).toEqual([]);
    expect(save.stats.comfort).toBe(2);
    expect(save.stats.bestMinutes).toBe(100);
    expect(save.stats.easedBest).toBe(0);
    expect(outcome.newBest).toBe(false);
    expect(outcome.pace).toBeNull();
    // It still counts as a run: missions progress, the lifetime counters and Morning Snow apply.
    expect(save.stats.runs).toBe(11);
    expect(save.stats.flakes).toBe(12);
    expect(outcome.missions.some((m) => m.fraction > 0)).toBe(true);
  });

  it('leaves the Journey alone on every other mode', () => {
    const { save, outcome } = applyRunResult(quiet(), run(400), opts());
    expect(save.campaign).toEqual(quiet().campaign);
    expect(outcome.campaign).toBeUndefined();
  });

  it('unlocks First Steps, Halfway There and Starry Road', () => {
    let s = quiet();
    for (let id = 1; id <= 9; id++) s = applyRunResult(s, level(id, true, 3), opts()).save;
    expect(s.unlocks.achievements).not.toContain('journey-10');
    const ten = applyRunResult(s, level(10, true, 3), opts());
    expect(ten.outcome.achievementsUnlocked).toEqual(['journey-10']);
    expect(ten.outcome.cosmeticsUnlocked).toEqual([]);
    s = ten.save;
    for (let id = 11; id <= 19; id++) s = applyRunResult(s, level(id, true, 3), opts()).save;
    // 19 levels at three stars, then the 20th.
    expect(s.unlocks.achievements).not.toContain('three-star-20');
    s = applyRunResult(s, level(20, true, 3), opts()).save;
    expect(s.unlocks.achievements).toContain('three-star-20');
    s.campaign.stars = s.campaign.stars.map((n, i) => (i < 99 ? Math.max(1, n) : n));
    expect(applyRunResult(s, level(100, true, 1), opts()).outcome.achievementsUnlocked).toEqual(['journey-100']);
    // A gap (the testing toggle skipped a level) holds First Steps back.
    const gap = quiet();
    gap.campaign.stars = gap.campaign.stars.map((_n, i) => (i < 10 && i !== 4 ? 1 : 0));
    expect(applyRunResult(gap, level(10, true, 3), opts()).outcome.achievementsUnlocked).toEqual([]);
  });

  it('knows which levels are playable, the total stars and where Continue leads', () => {
    const s = defaults(1);
    expect(CAMPAIGN_STARS_MAX).toBe(600);
    expect(isLevelPlayable(s, 1)).toBe(true);
    expect(isLevelPlayable(s, 2)).toBe(false);
    expect(isLevelPlayable(s, 0)).toBe(false);
    expect(isLevelPlayable(s, 201)).toBe(false);
    expect(continueLevel(s)).toBe(1);
    expect(totalStars(s)).toBe(0);
    s.campaign.unlocked = 38;
    s.campaign.stars[0] = 3;
    s.campaign.stars[36] = 2;
    expect(isLevelPlayable(s, 38)).toBe(true);
    expect(isLevelPlayable(s, 39)).toBe(false);
    expect(continueLevel(s)).toBe(38);
    expect(totalStars(s)).toBe(5);
    s.settings.unlockAll = true;
    expect(isLevelPlayable(s, 200)).toBe(true);
    expect(isLevelPlayable(s, 201)).toBe(false);
    expect(continueLevel(s)).toBe(38);
    s.campaign.unlocked = 201;
    expect(continueLevel(s)).toBe(200);
  });
});
