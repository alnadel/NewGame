// Elementals heroes (docs/ELEMENTALS.md §1-§2, §4.7-§4.8, §5.6): the shared helpers, the §1.7 rate
// table at the trial drains, and each hero's rules, ability, relay TAGs, the duo, flakes, the death
// lines and the trial hash block. Rules are driven through applyHeroDaylight with the lit sum set by
// hand (the world's coverage is not under test here); whole runs prove the step order.
import { describe, expect, it } from 'vitest';
import { trialDef, type TrialDef } from '../../src/config/trials.ts';
import { DT, tickAtMinute } from '../../src/core/clock.ts';
import { worldYAtDayTick, worldYAtTick } from '../../src/core/gen/plan.ts';
import { campaignConfig } from '../../src/core/level.ts';
import { SEED_ID_BASE, type Bud, type Pickup } from '../../src/core/objects.ts';
import { createBot } from '../../src/core/sim/bots.ts';
import { createRun } from '../../src/core/sim/create.ts';
import type { SimEvent } from '../../src/core/sim/events.ts';
import { updateGuide } from '../../src/core/sim/guide.ts';
import { hashState } from '../../src/core/sim/hash.ts';
import {
  abilityHero,
  applyHeroDaylight,
  castHero,
  heroDeath,
  heroFlake,
  heroHealth,
  heroRates,
  heroStart,
  nextTagHero,
  nextTagTicks,
  relayY,
  tagLocked,
  tagTick,
} from '../../src/core/sim/heroes.ts';
import { historyAt } from '../../src/core/sim/history.ts';
import { step } from '../../src/core/sim/step.ts';
import { NO_INPUT, type InputFrame, type NubsState, type SimState } from '../../src/core/sim/types.ts';
import { trailX } from '../../src/core/trail.ts';

const R = 30;
/** The table rounded to 0.1 (+ 0 turns a rounded −0 into 0). */
const row = (t: Float64Array | null): number[] => Array.from(t as Float64Array, (v) => Math.round(v * 10) / 10 + 0);
const TAP: InputFrame = { dTheta: 0, down: false, downEdge: true, upEdge: true, release: 0, key: 0 };

/** Trial `id` after its start beat: the clock running, daylight. */
function going(id: number): SimState {
  const s = createRun(campaignConfig(id));
  step(s, TAP);
  while (s.ready > 0) step(s, NO_INPUT);
  return s;
}

/** One hero daylight tick with the lead's lit sum (and centre weight, and the mate's lit sum) set by hand; its events. */
function tick(s: SimState, c: number, w0 = c === 0 ? 0 : 1, mateC?: number): SimEvent[] {
  s.events.length = 0;
  s.nubs.c = c;
  s.nubs.w[0] = w0;
  if (s.mate && mateC !== undefined) s.mate.c = mateC;
  applyHeroDaylight(s);
  return s.events;
}

const kinds = (ev: readonly SimEvent[]): string[] => ev.map((e) => e.e);
const close = (a: number, b: number): void => expect(a).toBeCloseTo(b, 9);

describe('hero rates (§1.7)', () => {
  it('pins the table heroes at the trial drains', () => {
    // c = 0..10
    expect(row(heroRates('nubs', 26, R))).toEqual([30, 18.8, 7.6, -3.6, -14.8, -26, -31.2, -36.4, -41.6, -46.8, -52]);
    expect(row(heroRates('ember', 26, R))).toEqual([-26, -18.4, -10.8, -3.2, 4.4, 12, 19.2, 26.4, 33.6, 40.8, 48]);
    expect(row(heroRates('ember', 18, R)).slice(0, 7)).toEqual([-18, -12, -6, 0, 6, 12, 19.2]);
    // Ember's safe set is rate(c) > 0: c 3 at D 18 is not safe.
    expect((heroRates('ember', 18, R) as Float64Array)[3]).toBeLessThanOrEqual(0);
    expect(row(heroRates('sprout', 24, R))).toEqual([-9.6, 18, 18, 18, 18, -24, -26.4, -28.8, -31.2, -33.6, -36]);
    expect(row(heroRates('sprout', 20, R))[0]).toBe(-8);
    expect(row(heroRates('sprout', 20, R))[10]).toBe(-30);
    expect(heroRates('ember', 26, R)).toBe(heroRates('ember', 26, R));
    expect(heroRates('volt', 26, R)).toBeNull();
    expect(heroRates('drip', 24, R)).toBeNull();
  });

  it('pins Volt at D 26 and Drip at D 24 (nb.rate is per second)', () => {
    const v = going(1003);
    v.voltLit = true;
    tick(v, 6);
    close(v.nubs.rate, -15.6);
    tick(v, 3);
    close(v.nubs.rate, -7.8);
    tick(v, 0);
    close(v.nubs.rate, -3.9);
    const d = going(1004);
    tick(d, 0, 0);
    close(d.nubs.rate, -10.8);
    tick(d, 5, 1);
    close(d.nubs.rate, 10.8);
    tick(d, 6, 2);
    close(d.nubs.rate, 32.4);
  });
});

describe('hero helpers', () => {
  it('health, start meters and the ability hero', () => {
    expect(heroStart('drip', 100)).toBe(50);
    expect(heroStart('ember', 100)).toBe(100);
    const s = createRun(campaignConfig(1004));
    expect(heroHealth(s.nubs)).toBe(100);
    s.nubs.chill = 80;
    expect(heroHealth(s.nubs)).toBe(40);
    const n = createRun(campaignConfig(1006));
    n.nubs.chill = 60;
    expect(heroHealth(n.nubs)).toBe(60);
    expect(abilityHero(n)).toBe('nubs');
    expect(abilityHero(createRun(campaignConfig(1007)))).toBe('sprout');
    expect(abilityHero(createRun(campaignConfig(1003)))).toBe('volt');
    expect(abilityHero(createRun(campaignConfig(12)))).toBe('nubs');
  });

  it('schedules a relay on the 6-tick grid', () => {
    const s = createRun(campaignConfig(1005));
    const t = trialDef(1005) as TrialDef;
    const tag = 6 * Math.round(tickAtMinute(300) / 6);
    expect(tagTick(t, 0)).toBe(tag);
    expect(nextTagTicks(s)).toBe(tag - s.tickAbs);
    expect(nextTagHero(s)).toBe('ember');
    expect(tagLocked(s)).toBe(false);
    expect(relayY(s, 0)).toBe(worldYAtTick(s.world, tag));
    expect(relayY(s, t.relays.length)).toBe(-1e9);
    const solo = createRun(campaignConfig(1001));
    expect([nextTagTicks(solo), nextTagHero(solo), tagLocked(solo)]).toEqual([-1, null, false]);
  });
});

describe('Nubs, Ember and Sprout (table heroes)', () => {
  it('moves the meter by rate · DT, sets safe, and pays income from joy', () => {
    const s = going(1001);
    s.nubs.chill = 50;
    s.nubs.frost = 0;
    tick(s, 4);
    close(s.nubs.chill, 50 + 4.4 * DT);
    expect(s.nubs.safe).toBe(true);
    tick(s, 3);
    expect(s.nubs.safe).toBe(false);
    expect(s.nubs.frost).toBe(0);
    tick(s, 5);
    close(s.nubs.frost, 0.04 * DT);
    tick(s, 6);
    close(s.nubs.frost, 0.04 * DT + 0.25 * DT);
    // The meter is clamped to the tank; health below 25 fires lowChill once.
    s.nubs.chill = 99.99;
    tick(s, 10);
    expect(s.nubs.chill).toBe(100);
    s.nubs.chill = 25.1;
    expect(kinds(tick(s, 0))).toContain('lowChill');
    expect(kinds(tick(s, 0))).not.toContain('lowChill');
    expect(s.stats.minChill).toBeLessThan(25);
  });

  it('Nubs income only while fully shaded, and nothing while a Cold Snap rides', () => {
    const s = going(1005);
    s.nubs.frost = 0;
    tick(s, 0);
    close(s.nubs.frost, 0.05 * DT);
    tick(s, 1);
    close(s.nubs.frost, 0.05 * DT);
    s.snapTicks = 10;
    tick(s, 0);
    close(s.nubs.frost, 0.05 * DT);
  });

  it('Sprout feeds on the band, starves in shade and scorches in glare; its green thumb blooms buds', () => {
    const s = going(1002);
    s.nubs.chill = 50;
    tick(s, 2);
    close(s.nubs.chill, 50 + 18 * DT);
    expect(s.nubs.safe).toBe(true);
    tick(s, 0);
    expect(s.nubs.safe).toBe(false);
    close(s.nubs.rate, -9.6);
    tick(s, 7);
    close(s.nubs.rate, -28.8);
    // Green thumb: a safe Sprout blooms every unbloomed bud within 24 u of its y.
    const bud = s.world.buds.find((b) => b.y > s.nubs.y + 30 && b.state === 0) as Bud;
    s.nubs.y = bud.y - 20;
    s.nubs.frost = 0;
    const blooms = s.stats.blooms ?? 0;
    const ev = tick(s, 2);
    expect(bud.state).toBe(1);
    expect(s.stats.blooms).toBeGreaterThan(blooms);
    expect(kinds(ev)).toContain('bloom');
    expect(s.nubs.frost).toBeGreaterThanOrEqual(0.12);
    // Not while unsafe.
    const next = s.world.buds.find((b) => b.y > bud.y + 30 && b.state === 0) as Bud;
    s.nubs.y = next.y;
    tick(s, 5);
    expect(next.state).toBe(0);
  });

  it('BLAZE: costs the charge, counts c as at least 5 for 180 ticks, counts blazeTicks, then abilityEnd', () => {
    const s = going(1001);
    s.nubs.frost = 0.99;
    expect(castHero(s)).toBe(false);
    s.nubs.frost = 1;
    s.events.length = 0;
    expect(castHero(s)).toBe(true);
    expect(s.events[0]).toMatchObject({ e: 'ability', hero: 'ember', kind: 'blaze' });
    expect([s.nubs.frost, s.heroAbility, s.heroTicks]).toEqual([0, 'blaze', 180]);
    s.nubs.frost = 1;
    expect(castHero(s)).toBe(false); // a timed ability runs
    s.nubs.chill = 50;
    s.nubs.frost = 0;
    tick(s, 0);
    close(s.nubs.chill, 50 + 12 * DT);
    expect(s.nubs.safe).toBe(true);
    expect(s.stats.blazeTicks).toBe(1);
    tick(s, 4); // raw c 4 is safe: not a Blaze save
    expect(s.stats.blazeTicks).toBe(1);
    let ended = 0;
    for (let i = 0; i < 178; i++) ended += kinds(tick(s, 0)).filter((k) => k === 'abilityEnd').length;
    expect([ended, s.heroAbility, s.stats.blazeTicks]).toEqual([1, null, 179]);
    tick(s, 0);
    expect(s.nubs.safe).toBe(false);
  });
});

describe('SEED', () => {
  it("plants Sprout's Sunflower 84 ticks ahead, 30 u off the trail on the sun's side, and the guide sees it", () => {
    const a = going(1002);
    const b = going(1002);
    a.nubs.frost = 1;
    a.events.length = 0;
    expect(castHero(a)).toBe(true);
    const c = a.world.byId.get(SEED_ID_BASE);
    expect(c).toBeDefined();
    const y = worldYAtDayTick(a.world, a.day, a.dayTick + 84);
    expect(c).toMatchObject({ kind: 'sunflower', name: "Sprout's Sunflower", y, side: a.ux >= 0 ? 1 : -1 });
    expect(c?.x).toBeCloseTo(trailX(a.world.trail, y) + (a.ux >= 0 ? 30 : -30), 9);
    expect(a.events[0]).toMatchObject({ e: 'ability', hero: 'sprout', kind: 'seed', x: c?.x, y });
    expect([a.stats.seeds, a.nubs.frost, a.heroAbility]).toEqual([1, 0, null]);
    // The same run with and without the flower: its shade shows up in the guide as Sprout arrives.
    let differs = false;
    for (let i = 0; i < 84 && !differs; i++) {
      step(a, NO_INPUT);
      step(b, NO_INPUT);
      updateGuide(a);
      updateGuide(b);
      for (let k = 0; k < 360; k++) if ((a.guide.lit[k] as number) < (b.guide.lit[k] as number)) differs = true;
    }
    expect(differs).toBe(true);
  });
});

describe('Volt', () => {
  it('hysteresis, dead zone, refractory, chain and its cap', () => {
    const s = going(1003);
    const th = s.sun.theta;
    // Hysteresis: lit stays lit at c 2, shaded at c 1, stays shaded at c 2, lit again at c 3.
    s.voltLit = true;
    tick(s, 2);
    expect(s.voltLit).toBe(true);
    s.voltTheta = th;
    s.voltTick = s.tick - 100;
    s.nubs.chill = 50;
    expect(kinds(tick(s, 1))).not.toContain('strike'); // inside the dead zone
    expect(s.voltLit).toBe(false);
    expect(s.nubs.safe).toBe(true);
    tick(s, 2);
    expect(s.voltLit).toBe(false);
    tick(s, 3);
    expect(s.voltLit).toBe(true);
    // A strike: 40° or more from the last, 45 ticks or more after it.
    s.voltTheta = (th + 90) % 360;
    s.voltTick = s.tick - 30;
    expect(kinds(tick(s, 0))).not.toContain('strike'); // refractory
    s.voltLit = true;
    s.voltTick = s.tick - 200;
    s.voltChain = 4;
    s.nubs.chill = 50;
    let ev = tick(s, 0);
    expect(ev.find((e) => e.e === 'strike')).toMatchObject({ chain: 1, gain: 15, thunder: false });
    close(s.nubs.chill, 50 - 3.9 * DT + 15);
    expect([s.voltTheta, s.voltTick, s.voltChain, s.stats.strikes]).toEqual([th, s.tick, 1, 1]);
    // Chained within 90 ticks: x2 at +18.75, … capped at x5 (+30); income from x3.
    for (const [chain, gain] of [
      [2, 18.75],
      [3, 22.5],
      [4, 26.25],
      [5, 30],
      [5, 30],
    ] as const) {
      s.voltLit = true;
      s.voltTheta = (s.voltTheta + 60) % 360;
      s.voltTick = s.tick - 60;
      s.nubs.frost = 0;
      ev = tick(s, 0);
      expect(ev.find((e) => e.e === 'strike')).toMatchObject({ chain, gain });
      close(s.nubs.frost, chain >= 3 ? 0.1 : 0);
    }
    expect(s.stats.bestChain).toBe(5);
  });

  it('THUNDERCLAP strikes at θ: dead zone and refractory ignored, ×1.5, a chain step', () => {
    const s = going(1003);
    s.voltTheta = s.sun.theta;
    s.voltTick = s.tick - 1;
    s.voltChain = 2;
    s.nubs.chill = 20;
    s.nubs.frost = 1;
    s.events.length = 0;
    expect(castHero(s)).toBe(true);
    expect(kinds(s.events)).toEqual(['ability', 'strike']);
    expect(s.events[1]).toMatchObject({ chain: 3, gain: 33.75, thunder: true });
    close(s.nubs.chill, 53.75);
    expect([s.voltTheta, s.voltTick, s.heroAbility]).toEqual([s.sun.theta, s.tick, null]);
    close(s.nubs.frost, 0.1);
  });
});

describe('Drip', () => {
  it('reads its centre sample, wants a side with hysteresis, counts calm and pays income', () => {
    const s = going(1004);
    expect([s.nubs.chill, s.dripCool]).toEqual([50, true]);
    s.nubs.frost = 0;
    tick(s, 4, 0); // c 4 but the centre is shaded: cools
    close(s.nubs.chill, 50 - 10.8 * DT);
    expect(s.nubs.safe).toBe(true);
    expect(s.stats.calmTicks).toBe(1);
    close(s.nubs.frost, 0.06 * DT);
    s.nubs.chill = 45.1;
    tick(s, 0, 0);
    expect(s.dripCool).toBe(false); // ≤ 45: wants sun
    tick(s, 5, 1);
    expect(s.nubs.safe).toBe(true);
    s.nubs.chill = 54;
    tick(s, 5, 1);
    expect(s.dripCool).toBe(false); // between 45 and 55 it keeps its side
    s.nubs.chill = 55;
    tick(s, 5, 1);
    expect(s.dripCool).toBe(true);
    s.nubs.chill = 80;
    const calm = s.stats.calmTicks;
    tick(s, 0, 0);
    expect(s.stats.calmTicks).toBe(calm);
  });

  it('freezes at 0 and boils at 100 (chill 0, heroCause boil), with their lines', () => {
    const f = going(1004);
    f.nubs.chill = 0.1;
    tick(f, 0, 0);
    expect([f.nubs.chill, f.heroCause]).toEqual([0, null]);
    expect(heroDeath(f)).toMatchObject({ who: 'drip', heroCause: 'freeze' });
    expect(heroDeath(f).line).toMatch(/^Froze solid in the shade/);
    const b = going(1004);
    b.nubs.chill = 99.9;
    tick(b, 5, 1);
    expect([b.nubs.chill, b.heroCause]).toEqual([0, 'boil']);
    expect(heroDeath(b)).toMatchObject({ who: 'drip', heroCause: 'boil', cause: 'plain' });
    expect(heroDeath(b).line).toMatch(/^Boiled away in full sun at .*\.$/);
    // Through step(): the death check fires on the boil.
    const s = going(1004);
    for (let i = 0; i < 600 && s.phase !== 'dead'; i++) {
      if (s.nubs.w[0] === 1) s.nubs.chill = 99.99;
      step(s, NO_INPUT);
    }
    expect(s.phase).toBe('dead');
    expect(s.death?.who).toBe('drip');
  });

  it('CLOUDBURST eases T to 50 for 90 ticks whatever the light', () => {
    const s = going(1004);
    s.nubs.frost = 1;
    expect(castHero(s)).toBe(true);
    expect([s.heroAbility, s.heroTicks]).toEqual(['rain', 90]);
    s.nubs.chill = 80;
    tick(s, 10, 2);
    close(s.nubs.chill, 80 - 30 * 0.05);
    expect(s.nubs.safe).toBe(true);
    let ended = 0;
    for (let i = 0; i < 89; i++) ended += kinds(tick(s, 10, 2)).filter((k) => k === 'abilityEnd').length;
    expect([ended, s.heroAbility]).toEqual([1, null]);
    expect(Math.abs(s.nubs.chill - 50)).toBeLessThan(1);
  });
});

describe('relay (§2.1)', () => {
  it('telegraphs, locks the ability, then TAGs at its tick: the incoming hero at its start meter', () => {
    const t = trialDef(1005) as TrialDef;
    const s = going(1005);
    const bot = createBot('reactive');
    const tag = tagTick(t, 0);
    let soon: SimEvent | undefined;
    while (s.tickAbs < tag - 1 && s.phase === 'day') {
      step(s, bot.next(s));
      soon ??= s.events.find((e) => e.e === 'tagSoon');
      if (s.tickAbs === tag - 180) expect(s.events).toContainEqual({ e: 'tagSoon', to: 'ember', ticks: 180 });
    }
    expect(soon).toEqual({ e: 'tagSoon', to: 'ember', ticks: 180 });
    expect(tagLocked(s)).toBe(true);
    s.nubs.frost = 1;
    expect(castHero(s)).toBe(false);
    expect(s.guide.tag.some((v) => v === 1)).toBe(true);
    step(s, NO_INPUT);
    expect(s.tickAbs).toBe(tag);
    expect(s.events.find((e) => e.e === 'tag')).toEqual({ e: 'tag', from: 'nubs', to: 'ember', index: 0 });
    expect([s.nubs.hero, s.relayIdx, s.stats.tags, s.nubs.frost]).toEqual(['ember', 1, 1, 1]);
    expect(s.nubs.chill).toBe(100); // the start meter, and the grace holds it
    expect(s.tagGrace).toBe(29);
    expect(tagLocked(s)).toBe(false);
  });

  it('holds the incoming meter for the grace and counts a TAG clean when safe within the watch', () => {
    const s = going(1001);
    s.nubs.chill = 70;
    s.tagGrace = 30;
    s.tagWatch = 30;
    tick(s, 0);
    expect([s.nubs.chill, s.nubs.rate, s.tagGrace, s.tagWatch]).toEqual([70, 0, 29, 29]);
    const ev = tick(s, 5);
    expect(ev).toContainEqual({ e: 'tagClean', to: 'ember' });
    expect([s.stats.cleanTags, s.tagWatch]).toEqual([1, 0]);
  });
});

describe('duo (§2.2)', () => {
  it("Harmony when both are safe: harmonyTicks and the ability hero's income ×2", () => {
    const s = going(1006);
    s.nubs.frost = 0;
    tick(s, 0, 0, 5);
    expect([s.nubs.safe, (s.mate as NubsState).safe, s.harmony, s.stats.harmonyTicks]).toEqual([true, true, true, 1]);
    close(s.nubs.frost, 2 * 0.05 * DT);
    tick(s, 0, 0, 0);
    expect(s.harmony).toBe(false);
    close(s.nubs.frost, 3 * 0.05 * DT);
  });

  it("guide.now is the AND of the lead's and the mate's masks", () => {
    const s = going(1006);
    updateGuide(s);
    const g = s.guide;
    let split = 0;
    for (let b = 0; b < 360; b++) {
      expect(g.now[b]).toBe((g.lead[b] as number) & (g.mate[b] as number));
      if (g.lead[b] !== g.mate[b]) split++;
    }
    expect(split).toBeGreaterThan(0);
  });

  it('either body at 0 ends the run; `who` names it and the line adds the partner', () => {
    const s = going(1006);
    for (let i = 0; i < 2000 && s.phase === 'day'; i++) {
      const m = s.mate as NubsState;
      if (m.c < 3) m.chill = 1e-9;
      step(s, NO_INPUT);
    }
    expect(s.phase).toBe('dead');
    expect(s.death).toMatchObject({ who: 'ember' });
    expect(s.death?.heroCause).toMatch(/snuff|douse/);
    expect(s.death?.line).toMatch(/ Nubs can't go on alone\.$/);
    expect(s.nubs.chill).toBeGreaterThan(0);
    // A same-tick tie goes to the lead.
    const t = going(1006);
    t.nubs.chill = 0;
    (t.mate as NubsState).chill = 0;
    expect(heroDeath(t)).toMatchObject({ who: 'nubs', heroCause: 'melt' });
    expect(heroDeath(t).line).toMatch(/^Melted by You at .* Ember can't go on alone\.$/);
  });
});

describe('flakes per hero', () => {
  const p = { x: 1, y: 2 } as Pickup;
  it('Nubs chills; Ember hisses (steam in a Blaze); Sprout sips; Drip gets an ice cube; Volt gets Snow only', () => {
    const cases: [number, number, number, number][] = [
      // trial, start meter, flake delta, crystal delta
      [1001, 50, -12, -24],
      [1002, 50, 8, 16],
      [1003, 50, 0, 0],
      [1004, 50, -15, -30],
    ];
    for (const [id, m, d1, d2] of cases) {
      const s = going(id);
      s.nubs.chill = m;
      s.events.length = 0;
      heroFlake(s, p, 1);
      expect(s.nubs.chill).toBe(m + d1);
      expect(s.events).toEqual([{ e: 'heroPickup', hero: s.nubs.hero, delta: d1, x: 1, y: 2 }]);
      heroFlake(s, p, 2);
      expect(s.nubs.chill).toBe(m + d1 + d2);
    }
    const n = going(1005);
    n.nubs.chill = 50;
    n.events.length = 0;
    heroFlake(n, p, 1);
    heroFlake(n, p, 2);
    expect([n.nubs.chill, n.events.length]).toEqual([91, 0]);
    const e = going(1001);
    e.nubs.frost = 1;
    castHero(e);
    e.nubs.chill = 10;
    e.events.length = 0;
    heroFlake(e, p, 1);
    expect([e.nubs.chill, e.events[0]]).toEqual([10, { e: 'heroPickup', hero: 'ember', delta: 0, x: 1, y: 2 }]);
    e.heroAbility = null;
    heroFlake(e, p, 1);
    expect([e.nubs.chill, e.heroCause]).toEqual([0, 'hiss']);
    expect(heroDeath(e)).toMatchObject({ who: 'ember', heroCause: 'hiss' });
    expect(heroDeath(e).line).toMatch(/^Hissed out by a snowflake at /);
  });
});

describe('the hero state in the hash, the history and the stats', () => {
  it('a trial hash feeds the hero state; a Nubs run feeds none of it', () => {
    const s = createRun(campaignConfig(1003));
    const h = hashState(s);
    s.voltChain = 3;
    expect(hashState(s)).not.toBe(h);
    const n = createRun(campaignConfig(12));
    const hn = hashState(n);
    n.voltChain = 3;
    n.harmony = true;
    expect(hashState(n)).toBe(hn);
  });

  it("the Melt Map history holds the lead's health; stats.minChill the lowest health of any body", () => {
    const s = going(1004);
    for (let i = 0; i < 120; i++) {
      s.nubs.chill = 80;
      step(s, NO_INPUT);
    }
    const out = new Float64Array(4);
    historyAt(s, 1, out);
    expect(out[2]).toBeGreaterThan(35);
    expect(out[2]).toBeLessThan(45);
    expect(s.stats.minChill).toBeLessThanOrEqual(41);
  });
});
