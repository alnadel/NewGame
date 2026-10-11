import { describe, expect, it } from 'vitest';
import type { HourGlyph, RunResult, RunStats } from '../../src/core/sim/events.ts';
import type { SaveV1 } from '../../src/meta/saveTypes.ts';
import { defaults } from '../../src/meta/save.ts';
import { MISSIONS } from '../../src/meta/content.ts';
import { addDays } from '../../src/meta/daily.ts';
import {
  activeMissionViews,
  applyRunResult,
  beginRun,
  buyCosmetic,
  dailyProgress,
  dailyStatus,
  dailyTryStarted,
  debugRunOutcome,
  equipCosmetic,
  isDailyUnlocked,
  itemState,
  resetProgress,
  shouldShowInstallSheet,
} from '../../src/meta/progression.ts';

const TODAY = '2026-10-11';

function stats(over: Partial<RunStats> = {}): RunStats {
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
    ...over,
  };
}

function run(minutes: number, over: Partial<RunStats> = {}, extra: Partial<RunResult> = {}): RunResult {
  const day = Math.floor(minutes / 720) + 1;
  const glyphs: HourGlyph[][] = [];
  for (let d = 1; d < day; d++) glyphs.push(Array<HourGlyph>(12).fill('cool'));
  glyphs.push([...Array<HourGlyph>(Math.floor((minutes % 720) / 60)).fill('warm'), 'melt']);
  return {
    mode: 'endless',
    seed: 42,
    profile: 3,
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

/** Plays a run and immediately starts the next one (mission replacement). */
function play(save: SaveV1, result: RunResult, dailyTry?: number | null): SaveV1 {
  const after = applyRunResult(save, result, { today: TODAY, dailyTry }).save;
  return beginRun(after).save;
}

describe('applyRunResult: stats, bests and wallet', () => {
  it('pays run Snow plus mission rewards into the wallet', () => {
    const s0 = defaults(1);
    const { save, outcome } = applyRunResult(s0, run(200, { snow: 23, flakes: 12 }), { today: TODAY });
    // reach-9am (10) + flakes-10 (10) complete.
    expect(outcome.runSnow).toBe(23);
    expect(outcome.missionSnow).toBe(20);
    expect(outcome.snowEarned).toBe(43);
    expect(outcome.walletBefore).toBe(0);
    expect(outcome.walletAfter).toBe(43);
    expect(save.stats.wallet).toBe(43);
    expect(save.stats.lifetimeSnow).toBe(43);
    expect(save.stats.runs).toBe(1);
    expect(save.stats.flakes).toBe(12);
    expect(save.stats.bestSnowRun).toBe(23);
  });

  it('never mutates its input', () => {
    const s0 = defaults(1);
    const before = JSON.stringify(s0);
    applyRunResult(s0, run(900, { snow: 50, phews: 3 }), { today: TODAY });
    expect(JSON.stringify(s0)).toBe(before);
  });

  it('reports NEW BEST only when a previous best is beaten', () => {
    let s = defaults(1);
    const first = applyRunResult(s, run(300), { today: TODAY });
    expect(first.outcome.newBest).toBe(false);
    s = first.save;
    expect(s.stats.bestMinutes).toBe(300);
    expect(applyRunResult(s, run(250), { today: TODAY }).outcome.newBest).toBe(false);
    const third = applyRunResult(s, run(301), { today: TODAY });
    expect(third.outcome.newBest).toBe(true);
    expect(third.outcome.prevBestMinutes).toBe(300);
    expect(third.save.stats.bestMinutes).toBe(301);
  });

  it('keeps daily scores out of the endless best', () => {
    const s = applyRunResult(defaults(1), run(400, {}, { mode: 'daily', dailyDate: TODAY }), { today: TODAY }).save;
    expect(s.stats.bestMinutes).toBe(0);
    expect(s.stats.runs).toBe(1);
  });

  it('tracks reached night, days survived and max day', () => {
    const s = applyRunResult(defaults(1), run(1240), { today: TODAY }).save;
    expect(s.stats.reachedNight).toBe(true);
    expect(s.stats.daysSurvived).toBe(1);
    expect(s.stats.maxDay).toBe(2);
  });
});

describe('debug runs (sim-altering URL params)', () => {
  it('earn, unlock and change nothing, and the outcome mirrors the save', () => {
    const save = play(defaults(), run(300, { snow: 12, flakes: 9 }));
    const before = JSON.stringify(save);
    const o = debugRunOutcome(save, run(720 * 6 + 360, { snow: 40, phews: 30, cloudRideBest: 12 }));
    expect(JSON.stringify(save)).toBe(before);
    expect(o.newBest).toBe(false);
    expect([o.snowEarned, o.missionSnow, o.walletBefore, o.walletAfter]).toEqual([0, 0, save.stats.wallet, save.stats.wallet]);
    expect(o.runSnow).toBe(40);
    expect([o.achievementsUnlocked, o.cosmeticsUnlocked, o.toasts, o.missionsCompleted]).toEqual([[], [], [], []]);
    expect(o.missions).toEqual(activeMissionViews(save));
    expect(o.dailyUnlocked).toBe(false);
  });
});

describe('missions', () => {
  it('tracks best single-run progress without completing early', () => {
    let s = applyRunResult(defaults(1), run(60, { flakes: 4 }), { today: TODAY }).save;
    s = applyRunResult(s, run(30, { flakes: 7 }), { today: TODAY }).save;
    const flakes = s.missions.active.find((m) => m.id === 'flakes-10');
    expect(flakes).toEqual({ id: 'flakes-10', progress: 7, done: false });
    expect(activeMissionViews(s)[1]?.progressText).toBe('7/10');
    expect(activeMissionViews(s)[0]?.progressText).toBe('7:00 AM');
  });

  it('stamps completions and replaces them only at the next run start', () => {
    const { save, outcome } = applyRunResult(defaults(1), run(185, { maxMult: 3 }), { today: TODAY });
    expect(outcome.missionsCompleted.map((m) => m.id)).toEqual(['reach-9am', 'mult-3']);
    expect(outcome.missions.map((m) => [m.id, m.done, m.justCompleted])).toEqual([
      ['reach-9am', true, true],
      ['flakes-10', false, false],
      ['mult-3', true, true],
    ]);
    // Still visible (stamped) until the next run begins.
    expect(save.missions.active.map((m) => m.id)).toEqual(['reach-9am', 'flakes-10', 'mult-3']);
    const started = beginRun(save);
    expect(started.save.missions.active.map((m) => m.id)).toEqual(['survive-noon', 'flakes-10', 'cloud-ride']);
    expect(started.dealt.map((m) => m.label)).toEqual([
      'Survive a noon (reach 12:30 PM)',
      "Ride a cloud's shadow for 3\u00A0s straight",
    ]);
    expect(started.save.missions.cursor).toBe(5);
    // Nothing to replace: the same object comes back.
    expect(beginRun(started.save).save).toBe(started.save);
  });

  it('pays each mission once', () => {
    let s = defaults(1);
    const a = applyRunResult(s, run(200), { today: TODAY });
    s = a.save;
    const b = applyRunResult(s, run(200), { today: TODAY });
    expect(a.outcome.missionSnow).toBe(10);
    expect(b.outcome.missionSnow).toBe(0);
  });

  it('voids the gazing-ball mission on any glare contact', () => {
    let s = defaults(1);
    s.missions.active[0] = { id: 'clean-balls', progress: 0, done: false };
    s = applyRunResult(s, run(10, { ballsPassedClean: 6, ballGlared: true }), { today: TODAY }).save;
    expect(s.missions.active[0]).toEqual({ id: 'clean-balls', progress: 0, done: false });
    s = applyRunResult(s, run(10, { ballsPassedClean: 4 }), { today: TODAY }).save;
    expect(s.missions.active[0]?.done).toBe(true);
  });

  it("completes \"Play today's Daily\" only with today's daily", () => {
    const s = defaults(1);
    s.missions.active[0] = { id: 'play-daily', progress: 0, done: false };
    const other = run(10, {}, { mode: 'daily', dailyDate: '2026-10-10' });
    expect(applyRunResult(s, other, { today: TODAY }).save.missions.active[0]?.done).toBe(false);
    const today = run(10, {}, { mode: 'daily', dailyDate: TODAY });
    expect(applyRunResult(s, today, { today: TODAY }).save.missions.active[0]?.done).toBe(true);
  });

  it('repeats the pool as tier II with scaled goals and rewards', () => {
    // A run that completes every tier-I mission at once.
    const all = run(1500, {
      flakes: 40,
      maxMult: 5,
      cloudRideBest: 30,
      phews: 4,
      crystals: 2,
      x5HoldBest: 20,
      gateNoon: true,
      ballsPassedClean: 9,
    });
    const daily = { ...all, mode: 'daily' as const, dailyDate: TODAY };
    let s = defaults(1);
    for (let i = 0; i < 5; i++) s = play(s, i === 4 ? daily : all);
    // 13 missions in the pool, 3 per lap: the cursor has wrapped once.
    expect(s.missions.tier).toBe(2);
    const ids = s.missions.active.map((m) => m.id);
    expect(ids.every((id) => id.endsWith('@2'))).toBe(true);
    const views = activeMissionViews(s);
    expect(views.map((v) => v.label)).toEqual([
      'Reach a ×5 multiplier',
      "Survive Day 2's noon (reach 12:30 PM)",
      "Ride a cloud's shadow for 6\u00A0s straight",
    ]);
    expect(views.map((v) => v.reward)).toEqual([30, 40, 40]);
    expect(views.map((v) => v.tierLabel)).toEqual(['II', 'II', 'II']);
  });

  it('labels tier II day goals one day later', () => {
    const s = defaults(1);
    s.missions.active = [
      { id: 'reach-9am@2', progress: 0, done: false },
      { id: 'reach-day-3@2', progress: 0, done: false },
      { id: 'mult-3@3', progress: 0, done: false },
    ];
    expect(activeMissionViews(s).map((v) => v.label)).toEqual([
      'Reach Day 2 · 9:00 AM',
      'Reach Day 4',
      'Reach a ×5 multiplier',
    ]);
    const after = applyRunResult(s, run(900), { today: TODAY }).save;
    expect(after.missions.active[0]?.done).toBe(true);
    expect(after.missions.active[1]?.done).toBe(false);
  });

  it('cycles through every pool entry exactly once per tier', () => {
    const s = defaults(1);
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
  });
});

describe('achievements and cosmetic unlocks', () => {
  it('unlocks First Light on the first run', () => {
    const { save, outcome } = applyRunResult(defaults(1), run(5), { today: TODAY });
    expect(outcome.achievementsUnlocked).toEqual(['first-light']);
    expect(save.unlocks.achievements).toEqual(['first-light']);
    expect(outcome.toasts[0]).toEqual({ text: 'Achievement: First Light', icon: 'trophy', tone: 'gold' });
  });

  it('grants the Sun Visor, Crown and Gold scarf with their achievements', () => {
    const { save, outcome } = applyRunResult(defaults(1), run(6 * 720 + 10), { today: TODAY });
    expect(outcome.achievementsUnlocked).toEqual(['first-light', 'night-owl', 'high-noon', 'solstice', 'seventh-sun']);
    expect(outcome.cosmeticsUnlocked).toEqual(['hat-visor', 'hat-crown', 'scarf-gold']);
    expect(save.unlocks.cosmetics).toContain('scarf-gold');
    expect(itemState(save, 'hat-crown')).toBe('owned');
    expect(outcome.toasts.map((t) => t.text)).toContain('Unlocked: Crown');
  });

  it('High Noon needs 12:30 PM on Day 3', () => {
    const s = defaults(1);
    expect(applyRunResult(s, run(1829), { today: TODAY }).outcome.achievementsUnlocked).not.toContain('high-noon');
    expect(applyRunResult(s, run(1830), { today: TODAY }).outcome.achievementsUnlocked).toContain('high-noon');
  });

  it('counts lifetime PHEWs and long cloud rides', () => {
    let s = applyRunResult(defaults(1), run(5, { phews: 20 }), { today: TODAY }).save;
    const r = applyRunResult(s, run(5, { phews: 5, cloudRideBest: 10.2 }), { today: TODAY });
    expect(r.outcome.achievementsUnlocked).toEqual(['phew-nomenal', 'cloud-rider']);
    s = r.save;
    expect(applyRunResult(s, run(5, { phews: 5 }), { today: TODAY }).outcome.achievementsUnlocked).toEqual([]);
  });

  it('Daily Habit needs 7 different dailies', () => {
    let s = defaults(1);
    for (let i = 0; i < 7; i++) {
      const date = addDays(TODAY, -i);
      s = dailyTryStarted(s, date).save;
      s = dailyTryStarted(s, date).save; // a second try on the same date doesn't count twice
    }
    expect(s.stats.dailyDaysPlayed).toBe(7);
    const r = applyRunResult(s, run(10, {}, { mode: 'daily', dailyDate: TODAY }), { today: TODAY, dailyTry: 2 });
    expect(r.outcome.achievementsUnlocked).toContain('daily-habit');
  });

  it('announces the Daily unlock on run 3 and nudges when an item becomes affordable', () => {
    let s = defaults(1);
    s = applyRunResult(s, run(5, { snow: 20 }), { today: TODAY }).save;
    s = applyRunResult(s, run(5, { snow: 20 }), { today: TODAY }).save;
    expect(isDailyUnlocked(s)).toBe(false);
    const r = applyRunResult(s, run(5, { snow: 30 }), { today: TODAY });
    expect(r.outcome.dailyUnlocked).toBe(true);
    expect(r.outcome.toasts.map((t) => t.text)).toEqual(['Daily Solstice unlocked!', 'You can afford the Mint Scarf!']);
  });

  it('unlocks the Daily early after the first night', () => {
    const r = applyRunResult(defaults(1), run(800), { today: TODAY });
    expect(r.outcome.dailyUnlocked).toBe(true);
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
    expect(status).toMatchObject({ number: 284, tries: 3, scored: false, played: true });
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
    s = applyRunResult(s, daily, { today: TODAY, dailyTry: 1 }).save;
    const e = s.daily[TODAY]!;
    expect(e.bestMinutes).toBe(1240);
    expect(e.bestSnow).toBe(40);
    expect(e.glyphs.split('\n')).toHaveLength(2);
    expect(e.glyphs.endsWith('\u{1F4A7}')).toBe(true);
    // A worse later try keeps the best.
    s = dailyTryStarted(s, TODAY).save;
    s = applyRunResult(s, run(100, {}, { mode: 'daily', dailyDate: TODAY }), { today: TODAY, dailyTry: 2 }).save;
    expect(s.daily[TODAY]?.bestMinutes).toBe(1240);
  });

  it('ignores practice runs for the daily best', () => {
    const s = applyRunResult(defaults(1), run(900, {}, { mode: 'daily', dailyDate: TODAY }), {
      today: TODAY,
      dailyTry: null,
    }).save;
    expect(s.daily[TODAY]).toBeUndefined();
  });
});

describe('wardrobe', () => {
  function rich(wallet: number): SaveV1 {
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
    const s = applyRunResult(defaults(1), run(900, { snow: 99 }), { today: TODAY }).save;
    s.settings.music = 0.1;
    s.flags.installSheetShown = true;
    const r = resetProgress(s, 5);
    expect(r.stats.runs).toBe(0);
    expect(r.stats.wallet).toBe(0);
    expect(r.settings.music).toBe(0.1);
    expect(r.flags.installSheetShown).toBe(true);
    expect(r.createdAt).toBe(5);
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
