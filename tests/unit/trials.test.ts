// Elementals v2 Trials (docs/ELEMENTALS_V2.md §5, §7.2-§7.3): the element and trial tables and their
// helpers, and the plumbing that loads a trial and walks it (Journey ids and texts untouched).
import { describe, expect, it } from 'vitest';
import { CAMPAIGN_LEVELS, levelDef } from '../../src/config/campaign.ts';
import { CAUSE_TIPS, HERO_IDS, HEROES } from '../../src/config/heroes.ts';
import { hashString } from '../../src/config/rng.ts';
import {
  anyLevelDef,
  EL_KINDS,
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
import { validatedY } from '../../src/core/gen/world.ts';
import { campaignConfig, levelOutcome } from '../../src/core/level.ts';
import { EL_ID_BASE, SNAP_ID_BASE, TREE_ID_BASE, RUNTIME_ID_BASE } from '../../src/core/objects.ts';
import { createBot } from '../../src/core/sim/bots.ts';
import { createRun } from '../../src/core/sim/create.ts';
import { step } from '../../src/core/sim/step.ts';
import { V16_NONE } from '../../src/core/sim/types.ts';
import { trailX } from '../../src/core/trail.ts';

describe('the element table (§10.1)', () => {
  it('lists the five elements with their verbs, held suns and unlock trials', () => {
    expect(HERO_IDS).toEqual(['nubs', 'ember', 'drip', 'sprout', 'gust']);
    expect(HERO_IDS.map((h) => HEROES[h].id)).toEqual(HERO_IDS);
    expect(HERO_IDS.map((h) => HEROES[h].verb)).toEqual(['sun', 'burn', 'steer', 'grow', 'blow']);
    expect(HERO_IDS.filter((h) => HEROES[h].sunHeld)).toEqual(['drip', 'gust']);
    expect(HERO_IDS.map((h) => HEROES[h].intro)).toEqual([0, 1, 2, 3, 4]);
    expect(HERO_IDS.map((h) => HEROES[h].meter)).toEqual(['Chill', 'Flame', 'Size', 'Sap', 'Lift']);
    for (const h of HERO_IDS) {
      expect(HEROES[h].rules).toHaveLength(3);
      expect(HEROES[h].glyph).toBe(h);
      expect(HEROES[h].gesture).toMatch(/^g-(drag|press|steer|vane)$/);
    }
    // Controls v3 (docs/CONTROLS_V3.md §0.1, §11.2, §13.1): the button's act and the drag per element, and the banner's lines.
    expect(HERO_IDS.map((h) => HEROES[h].act)).toEqual(['snap', 'burn', 'none', 'grow', 'calm']);
    expect(HERO_IDS.map((h) => HEROES[h].drag)).toEqual(['sun', 'sun', 'steer', 'sun', 'vane']);
    expect(HERO_IDS.map((h) => HEROES[h].dragLine)).toEqual(['Drag: turn the sun', 'Drag: turn the sun', 'Drag: steer Drip', 'Drag: turn the sun', 'Drag: set the wind']);
    expect(HERO_IDS.map((h) => HEROES[h].actLine)).toEqual(['Button: Cold Snap', 'Button: burn the next wall', 'No button: the sun holds', 'Button: grow the next plant', 'Button: calm the wind']);
    expect(HEROES.nubs.deathTip).toBe('');
    expect(CAUSE_TIPS['ember:crash']).toBeTruthy();
    expect(CAUSE_TIPS.fall).toBe(CAUSE_TIPS.swept);
  });
});

describe('the trial table (§5)', () => {
  it('serves ids 1001..1007 only, outside the Journey', () => {
    expect(TRIAL_IDS).toEqual([1001, 1002, 1003, 1004, 1005, 1006, 1007]);
    expect(TRIALS.map((t) => t.id)).toEqual(TRIAL_IDS);
    TRIALS.forEach((t, i) => {
      expect(t.n).toBe(i + 1);
      expect(t.seed).toBe(hashString(`trial-${t.id}-${t.salt}`));
      expect(trialDef(t.id)).toBe(t);
      expect(t.mech).toEqual({ buds: false, snap: true, deep: false, brittle: false });
      expect([t.forecast, t.concepts]).toEqual(['clear', []]);
      expect(t.goal).toEqual({ kind: 'finish', target: 0 });
      // Controls v3 §13.2: the card copy runs to 100 characters, and never teaches a retired gesture.
      expect(t.card.blurb.length).toBeLessThanOrEqual(100);
      expect(t.card.blurb).not.toMatch(/\bHold\b|\bSwipe\b|just before/);
      expect(t.card.stars[0]).toBe('Finish');
      // The cast is the walkers in order of first appearance; every relay hands over to another element.
      const walkers = [t.cast[0], ...t.relays.map((r) => r.to)];
      expect([...new Set(walkers)]).toEqual(t.cast);
      walkers.forEach((h, k) => k > 0 && expect(h).not.toBe(walkers[k - 1]));
      // Most runs start and end with Nubs, and every Trial ends by 5:00 PM.
      expect([walkers[0], walkers.at(-1)]).toEqual(['nubs', 'nubs']);
      expect(t.startMinute + t.lengthMinutes).toBeLessThanOrEqual(660);
      // Objects: known kinds, minutes inside the run, walls and crossings on the trail, crossings r 12-18.
      for (const o of t.objects) {
        expect(EL_KINDS).toContain(o.k);
        expect(o.m).toBeGreaterThan(t.startMinute);
        expect(o.m).toBeLessThan(t.startMinute + t.lengthMinutes);
        if (['bramble', 'gate', 'ice', 'gap', 'stream'].includes(o.k)) expect(o.dx).toBe(0);
        if (o.k === 'gap' || o.k === 'stream') expect(o.r).toBeGreaterThanOrEqual(12);
        if (o.k === 'gap' || o.k === 'stream') expect(o.r).toBeLessThanOrEqual(18);
        if (o.k === 'rain' || o.k === 'fog') expect([o.r !== undefined, o.drift !== undefined]).toEqual([true, true]);
      }
    });
    expect(TRIALS.map((t) => t.intro)).toEqual(['ember', 'drip', 'sprout', 'gust', null, null, null]);
    expect(TRIALS.map((t) => t.requires)).toEqual([[], [], [], [], [1, 2], [3, 4], [5, 6]]);
    // §5's lists (T2 less its hidden puddle, T6 and T7 as re-authored by the lead's decisions, §13.3).
    expect(TRIALS.map((t) => t.objects.length)).toEqual([8, 12, 9, 9, 16, 15, 25]);
    expect(trialDef(1007)?.breeze).toBe(-16);
    expect(trialDef(1004)?.objects[0]).toEqual({ k: 'rain', m: 312, dx: -100, r: 55, drift: 20 });
    for (const id of [0, 1, 200, 201, 1000, 1008, 1001.5, NaN, undefined]) expect(isTrialId(id)).toBe(false);
    expect(levelDef(1001)).toBeNull();
    expect(CAMPAIGN_LEVELS).toHaveLength(200);
    expect(CAMPAIGN_LEVELS.some((l) => isTrialId(l.id))).toBe(false);
    // The run-made id spaces: above the validator's, below the snap cloud's.
    expect(RUNTIME_ID_BASE < EL_ID_BASE && EL_ID_BASE < TREE_ID_BASE && TREE_ID_BASE < SNAP_ID_BASE).toBe(true);
  });

  it('builds a LevelDef no Journey rule can award, and resolves ids either way', () => {
    const t = trialDef(1007) as TrialDef;
    const l = trialLevel(1007);
    expect(l).toBe(trialLevel(1007));
    expect(l).toMatchObject({ id: 1007, chapter: 17, seed: t.seed, biome: 'meadow', forecast: 'clear', introduces: null, feats: [], flares: [] });
    expect(l?.goal).toEqual({ kind: 'finish', target: 0 });
    expect(l?.stars).toEqual({ flakes: 1e9, minChill: 25, sunSec: 1e9 });
    expect(anyLevelDef(12)).toBe(levelDef(12));
    expect(anyLevelDef(1003)).toBe(trialLevel(1003));
    expect(anyLevelDef(1008)).toBeNull();
  });

  it('names trials T/Trial n and keeps every Journey level text', () => {
    for (let id = 1; id <= 200; id++) {
      expect(levelTag(id)).toBe(`Level ${id}`);
      expect(levelShort(id)).toBe(`L${id}`);
    }
    expect(levelTag(1003)).toBe('Trial 3');
    expect(levelShort(1007)).toBe('T7');
  });

  it('counts Dares and stars as the Journey does: 2 of 3', () => {
    const t = trialDef(1001) as TrialDef;
    const stats = { flakes: 0, snow: 0, minChill: 30, burns: 7 };
    expect(trialDareValue('burns', stats)).toBe(7);
    expect(trialDareValue('drinks', stats)).toBe(0);
    expect(trialDareValue('cloudRide', { ...stats, cloudRide: 61 })).toBe(61);
    expect(trialStars(t, stats, false)).toBe(0);
    expect(trialStars(t, stats, true)).toBe(3);
    expect(trialStars(t, { ...stats, minChill: 29 }, true)).toBe(2);
    expect(trialStars(t, { ...stats, minChill: 29, burns: 6 }, true)).toBe(1);
  });
});

describe('a trial loads and walks', () => {
  it('places each trial\'s objects and walks its legs (contract stage: Nubs\' meter rule)', () => {
    for (const id of TRIAL_IDS) {
      const t = trialDef(id) as TrialDef;
      const cfg = campaignConfig(id);
      expect(cfg).toMatchObject({ level: id, seed: t.seed, drain: t.drain, mechanics: t.mech, v16: V16_NONE, startFrost: 1 });
      const s = createRun(cfg);
      expect(s.trial).toBe(t);
      expect(s.nubs.hero).toBe(t.cast[0]);
      expect(s.nubs.chill).toBe(t.tune.legStart[0] || 100);
      expect(s.nubs.frost).toBe(1);
      expect(s.stats.minChill).toBe(100);
      expect(s.stats.burns).toBe(0);
      // The whole world is built ahead; the objects stand at their places, y-sorted, ids in order.
      expect(validatedY(s.world)).toBeGreaterThanOrEqual(s.world.finishY);
      const el = s.el!;
      expect(el.objs).toHaveLength(t.objects.length);
      el.objs.forEach((o, i) => {
        expect(o.id).toBe(EL_ID_BASE + i);
        if (i > 0) expect(o.y).toBeGreaterThanOrEqual(el.objs[i - 1]!.y);
        expect([o.state, o.size, o.grown, o.paid, o.casterId, o.hit]).toEqual([0, 0, 0, 0, -1, false]);
      });
      expect(el.tagMask.length > 0).toBe(t.cast.includes('drip'));
      const bot = createBot('reactive');
      for (let i = 0; i < 600 && s.phase !== 'dead' && s.phase !== 'won'; i++) step(s, bot.next(s));
      expect(s.nubs.x).toBe(trailX(s.world.trail, s.nubs.y) + el.dx);
    }
  });

  it('scores a trial at the finish with trialStars, never relaxed', () => {
    const s = createRun(campaignConfig(1007, { relaxedGoal: true }));
    const l = trialLevel(1007) as NonNullable<ReturnType<typeof trialLevel>>;
    expect(levelOutcome(l, s)).toEqual({ id: 1007, passed: false, stars: 0, introduces: null });
    s.phase = 'won';
    expect(levelOutcome(l, s)).toEqual({ id: 1007, passed: true, stars: 2, introduces: null });
    s.stats.grove = 4;
    expect(levelOutcome(l, s).stars).toBe(3);
    s.stats.minChill = 24;
    expect(levelOutcome(l, s).stars).toBe(2);
  });

  it('leaves Nubs runs with no trial, no el and no element counters', () => {
    const s = createRun(campaignConfig(12));
    expect(s.trial).toBeNull();
    expect(s.el).toBeNull();
    expect(s.nubs.hero).toBe('nubs');
    expect(s.stats.cleanTags).toBeUndefined();
  });
});

describe('every pinned trial passes G0, G1, G2 and G5 (§6.4, §9.6)', () => {
  it('placement and authoring, the audits, the path bot, the anti-trivial runs', async () => {
    const { gates, report, runHere } = await import('../../scripts/sim16/trials.ts');
    const fails: string[] = [];
    for (const t of TRIALS) {
      // G5 without G5b's 360 constant angles (`--trials --check` runs those); no G3/G4/G6/G7 bots.
      const g = await gates(runHere, { id: t.id, salt: t.salt }, 0, false, [0, 5]);
      if (![g.g0?.ok, g.g1?.ok, g.g2?.ok, g.g5?.ok].every((ok) => ok === true)) fails.push(report(g));
    }
    expect(fails).toEqual([]);
  }, 60_000);
});
