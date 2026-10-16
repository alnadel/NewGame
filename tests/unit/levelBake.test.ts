// v1.6 Journey bake (docs/V1_6_PLAN.md §2.5, §2.6; CORE-2): src/config/levelBake.gen.ts is current
// (`node scripts/sim.ts --bake` rewrites it), the levels read their Dares and flares from its
// LEVEL_BAKE_RUN, and the baked flares are kept by the validator where they stand.
import { describe, expect, it } from 'vitest';
import { bakeRunEntry, CAMPAIGN_LEVELS, isBossFinale, levelBakeKey, levelDef, nominalFlares, type LevelBake, type LevelDef } from '../../src/config/campaign.ts';
import { LEVEL_BAKE, LEVEL_BAKE_RUN } from '../../src/config/levelBake.gen.ts';
import { TUNING } from '../../src/config/tuning.ts';
import { tickAtMinute } from '../../src/core/clock.ts';
import { createWorld, ensureGenerated } from '../../src/core/gen/world.ts';
import { campaignConfig } from '../../src/core/level.ts';
import { FLARE_KEPT } from '../../src/core/objects.ts';
import { bakeLevel } from '../../scripts/sim16/bake.ts';

describe('the Journey bake', () => {
  it('has a current entry for every level (its key matches the level as defined today)', () => {
    for (const l of CAMPAIGN_LEVELS) {
      const b = LEVEL_BAKE[l.id];
      expect(b, `level ${l.id}: run node scripts/sim.ts --bake`).toBeDefined();
      const key = levelBakeKey(l.seed, l.concepts, l.drain, l.startMinute, l.lengthMinutes, l.biome, l.forecast, nominalFlares(l.id, l.startMinute, l.lengthMinutes));
      expect(b?.key, `level ${l.id}: run node scripts/sim.ts --bake`).toBe(key);
      // The level plays its baked flares, and the game's part (LEVEL_BAKE_RUN) is the Dares sized from these offers.
      expect(l.flares).toEqual(b?.flares);
      expect(LEVEL_BAKE_RUN.split(';')[l.id - 1], `level ${l.id}: run node scripts/sim.ts --bake`).toBe(bakeRunEntry(l, b as LevelBake));
    }
  });

  it('recomputes the same entries for a sample of levels (the generator has not moved under the file)', () => {
    for (const id of [6, 21, 32, 38, 50, 190]) {
      const { rescuesFlares: _r, dropped: _d, ...entry } = bakeLevel(id);
      expect(entry, `level ${id}: run node scripts/sim.ts --bake`).toEqual(LEVEL_BAKE[id]);
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

  it('sizes the Dares from the offers (§2.6 table)', () => {
    const l8 = levelDef(8) as LevelDef;
    expect(l8.goal).toEqual({ kind: 'blooms', target: 1 });
    const l21 = levelDef(21) as LevelDef;
    expect(l21.goal).toEqual({ kind: 'brittle', target: 1 });
    expect(LEVEL_BAKE[21]?.glass).toBeGreaterThanOrEqual(1);
    expect(l21.feats).toEqual([{ kind: 'brittle', target: Math.max(1, Math.ceil(0.6 * (LEVEL_BAKE[21]?.glass ?? 0))) }]);
    const l38 = levelDef(38) as LevelDef;
    expect(l38.goal).toEqual({ kind: 'parry', target: 2 });
    expect(l38.feats).toEqual([{ kind: 'parry', target: Math.ceil(0.75 * l38.flares.length) }]);
    const l6 = levelDef(6) as LevelDef;
    expect(l6.goal).toEqual({ kind: 'clean', target: Math.max(1, (LEVEL_BAKE[6]?.balls ?? 0) - 1) });
    for (const id of [50, 100, 200]) expect((levelDef(id) as LevelDef).feats.map((f) => f.kind)).toContain('parry');
  });
});
