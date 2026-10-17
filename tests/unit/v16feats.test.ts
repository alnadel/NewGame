// v1.6 Dares and the soft-fail (docs/V1_6_PLAN.md §2.6; CORE-2): what each Dare counts, the `feat`
// and `featMet` events, star 2, the relaxed goal after two misses, and the Dare table's shape.
import { describe, expect, it } from 'vitest';
import { LEVEL_BAKE } from '../../src/config/levelBake.gen.ts';
import {
  CAMPAIGN_LEVELS,
  DARE_OF,
  featMet,
  featValue,
  goalValue,
  isBossFinale,
  levelDef,
  relaxedGoalFor,
  SOFT_FAIL_MISSES,
  softFailMisses,
  starsFor,
  type FeatKind,
  type LevelDef,
  type LevelStats,
} from '../../src/config/campaign.ts';
import { campaignConfig, levelOutcome } from '../../src/core/level.ts';
import { createBot } from '../../src/core/sim/bots.ts';
import { DARE_TERMS } from '../../src/core/sim/bots/dares.ts';
import { createRun } from '../../src/core/sim/create.ts';
import type { SimEvent } from '../../src/core/sim/events.ts';
import { snapshotFeats, updateFeats } from '../../src/core/sim/feats.ts';
import { step } from '../../src/core/sim/step.ts';
import type { SimState } from '../../src/core/sim/types.ts';

const base: LevelStats = { flakes: 0, snow: 0, minChill: 50 };

describe('Dares (§2.6)', () => {
  it('featValue counts each kind from its RunStats counter', () => {
    const rows: [FeatKind, Partial<LevelStats>, number][] = [
      ['blooms', { blooms: 2 }, 2],
      ['swings', { swings: 3 }, 3],
      ['deep', { deepTicks: 90 }, 90],
      // A snapSave level starts with its snap ready, so the Dare counts every snap-alone tick.
      ['snapSave', { snapSavedTicks: 200, earnedSnapSavedTicks: 40 }, 200],
      ['parry', { parries: 2 }, 2],
      ['brittle', { brittleSaved: 1 }, 1],
      ['flakes', { flakes: 7 }, 7],
      ['clean', { ballsPassedClean: 4 }, 4],
      ['ride', { cloudRideBest: 2.4, cloudsRidden: 2 }, 0],
      ['ride', { cloudRideBest: 2.5 }, 1],
      ['ride', { cloudsRidden: 3 }, 1],
      ['gates', { gateShaded: 1, gateDeep: 0 }, 0],
      ['gates', { gateDeep: 1 }, 1],
      ['flip', { flipTicks: 12 }, 1],
      ['flip', { flipTicks: 13 }, 0],
      ['still', { lockHeld: 1, gustHeld: 2 }, 3],
      ['ring', { maxMult: 4 }, 4],
    ];
    for (const [kind, st, want] of rows) expect(featValue(kind, { ...base, ...st } as LevelStats), `${kind} ${JSON.stringify(st)}`).toBe(want);
    expect(featValue('ring', base)).toBe(1);
    // The verb goals read the plain counters (a snap save goal counts every snap-alone tick).
    expect(goalValue('snapSave', { ...base, snapSavedTicks: 200, earnedSnapSavedTicks: 40 } as LevelStats)).toBe(200);
    expect(goalValue('gate', { ...base, gateShaded: 1 } as LevelStats)).toBe(1);
  });

  it('every level carries one Dare (finales two, boss finales a parry); star 2 is a Dare met', () => {
    for (const l of CAMPAIGN_LEVELS) {
      expect(l.feats.length, `level ${l.id}`).toBeGreaterThanOrEqual(1);
      expect(l.feats.length, `level ${l.id}`).toBeLessThanOrEqual(2);
      for (const f of l.feats) expect(f.target, `level ${l.id} ${f.kind}`).toBeGreaterThanOrEqual(1);
      // A boss finale dares a parry wherever a fixed angle parries one of its flares (the bake's stillFlares).
      if (isBossFinale(l.id) && (LEVEL_BAKE[l.id]?.stillFlares ?? 0) > 0) expect(l.feats.map((f) => f.kind), `level ${l.id}`).toContain('parry');
    }
    // A teaching level's Dare is its concept's when the level offers it, else a core verb; the verb
    // teaching levels dare their own verb.
    for (const l of CAMPAIGN_LEVELS.slice(0, 40)) {
      const k = l.introduces ? DARE_OF[l.introduces] : undefined;
      if (k && l.feats[0]) expect([k, 'blooms', 'swings', 'deep', 'snapSave'], `level ${l.id}`).toContain(l.feats[0].kind);
    }
    for (const id of [5, 7, 8, 13, 21, 36, 38]) {
      const l = levelDef(id) as LevelDef;
      expect(l.feats[0]?.kind, `level ${id}`).toBe(DARE_OF[l.introduces as keyof typeof DARE_OF]);
    }
    const l = levelDef(8) as LevelDef;
    const f = l.feats[0] as { kind: FeatKind; target: number };
    const goal = goalValue(l.goal.kind, base) >= l.goal.target ? {} : { blooms: l.goal.target };
    const met = { ...base, ...goal, [statOf(f.kind)]: f.target, minChill: 0 } as LevelStats;
    expect(featMet(l, met)).toBe(true);
    expect(starsFor(l, met)).toBe(2);
    expect(featMet(l, { ...met, [statOf(f.kind)]: f.target - 1 } as LevelStats)).toBe(featValue(f.kind, { ...met, [statOf(f.kind)]: f.target - 1 } as LevelStats) >= f.target);
  });

  it('feat events: a live count when the Dare value moves (tick counters every 6 ticks) and featMet once at the target', () => {
    const id = CAMPAIGN_LEVELS.find((l) => l.feats[0]?.kind === 'deep')?.id as number;
    expect(id).toBeGreaterThan(0);
    const s = createRun(campaignConfig(id));
    const f = (s.level as LevelDef).feats[0] as { kind: FeatKind; target: number };
    const seen: SimEvent[] = [];
    const tickWith = (v: number): void => {
      s.events.length = 0;
      snapshotFeats(s);
      s.stats.deepTicks = v;
      updateFeats(s);
      seen.push(...s.events.filter((e) => e.e === 'feat' || e.e === 'featMet'));
    };
    s.stats.deepTicks = 0;
    for (let v = 1; v <= 7; v++) tickWith(v);
    expect(seen).toEqual([{ e: 'feat', kind: 'deep', value: 6, target: f.target }]);
    seen.length = 0;
    s.stats.deepTicks = f.target - 2;
    tickWith(f.target - 1);
    tickWith(f.target);
    tickWith(f.target + 1);
    const met = seen.filter((e) => e.e === 'featMet');
    expect(met).toEqual([{ e: 'featMet', kind: 'deep' }]);
    expect(seen).toContainEqual({ e: 'feat', kind: 'deep', value: f.target, target: f.target });
  });

  it('a played level reports its Dare events in step order (a count event for every Dare value change of a count Dare)', () => {
    const id = CAMPAIGN_LEVELS.find((l) => l.feats[0]?.kind === 'flakes' || l.feats[0]?.kind === 'clean')?.id ?? 2;
    const s = createRun(campaignConfig(id));
    const bot = createBot('oracle', 0, true, { feats: true, dares: DARE_TERMS });
    const events: SimEvent[] = [];
    while (s.phase !== 'dead' && s.phase !== 'won' && s.tick < 8000) {
      step(s, bot.next(s));
      events.push(...s.events);
    }
    const f = (s.level as LevelDef).feats[0] as { kind: FeatKind; target: number };
    const counts = events.filter((e) => e.e === 'feat');
    const final = featValue(f.kind, s.stats);
    if (final > 0) expect(counts.at(-1)).toEqual({ e: 'feat', kind: f.kind, value: final, target: f.target });
    expect(events.filter((e) => e.e === 'featMet')).toHaveLength(final >= f.target ? 1 : 0);
  }, 30_000);
});

describe('the soft-fail (§2.6)', () => {
  it('relaxes a goal after two misses (one on levels 1-10); a finish level never relaxes', () => {
    expect(SOFT_FAIL_MISSES).toBe(2);
    const l2 = levelDef(2) as LevelDef;
    expect(softFailMisses(l2)).toBe(1);
    expect([relaxedGoalFor(l2, 0), relaxedGoalFor(l2, 1), relaxedGoalFor(l2, 2), relaxedGoalFor(l2, 5)]).toEqual([false, true, true, true]);
    const late = CAMPAIGN_LEVELS.find((l) => l.id > 10 && l.goal.kind !== 'finish') as LevelDef;
    expect(softFailMisses(late)).toBe(SOFT_FAIL_MISSES);
    expect([relaxedGoalFor(late, 0), relaxedGoalFor(late, 1), relaxedGoalFor(late, 2), relaxedGoalFor(late, 5)]).toEqual([false, false, true, true]);
    const fin = CAMPAIGN_LEVELS.find((l) => l.goal.kind === 'finish') as LevelDef;
    expect(relaxedGoalFor(fin, 9)).toBe(false);
  });

  it('RunConfig.relaxedGoal passes a level whose goal was missed at the line', () => {
    const won = (relaxedGoal: boolean): SimState => {
      const s = createRun(campaignConfig(2, relaxedGoal ? { relaxedGoal } : {}));
      s.phase = 'won';
      return s;
    };
    const l2 = levelDef(2) as LevelDef;
    expect(levelOutcome(l2, won(false))).toEqual({ id: 2, passed: false, stars: 0, introduces: 'flakes' });
    const r = levelOutcome(l2, won(true));
    expect(r.passed).toBe(true);
    expect(r.stars).toBeGreaterThanOrEqual(1);
  });
});

/** The RunStats field a Dare kind counts (for the simple counter kinds). */
function statOf(kind: FeatKind): string {
  const m: Partial<Record<FeatKind, string>> = { blooms: 'blooms', swings: 'swings', deep: 'deepTicks', snapSave: 'snapSavedTicks', parry: 'parries', brittle: 'brittleSaved', flakes: 'flakes', clean: 'ballsPassedClean' };
  return m[kind] ?? kind;
}
