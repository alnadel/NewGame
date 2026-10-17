// v1.6 Dares and the soft-fail (docs/V1_6_PLAN.md §2.6; CORE-2): what each Dare counts, the `feat`
// and `featMet` events, star 2, the relaxed goal after two misses, and the Dare table's shape.
import { describe, expect, it } from 'vitest';
import {
  CAMPAIGN_LEVELS,
  DARE_OF,
  dareFloor,
  featMet,
  featValue,
  goalValue,
  levelDef,
  relaxedGoalFor,
  SOFT_FAIL_MISSES,
  softFailMisses,
  sizeDare,
  starsFor,
  type DareMeasure,
  type FeatKind,
  type LevelDef,
  type LevelStats,
} from '../../src/config/campaign.ts';
import { TUNING } from '../../src/config/tuning.ts';
import { createWorld } from '../../src/core/gen/world.ts';
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

  it('every level carries one Dare (a finale up to two); star 2 is a Dare met', () => {
    for (const l of CAMPAIGN_LEVELS) {
      expect(l.feats.length, `level ${l.id}`).toBeGreaterThanOrEqual(1);
      expect(l.feats.length, `level ${l.id}`).toBeLessThanOrEqual(l.id % 10 === 0 ? 2 : 1);
      for (const f of l.feats) expect(f.target, `level ${l.id} ${f.kind}`).toBeGreaterThanOrEqual(1);
      if (l.feats.length === 2) expect(l.feats[0]?.kind).not.toBe(l.feats[1]?.kind);
    }
    // A teaching level dares a verb its concepts, the core verbs it has taught (SWINGs from L7) or the
    // shade verbs offer (fix round 3: the first that needs its verb there). No level before the deep
    // shade lesson dares the ring (fix round 2).
    for (const l of CAMPAIGN_LEVELS.slice(0, 40)) {
      const k = l.introduces ? DARE_OF[l.introduces] : undefined;
      if (k && l.feats[0]) expect([k, 'blooms', ...(l.id >= 7 ? ['swings'] : []), 'snapSave', 'flakes', 'deep'], `level ${l.id}`).toContain(l.feats[0].kind);
    }
    for (const l of CAMPAIGN_LEVELS.slice(0, 4)) expect(l.feats.map((f) => f.kind), `level ${l.id}`).not.toContain('ring');
    // A Dare that asks for what the level's goal counts asks for more than the goal.
    for (const l of CAMPAIGN_LEVELS) for (const f of l.feats) expect(f.target, `level ${l.id}`).toBeGreaterThanOrEqual(dareFloor(l, f.kind));
    const l = levelDef(8) as LevelDef;
    const f = l.feats[0] as { kind: FeatKind; target: number };
    const goal = goalValue(l.goal.kind, base) >= l.goal.target ? {} : { blooms: l.goal.target };
    const met = { ...base, ...goal, [statOf(f.kind)]: Math.max(f.target, (goal as { blooms?: number }).blooms ?? 0), minChill: 0 } as LevelStats;
    expect(featMet(l, met)).toBe(true);
    expect(starsFor(l, met)).toBe(2);
    expect(featMet(l, { ...met, [statOf(f.kind)]: f.target - 1 } as LevelStats)).toBe(featValue(f.kind, { ...met, [statOf(f.kind)]: f.target - 1 } as LevelStats) >= f.target);
  });

  it('sizeDare: just above the players who do not seek a Dare, where its seekers reach it (fix round 3)', () => {
    // [reactive, oracle, humanDial × 10] / [Feat-seeking oracle, humanFeat × 10]
    const m = (not: number[], seek: number[]): DareMeasure => ({ kind: 'blooms', not, seek });
    const quiet = [1, 2, 0, 0, 1, 2, 3, 0, 0, 1, 0, 1];
    // Above the reactive bot, the oracle and all but DARE_NOT_MAX (2) of the humanDial players: 3.
    expect(sizeDare('blooms', m(quiet, [5, 3, 4, 3, 5, 3, 3, 4, 2, 2, 2]), 1)).toEqual({ target: 3, tier: 3, met: 7 });
    // Too few humanFeat players reach it: tier 2 (the same target).
    expect(sizeDare('blooms', m(quiet, [5, 3, 1, 3, 1, 1, 3, 2, 2, 2, 2]), 1)).toEqual({ target: 3, tier: 2, met: 3 });
    // The Feat-seeking oracle short of it: no verb needed here, so what the seekers reach (tier 1).
    expect(sizeDare('blooms', m([4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4], [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4]), 1)).toMatchObject({ target: 4, tier: 1 });
    // Ticks: clear by 12 ticks and 10%, in whole tenths of a second, at least the floor.
    const ticks: DareMeasure = { kind: 'snapSave', not: [0, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], seek: [170, 150, 150, 150, 150, 150, 150, 150, 0, 0, 0] };
    expect(sizeDare('snapSave', ticks, 60)).toEqual({ target: 114, tier: 3, met: 7 });
    // A melted run (−1) never meets it.
    expect(sizeDare('blooms', m(quiet, [5, -1, -1, -1, -1, 3, 3, 4, 3, 3, 3]), 1).met).toBe(6);
  });
  it('feat events: a live count when the Dare value moves (tick counters every 6 ticks) and featMet once at the target', () => {
    // A level with a deep Dare (no level dares deep since fix round 3's sizing, so one is made up).
    const lv: LevelDef = Object.freeze({ ...(levelDef(12) as LevelDef), feats: Object.freeze([{ kind: 'deep' as FeatKind, target: 90 }]) });
    const cfg = campaignConfig(12);
    const world = createWorld(cfg, lv);
    const s = createRun(cfg, { cfg, world, targetY: world.startY + TUNING.world.hardAhead });
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

  it('a snap cast into an eclipse saves nothing: its ticks are not snap-saved (the eclipse already shades every angle)', () => {
    const id = CAMPAIGN_LEVELS.find((l) => l.concepts.includes('eclipse') && l.id > 10)?.id as number;
    const s = createRun({ ...campaignConfig(id), startFrost: 1 });
    const bot = createBot('reactive', 0, false);
    const ecl = s.world.eclipseTick;
    let inEclipse = 0;
    while (s.phase !== 'dead' && s.phase !== 'won' && s.tickAbs < ecl + 6 * 60) {
      const f = { ...bot.next(s) };
      if ((s.stats.snaps ?? 0) === 0 && s.tickAbs + 1 >= ecl && s.ready === 0 && s.phase === 'day') f.snap = true;
      const before = s.stats.snapSavedTicks ?? 0;
      step(s, f);
      if (s.eclipseOn) inEclipse += (s.stats.snapSavedTicks ?? 0) - before;
    }
    expect(s.stats.snaps).toBe(1);
    expect(inEclipse).toBe(0);
  }, 30_000);

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
