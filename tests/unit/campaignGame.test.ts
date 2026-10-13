// The campaign in the game and render layers (CAMPAIGN_PLAN §4): the level's run config, the intro
// card's words, the goal line and the HUD goal pill, level progress and the finish line, the
// render-side concept fields (gusts, lock, eclipse), ?level=, the level card's timing and the
// finish/miss stamps.
import { describe, expect, it } from 'vitest';
import { createRun, NO_INPUT, step, type InputFrame } from '../../src/core/index.ts';
import {
  asV12,
  CAMPAIGN,
  CAMPAIGN_LEVELS,
  CONCEPTS,
  CONCEPT_ORDER,
  gustDir,
  isWon,
  levelDef,
  levelFinishY,
  levelProgress,
  levelStartY,
  shimCampaignTick,
  starsFor,
} from '../../src/core/campaignShim.ts';
import { campaignConfig, campaignShareText, goalLine, goalText, hudGoal, introCard, missLine } from '../../src/game/campaign.ts';
import { isDebugRun, parseParams } from '../../src/game/params.ts';
import { createBanners, dismissLevelCard, resetBanners, showLevelCard, showStamp, updateBanners } from '../../src/render/banners.ts';

const TAP: InputFrame = { ...NO_INPUT, down: true, downEdge: true };

describe('level table (shim)', () => {
  it('has 200 levels, the first 40 each introducing the next concept', () => {
    expect(CAMPAIGN_LEVELS).toHaveLength(200);
    for (let i = 0; i < 40; i++) {
      const l = CAMPAIGN_LEVELS[i]!;
      expect(l.id).toBe(i + 1);
      expect(l.introduces).toBe(CONCEPT_ORDER[i]);
      expect(l.concepts[0]).toBe(CONCEPT_ORDER[i]);
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
    expect(CONCEPTS.glare.name).toBe('Glare');
  });

  it('awards stars for the pass, the flakes and the lowest Chill', () => {
    const l = levelDef(2)!;
    expect(starsFor(l, { flakes: 0, minChill: 0 })).toBe(1);
    expect(starsFor(l, { flakes: l.stars.flakes, minChill: 0 })).toBe(2);
    expect(starsFor(l, { flakes: l.stars.flakes, minChill: l.stars.minChill })).toBe(3);
  });

  it('seeds the gust direction per gust', () => {
    const dirs = new Set<number>();
    for (let k = 0; k < 20; k++) {
      const d = gustDir(1234, k);
      expect(Math.abs(d)).toBe(1);
      expect(gustDir(1234, k)).toBe(d);
      dirs.add(d);
    }
    expect(dirs.size).toBe(2);
  });
});

describe('campaignConfig (§4)', () => {
  it('builds the level run: seed, profile 3, no tutorial, no plan, mods, drain, start, biome, forecast', () => {
    const l = levelDef(9)!;
    const cfg = campaignConfig(l, false, true);
    expect(cfg).toMatchObject({ seed: l.seed, mode: CAMPAIGN, profile: 3, tutorial: false, plan: false, level: 9, mods: l.concepts, drain: l.drain, biome: l.biome, forecast: 'breezy' });
    expect(cfg.lesson).toBeUndefined();
    expect(cfg.startT).toBeGreaterThan(0);
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
    expect(c).toMatchObject({ kicker: 'LEVEL 6', title: 'Glass Garden', concept: 'glare', conceptName: 'Glare', goal: 'Reach the finish' });
    expect(c.blurb).toContain('Gazing balls');
    const combo = introCard(levelDef(41)!);
    expect(combo.concept).toBeNull();
    expect(combo.conceptName).toContain(' · ');
  });
  it('goal text and the Results goal line', () => {
    const flakes = levelDef(2)!;
    const swing = levelDef(7)!;
    const finish = levelDef(1)!;
    expect(goalText(flakes)).toBe('Collect 8 flakes');
    expect(goalText(swing)).toBe('Score 20 Snow');
    expect(goalLine(flakes, { flakes: 9, snow: 12 }, true)).toBe('Collected 9/8 flakes');
    expect(goalLine(flakes, { flakes: 5, snow: 12 }, false)).toBe('Not enough flakes: 5/8');
    expect(goalLine(swing, { flakes: 5, snow: 24.7 }, true)).toBe('Scored 24/20 Snow');
    expect(goalLine(finish, { flakes: 0, snow: 0 }, true)).toBe('Reached the finish');
    expect(missLine(flakes)).toBe('NOT ENOUGH FLAKES');
    expect(missLine(swing)).toBe('NOT ENOUGH SNOW');
    expect(campaignShareText(levelDef(12)!, 2)).toBe('SHADY Journey · Level 12 ★★☆ · Overcast');
  });
  it('HUD goal pill: flakes/target, snow/target, or plain Snow', () => {
    expect(hudGoal(levelDef(2)!, { flakes: 3, snow: 7 })).toEqual({ value: 3, target: 8, flakes: true });
    expect(hudGoal(levelDef(7)!, { flakes: 3, snow: 7.9 })).toEqual({ value: 7, target: 20, flakes: false });
    expect(hudGoal(levelDef(1)!, { flakes: 3, snow: 7 })).toEqual({ value: 7, target: -1, flakes: false });
    expect(hudGoal(null, { flakes: 3, snow: 7 })).toEqual({ value: 7, target: -1, flakes: false });
  });
});

describe('progress and the finish line', () => {
  it('runs 0..1 from the level start to the finish, 0 outside the campaign', () => {
    const l = levelDef(4)!;
    const s = asV12(createRun(campaignConfig(l, false, true)));
    expect(s.mods.has('noon')).toBe(true);
    expect(s.eclipse).toBe(0);
    expect(s.sun.gust).toBe(0);
    expect(s.sun.locked).toBe(false);
    expect(levelProgress(s)).toBe(0);
    expect(Math.abs(s.nubs.y - levelStartY(l))).toBeLessThan(1);
    expect(levelFinishY(l)).toBeGreaterThan(levelStartY(l));
    s.nubs.y = (levelStartY(l) + levelFinishY(l)) / 2;
    expect(levelProgress(s)).toBeCloseTo(0.5, 6);
    s.nubs.y = levelFinishY(l) + 50;
    expect(levelProgress(s)).toBe(1);
    const endless = createRun({ seed: 1, mode: 'endless', profile: 3, tutorial: false, reducedMotion: false });
    expect(levelProgress(endless)).toBe(0);
  });

  it('the finish: crossing the line alive wins once, with the goal checked', () => {
    const l = levelDef(2)!;
    const s = asV12(createRun(campaignConfig(l, false, true)));
    step(s, TAP);
    for (let i = 0; i < 60; i++) step(s, NO_INPUT);
    expect(shimCampaignTick(s, l, 100)).toBeNull();
    s.nubs.y = levelFinishY(l) + 1;
    s.stats.flakes = 12;
    const ev = shimCampaignTick(s, l, 55);
    expect(ev).toEqual({ e: 'levelWon', passed: true, stars: 3, flakes: 12, minChill: 55 });
    expect(isWon(s)).toBe(true);
    expect(shimCampaignTick(s, l, 55)).toBeNull();
  });

  it('a missed goal at the line is a levelWon with 0 stars', () => {
    const l = levelDef(2)!;
    const s = asV12(createRun(campaignConfig(l, false, true)));
    step(s, TAP);
    for (let i = 0; i < 60; i++) step(s, NO_INPUT);
    s.nubs.y = levelFinishY(l) + 1;
    expect(shimCampaignTick(s, l, 100)).toEqual({ e: 'levelWon', passed: false, stars: 0, flakes: 0, minChill: 100 });
  });

  it('writes the gust, lock and eclipse fields from the level timetable', () => {
    const gusts = levelDef(32)!;
    const s = asV12(createRun(campaignConfig(gusts, false, true)));
    step(s, TAP);
    let seen = 0;
    for (let i = 0; i < 60 * 9; i++) {
      s.nubs.chill = 100;
      step(s, NO_INPUT);
      shimCampaignTick(s, gusts, 100);
      if (s.sun.gust !== 0) seen++;
    }
    // A 2 s gust at the end of each 8 s period.
    expect(seen).toBeGreaterThan(60 * 1.5);
    expect(seen).toBeLessThan(60 * 2.5);
    const lock = levelDef(33)!;
    const t = asV12(createRun(campaignConfig(lock, false, true)));
    step(t, TAP);
    let locked = 0;
    for (let i = 0; i < 60 * 7; i++) {
      t.nubs.chill = 100;
      step(t, NO_INPUT);
      shimCampaignTick(t, lock, 100);
      if (t.sun.locked) locked++;
    }
    expect(locked).toBeGreaterThan(60 * 1);
    expect(locked).toBeLessThan(60 * 1.4);
    const ecl = levelDef(36)!;
    const u = asV12(createRun(campaignConfig(ecl, false, true)));
    step(u, TAP);
    step(u, NO_INPUT);
    u.nubs.y = (levelStartY(ecl) + levelFinishY(ecl)) / 2 + u.params.v * 2;
    shimCampaignTick(u, ecl, 100);
    expect(u.eclipse).toBe(1);
    u.nubs.y = (levelStartY(ecl) + levelFinishY(ecl)) / 2 + u.params.v * 7;
    shimCampaignTick(u, ecl, 100);
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
  it('holds until dismissed, then leaves within 0.4 s', () => {
    const b = createBanners();
    showLevelCard(b, 'LEVEL 6', 'Glass Garden', 'glare', 'Glare', 'Gazing balls throw light back.', 'Reach the finish', 'meadow');
    expect(b.level).toBe(0);
    for (let i = 0; i < 100; i++) updateBanners(b, 0.1, false);
    expect(b.level).toBeCloseTo(10, 6);
    expect(b.levelOut).toBe(-1);
    dismissLevelCard(b);
    expect(b.levelOut).toBe(0);
    for (let i = 0; i < 3; i++) updateBanners(b, 0.1, false);
    expect(b.level).toBeGreaterThan(0);
    for (let i = 0; i < 3; i++) updateBanners(b, 0.1, false);
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
