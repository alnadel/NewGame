// The campaign in the game and render layers (CAMPAIGN_PLAN §4): the level's run config, the intro
// card's words, the goal line and the HUD goal pill, level progress and the finish line, the
// render-side concept fields (lock, eclipse; the retired gust stays 0), ?level=, the level card's timing and the
// finish/miss stamps.
import { describe, expect, it } from 'vitest';
import {
  CAMPAIGN_LEVELS,
  CONCEPT_IDS,
  CONCEPTS,
  createRun,
  levelDef,
  levelProgress,
  NO_INPUT,
  starsFor,
  step,
  trialDef,
  trialLevel,
  type InputFrame,
  type SimEvent,
} from '../../src/core/index.ts';
import { campaignConfig, conceptLabel, featLabel, goalLine, goalText, hudGoal, introCard, missLine, nextStarHint, STAR_COOL_LOST, STAR_FLAKES, STAR_GOAL, starRules, starState, trialDareCount, trialDareGlyph } from '../../src/game/campaign.ts';
import { isDebugRun, parseParams } from '../../src/game/params.ts';
import { campaignShareText } from '../../src/meta/share.ts';
import { createBanners, dismissLevelCard, resetBanners, showLevelCard, showStamp, updateBanners } from '../../src/render/banners.ts';

const TAP: InputFrame = { ...NO_INPUT, down: true, downEdge: true };

describe('level table (core)', () => {
  it('has 200 levels, the first 40 each introducing the next concept', () => {
    expect(CAMPAIGN_LEVELS).toHaveLength(200);
    for (let i = 0; i < 40; i++) {
      const l = CAMPAIGN_LEVELS[i]!;
      expect(l.id).toBe(i + 1);
      expect(l.introduces).toBe(CONCEPT_IDS[i]);
      expect(l.concepts[0]).toBe(CONCEPT_IDS[i]);
    }
    for (let i = 40; i < 200; i++) {
      const l = CAMPAIGN_LEVELS[i]!;
      expect(l.introduces).toBeNull();
      // Controls v3's SUB_OVERRIDE may drop a retired slot (L92: one concept).
      expect(l.concepts.length).toBeGreaterThanOrEqual(1);
      expect(l.chapter).toBe(Math.ceil(l.id / 10));
    }
    expect(levelDef(0)).toBeNull();
    expect(levelDef(201)).toBeNull();
    expect(levelDef(6)!.name).toBe('Glass Garden');
    expect(CONCEPTS.glare.blurb).toContain('Gazing balls');
  });

  it('awards stars for the pass, the Dare and the lowest Chill', () => {
    // v1.6 (docs/V1_6_PLAN.md §2.6): star 2 is the level's Dare (First Shade: flakes, sized by the bake;
    // no verb is taught before it, fix round 3).
    const l = levelDef(1)!;
    const d = l.feats[0]!;
    expect(d.kind).toBe('flakes');
    expect(starsFor(l, { flakes: d.target - 1, snow: 0, minChill: 0, maxMult: 5 })).toBe(1);
    expect(starsFor(l, { flakes: d.target, snow: 0, minChill: 0 })).toBe(2);
    expect(starsFor(l, { flakes: d.target, snow: 0, minChill: l.stars.minChill })).toBe(3);
    // A goal level short of its goal earns nothing.
    const f = levelDef(2)!;
    expect(starsFor(f, { flakes: f.goal.target - 1, snow: 0, minChill: 100 })).toBe(0);
    expect(starsFor(f, { flakes: f.goal.target, snow: 0, minChill: 0 })).toBeGreaterThanOrEqual(1);
  });
});

describe('campaignConfig (§4)', () => {
  it('builds the level run: seed, profile 3, no tutorial, no plan, mods, drain, start, biome, forecast', () => {
    const l = levelDef(9)!;
    const cfg = campaignConfig(l, false, true);
    expect(cfg).toMatchObject({ seed: l.seed, mode: 'campaign', profile: 3, tutorial: false, plan: false, level: 9, mods: l.concepts, drain: l.drain, biome: l.biome, forecast: 'breezy' });
    expect(cfg.lesson).toBeUndefined();
    expect(cfg.startT).toBe(0);
    // High Noon starts at 10:30 AM.
    expect(campaignConfig(levelDef(4)!, false, true).startT).toBeGreaterThan(0);
  });
  it('teaches the lesson only on level 1 before the tutorial is done', () => {
    expect(campaignConfig(levelDef(1)!, false, false).lesson).toBe(true);
    expect(campaignConfig(levelDef(1)!, false, true).lesson).toBeUndefined();
    expect(campaignConfig(levelDef(2)!, false, false).lesson).toBeUndefined();
    expect(campaignConfig(levelDef(1)!, false, false).startT).toBe(0);
  });
});

describe('the words', () => {
  it('intro card: level, name, the concept and the goal', () => {
    const l6 = levelDef(6)!;
    const c = introCard(l6);
    // The concept has its own short name (v1.3), so the row names it. v1.6 (§2.6): L6's goal is a
    // verb goal (balls passed clean), worded like its Dare.
    const clean = (n: number): string => `${n} clean ball${n === 1 ? '' : 's'}`;
    expect(l6.goal.kind).toBe('clean');
    expect(c).toMatchObject({ kicker: 'LEVEL 6', title: 'Glass Garden', concept: 'glare', conceptName: 'Glare', goal: clean(l6.goal.target) });
    expect(conceptLabel({ name: 'Glare' }, 'glare')).toBe('New concept');
    expect(c.blurb).toContain('Gazing balls');
    // The three star rules: the goal, the level's Dare (v1.6; the flakes without one), a cool run (lit at most sunSec, rounded up).
    expect(c.stars).toEqual([clean(l6.goal.target), featLabel(l6.feats[0]!), `≤ ${Math.round(l6.stars.sunSec * 10) / 10} s in sun`]);
    expect(introCard({ ...l6, feats: [] }).stars[1]).toBe(`${l6.stars.flakes} flakes`);
    expect(introCard(levelDef(2)!).stars[0]).toBe(`${levelDef(2)!.goal.target} flakes`);
    // v1.6 (T6): no level has a Snow goal any more; the words still read one.
    expect(introCard({ ...levelDef(7)!, goal: { kind: 'snow', target: 12 } }).stars[0]).toBe('12 Snow');
    const combo = introCard(levelDef(41)!);
    expect(combo.concept).toBeNull();
    expect(combo.conceptName).toContain(' · ');
  });
  it('goal text and the Results goal line', () => {
    const flakes = levelDef(2)!;
    // v1.6 (T6): L7's goal is 1 SWING; the Snow-goal words are checked on a made-up level.
    const swing = { ...levelDef(7)!, goal: { kind: 'snow' as const, target: 20 } };
    const finish = levelDef(1)!;
    expect(flakes.goal.kind).toBe('flakes');
    expect(levelDef(7)!.goal).toEqual({ kind: 'swings', target: 1 });
    const ft = flakes.goal.target;
    const st = swing.goal.target;
    expect(goalText(flakes)).toBe(`Collect ${ft} flakes`);
    expect(goalText(swing)).toBe(`Score ${st} Snow`);
    expect(goalLine(flakes, { flakes: ft + 1, snow: 12 }, true).startsWith(`Collected ${ft + 1} flakes (goal ${ft}) ✓`)).toBe(true);
    expect(goalLine(flakes, { flakes: 5, snow: 12 }, false)).toBe(`Not enough flakes: 5/${ft}`);
    expect(goalLine(swing, { flakes: 5, snow: st + 4.7 }, true).startsWith(`Scored ${st + 4} Snow (goal ${st}) ✓`)).toBe(true);
    // A pass short of three stars names the next star: the Dare first (v1.6; here a reach ×4 Dare on a finish level), then the cool run.
    expect(finish.feats[0]?.kind).toBe('flakes');
    const ringy = { ...finish, feats: [{ kind: 'ring' as const, target: 4 }] };
    expect(goalLine(ringy, { flakes: 0, snow: 0, litTotal: 0, minChill: 100, maxMult: 1 }, true)).toBe('Reached the finish · Next ★: Reach ×4 (1/4)');
    expect(goalLine(ringy, { flakes: 99, snow: 0, litTotal: finish.stars.sunSec + 5, minChill: 100, maxMult: 4 }, true)).toMatch(/^Reached the finish · Next ★: ≤ \d+(\.\d)? s in the sun \(\d+(\.\d)? s\)$/);
    // Over the limit by a hair still reads as over it, to the tenth (it used to read "under 6 s (6 s)").
    const lim = Math.round(finish.stars.sunSec * 10);
    expect(nextStarHint(finish, { flakes: 99, snow: 0, litTotal: finish.stars.sunSec + 0.04, minChill: 100, maxMult: 1 })).toBe(
      ` · Next ★: ≤ ${lim / 10} s in the sun (${(lim + 1) / 10} s)`,
    );
    expect(goalLine(ringy, { flakes: 99, snow: 0, litTotal: 0, minChill: 0, maxMult: 4 }, true)).toBe(`Reached the finish · Next ★: keep Chill above ${finish.stars.minChill}`);
    expect(goalLine(ringy, { flakes: 99, snow: 0, litTotal: 0, minChill: 100, maxMult: 4 }, true)).toBe('Reached the finish');
    // A level without Dares names its flakes star first.
    const plain = { ...finish, feats: [] };
    expect(goalLine(plain, { flakes: 0, snow: 0, litTotal: 0, minChill: 100 }, true)).toBe(plain.stars.flakes > 0 ? `Reached the finish · Next ★: ${plain.stars.flakes} flakes` : 'Reached the finish');
    expect(missLine(flakes)).toBe('NOT ENOUGH FLAKES');
    expect(missLine(swing)).toBe('NOT ENOUGH SNOW');
    expect(campaignShareText({ id: 12, name: levelDef(12)!.name, stars: 2, link: null })).toBe('SHADY Journey · Level 12 ★★☆ · Grey Day');
  });
  it('HUD goal pill: flakes/target, a verb goal, the Dare, or plain Snow', () => {
    expect(hudGoal(levelDef(2)!, { flakes: 3, snow: 7 })).toMatchObject({ value: 3, target: levelDef(2)!.goal.target, flakes: true, glyph: null });
    // v1.6: L7's goal is 1 SWING; a finish level counts its Dare (L1: flakes; a reach ×4 Dare its level).
    expect(hudGoal(levelDef(7)!, { flakes: 3, snow: 7.9 })).toMatchObject({ value: 0, target: levelDef(7)!.goal.target, flakes: false, glyph: 'swing' });
    expect(hudGoal(levelDef(1)!, { flakes: 3, snow: 7, maxMult: 2 })).toMatchObject({ value: 3, target: levelDef(1)!.feats[0]!.target });
    expect(hudGoal({ ...levelDef(1)!, feats: [{ kind: 'ring', target: 4 }] }, { flakes: 3, snow: 7, maxMult: 2 })).toMatchObject({ value: 2, target: 4, flakes: false, glyph: 'ring' });
    expect(hudGoal({ ...levelDef(1)!, feats: [] }, { flakes: 3, snow: 7 })).toMatchObject({ value: 7, target: -1, flakes: false });
    expect(hudGoal(null, { flakes: 3, snow: 7 })).toMatchObject({ value: 7, target: -1, flakes: false });
  });
});

/** Steps `s` until a levelWon event (Chill topped up every tick), returning it; null after `max` ticks. */
function runToFinish(s: ReturnType<typeof createRun>, max: number): Extract<SimEvent, { e: 'levelWon' }> | null {
  for (let i = 0; i < max; i++) {
    s.nubs.chill = s.nubs.maxChill;
    step(s, NO_INPUT);
    for (const ev of s.events) if (ev.e === 'levelWon') return ev;
    if (s.phase === 'dead') return null;
  }
  return null;
}

describe('progress and the finish line (core)', () => {
  it('runs 0..1 from the level start to the finish, 0 outside the campaign', () => {
    const l = levelDef(4)!;
    const s = createRun(campaignConfig(l, false, true));
    expect(s.mods.has('noon')).toBe(true);
    expect(s.eclipse).toBe(0);
    expect(s.sun.gust).toBe(0);
    expect(s.sun.locked).toBe(false);
    expect(levelProgress(s)).toBe(0);
    const w = s.world;
    expect(Math.abs(s.nubs.y - w.startY)).toBeLessThan(1);
    expect(w.finishY).toBeGreaterThan(w.startY);
    s.nubs.y = (w.startY + w.finishY) / 2;
    expect(levelProgress(s)).toBeCloseTo(0.5, 6);
    s.nubs.y = w.finishY + 50;
    expect(levelProgress(s)).toBe(1);
    const endless = createRun({ seed: 1, mode: 'endless', profile: 3, tutorial: false, reducedMotion: false });
    expect(levelProgress(endless)).toBe(0);
  });

  it('the finish: crossing the line alive wins once, with the goal and stars in the event and the result', () => {
    const l = levelDef(1)!;
    const s = createRun(campaignConfig(l, false, true));
    step(s, TAP);
    const ev = runToFinish(s, 60 * 60 * 20);
    expect(ev).not.toBeNull();
    expect(ev!.passed).toBe(true);
    expect(ev!.stars).toBeGreaterThanOrEqual(1);
    expect(ev!.minChill).toBeGreaterThan(0);
    expect(s.phase).toBe('won');
    expect(s.nubs.y).toBeGreaterThanOrEqual(s.world.finishY);
    expect(levelProgress(s)).toBe(1);
    // Frozen: another step changes nothing and emits nothing.
    const y = s.nubs.y;
    step(s, NO_INPUT);
    expect(s.events).toHaveLength(0);
    expect(s.nubs.y).toBe(y);
  });

  it('a missed goal at the line is a levelWon with passed false and 0 stars', () => {
    const l = levelDef(2)!;
    expect(l.goal.kind).toBe('flakes');
    const s = createRun(campaignConfig(l, false, true));
    step(s, TAP);
    // Melt every flake as it comes: never collect one.
    const ev = (() => {
      for (let i = 0; i < 60 * 60 * 20; i++) {
        s.nubs.chill = s.nubs.maxChill;
        s.stats.flakes = 0;
        step(s, NO_INPUT);
        for (const e of s.events) if (e.e === 'levelWon') return e;
      }
      return null;
    })();
    expect(ev).not.toBeNull();
    expect(ev).toMatchObject({ e: 'levelWon', passed: false, stars: 0, flakes: 0 });
  });

  it('the sim writes the gust, lock and eclipse fields', () => {
    // Controls v3 retired Gusts (L32 teaches Lowland now): sun.gust stays 0 on every level.
    const s = createRun(campaignConfig(levelDef(32)!, false, true));
    step(s, TAP);
    for (let i = 0; i < 60 * 20; i++) {
      s.nubs.chill = s.nubs.maxChill;
      step(s, NO_INPUT);
      expect(s.sun.gust).toBe(0);
    }
    const lock = levelDef(33)!;
    const t = createRun(campaignConfig(lock, false, true));
    step(t, TAP);
    let locked = 0;
    for (let i = 0; i < 60 * 20; i++) {
      t.nubs.chill = t.nubs.maxChill;
      step(t, NO_INPUT);
      if (t.sun.locked) locked++;
    }
    // 1.2 s every 7 s.
    expect(locked).toBeGreaterThanOrEqual(60 * 1.2);
    expect(locked).toBeLessThanOrEqual(60 * 3.6);
    const ecl = levelDef(36)!;
    const u = createRun(campaignConfig(ecl, false, true));
    step(u, TAP);
    let peak = 0;
    let ticksOn = 0;
    for (let i = 0; i < 60 * 60 * 20 && u.phase !== 'won'; i++) {
      u.nubs.chill = u.nubs.maxChill;
      step(u, NO_INPUT);
      if (u.eclipseOn) ticksOn++;
      peak = Math.max(peak, u.eclipse);
    }
    expect(peak).toBe(1);
    expect(ticksOn).toBe(6 * 60);
    expect(u.eclipse).toBe(0);
  });
});

describe('?level=', () => {
  it('parses a level 1..200 and is not a debug run by itself', () => {
    expect(parseParams('?level=6').level).toBe(6);
    expect(parseParams('?level=200').level).toBe(200);
    expect(parseParams('?level=201').level).toBeNull();
    expect(parseParams('?level=0').level).toBeNull();
    expect(parseParams('?level=abc').level).toBeNull();
    expect(parseParams('').level).toBeNull();
    expect(isDebugRun(parseParams('?level=6&test=1'))).toBe(false);
    expect(isDebugRun(parseParams('?level=6&fast=8'))).toBe(true);
  });
});

describe('level card and the finish stamps (render/banners)', () => {
  it('holds until dismissed, then leaves within 0.3 s', () => {
    const b = createBanners();
    showLevelCard(b, introCard(levelDef(6)!), 'meadow');
    expect(b.level).toBe(0);
    for (let i = 0; i < 100; i++) updateBanners(b, 0.1, false);
    expect(b.level).toBeCloseTo(10, 6);
    expect(b.levelOut).toBe(-1);
    dismissLevelCard(b);
    expect(b.levelOut).toBe(0);
    for (let i = 0; i < 2; i++) updateBanners(b, 0.1, false);
    expect(b.level).toBeGreaterThan(0);
    for (let i = 0; i < 2; i++) updateBanners(b, 0.1, false);
    expect(b.level).toBe(-1);
    showLevelCard(b, introCard(levelDef(7)!), 'oldtown');
    resetBanners(b);
    expect(b.level).toBe(-1);
  });
  it('the finish and miss stamps have their own looks', () => {
    const b = createBanners();
    showStamp(b, 'finish', 'FINISH', 1.2);
    expect(b.stampKind).toBe('finish');
    showStamp(b, 'miss', 'NOT ENOUGH FLAKES', 1.2);
    expect(b.stampKind).toBe('miss');
    expect(b.stamp).toBe(0);
  });
});

describe('Elementals Trials (docs/ELEMENTALS_V2.md §7.11)', () => {
  const t1 = trialLevel(1001)!;
  const t4 = trialLevel(1004)!;
  const t6 = trialLevel(1006)!;
  it('the intro card, star rules and goal speak the Trial\'s own words; it is never relaxed', () => {
    expect(introCard(t1)).toMatchObject({ kicker: 'TRIAL 1', title: 'Kindling', concept: 'ember', conceptName: 'NUBS ▸ EMBER ▸ NUBS', goal: 'Reach the finish', dareGlyph: 'ember' });
    expect(introCard(t6)).toMatchObject({ kicker: 'TRIAL 6', concept: 'elementals', goal: 'Reach the finish', dareGlyph: 'sprout' });
    // The Dare's glyph is the element that earns it.
    expect([1001, 1002, 1003, 1004, 1005, 1006, 1007].map((id) => trialDareGlyph(trialDef(id)!))).toEqual(['ember', 'drip', 'sprout', 'gust', 'drip', 'sprout', 'sprout']);
    expect(hudGoal(trialLevel(1005)!, { flakes: 0, snow: 0, drinks: 2 })).toMatchObject({ value: 2, target: 5, glyph: 'drip' });
    expect(starRules(t1)).toEqual(['Finish', 'Burn all 7', 'Meters ≥ 30']);
    expect(campaignConfig(t6, false, true, true).relaxedGoal).toBeUndefined();
    expect(goalLine(t1, { flakes: 0, snow: 0 }, true)).toBe('Reached the finish');
    expect(goalLine(t1, { flakes: 0, snow: 0 }, false)).toBe('Out before the finish');
    expect(trialDareCount(trialDef(1001)!, { flakes: 0, snow: 0, burns: 9 })).toBe('7/7');
    expect(trialDareCount(trialDef(1004)!, { flakes: 0, snow: 0, cloudRide: 30 })).toBe('0.5/1 s');
  });
  it('stars: the goal, the Dare (trialDareValue) and Steady (no life meter under the bar); the HUD pill counts the Dare', () => {
    const st = (burns: number, minChill: number) => ({ flakes: 0, snow: 0, litTotal: 999, minChill, burns });
    expect(starState(t1, st(0, 100), false)).toBe(0);
    expect(starState(t1, st(7, 100), true)).toBe(STAR_GOAL | STAR_FLAKES);
    // The Journey's sun bar never counts on a Trial; a dip under the Steady bar does.
    expect(starState(t1, st(6, 29), true)).toBe(STAR_GOAL | STAR_COOL_LOST);
    expect(hudGoal(t1, { flakes: 0, snow: 0, burns: 3 })).toMatchObject({ value: 3, target: 7, glyph: 'ember', sec: false });
    expect(hudGoal(t1, { flakes: 0, snow: 0, burns: 9 }).value).toBe(7);
    expect(hudGoal(t4, { flakes: 0, snow: 0, cloudRide: 30 })).toMatchObject({ value: 30, target: 60, glyph: 'gust', sec: true });
  });
});

