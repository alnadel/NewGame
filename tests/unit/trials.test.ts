// Elementals Trials: the trial table and its helpers, and the plumbing that loads a trial and walks
// it (Journey ids and texts untouched).
import { describe, expect, it } from 'vitest';
import { CAMPAIGN_LEVELS, levelDef } from '../../src/config/campaign.ts';
import { HERO_IDS, HEROES } from '../../src/config/heroes.ts';
import { hashString } from '../../src/config/rng.ts';
import {
  anyLevelDef,
  isTrialId,
  levelShort,
  levelTag,
  TRIAL_IDS,
  trialDareValue,
  trialDef,
  trialLevel,
  TRIALS,
  trialStars,
  type TrialDef,
} from '../../src/config/trials.ts';
import { campaignConfig, levelOutcome } from '../../src/core/level.ts';
import { createBot } from '../../src/core/sim/bots.ts';
import { createRun } from '../../src/core/sim/create.ts';
import { step } from '../../src/core/sim/step.ts';
import { V16_NONE } from '../../src/core/sim/types.ts';
import { trailX } from '../../src/core/trail.ts';

describe('the trial table', () => {
  it('serves ids 1001..1008 only, outside the Journey', () => {
    expect(TRIAL_IDS).toEqual([1001, 1002, 1003, 1004, 1005, 1006, 1007, 1008]);
    expect(TRIALS.map((t) => t.id)).toEqual(TRIAL_IDS);
    TRIALS.forEach((t, i) => {
      expect(t.n).toBe(i + 1);
      expect(t.seed).toBe(hashString(`trial-${t.id}-${t.salt}`));
      expect(trialDef(t.id)).toBe(t);
      expect(t.mech).toEqual({ buds: [2, 7, 8].includes(t.n), snap: true, deep: false, brittle: false });
      expect(t.card.blurb.length).toBeLessThanOrEqual(90);
    });
    for (const id of [0, 1, 200, 201, 1000, 1009, 1001.5, NaN, undefined]) expect(isTrialId(id)).toBe(false);
    expect(levelDef(1001)).toBeNull();
    expect(levelDef(201)).toBeNull();
    expect(CAMPAIGN_LEVELS).toHaveLength(200);
    expect(CAMPAIGN_LEVELS.some((l) => isTrialId(l.id))).toBe(false);
    expect(HERO_IDS.map((h) => HEROES[h].id)).toEqual(HERO_IDS);
  });

  it('builds a LevelDef no Journey rule can award, and resolves ids either way', () => {
    const t = trialDef(1007) as TrialDef;
    const l = trialLevel(1007);
    expect(l).toBe(trialLevel(1007));
    expect(l).toMatchObject({ id: 1007, chapter: 5, seed: t.seed, biome: 'meadow', forecast: 'clear', introduces: null, feats: [], flares: [] });
    expect(l?.goal).toEqual({ kind: 'blooms', target: 2 });
    expect(l?.stars).toEqual({ flakes: 1e9, minChill: 30, sunSec: 1e9 });
    expect(anyLevelDef(12)).toBe(levelDef(12));
    expect(anyLevelDef(1003)).toBe(trialLevel(1003));
    expect(anyLevelDef(1009)).toBeNull();
  });

  it('names trials T/Trial n and keeps every Journey level text', () => {
    for (let id = 1; id <= 200; id++) {
      expect(levelTag(id)).toBe(`Level ${id}`);
      expect(levelShort(id)).toBe(`L${id}`);
    }
    expect(levelTag(1003)).toBe('Trial 3');
    expect(levelShort(1008)).toBe('T8');
  });

  it('counts Dares and stars as the Journey does: 2 of 3', () => {
    const t = trialDef(1005) as TrialDef;
    const stats = { flakes: 0, snow: 0, minChill: 35, cleanTags: 2 };
    expect(trialDareValue('cleanTags', stats)).toBe(2);
    expect(trialDareValue('chain', stats)).toBe(0);
    expect(trialDareValue('flakes', { ...stats, flakes: 7 })).toBe(7);
    expect(trialStars(t, stats, false)).toBe(0);
    expect(trialStars(t, stats, true)).toBe(3);
    expect(trialStars(t, { ...stats, minChill: 34 }, true)).toBe(2);
    expect(trialStars(t, { ...stats, minChill: 34, cleanTags: 1 }, true)).toBe(1);
  });
});

describe('C0: a trial loads and walks', () => {
  it('runs every trial on its walker (Nubs\' rule until the element rules land)', () => {
    for (const id of TRIAL_IDS) {
      const t = trialDef(id) as TrialDef;
      const cfg = campaignConfig(id);
      expect(cfg).toMatchObject({ level: id, seed: t.seed, drain: t.drain, mechanics: t.mech, v16: V16_NONE, startFrost: 1 });
      const s = createRun(cfg);
      expect(s.trial).toBe(t);
      expect(s.nubs.hero).toBe(t.cast[0]);
      expect(s.nubs.chill).toBe(100);
      expect(s.nubs.frost).toBe(1);
      expect(s.stats.minChill).toBe(100);
      expect(s.stats.cleanTags).toBe(0);
      const bot = createBot('reactive');
      for (let i = 0; i < 600 && s.phase !== 'dead' && s.phase !== 'won'; i++) step(s, bot.next(s));
      expect(s.nubs.x).toBe(trailX(s.world.trail, s.nubs.y));
      expect(s.nubs.c).toBe(s.nubs.w.reduce((a, b) => a + b, 0));
    }
  });

  it('scores a trial at the finish with trialStars, never relaxed', () => {
    const s = createRun(campaignConfig(1007, { relaxedGoal: true }));
    const l = trialLevel(1007) as NonNullable<ReturnType<typeof trialLevel>>;
    expect(levelOutcome(l, s)).toEqual({ id: 1007, passed: false, stars: 0, introduces: null });
    s.phase = 'won';
    expect(levelOutcome(l, s).passed).toBe(false); // Bloom 2 unmet, and a trial's goal never relaxes
    s.stats.blooms = 2;
    expect(levelOutcome(l, s)).toEqual({ id: 1007, passed: true, stars: 2, introduces: null });
    s.stats.minChill = 29;
    expect(levelOutcome(l, s).stars).toBe(1);
  });

  it('leaves Nubs runs with no trial and no relay counters', () => {
    const s = createRun(campaignConfig(12));
    expect(s.trial).toBeNull();
    expect(s.nubs.hero).toBe('nubs');
    expect(s.stats.cleanTags).toBeUndefined();
  });
});
