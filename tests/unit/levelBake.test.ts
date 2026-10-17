// v1.6 Journey bake (docs/V1_6_PLAN.md §2.5, §2.6; fix round 3): src/config/levelBake.gen.ts is
// current (`node scripts/sim.ts --bake` rewrites it), the levels read their Dares, flares and world
// variants from its LEVEL_BAKE_RUN, the baked flares are kept by the validator where they stand, the
// Dares are sized from what the bots measured, and a teaching level plays a world whose lesson reads.
import { describe, expect, it } from 'vitest';
import {
  bakedGoal,
  bakeRunEntry,
  CAMPAIGN_LEVELS,
  dareCandidates,
  dareFloor,
  isBossFinale,
  lessonReads,
  levelBakeKey,
  levelDef,
  levelSeed,
  nominalFlares,
  sizeDare,
  snapByGoal,
  TEACH_LEVELS,
  type LevelBake,
  type LevelDef,
} from '../../src/config/campaign.ts';
import { LEVEL_BAKE, LEVEL_BAKE_RUN } from '../../src/config/levelBake.gen.ts';
import { TUNING } from '../../src/config/tuning.ts';
import { tickAtMinute, TICK_HZ } from '../../src/core/clock.ts';
import { worldYAtTick } from '../../src/core/gen/plan.ts';
import { createWorld, ensureGenerated } from '../../src/core/gen/world.ts';
import { campaignConfig } from '../../src/core/level.ts';
import { FLARE_KEPT } from '../../src/core/objects.ts';
import { bakeLevel } from '../../scripts/sim16/bake.ts';
import { CONFIRM_SALTS, measureDare, notRuns, runHere, SIZE_SALTS } from '../../scripts/sim16/dares.ts';

describe('the Journey bake', () => {
  it('has a current entry for every level (its key matches the level as defined today)', () => {
    for (const l of CAMPAIGN_LEVELS) {
      const b = LEVEL_BAKE[l.id];
      expect(b, `level ${l.id}: run node scripts/sim.ts --bake`).toBeDefined();
      const key = levelBakeKey(l.seed, l.concepts, l.drain, l.startMinute, l.lengthMinutes, l.biome, l.forecast, nominalFlares(l.id, l.startMinute, l.lengthMinutes));
      expect(b?.key, `level ${l.id}: run node scripts/sim.ts --bake`).toBe(key);
      // The level plays its baked world variant and flares, and the game's part (LEVEL_BAKE_RUN) is the Dares sized from the measures.
      expect(l.seed).toBe(levelSeed(l.id, b?.variant ?? 0));
      expect(l.flares).toEqual(b?.flares);
      expect(LEVEL_BAKE_RUN.split(';')[l.id - 1], `level ${l.id}: run node scripts/sim.ts --bake`).toBe(bakeRunEntry(l, b as LevelBake));
      // Only a teaching level ever plays another world variant.
      if (l.id > TEACH_LEVELS) expect(b?.variant, `level ${l.id}`).toBe(0);
    }
  });

  it('recomputes the same world part for a sample of levels (the generator has not moved under the file)', () => {
    for (const id of [6, 21, 32, 38, 50, 190]) {
      const { rescuesFlares: _r, dropped: _d, ...entry } = bakeLevel(id);
      const { dares: _a, dares2: _b, ...world } = LEVEL_BAKE[id] as LevelBake;
      expect(entry, `level ${id}: run node scripts/sim.ts --bake`).toEqual(world);
    }
  }, 60_000);

  it('flare levels: the Solar Flare (38) and every boss finale; the validator keeps each baked flare where it stands', () => {
    for (const l of CAMPAIGN_LEVELS) {
      const want = l.introduces === 'flare' || isBossFinale(l.id);
      expect(l.flares.length > 0, `level ${l.id}`).toBe(want);
    }
    for (const id of [38, 60, 200]) {
      const l = levelDef(id) as LevelDef;
      const w = createWorld(campaignConfig(id));
      ensureGenerated(w, w.finishY + 500);
      expect(w.flares).toHaveLength(l.flares.length);
      w.flares.forEach((f, i) => {
        expect(f.state).toBe(FLARE_KEPT);
        expect(f.riseTick).toBe(TUNING.validator.stepTicks * Math.round(tickAtMinute((l.flares[i] as { minute: number }).minute) / TUNING.validator.stepTicks));
        expect(f.riseTick - f.warnTick).toBe(TUNING.flare.warnTicksJourney);
      });
    }
  }, 60_000);

  it('every baked flare resolves in its level: it ends ≥ finishMarginSec before the finish line, and a parry Dare asks for no more than the flares a fixed angle parries', () => {
    for (const l of CAMPAIGN_LEVELS) {
      if (l.flares.length === 0) continue;
      const w = createWorld(campaignConfig(l.id));
      ensureGenerated(w, w.finishY + 500);
      for (const f of w.flares) {
        expect(f.state, `level ${l.id} flare ${f.id}`).toBe(FLARE_KEPT);
        expect(worldYAtTick(w, f.endTick + Math.round(TUNING.flare.finishMarginSec * TICK_HZ)), `level ${l.id} flare ${f.id} ends after the finish`).toBeLessThan(w.finishY);
      }
      // A teaching level leaves a beat between flares; a boss's warning may start in the previous fall.
      for (let i = 1; i < w.flares.length; i++) {
        const p = w.flares[i - 1] as (typeof w.flares)[number];
        const q = w.flares[i] as (typeof w.flares)[number];
        expect(q.warnTick, `level ${l.id} flare ${q.id}`).toBeGreaterThanOrEqual(l.introduces ? p.endTick + Math.round(TUNING.flare.teachGapSec * TICK_HZ) : p.fallTick);
      }
      const still = LEVEL_BAKE[l.id]?.stillFlares ?? 0;
      expect(still).toBeLessThanOrEqual(l.flares.length);
      for (const fs of l.feats) if (fs.kind === 'parry') expect(fs.target, `level ${l.id}`).toBeLessThanOrEqual(still);
      if (l.goal.kind === 'parry') expect(l.goal.target, `level ${l.id}`).toBeLessThanOrEqual(still);
    }
    // The Solar Flare's lesson: three flares, every one parried by a fixed angle.
    expect(levelDef(38)?.flares).toHaveLength(3);
    expect(LEVEL_BAKE[38]?.stillFlares).toBe(3);
  }, 60_000);

  it('sizes every Dare from what the bots measured: a candidate of the level, sized by sizeDare (fix round 3)', () => {
    for (const l of CAMPAIGN_LEVELS) {
      const b = LEVEL_BAKE[l.id] as LevelBake;
      const first = l.feats[0];
      expect(first, `level ${l.id}`).toBeDefined();
      l.feats.forEach((f, i) => {
        const m = (i === 0 ? b.dares : [...b.dares2, ...b.dares]).find((x) => x.kind === f.kind);
        expect(m, `level ${l.id} ${f.kind}`).toBeDefined();
        expect(dareCandidates(l, b, i === 0 ? null : (first?.kind ?? null)), `level ${l.id}`).toContain(f.kind);
        const size = sizeDare(f.kind, m!, dareFloor(l, f.kind));
        expect(f.target, `level ${l.id} ${f.kind}`).toBe(size.target);
        // A finale's second Dare is never one the players who do not seek it meet (either earns the star).
        if (i === 1) expect(size.tier, `level ${l.id}`).toBeGreaterThanOrEqual(2);
      });
    }
    // The verb goals of the lessons the bake sizes or keeps.
    expect((levelDef(8) as LevelDef).goal).toEqual({ kind: 'blooms', target: 1 });
    expect((levelDef(21) as LevelDef).goal).toEqual({ kind: 'brittle', target: 1 });
    expect(LEVEL_BAKE[21]?.glass).toBeGreaterThanOrEqual(1);
    expect((levelDef(38) as LevelDef).goal).toEqual({ kind: 'parry', target: 2 });
    const l6 = levelDef(6) as LevelDef;
    expect(l6.goal).toEqual({ kind: 'clean', target: bakedGoal(l6, LEVEL_BAKE[6] as LevelBake) });
    // No parry Dare where no fixed angle parries a flare (the Heat Dome's high noon sun).
    for (const l of CAMPAIGN_LEVELS) if ((LEVEL_BAKE[l.id]?.stillFlares ?? 0) === 0) expect(l.feats.map((f) => f.kind), `level ${l.id}`).not.toContain('parry');
  });

  it('re-measures a level\'s Dare as the file holds it (the bots have not moved under the file)', async () => {
    const l = levelDef(8) as LevelDef;
    const b = LEVEL_BAKE[8] as LevelBake;
    const m = b.dares[b.dares.length - 1]!;
    const again = await measureDare(runHere, { id: 8, seed: l.seed, flares: l.flares }, m.kind, snapByGoal(l) || m.kind === 'snapSave');
    expect(again).toEqual(m);
  }, 60_000);

  it('teaching without walls: a lesson whose own world walls it plays a world variant whose lesson reads', async () => {
    const id = CAMPAIGN_LEVELS.find((l) => l.introduces && (LEVEL_BAKE[l.id]?.variant ?? 0) > 0 && l.flares.length === 0 && bakedGoal(l, { balls: 0 }) === null)?.id as number;
    expect(id).toBeGreaterThan(0);
    const l = levelDef(id) as LevelDef;
    const reads = async (seed: number, salts: readonly number[]): Promise<boolean> => {
      const [r, o, ...hd] = await notRuns(runHere, { id, seed, flares: l.flares }, snapByGoal(l), salts);
      return lessonReads(hd.filter((x) => x.passed).length, hd.length, o!.passed, r!.won);
    };
    // Its variant reads on the training streams and on the fresh ones that confirmed it; its own world did not.
    expect(await reads(l.seed, SIZE_SALTS)).toBe(true);
    expect(await reads(l.seed, CONFIRM_SALTS)).toBe(true);
    expect((await reads(levelSeed(id, 0), SIZE_SALTS)) && (await reads(levelSeed(id, 0), CONFIRM_SALTS))).toBe(false);
  }, 60_000);
});
