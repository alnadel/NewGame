// The campaign in the game and render layers (CAMPAIGN_PLAN §4): the level's run config, the intro
// card's words, the goal line and the HUD goal pill, level progress and the finish line, the
// render-side concept fields (gusts, lock, eclipse), ?level=, the level card's timing and the
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
  type InputFrame,
  type SimEvent,
} from '../../src/core/index.ts';
import { campaignConfig, conceptLabel, goalLine, goalText, hudGoal, introCard, missLine } from '../../src/game/campaign.ts';
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
      expect(l.concepts.length).toBeGreaterThanOrEqual(2);
      expect(l.chapter).toBe(Math.ceil(l.id / 10));
    }
    expect(levelDef(0)).toBeNull();
    expect(levelDef(201)).toBeNull();
    expect(levelDef(6)!.name).toBe('Glass Garden');
    expect(CONCEPTS.glare.blurb).toContain('Gazing balls');
  });

  it('awards stars for the pass, the flakes and the lowest Chill', () => {
    const l = levelDef(1)!;
    expect(starsFor(l, { flakes: 0, snow: 0, minChill: 0 })).toBe(1);
    expect(starsFor(l, { flakes: l.stars.flakes, snow: 0, minChill: 0 })).toBe(2);
    expect(starsFor(l, { flakes: l.stars.flakes, snow: 0, minChill: l.stars.minChill })).toBe(3);
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
    const c = introCard(levelDef(6)!);
    // The catalog names the concept after its level, so the row reads "New concept" (no double title).
    expect(c).toMatchObject({ kicker: 'LEVEL 6', title: 'Glass Garden', concept: 'glare', conceptName: 'New concept', goal: 'Reach the finish' });
    expect(conceptLabel({ name: 'Elsewhere' }, 'glare')).toBe('Glass Garden');
    expect(c.blurb).toContain('Gazing balls');
    const combo = introCard(levelDef(41)!);
    expect(combo.concept).toBeNull();
    expect(combo.conceptName).toContain(' · ');
  });
  it('goal text and the Results goal line', () => {
    const flakes = levelDef(2)!;
    const swing = levelDef(7)!;
    const finish = levelDef(1)!;
    expect(flakes.goal.kind).toBe('flakes');
    expect(swing.goal.kind).toBe('snow');
    const ft = flakes.goal.target;
    const st = swing.goal.target;
    expect(goalText(flakes)).toBe(`Collect ${ft} flakes`);
    expect(goalText(swing)).toBe(`Score ${st} Snow`);
    expect(goalLine(flakes, { flakes: ft + 1, snow: 12 }, true)).toBe(`Collected ${ft + 1}/${ft} flakes`);
    expect(goalLine(flakes, { flakes: 5, snow: 12 }, false)).toBe(`Not enough flakes: 5/${ft}`);
    expect(goalLine(swing, { flakes: 5, snow: st + 4.7 }, true)).toBe(`Scored ${st + 4}/${st} Snow`);
    expect(goalLine(finish, { flakes: 0, snow: 0 }, true)).toBe('Reached the finish');
    expect(missLine(flakes)).toBe('NOT ENOUGH FLAKES');
    expect(missLine(swing)).toBe('NOT ENOUGH SNOW');
    expect(campaignShareText({ id: 12, name: levelDef(12)!.name, stars: 2, link: null })).toBe('SHADY Journey · Level 12 ★★☆ · Overcast');
  });
  it('HUD goal pill: flakes/target, snow/target, or plain Snow', () => {
    expect(hudGoal(levelDef(2)!, { flakes: 3, snow: 7 })).toEqual({ value: 3, target: levelDef(2)!.goal.target, flakes: true });
    expect(hudGoal(levelDef(7)!, { flakes: 3, snow: 7.9 })).toEqual({ value: 7, target: levelDef(7)!.goal.target, flakes: false });
    expect(hudGoal(levelDef(1)!, { flakes: 3, snow: 7 })).toEqual({ value: 7, target: -1, flakes: false });
    expect(hudGoal(null, { flakes: 3, snow: 7 })).toEqual({ value: 7, target: -1, flakes: false });
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
    const gusts = levelDef(32)!;
    const s = createRun(campaignConfig(gusts, false, true));
    step(s, TAP);
    // A 2 s gust every 8 s of the daylight clock (the start beat excluded): over 20 s, one to three
    // gusts, each tick blowing one way (the exact timetable is the core's campaign.test).
    let seen = 0;
    for (let i = 0; i < 60 * 20; i++) {
      s.nubs.chill = s.nubs.maxChill;
      step(s, NO_INPUT);
      if (s.sun.gust !== 0) {
        expect(Math.abs(s.sun.gust)).toBe(1);
        seen++;
      }
    }
    expect(seen).toBeGreaterThanOrEqual(60 * 2);
    expect(seen).toBeLessThanOrEqual(60 * 6);
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
    showLevelCard(b, 'LEVEL 6', 'Glass Garden', 'glare', 'Glare', 'Gazing balls throw light back.', 'Reach the finish', 'meadow');
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
    showLevelCard(b, 'LEVEL 7', 'SWING!', 'swing', 'Swing', '', 'Score 20 Snow', 'oldtown');
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
