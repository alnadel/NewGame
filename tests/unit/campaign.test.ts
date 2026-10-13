// The Journey campaign (CAMPAIGN_PLAN §2-§3): the level table, the concept catalog and its tunes,
// the finish line, goals and stars, and the behaviour concepts in the sim.
import { describe, expect, it } from 'vitest';
import {
  buildCampaign,
  CAMPAIGN_LEVELS,
  CHAPTERS,
  CONCEPT_IDS,
  CONCEPTS,
  conceptsCompatible,
  goalMet,
  LEVEL_COUNT,
  levelDef,
  starsFor,
  type ConceptId,
  type LevelDef,
} from '../../src/config/campaign.ts';
import { dayParams, dayPlan, type DayParams } from '../../src/config/days.ts';
import { forecastFits } from '../../src/config/forecasts.ts';
import { TUNING } from '../../src/config/tuning.ts';
import { dayTicks, elevation, tickAtMinute, yAtDayTick } from '../../src/core/clock.ts';
import { angleDiff } from '../../src/core/dmath.ts';
import { ECLIPSE_SEC, createWorld, eclipseAt, ensureGenerated } from '../../src/core/gen/world.ts';
import { campaignConfig, levelOutcome, levelProgress, resolveLevelConfig } from '../../src/core/level.ts';
import { hashString } from '../../src/core/rng.ts';
import { createBot } from '../../src/core/sim/bots.ts';
import { makeCaster, makePrism } from '../../src/core/gen/catalog.ts';
import { insertCaster } from '../../src/core/gen/store.ts';
import { rectPoly } from '../../src/core/geom.ts';
import { trailX } from '../../src/core/trail.ts';
import { createRun, prepareRun, prepareSome } from '../../src/core/sim/create.ts';
import { syncTime } from '../../src/core/sim/step.ts';
import type { SimEvent } from '../../src/core/sim/events.ts';
import { hashState } from '../../src/core/sim/hash.ts';
import { headlessConfig, runBot } from '../../src/core/sim/headless.ts';
import { buildRunResult } from '../../src/core/sim/result.ts';
import { step } from '../../src/core/sim/step.ts';
import { sunGustAt, sunLockedAt } from '../../src/core/sim/sun.ts';
import { NO_INPUT, type InputFrame, type SimState } from '../../src/core/sim/types.ts';

const TAP: InputFrame = { dTheta: 0, down: false, downEdge: true, upEdge: true, release: 0, key: 0 };
const f = (p: Partial<InputFrame> = {}): InputFrame => ({ dTheta: 0, down: false, downEdge: false, upEdge: false, release: 0, key: 0, ...p });

/** A level's run started (tap + start beat), ready for clock ticks. */
function started(id: number): SimState {
  const s = createRun(campaignConfig(id));
  step(s, TAP);
  while (s.ready > 0) step(s, NO_INPUT);
  return s;
}

/** Empties the world and freezes generation (Nubs is in full sun). */
function strip(s: SimState): void {
  const w = s.world;
  w.casters.length = 0;
  w.byId.clear();
  w.clouds.length = 0;
  w.balls.length = 0;
  w.pickups.length = 0;
  w.validatedThrough = 1e6;
}

let shadeId = 2_000_000;
/** Strips the world, then covers the trail with 80×80 blocks so Nubs is shaded whatever the sun does. */
function shadeAll(s: SimState): void {
  strip(s);
  for (let y = -100; y <= s.world.finishY + 600; y += 40) {
    const x = trailX(s.world.trail, y);
    insertCaster(
      s.world,
      makeCaster({
        id: shadeId++, kind: 'rock', name: 'the Test Rock', biome: 'meadow', x, y, rot: 0,
        parts: [makePrism(rectPoly(x, y, 80, 80, 1, 0), 100)], side: 1, rescue: false, gate: false, ballId: -1, chunk: 0,
      }),
    );
  }
}

/** Jumps a started run's clock to `dayTick` of its day (the world must be stripped first). */
function jumpTo(s: SimState, dayTick: number): void {
  s.dayTick = dayTick;
  syncTime(s);
}

/** Plays a level with a bot until it ends (won or dead); returns the state and every event. */
function play(id: number, bot: 'oracle' | 'reactive' | 'idle' = 'reactive', before?: (s: SimState) => void): { s: SimState; events: SimEvent[] } {
  const s = createRun(campaignConfig(id));
  before?.(s);
  const b = createBot(bot);
  const events: SimEvent[] = [];
  for (let i = 0; i < 8000 && s.phase !== 'dead' && s.phase !== 'won'; i++) {
    step(s, b.next(s));
    events.push(...s.events);
  }
  return { s, events };
}

describe('the level table', () => {
  it('has exactly 200 levels, ids 1..200, chapters of ten, and is deterministic', () => {
    expect(LEVEL_COUNT).toBe(200);
    expect(CAMPAIGN_LEVELS).toHaveLength(200);
    expect(CHAPTERS).toHaveLength(20);
    CAMPAIGN_LEVELS.forEach((l, i) => {
      expect(l.id).toBe(i + 1);
      expect(l.chapter).toBe(Math.ceil(l.id / 10));
      expect(l.seed).toBe(hashString(`journey-${l.id}`));
      expect(l.name.length).toBeGreaterThan(2);
      expect(l.concepts.length).toBeGreaterThanOrEqual(1);
      expect(l.concepts.length).toBeLessThanOrEqual(3);
      expect(new Set(l.concepts).size).toBe(l.concepts.length);
      expect(l.lengthMinutes).toBeGreaterThan(0);
      expect(l.drain).toBeGreaterThanOrEqual(22);
      expect(l.drain).toBeLessThanOrEqual(55);
      // The effective drain (× the concepts' drainMul) is capped: 40 with lock/gusts, 45 with an eclipse.
      const mul = dayParams(1, 3, dayPlan(l.biome, l.forecast), l.concepts).drainMul;
      expect(l.drain * mul).toBeLessThanOrEqual(62 + 1e-9);
      if (l.concepts.includes('lock') || l.concepts.includes('gusts')) expect(l.drain * mul).toBeLessThanOrEqual(40 + 1e-9);
      if (l.concepts.includes('eclipse')) expect(l.drain * mul).toBeLessThanOrEqual(45 + 1e-9);
      // Star 3 (a cool run) allows 22% of the level's daylight in the sun and 20% of the tank.
      expect(Math.abs(l.stars.sunSec - (0.22 * l.lengthMinutes * 50) / 720)).toBeLessThanOrEqual(0.05 + 1e-9);
      expect(l.stars.minChill).toBe(Math.round(0.2 * dayParams(1, 3, dayPlan(l.biome, l.forecast), l.concepts).maxChill));
      expect(forecastFits(l.forecast, l.biome)).toBe(true);
      expect(CHAPTERS[l.chapter - 1]?.id).toBe(l.chapter);
      // Only a marathon spans a night.
      if (!l.concepts.includes('marathon')) expect(l.startMinute + l.lengthMinutes).toBeLessThanOrEqual(720);
      if (l.goal.kind === 'finish') expect(l.goal.target).toBe(0);
      else expect(l.goal.target).toBeGreaterThan(0);
    });
    expect(buildCampaign()).toEqual(CAMPAIGN_LEVELS);
    expect(levelDef(0)).toBeNull();
    expect(levelDef(201)).toBeNull();
    expect(levelDef(1.5)).toBeNull();
    expect(levelDef(42)).toBe(CAMPAIGN_LEVELS[41]);
  });

  it('levels 1-40 introduce the forty concepts in catalog order, alone; later levels introduce nothing', () => {
    expect(CONCEPT_IDS).toHaveLength(40);
    expect(Object.keys(CONCEPTS).sort()).toEqual([...CONCEPT_IDS].sort());
    for (let id = 1; id <= 40; id++) {
      const l = levelDef(id) as LevelDef;
      expect(l.introduces).toBe(CONCEPT_IDS[id - 1]);
      expect(l.concepts).toEqual([CONCEPT_IDS[id - 1]]);
      // The level is titled for its lesson; the concept keeps a short name of its own.
      const c = CONCEPTS[CONCEPT_IDS[id - 1] as ConceptId];
      expect(l.name).toBe(c.title);
      expect(c.name).not.toBe(c.title);
    }
    expect(new Set(CONCEPT_IDS.map((id) => CONCEPTS[id].name)).size).toBe(40);
    for (let id = 41; id <= 200; id++) expect((levelDef(id) as LevelDef).introduces).toBeNull();
  });

  it('follows the plan rows: level 1, 2, 4, 25, 37, 39 and 40', () => {
    // Level 1 is the gentlest of all: dawn to 10 AM at drain 28.
    const l1 = levelDef(1) as LevelDef;
    expect([l1.biome, l1.startMinute, l1.lengthMinutes, l1.drain, l1.goal.kind]).toEqual(['meadow', 0, 240, 28, 'finish']);
    expect(dayParams(1, 3, dayPlan('meadow', 'clear'), l1.concepts).clouds).toHaveLength(0);
    const l2 = levelDef(2) as LevelDef;
    expect(l2.goal.kind).toBe('flakes');
    expect(dayParams(1, 3, dayPlan('meadow', 'clear'), l2.concepts).flakesPerCluster).toBe(4);
    const l4 = levelDef(4) as LevelDef;
    expect([l4.startMinute, l4.lengthMinutes]).toEqual([270, 180]);
    expect((levelDef(5) as LevelDef).biome).toBe('oldtown');
    expect((levelDef(7) as LevelDef).goal.kind).toBe('snow');
    expect((levelDef(14) as LevelDef).forecast).toBe('market');
    expect((levelDef(25) as LevelDef).stars.minChill).toBe(10);
    expect([(levelDef(37) as LevelDef).startMinute, (levelDef(37) as LevelDef).lengthMinutes]).toEqual([540, 180]);
    expect((levelDef(39) as LevelDef).lengthMinutes).toBe(1080);
    const l40 = levelDef(40) as LevelDef;
    expect([l40.startMinute, l40.lengthMinutes]).toEqual([180, 360]);
    for (const id of [32, 33]) expect((levelDef(id) as LevelDef).drain).toBeLessThanOrEqual(40);
  });

  it('shapes a sawtooth: teaching levels end before noon, finales are spikes, hard concepts pay for themselves', () => {
    const at = (id: number): LevelDef => levelDef(id) as LevelDef;
    // Teaching levels (no time concept) end before noon; their chapter finales run to noon.
    for (const id of [1, 2, 3, 5, 9]) expect(at(id).lengthMinutes).toBe(240);
    for (const id of [12, 25, 35]) expect(at(id).lengthMinutes).toBe(300);
    for (const id of [10, 20, 30]) expect(at(id).lengthMinutes).toBe(360);
    // On the curve (drain + the concepts' costs) a finale is a spike: above its chapter and the next start.
    const curve = (id: number): number => at(id).drain + at(id).concepts.reduce((a, c) => a + (CONCEPTS[c].level?.cost ?? 0), 0);
    for (const f of [10, 20, 30]) expect(curve(f)).toBeGreaterThan(Math.max(curve(f - 1), curve(f + 1)));
    expect(curve(31)).toBeGreaterThan(curve(11));
    // A costly concept lowers the drain: Lowland (18) drains less than Giants (17).
    expect(at(18).drain).toBeLessThan(at(17).drain);
    // Composed chapters: the first two levels are a step shorter than the rest.
    expect(at(101).lengthMinutes).toBe(at(105).lengthMinutes - 30);
  });

  it('composes levels 41-200 from compatible concepts around the chapter, with finales every ten and a rising curve', () => {
    for (let id = 41; id <= 200; id++) {
      const l = levelDef(id) as LevelDef;
      const ch = CHAPTERS[l.chapter - 1]!;
      expect(l.concepts.length).toBeGreaterThanOrEqual(2);
      expect(ch.concepts).toContain(l.concepts[0]);
      for (let i = 0; i < l.concepts.length; i++)
        for (let j = i + 1; j < l.concepts.length; j++) expect(conceptsCompatible(l.concepts[i]!, l.concepts[j]!), `${id}: ${l.concepts.join(',')}`).toBe(true);
      if (id % 10 === 0) {
        expect(l.concepts).toHaveLength(3);
        expect(l.concepts[0]).toBe(ch.concepts[0]);
      }
      // Forecast concepts only where they fit; 'oldtown'/'market' force Old Town, 'dazzle' the Meadow.
      for (const c of l.concepts) {
        const need = CONCEPTS[c].level?.biome;
        if (need) expect(l.biome).toBe(need);
      }
    }
    // Lengths grow 330 → 720 chapter by chapter (each chapter's first two levels a step shorter).
    const plain = (id: number): boolean => !(levelDef(id) as LevelDef).concepts.some((c) => CONCEPTS[c].level?.lengthMinutes !== undefined);
    const lens = CAMPAIGN_LEVELS.filter((l) => l.id > 40 && plain(l.id) && (l.id - 1) % 10 >= 2).map((l) => l.lengthMinutes);
    expect(Math.min(...lens)).toBe(360);
    expect(Math.max(...lens)).toBe(720);
    for (let i = 1; i < lens.length; i++) expect(lens[i]).toBeGreaterThanOrEqual(lens[i - 1]!);
    // Chapter biomes alternate from the Meadow.
    CHAPTERS.forEach((c, i) => expect(c.biome).toBe(i % 2 === 0 ? 'meadow' : 'oldtown'));
  });

  it('scores: goalMet and starsFor', () => {
    const l = levelDef(2) as LevelDef;
    expect(goalMet(l, { flakes: l.goal.target, snow: 0, minChill: 0 })).toBe(true);
    expect(goalMet(l, { flakes: l.goal.target - 1, snow: 0, minChill: 0 })).toBe(false);
    expect(starsFor(l, { flakes: l.goal.target - 1, snow: 0, minChill: 100 })).toBe(0);
    expect(starsFor(l, { flakes: l.goal.target, snow: 0, minChill: 0 })).toBe(1);
    expect(starsFor(l, { flakes: l.stars.flakes, snow: 0, minChill: 0 })).toBe(2);
    expect(starsFor(l, { flakes: l.goal.target, snow: 0, minChill: l.stars.minChill })).toBe(2);
    expect(starsFor(l, { flakes: l.stars.flakes, snow: 0, minChill: l.stars.minChill })).toBe(3);
    // The cool-run star needs both: little sun (litTotal ≤ sunSec) and a safe lowest Chill.
    expect(starsFor(l, { flakes: l.stars.flakes, snow: 0, minChill: l.stars.minChill, litTotal: l.stars.sunSec })).toBe(3);
    expect(starsFor(l, { flakes: l.stars.flakes, snow: 0, minChill: l.stars.minChill, litTotal: l.stars.sunSec + 0.1 })).toBe(2);
    expect(starsFor(l, { flakes: l.stars.flakes, snow: 0, minChill: l.stars.minChill - 1, litTotal: 0 })).toBe(2);
    const s7 = levelDef(7) as LevelDef;
    expect(goalMet(s7, { flakes: 0, snow: s7.goal.target, minChill: 0 })).toBe(true);
    expect(goalMet(levelDef(1) as LevelDef, { flakes: 0, snow: 0, minChill: 0 })).toBe(true);
  });
});

describe('concept tunes reach dayParams', () => {
  const base = dayParams(1, 3, dayPlan('meadow', 'clear'));
  const at = (...mods: ConceptId[]): DayParams => dayParams(1, 3, dayPlan('meadow', 'clear'), mods);

  it('is the same object without mods, and every tuned concept changes the day', () => {
    expect(dayParams(1, 3, dayPlan('meadow', 'clear'), [])).toBe(base);
    expect(at('flakes')).toBe(at('flakes'));
    for (const id of CONCEPT_IDS) {
      const c = CONCEPTS[id];
      if (!c.tune) continue;
      // 'noon' overrides εnoon to 48, Day 1's profile-3 value: visible on Day 2 (58 → 48).
      if (id === 'noon') expect(dayParams(2, 3, dayPlan('oldtown', 'clear'), [id]).epsNoon).toBe(48);
      else expect(at(id), id).not.toEqual(base);
    }
    expect([base.heightScale, base.waitersOnly, base.clusterGap, base.meltBudget, base.drainMul, base.regen, base.maxChill, base.sunFollow, base.sunFriction, base.walkMul]).toEqual([
      1, false, 1, TUNING.pickups.meltBudget, 1, TUNING.nubs.regen, TUNING.nubs.maxChill, 0, TUNING.sun.friction, 1,
    ]);
  });

  it('applies each knob', () => {
    expect(at('sprint').v).toBeCloseTo(base.v * 1.35, 9);
    expect(at('sprint').walkMul).toBe(1.35);
    expect(at('stroll').drainMul).toBe(1.25);
    expect(at('stroll').walkMul).toBe(0.75);
    expect(at('giants').heightScale).toBe(1.6);
    expect(at('lowland').heightScale).toBe(0.6);
    expect(at('sparse').spacing).toBeCloseTo(base.spacing * 1.45, 9);
    expect(at('dense').spacing).toBeCloseTo(base.spacing * 0.7, 9);
    expect(at('dense').latMax).toBe(base.latMax - 10);
    expect(at('drought').clouds).toHaveLength(0);
    expect(at('fleet').clouds).toHaveLength(base.clouds.length * 3);
    expect(at('fleet').spacing).toBeCloseTo(base.spacing * 1.6, 9);
    expect(at('cloud').waitersOnly).toBe(true);
    expect([at('glare').ballStart, at('glare').ballEvery]).toEqual([6, 12]);
    expect(at('flurry').flakesPerCluster).toBe(7);
    expect(at('flurry').clusterGap).toBe(0.6);
    expect(at('meltfast').meltBudget).toBe(0.5);
    expect(at('hardy').meltBudget).toBe(Infinity);
    expect(at('thaw').regen).toBeCloseTo(TUNING.nubs.regen * 0.45, 9);
    expect(at('frosty').regen).toBe(TUNING.nubs.regen * 2.5);
    expect(at('ration').maxChill).toBe(50);
    expect(at('heavy').sunFollow).toBe(220);
    expect(at('heavy').sunFriction).toBe(0);
    expect(at('slippery').sunFriction).toBeCloseTo(0.9941836, 6);
    expect(at('moonlit').epsNoon).toBe(30);
    expect(at('moonlit').drainMul).toBe(0.7);
    expect(at('boss').epsNoon).toBe(80);
    expect(at('noon').epsNoon).toBe(48);
    // Multipliers fold: stroll × moonlit; latMax adds; overrides take the last value.
    expect(at('stroll', 'moonlit').drainMul).toBeCloseTo(1.25 * 0.7, 9);
    expect(at('dense', 'dense').latMax).toBe(base.latMax - 20);
    expect(at('noon', 'boss').epsNoon).toBe(80);
    // The clock is untouched by walkMul: the day is as long as ever.
    expect([at('sprint').dayLen, at('sprint').nightLen]).toEqual([base.dayLen, base.nightLen]);
  });
});

describe('campaign runs', () => {
  it('campaignConfig/resolveLevelConfig derive the run from the level and win it at the finish line', () => {
    const cfg = campaignConfig(1, { reducedMotion: true });
    expect(cfg).toMatchObject({ seed: hashString('journey-1'), mode: 'campaign', profile: 3, tutorial: false, plan: false, level: 1, biome: 'meadow', drain: 28, startDay: 1, startT: 0, reducedMotion: true });
    expect(cfg.mods).toEqual(['drag']);
    expect(cfg.forecast).toBeUndefined();
    expect(campaignConfig(9).forecast).toBe('breezy');
    // The level wins over whatever else the config says.
    expect(resolveLevelConfig({ ...headlessConfig(5, 0), level: 4 }).seed).toBe(hashString('journey-4'));
    const plain = headlessConfig(5);
    expect(resolveLevelConfig(plain)).toBe(plain);

    const { s, events } = play(1, 'reactive');
    const level = levelDef(1) as LevelDef;
    expect(s.phase).toBe('won');
    expect(s.death).toBeNull();
    expect(s.level).toBe(level);
    expect(s.mods.has('drag')).toBe(true);
    expect(s.nubs.y).toBeGreaterThanOrEqual(s.world.finishY);
    expect(levelProgress(s)).toBe(1);
    const won = events.find((e) => e.e === 'levelWon');
    expect(won && won.e === 'levelWon' && won.passed).toBe(true);
    const r = buildRunResult(s);
    expect(r.mode).toBe('campaign');
    expect(r.level).toEqual({ id: 1, passed: true, stars: starsFor(level, s.stats), introduces: 'drag' });
    expect(r.level?.stars).toBeGreaterThanOrEqual(1);
    expect(won && won.e === 'levelWon' ? [won.stars, won.flakes, won.minChill] : null).toEqual([r.level?.stars, s.stats.flakes, s.stats.minChill]);
    // A finish banner stands at the line (kind 'finish', not a gate) and step() is a no-op afterwards.
    const banner = s.world.casters.find((c) => c.kind === 'finish');
    expect(banner).toBeDefined();
    expect(Math.abs((banner?.y ?? 0) - s.world.finishY)).toBeLessThanOrEqual(120);
    expect(banner?.gate).toBe(false);
    const h = hashState(s);
    step(s, TAP);
    expect(hashState(s)).toBe(h);
    expect(s.events).toHaveLength(0);
    // The level ends at 10 AM: 240 minutes after a dawn start.
    expect(s.minutes).toBe(240);
  });

  it('the finish line is at yAtMinute(start + length); a mid-day start puts the start hut by Nubs', () => {
    const s = createRun(campaignConfig(4));
    const level = levelDef(4) as LevelDef;
    expect(s.day).toBe(1);
    expect(s.dayTick).toBe(tickAtMinute(270));
    expect(s.nubs.y).toBeCloseTo(yAtDayTick(1, tickAtMinute(270)), 9);
    expect(s.world.finishY).toBeCloseTo(yAtDayTick(1, tickAtMinute(270 + 180)), 9);
    const hut = s.world.byId.get(s.world.startHutId)!;
    expect(hut.y).toBeCloseTo(s.nubs.y + 10, 9);
    expect(levelProgress(s)).toBe(0);
    expect(level.lengthMinutes).toBe(180);
    // At the start the sun points at the hut and the first clock tick leaves Nubs under its shade.
    step(s, TAP);
    expect(s.nubs.f).toBe(0);
  });

  it('a goal missed at the line still ends the run: levelWon with passed false and stars 0', () => {
    const { s, events } = play(2, 'reactive', (run) => {
      run.world.pickups.length = 0; // no flakes anywhere: the goal cannot be met
      run.world.validatedThrough = 1e6;
    });
    expect(s.phase).toBe('won');
    expect(s.stats.flakes).toBe(0);
    const won = events.find((e) => e.e === 'levelWon');
    expect(won).toEqual({ e: 'levelWon', passed: false, stars: 0, flakes: 0, minChill: s.stats.minChill });
    expect(buildRunResult(s).level).toEqual({ id: 2, passed: false, stars: 0, introduces: 'flakes' });
    expect(levelOutcome(levelDef(2) as LevelDef, s)).toEqual({ id: 2, passed: false, stars: 0, introduces: 'flakes' });
  });

  it('melting on a level gives passed false, stars 0 and a death', () => {
    const { s } = play(1, 'idle');
    expect(s.phase).toBe('dead');
    expect(buildRunResult(s).level).toEqual({ id: 1, passed: false, stars: 0, introduces: 'drag' });
    expect(levelProgress(s)).toBeLessThan(1);
  });

  it('minChill tracks the lowest daylight Chill (and starts at the starting Chill)', () => {
    const s = started(1);
    expect(s.stats.minChill).toBe(100);
    for (let i = 0; i < 90; i++) step(s, NO_INPUT); // θ0 only: lit soon
    expect(s.stats.minChill).toBeLessThan(100);
    expect(s.stats.minChill).toBeLessThanOrEqual(s.nubs.chill);
    expect(createRun(campaignConfig(25)).stats.minChill).toBe(50);
  });

  it('ration starts at 50 Chill with a 50 tank; frosty regenerates ×2.5', () => {
    const r = createRun(campaignConfig(25));
    expect([r.nubs.chill, r.nubs.maxChill, r.params.maxChill]).toEqual([50, 50, 50]);
    expect(r.world.carryC[Math.round(r.theta0) % 360]).toBe(50);
    expect(createRun(campaignConfig(24)).params.regen).toBe(75);
  });

  it('hardy flakes never melt; quick melt flakes melt in half a second', () => {
    const { s } = play(27, 'reactive');
    expect(s.params.meltBudget).toBe(Infinity);
    expect(s.stats.flakesMelted).toBe(0);
    expect(s.world.pickups.every((p) => p.state !== 2)).toBe(true);
    expect(createRun(campaignConfig(26)).params.meltBudget).toBe(0.5);
  });

  it('sprint scales the world by walkMul: Nubs covers 1.35× the ground per tick and the clock is unchanged', () => {
    const s = started(15);
    expect(s.world.walkMul).toBe(1.35);
    for (let i = 0; i < 120; i++) step(s, NO_INPUT);
    expect(s.nubs.y).toBeCloseTo(yAtDayTick(1, s.dayTick) * 1.35, 9);
    expect(s.dayTick).toBe(120);
    expect(s.world.finishY).toBeCloseTo(yAtDayTick(1, tickAtMinute(300)) * 1.35, 9);
    // Chunks hold the same clock span scaled: the finish banner sits at the line.
    const banner = s.world.casters.find((c) => c.kind === 'finish');
    expect(banner).toBeDefined();
  });

  it('giants scale caster heights ×1.6 (rescue rocks and the start hut shade excepted)', () => {
    const g = createWorld(campaignConfig(17));
    ensureGenerated(g, 2000);
    const trees = g.casters.filter((c) => c.kind === 'tree');
    expect(trees.length).toBeGreaterThan(0);
    for (const t of trees) expect(t.maxZ).toBeCloseTo(75 * 1.6, 9);
    const low = createWorld(campaignConfig(18));
    ensureGenerated(low, 2000);
    for (const c of low.casters) if (c.kind === 'house') expect(c.maxZ).toBeCloseTo(110 * 0.6, 9);
  });

  it('the gate concept puts a gate arch at the midpoint and pays +10 Snow when passed fully shaded', () => {
    const w = createWorld(campaignConfig(8));
    const mid = yAtDayTick(1, tickAtMinute(120));
    ensureGenerated(w, mid + 1000);
    const gate = w.casters.find((c) => c.gate);
    expect(gate).toBeDefined();
    expect(Math.abs((gate?.y ?? 0) - mid)).toBeLessThanOrEqual(120);
    const { s, events } = play(8, 'oracle');
    expect(s.phase).toBe('won');
    const g = events.filter((e) => e.e === 'gateArch');
    expect(g.length).toBeGreaterThanOrEqual(1);
    for (const e of g) if (e.e === 'gateArch') expect([0, 10]).toContain(e.snow);
    // Outside the campaign a gate arch pays nothing.
    const plain = createRun({ ...headlessConfig(3, 3), plan: false });
    const bot = createBot('oracle');
    let paid = 0;
    let seen = 0;
    for (let i = 0; i < 6000 && plain.phase !== 'dead'; i++) {
      step(plain, bot.next(plain));
      for (const e of plain.events) if (e.e === 'gateArch') {
        seen++;
        paid += e.snow;
      }
    }
    expect(seen).toBeGreaterThan(0);
    expect(paid).toBe(0);
  }, 30_000);

  it('eclipse: 6 s of full shade everywhere at the midpoint, then the sun comes back on the far side', () => {
    const s = started(36);
    const w = s.world;
    expect(w.eclipseTick).toBeGreaterThan(0);
    expect(w.eclipseTick + ECLIPSE_SEC * 60).toBe(tickAtMinute(150) + 180);
    // An empty world (Nubs in full sun), the clock jumped to just before the window.
    strip(s);
    jumpTo(s, w.eclipseTick - 5);
    let maxEclipse = 0;
    let shadedTicks = 0;
    let lastOn = -1;
    let litBefore = 0;
    let thetaIn = Number.NaN;
    while (s.phase === 'day' && s.tickAbs < w.eclipseTick + ECLIPSE_SEC * 60 + 10) {
      step(s, NO_INPUT);
      if (s.eclipseOn) {
        expect(eclipseAt(w, s.tickAbs)).toBe(true);
        expect(s.nubs.f).toBe(0);
        if (s.guide.tick === s.tick) expect(s.guide.now.every((v) => v === 1)).toBe(true);
        shadedTicks++;
        lastOn = s.tickAbs;
      } else {
        expect(s.eclipse).toBe(0);
        if (s.nubs.f === 1) litBefore++;
      }
      if (s.eclipse > maxEclipse) maxEclipse = s.eclipse;
      if (s.eclipseOn) thetaIn = s.sun.theta;
    }
    expect(Math.abs(angleDiff(s.sun.theta, thetaIn))).toBeCloseTo(180, 9);
    expect([s.sun.mode, s.sun.omega, s.sun.lag]).toEqual(['idle', 0, 0]);
    expect(s.phase).toBe('day');
    expect(litBefore).toBeGreaterThan(0);
    expect(shadedTicks).toBe(ECLIPSE_SEC * 60);
    expect(maxEclipse).toBe(1);
    expect(lastOn).toBe(w.eclipseTick + ECLIPSE_SEC * 60 - 1);
    expect(s.eclipseOn).toBe(false);
    expect(s.nubs.f).toBe(1);
  });

  it('lock: every 7 s the sun ignores input for 1.2 s and the renderer sees sun.locked', () => {
    expect(sunLockedAt(419)).toBe(false);
    expect(sunLockedAt(420)).toBe(true);
    expect(sunLockedAt(491)).toBe(true);
    expect(sunLockedAt(492)).toBe(false);
    expect(sunLockedAt(840)).toBe(true);
    const s = started(33);
    shadeAll(s);
    const drag = f({ down: true, downEdge: true, dTheta: 2 });
    step(s, drag);
    const hold = f({ down: true, dTheta: 2 });
    while (s.dayTick < 419) step(s, hold);
    expect(s.phase).toBe('day');
    expect(s.sun.locked).toBe(false);
    let theta = Number.NaN;
    let lockedTicks = 0;
    while (s.dayTick < 500 && s.phase === 'day') {
      step(s, hold);
      if (s.sun.locked) {
        lockedTicks++;
        if (Number.isNaN(theta)) theta = s.sun.theta;
        else expect(s.sun.theta).toBe(theta); // frozen for the whole lock
      }
    }
    expect(lockedTicks).toBe(72);
    expect(s.sun.locked).toBe(false);
    expect(s.sun.theta).not.toBe(theta);
  });

  it('gusts: a 2 s gust every 8 s turns the sun at 25°/s in a seeded direction; sun.gust tells the HUD', () => {
    expect(sunGustAt(479)).toBe(-1);
    expect(sunGustAt(480)).toBe(1);
    expect(sunGustAt(599)).toBe(1);
    expect(sunGustAt(600)).toBe(-1);
    expect(sunGustAt(960)).toBe(2);
    const s = started(32);
    shadeAll(s);
    while (s.dayTick < 479) step(s, NO_INPUT);
    expect(s.phase).toBe('day');
    expect(s.sun.gust).toBe(0);
    const before = s.sun.theta;
    let dir = 0;
    let n = 0;
    while (s.dayTick < 600 && s.phase === 'day') {
      step(s, NO_INPUT);
      if (s.sun.gust !== 0) {
        n++;
        if (dir === 0) dir = s.sun.gust;
        expect(s.sun.gust).toBe(dir);
      }
    }
    expect(n).toBe(120);
    expect(Math.abs(angleDiff(s.sun.theta, before))).toBeCloseTo(50, 6);
    expect(Math.sign(angleDiff(s.sun.theta, before))).toBe(dir);
    // Deterministic per seed, and the other gusts can blow the other way.
    const dirs = new Set<number>();
    const t = started(32);
    shadeAll(t);
    while (t.dayTick < 2 * 480 + 10 && t.phase === 'day') {
      step(t, NO_INPUT);
      if (t.sun.gust !== 0) dirs.add(t.sun.gust);
    }
    expect(dirs.size).toBeGreaterThanOrEqual(1);
    const again = started(32);
    shadeAll(again);
    while (again.dayTick < 600 && again.phase === 'day') step(again, NO_INPUT);
    expect(again.sun.theta).toBe(s.sun.theta);
  });

  it('clockwork: a release snaps the target to the nearest 30° without coasting', () => {
    const s = started(31);
    step(s, f({ down: true, downEdge: true, dTheta: 20 }));
    step(s, f({ upEdge: true, dTheta: 3, release: 900 }));
    expect(s.sun.omegaRel).toBe(0);
    for (let i = 0; i < 60 && s.sun.mode !== 'idle'; i++) step(s, NO_INPUT);
    expect(s.sun.mode).toBe('idle');
    expect(Math.abs(angleDiff(s.sun.theta, Math.round(s.sun.theta / 30) * 30))).toBeLessThan(1e-9);
  });

  it('heavy: the sun follows at 220°/s and never coasts; slippery: a flick coasts far', () => {
    const heavy = started(29);
    step(heavy, f({ down: true, downEdge: true, dTheta: 90 }));
    expect(heavy.sun.dTheta).toBeCloseTo(220 / 60, 9);
    step(heavy, f({ upEdge: true, release: 1000 }));
    expect(heavy.sun.omegaRel).toBe(0);
    for (let i = 0; i < 120 && heavy.sun.mode !== 'idle'; i++) step(heavy, NO_INPUT);
    expect(heavy.sun.mode).toBe('idle');

    const slip = started(30);
    shadeAll(slip);
    step(slip, f({ down: true, downEdge: true }));
    step(slip, f({ upEdge: true, release: 1000 }));
    let travel = 0;
    for (let i = 0; i < 3000 && slip.sun.mode !== 'idle' && slip.phase === 'day'; i++) {
      step(slip, NO_INPUT);
      travel += slip.sun.dTheta;
    }
    // At e^(−0.35/60) per tick a 360°/s flick coasts well over three full turns (plain: ≈ 103°).
    expect(Math.abs(travel)).toBeGreaterThan(900);
  });

  it('moonlit: a moon sun with noon elevation 30° and 0.7× the drain; s.moonlit for the renderer', () => {
    const s = createRun(campaignConfig(38));
    expect(s.moonlit).toBe(true);
    expect(createRun(campaignConfig(1)).moonlit).toBe(false);
    expect(s.params.epsNoon).toBe(30);
    expect(elevation(s.params, s.params.dayLen / 2)).toBe(30);
    expect(s.params.drainMul).toBe(0.7);
    const lab = started(38);
    strip(lab);
    for (let i = 0; i < 60; i++) step(lab, NO_INPUT);
    expect(lab.nubs.chill).toBeCloseTo(100 - (levelDef(38) as LevelDef).drain * 0.7, 6);
  });

  it('the validator uses the level drain, regen and max Chill, and skips the stretch after the finish', () => {
    const w = createWorld(campaignConfig(25));
    ensureGenerated(w, w.finishY + 1800);
    expect(w.validatorDrain).toBe((levelDef(25) as LevelDef).drain);
    expect(w.stats.unresolved).toBe(0);
    // Past the finish line nothing is rescued (that stretch is unused).
    expect(w.casters.some((c) => c.rescue && c.y > w.finishY + 300)).toBe(false);
    const boss = createWorld(campaignConfig(40));
    expect(boss.validatorDrain).toBe((levelDef(40) as LevelDef).drain);
  });

  it('a level prepared in slices is the level built at once, and campaign state is hashed', () => {
    const cfg = campaignConfig(36);
    const plain = createRun(cfg);
    const build = prepareRun(cfg);
    while (!prepareSome(build, 5));
    const sliced = createRun(cfg, build);
    expect(hashState(sliced)).toBe(hashState(plain));
    const a = createBot('reactive');
    const b = createBot('reactive');
    for (let i = 0; i < 1200; i++) {
      step(plain, a.next(plain));
      step(sliced, b.next(sliced));
    }
    expect(hashState(sliced)).toBe(hashState(plain));
    expect(plain.phase).toBe('day');
    // Eclipse intensity is part of the hash.
    const h = hashState(plain);
    plain.eclipse = 0.5;
    expect(hashState(plain)).not.toBe(h);
  }, 30_000);

  it('non-campaign runs are untouched: no level, no mods, finish at infinity, nothing new hashed', () => {
    const s = runBot(headlessConfig(7, 3), 600, 'reactive');
    expect(s.level).toBeNull();
    expect(s.mods.size).toBe(0);
    expect(s.world.finishY).toBe(Infinity);
    expect(s.world.walkMul).toBe(1);
    expect(s.world.startY).toBe(0);
    expect(levelProgress(s)).toBe(0);
    expect(buildRunResult(s).level).toBeUndefined();
    const h = hashState(s);
    s.eclipse = 1;
    s.sun.gust = 1;
    expect(hashState(s)).toBe(h);
  });

  it('the oracle finishes a sample of levels alive (the full gate is scripts/sim.ts --campaign)', () => {
    for (const id of [3, 10, 33, 40, 100]) {
      const { s } = play(id, 'oracle');
      expect(s.phase, `level ${id}`).toBe('won');
      expect(buildRunResult(s).level?.passed, `level ${id}`).toBe(true);
    }
  }, 60_000);

  it('a dawn level covers the first 1500 daylight ticks exactly: dayTicks(1) = 3000', () => {
    expect(dayTicks(1)).toBe(3000);
    expect(tickAtMinute(360)).toBe(1500);
    expect(tickAtMinute(720)).toBe(3000);
    expect(tickAtMinute(1080)).toBe(3480 + 1500);
  });
});
