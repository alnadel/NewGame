import { describe, expect, it } from 'vitest';
import type { HourGlyph, RunResult } from '../../src/core/index.ts';
import type { Save } from '../../src/meta/saveTypes.ts';
import { defaults, migrate } from '../../src/meta/save.ts';
import { MISSIONS } from '../../src/meta/content.ts';
import { missionGate, refillMissions, type MissionState } from '../../src/meta/missions.ts';
import { activeMissionViews, applyRunResult, beginRun, swapMission } from '../../src/meta/progression.ts';

const TODAY = '2026-10-11';
const def = (id: string) => MISSIONS.find((m) => m.id === id)!;

function run(minutes: number, over: Partial<RunResult['stats']> = {}, extra: Partial<RunResult> = {}): RunResult {
  const day = Math.floor(minutes / 720) + 1;
  const glyphs: HourGlyph[][] = [];
  for (let d = 1; d < day; d++) glyphs.push(Array<HourGlyph>(12).fill('warm'));
  glyphs.push([...Array<HourGlyph>(Math.floor((minutes % 720) / 60)).fill('warm'), 'melt']);
  return {
    mode: 'endless', seed: 1, profile: 3, drain: 55, noonCloud: 0, plan: [{ biome: 'meadow', forecast: 'clear' }], minutes, day, clock: '',
    stats: {
      flakes: 0, flakesMelted: 0, crystals: 0, flowers: 0, phews: 0, snow: 0, maxMult: 1, x5HoldBest: 0, cloudRideBest: 0, cloudSeconds: 0,
      ballsPassedClean: 0, ballGlared: false, gateNoon: false, dayReached: day, nightsReached: day - 1, minutes, litTotal: 0, swings: 0,
      swingChainBest: 0, phewMinChill: 100, minChill: 100, ...over,
    },
    death: { day, tDay: 0, minutes, time: '', x: 0, y: 0, cause: 'plain', line: '' },
    hourGlyphs: glyphs, melody: [], assisted: false, ...extra,
  };
}

/** A save whose recent best is `best` (three standard endless runs). */
function withBest(best: number): Save {
  const s = defaults(1);
  s.stats.runs = 3;
  s.history = Array.from({ length: 3 }, () => ({ m: best, s: 0, r: 4, d: TODAY }));
  return s;
}

const state = (cursor: number, tier = 1): MissionState => ({ cursor, tier, active: [], deferred: [] });

describe('skill gates and the deferred queue', () => {
  it('gates by recent best: fixed gates, and target − 330 for tier ≥ 2 Day goals', () => {
    expect(['reach-day-2', 'hold-x5', 'gate-arch', 'clean-balls', 'reach-day-3', 'flakes-10'].map((id) => missionGate(def(id), 1))).toEqual([
      390, 390, 720, 720, 1080, 0,
    ]);
    expect(missionGate(def('reach-9am'), 2)).toBe(570);
    expect(missionGate(def('survive-noon'), 2)).toBe(780);
    expect(missionGate(def('reach-day-3'), 2)).toBe(1830);
    expect(missionGate(def('flakes-10'), 3)).toBe(0);
    expect(missionGate(def('gate-arch'), 2)).toBe(720);
  });

  it('defers gated missions in pool order and deals them once the player is ready', () => {
    const s = state(5);
    refillMissions(s, 400);
    // reach-day-2 (390) is open; gate-arch and clean-balls (720) wait.
    expect(s.active.map((m) => m.id)).toEqual(['reach-day-2', 'ice-crystal', 'two-phews']);
    for (const slot of s.active) slot.done = true;
    refillMissions(s, 400);
    // reach-9am@2 (gate 900 − 330 = 570) waits too.
    expect(s.deferred).toEqual(['gate-arch', 'clean-balls', 'reach-day-3', 'reach-9am@2']);
    expect(s.active.map((m) => m.id)).toEqual(['hold-x5', 'swings-3', 'flakes-10@2']);
    // The queue is re-checked first, in order, before the pool.
    for (const slot of s.active) slot.done = true;
    refillMissions(s, 800);
    expect(s.active.map((m) => m.id)).toEqual(['gate-arch', 'clean-balls', 'reach-9am@2']);
    expect(s.deferred).toEqual(['reach-day-3']);
  });

  it('never deals an active mission at any tier and keeps one queued entry per mission', () => {
    const s = state(10);
    s.active = [{ id: 'flakes-10', progress: 0, done: false, stale: 0 }];
    s.deferred = ['reach-day-3'];
    refillMissions(s, 0);
    // reach-day-3 is passed again but already queued; hold-x5, swings-3, reach-9am@2 and
    // survive-noon@2 join the queue; flakes-10@2 is skipped while flakes-10 is active.
    expect(s.active.map((m) => m.id)).toEqual(['flakes-10', 'mult-3@2', 'cloud-ride@2']);
    expect(s.deferred).toEqual(['reach-day-3', 'hold-x5', 'swings-3', 'reach-9am@2', 'survive-noon@2']);
  });

  it('never leaves a final slot gated above the recent best over a long career', () => {
    for (const best of [0, 200, 400, 800, 1200, 2000]) {
      let s = withBest(best);
      for (let i = 0; i < 60; i++) {
        s.missions.active[i % 3] = { ...s.missions.active[i % 3]!, done: true };
        s = beginRun(s).save;
        for (const v of s.missions.active) {
          const id = v.id.split('@')[0]!;
          const tier = v.id.includes('@') ? Number(v.id.split('@')[1]) : 1;
          expect(missionGate(def(id), tier), `${v.id} at best ${best}`).toBeLessThanOrEqual(best);
        }
      }
      expect(s.missions.deferred.length).toBeLessThanOrEqual(MISSIONS.length);
    }
  });
});

describe('stale missions and Swap', () => {
  it('counts runs without progress and resets on any gain', () => {
    let s = withBest(0);
    s.missions.active = [
      { id: 'flakes-10', progress: 4, done: false, stale: 0 },
      { id: 'two-phews', progress: 0, done: false, stale: 3 },
      { id: 'mult-3', progress: 3, done: true, stale: 0 },
    ];
    s = applyRunResult(s, run(10, { flakes: 3, phews: 1 }), { today: TODAY }).save;
    expect(s.missions.active.map((m) => m.stale)).toEqual([1, 0, 0]);
    for (let i = 0; i < 4; i++) s = applyRunResult(s, run(10, { flakes: 4 }), { today: TODAY }).save;
    expect(s.missions.active.map((m) => m.stale)).toEqual([5, 4, 0]);
    expect(activeMissionViews(s).map((v) => v.swappable)).toEqual([true, false, false]);
    s = applyRunResult(s, run(10, { flakes: 5 }), { today: TODAY }).save;
    expect(s.missions.active[0]?.stale).toBe(0);
  });

  it('swaps a stale slot for the next eligible mission at once, free, and queues the old one', () => {
    const s = withBest(0);
    s.missions.cursor = 5;
    s.missions.active = [
      { id: 'flakes-10', progress: 4, done: false, stale: 5 },
      { id: 'two-phews', progress: 1, done: false, stale: 0 },
      { id: 'mult-3', progress: 2, done: false, stale: 0 },
    ];
    const wallet = s.stats.wallet;
    const next = swapMission(s, 'flakes-10');
    expect(next.missions.active.map((m) => m.id)).toEqual(['ice-crystal', 'two-phews', 'mult-3']);
    expect(next.missions.active[0]).toEqual({ id: 'ice-crystal', progress: 0, done: false, stale: 0 });
    expect(next.missions.deferred).toEqual(['reach-day-2', 'flakes-10']);
    expect(next.stats.wallet).toBe(wallet);
    // Unknown or finished slots: nothing changes.
    expect(swapMission(s, 'nope')).toBe(s);
    s.missions.active[1]!.done = true;
    expect(swapMission(s, 'two-phews')).toBe(s);
    // The swapped mission comes back later, from the queue.
    next.missions.active[0]!.done = true;
    expect(beginRun(next).save.missions.active[0]?.id).toBe('flakes-10');
  });
});

describe("Today's errand (retired in v1.3)", () => {
  it('stays empty in every save and never pays', () => {
    expect(migrate({ v: 1, stats: { runs: 4 }, missions: { errand: { date: TODAY, id: 'e-runs-5', progress: 2, done: false } } }, 1).save.missions.errand)
      .toEqual({ date: '', id: '', progress: 0, done: false });
    const s = withBest(0);
    s.lastPlay = TODAY;
    const r = applyRunResult(s, run(10, { flakes: 30 }), { today: TODAY });
    expect(r.outcome.bonusSnow).toBe(0);
    expect(r.save.missions.errand).toEqual({ date: '', id: '', progress: 0, done: false });
  });
});
