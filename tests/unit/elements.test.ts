// Elementals v2 rules (docs/ELEMENTALS_V2.md §1-§4, §7.7-§7.8; §9.6 CORE): each element's rate and
// meter, its verb's costs and refusals, the contact table, fire (feeds, spread, douse, burn-out),
// plants (holds, growth, bridges, trees), Drip's lane and keys, Gust's wind, weather and veils, the
// reads, the Drip mask, the death lines, the hash and a replay with verbs. Most cases put crafted
// objects ahead of the walker of a real Trial leg (so the relay schedule says whose stretch it is).
import { describe, expect, it } from 'vitest';
import type { HeroId } from '../../src/config/heroes.ts';
import { TUNING } from '../../src/config/tuning.ts';
import type { ElKind } from '../../src/config/trials.ts';
import { DT } from '../../src/core/clock.ts';
import { gatherScene } from '../../src/core/gen/store.ts';
import { worldElevation, worldYAtTick } from '../../src/core/gen/plan.ts';
import { tanD } from '../../src/core/dmath.ts';
import { BINS, createMaskScene, litMask } from '../../src/core/intervals.ts';
import { campaignConfig } from '../../src/core/level.ts';
import { EL_BURNING, EL_GONE, EL_ID_BASE, EL_IDLE, SNAP_ID_BASE, TREE_ID_BASE, type Cloud, type ElObj, type ElState } from '../../src/core/objects.ts';
import { createBot } from '../../src/core/sim/bots.ts';
import { createRun } from '../../src/core/sim/create.ts';
import {
  addRainProxy,
  applyElDaylight,
  arriveTicks,
  bridged,
  burnLeft,
  burnSweet,
  burnTarget,
  contactTicks,
  elHealth,
  growLeft,
  growTarget,
  laneOf,
  needOf,
  nextTagTicks,
  tagTick,
  veiled,
  walkerAt,
  weatherGood,
  weatherXAt,
  windAt,
} from '../../src/core/sim/elements.ts';
import { effectiveDrain } from '../../src/core/sim/nubs.ts';
import { hashState } from '../../src/core/sim/hash.ts';
import { createReplay, playReplay, recordFrame } from '../../src/core/sim/replay.ts';
import { step } from '../../src/core/sim/step.ts';
import { VERB_EAST, VERB_HOLD, VERB_KEY_BURN, VERB_KEY_HOLD, VERB_RELEASE, VERB_TAP, VERB_WEST, type InputFrame, type SimState } from '../../src/core/sim/types.ts';
import { trailX } from '../../src/core/trail.ts';

const E = TUNING.elements;
const O = E.objects;

/** A frame with no turn (the finger off the sun), plus the given element fields. */
function frame(extra: Partial<InputFrame> = {}): InputFrame {
  return { dTheta: 0, down: false, downEdge: false, upEdge: false, release: 0, key: 0, ...extra };
}

/** A run of trial `id`, walked by the reactive bot until `hero` walks (and `extra` ticks more). */
function runTo(id: number, hero: HeroId, extra = 0): SimState {
  const s = createRun(campaignConfig(id));
  const bot = createBot('reactive');
  while (s.nubs.hero !== hero || s.ready > 0 || s.phase !== 'day') {
    step(s, bot.next(s));
    if (s.phase === 'dead' || s.phase === 'won') throw new Error(`${id} ended before ${hero}`);
  }
  for (let i = 0; i < extra; i++) step(s, bot.next(s));
  return s;
}

const el = (s: SimState): ElState => s.el as ElState;

interface Row {
  readonly k: ElKind;
  /** u ahead of the walker. */
  readonly dy: number;
  readonly dx?: number;
  readonly r?: number;
  readonly drift?: number;
  readonly awake?: boolean;
}

/** Replaces the run's objects with crafted ones `dy` ahead of the walker (y-sorted, rain with its proxy). */
function place(s: SimState, rows: readonly Row[]): ElObj[] {
  const e = el(s);
  const w = s.world;
  for (let i = w.clouds.length - 1; i >= 0; i--) {
    const id = (w.clouds[i] as Cloud).id;
    if (id >= EL_ID_BASE && id < TREE_ID_BASE) w.clouds.splice(i, 1);
  }
  const sorted = [...rows].sort((a, b) => a.dy - b.dy);
  e.objs.length = 0;
  sorted.forEach((r, i) => {
    const y = s.nubs.y + r.dy;
    const radius = r.r ?? (r.k === 'puddle' ? O.puddleR : r.k === 'stone' ? O.stoneR : r.k === 'plot' ? O.plotR : 0);
    e.objs.push({ id: EL_ID_BASE + i, kind: r.k, x: trailX(w.trail, y) + (r.dx ?? 0), y, r: radius, drift: r.drift ?? 0, state: EL_IDLE, t: 0, paid: 0, size: 0, grown: 0, light: 0, casterId: -1, hit: false, awake: r.awake ?? false });
  });
  for (const o of e.objs) if (o.kind === 'rain') addRainProxy(s, o);
  return e.objs;
}

/** Steps with no input until `pred` holds (at most `max` ticks). */
function until(s: SimState, pred: () => boolean, max = 600, f: InputFrame = frame()): void {
  for (let i = 0; i < max && !pred(); i++) step(s, f);
  expect(pred()).toBe(true);
}

/** Steps with no input until `pred` holds, returning every event seen on the way. */
function collect(s: SimState, pred: () => boolean, max = 600): SimState['events'] {
  const seen: SimState['events'] = [];
  for (let i = 0; i < max && !pred(); i++) {
    step(s, frame());
    seen.push(...s.events);
  }
  expect(pred()).toBe(true);
  return seen;
}

/** The walker's meter after one daylight rule pass at lit sum c (no grace, no contacts). */
function rateAt(s: SimState, c: number): number {
  s.nubs.c = c;
  s.tagGrace = 0;
  s.nubs.chill = 50;
  applyElDaylight(s);
  return s.nubs.rate;
}

describe('rates and meters (§1.2, §2, §2.7)', () => {
  it('follow each element\'s formula by lit sum, with glare counting as full light', () => {
    const s = runTo(1005, 'ember', 1);
    place(s, []);
    const t = s.trial!;
    const D = effectiveDrain(s);
    const cases: [HeroId, (c: number) => number][] = [
      ['nubs', (c) => -D * (c / 5) + 30 * Math.max(0, 1 - c / 5)],
      ['ember', (c) => E.ember.refill * (Math.min(c, 5) / 5) - E.ember.fade * (1 - Math.min(c, 5) / 5)],
      ['drip', (c) => E.drip.grow * Math.max(0, 1 - c / 5) - (E.drip.evap * t.tune.evapMul * c) / 5],
      ['sprout', () => E.sprout.root],
      ['gust', () => E.gust.air],
    ];
    for (const [hero, want] of cases) {
      s.nubs.hero = hero;
      for (const c of [0, 1, 2, 3, 4, 5, 10]) expect([hero, c, rateAt(s, c)]).toEqual([hero, c, expect.closeTo(want(c), 9)]);
    }
    // Ember's safe line: c ≥ 2 refuels (with the shipped refill and fade).
    s.nubs.hero = 'ember';
    expect(rateAt(s, 1)).toBeLessThan(0);
    expect(rateAt(s, 2)).toBeGreaterThan(0);
  });

  it('let water and fog change the rates (rain, puddle, fog) and Sprout\'s Sap is no life meter', () => {
    const s = runTo(1005, 'ember', 1);
    place(s, [
      { k: 'rain', dy: 0, r: 40, awake: true },
      { k: 'fog', dy: 200, r: 40 },
    ]);
    s.nubs.hero = 'ember';
    expect(rateAt(s, 5)).toBeCloseTo(E.ember.refill - E.ember.rain, 9);
    s.nubs.hero = 'drip';
    expect(rateAt(s, 0)).toBeCloseTo(E.drip.grow + E.drip.rain, 9);
    s.nubs.hero = 'sprout';
    expect(rateAt(s, 0)).toBeCloseTo(E.sprout.root + E.sprout.rain, 9);
    s.nubs.hero = 'gust';
    expect(rateAt(s, 0)).toBeCloseTo(-E.gust.soak, 9);
    expect(el(s).touch & 2).toBe(2);
    // In fog Gust loses Lift and gets no air.
    place(s, [{ k: 'fog', dy: 0, r: 40 }]);
    expect(rateAt(s, 0)).toBeCloseTo(-E.gust.fog, 9);
    place(s, [{ k: 'puddle', dy: 0 }]);
    s.nubs.hero = 'ember';
    expect(rateAt(s, 5)).toBeCloseTo(E.ember.refill - E.ember.douse, 9);
    // Sap never moves the steady star.
    s.nubs.hero = 'sprout';
    s.stats.minChill = 100;
    s.nubs.chill = 1;
    s.nubs.c = 0;
    applyElDaylight(s);
    expect(s.stats.minChill).toBe(100);
  });

  it('starts each leg at its start meter and resets the leg at the TAG; steady health adds Ember\'s spending back', () => {
    const t = createRun(campaignConfig(1005)).trial!;
    const s = runTo(1005, 'ember');
    expect(s.nubs.chill).toBeCloseTo(t.tune.legStart[1] || E.start.ember, 0);
    expect([el(s).spent, el(s).hold, el(s).legTick > 0 && el(s).legTick < 3]).toEqual([0, -1, true]);
    s.nubs.chill = 40;
    el(s).spent = 22;
    expect(elHealth(s)).toBe(62);
    const d = runTo(1005, 'drip');
    expect(d.nubs.chill).toBeCloseTo(t.tune.legStart[2] || E.start.drip, 0);
    expect(el(d).spent).toBe(0);
  });
});

describe('the sun on a Trial (§4.1)', () => {
  it('holds while Drip or Gust walks, θ carried exactly, and turns again when Nubs takes over', () => {
    const s = createRun(campaignConfig(1004));
    const bot = createBot('reactive');
    let held = 0;
    let free = 0;
    while (s.phase !== 'won' && s.phase !== 'dead') {
      const was = s.nubs.hero;
      const theta = s.sun.theta;
      step(s, bot.next(s));
      if (s.ready > 0 || s.phase !== 'day') continue;
      if (was === 'gust' && s.nubs.hero === 'gust') {
        expect(s.sun.locked).toBe(true);
        expect(s.sun.theta).toBe(theta);
        held++;
      } else if (was === 'nubs' && s.nubs.hero === 'nubs') {
        expect(s.sun.locked).toBe(false);
        free++;
      }
    }
    expect(held).toBeGreaterThan(600);
    expect(free).toBeGreaterThan(600);
  });
});

describe('Ember (§2.2, §3.4)', () => {
  it('pays a tap\'s cost at once, refuses one it cannot afford, and burns for its time', () => {
    const s = runTo(1001, 'ember', 1);
    const [o] = place(s, [{ k: 'bramble', dy: 120 }]) as [ElObj];
    const cost = E.ember.cost.bramble * s.trial!.tune.costMul;
    const x = trailX(s.world.trail, o.y);
    s.nubs.chill = cost;
    step(s, frame({ verb: VERB_TAP, vx: x, vy: o.y }));
    expect(s.events.some((e) => e.e === 'fizz' && e.reason === 'low')).toBe(true);
    expect(o.state).toBe(EL_IDLE);
    s.nubs.chill = 80;
    const c0 = s.nubs.chill;
    step(s, frame({ verb: VERB_TAP, vx: x, vy: o.y }));
    expect(s.events.some((e) => e.e === 'burn' && e.obj === 0 && e.cost === cost && !e.spread)).toBe(true);
    expect([o.state, o.t, o.paid, el(s).spent]).toEqual([EL_BURNING, E.ember.burnTicks.bramble - 1, cost, cost]);
    expect(s.nubs.chill).toBeCloseTo(c0 - cost + s.nubs.rate * DT, 9);
    // Tapped on sight, it burns out long before Ember gets there: the cost is not taken back.
    const burns = s.stats.burns as number;
    until(s, () => o.state === EL_GONE, 120);
    expect(s.stats.burns).toBe(burns + 1);
    expect(el(s).spent).toBe(cost);
  });

  it('feeds on its own fire: a wall tapped in the sweet window costs nothing net; an untapped one bumps', () => {
    const s = runTo(1001, 'ember', 1);
    const [a, b] = place(s, [
      { k: 'gate', dy: 160 },
      { k: 'bramble', dy: 260 },
    ]) as [ElObj, ElObj];
    s.nubs.chill = 90;
    // The middle of the sweet window (its first tick would burn out just as Ember arrives).
    until(s, () => burnSweet(s, a), 300);
    for (let i = 0; i < 15; i++) step(s, frame());
    expect(burnSweet(s, a)).toBe(true);
    expect(burnTarget(s, NaN, NaN)).toBe(0);
    step(s, frame({ verb: VERB_KEY_BURN }));
    const paid = a.paid;
    expect([a.state, paid > 0, el(s).spent]).toEqual([EL_BURNING, true, paid]);
    const seen = collect(s, () => a.state === EL_GONE, 120);
    expect(seen.some((e) => e.e === 'feed' && e.obj === 0 && e.delta === paid)).toBe(true);
    expect(el(s).spent).toBe(0);
    // The bramble is never tapped: a bump smashes it.
    const bumps = s.stats.bumps as number;
    const hit = collect(s, () => b.hit, 300);
    expect(hit.some((e) => e.e === 'bump' && e.obj === 1 && e.delta === -E.bump && e.hero === 'ember')).toBe(true);
    expect([s.stats.bumps, b.state]).toEqual([bumps + 1, EL_GONE]);
  });

  it('refunds a tap on the sweet window\'s far tick (the tap lands next tick and still feeds)', () => {
    // Offsets across one tick of walking, so the window's first tick lands anywhere in its last step.
    for (const [k, dy] of [['bramble', 200], ['bramble', 200.6], ['gate', 200.3], ['gate', 200.9]] as const) {
      const s = runTo(1001, 'ember', 1);
      const [a] = place(s, [{ k, dy }]) as [ElObj];
      s.nubs.chill = 90;
      until(s, () => burnSweet(s, a), 300);
      step(s, frame({ verb: VERB_KEY_BURN }));
      expect(a.state).toBe(EL_BURNING);
      const seen = collect(s, () => a.state === EL_GONE, 120);
      expect(seen.some((e) => e.e === 'feed' && e.obj === 0)).toBe(true);
    }
  });

  it('passes a wall burning from spread fire without a refund, and melting ice still bumps', () => {
    const s = runTo(1001, 'ember', 1);
    const [g, ice] = place(s, [
      { k: 'gate', dy: 30 },
      { k: 'ice', dy: 80 },
    ]) as [ElObj, ElObj];
    g.state = EL_BURNING;
    g.t = 80;
    ice.state = EL_BURNING;
    ice.t = 200;
    ice.paid = 18;
    s.nubs.chill = 90;
    const spent = el(s).spent;
    until(s, () => g.state === EL_GONE, 60);
    expect(s.events.some((e) => e.e === 'feed')).toBe(false);
    expect(el(s).spent).toBe(spent);
    const bumps = s.stats.bumps as number;
    until(s, () => ice.hit, 120);
    expect(s.stats.bumps).toBe(bumps + 1);
    expect(ice.state).toBe(EL_GONE);
  });

  it('melts ice into a puddle where it stood, and dries a puddle on its path', () => {
    const s = runTo(1001, 'ember', 1);
    const objs = place(s, [
      { k: 'ice', dy: 250 },
      { k: 'puddle', dy: 200 },
    ]);
    const ice = objs.find((o) => o.kind === 'ice') as ElObj;
    const p = objs.find((o) => o.kind === 'puddle') as ElObj;
    s.nubs.chill = 90;
    step(s, frame({ verb: VERB_TAP, vx: trailX(s.world.trail, ice.y), vy: ice.y }));
    expect(ice.state).toBe(EL_BURNING);
    until(s, () => ice.kind === 'puddle', 80);
    expect([ice.r, ice.state, ice.paid]).toEqual([O.puddleR, EL_IDLE, 0]);
    step(s, frame({ verb: VERB_TAP, vx: p.x, vy: p.y }));
    expect(p.state).toBe(EL_BURNING);
    until(s, () => p.state === EL_GONE, 40);
  });

  it('targets walls before puddles, never plots, puddles only on its own path before the TAG, within reach, and not veiled', () => {
    const s = runTo(1001, 'ember', 1);
    const tr = s.world.trail;
    const objs = place(s, [
      { k: 'puddle', dy: 100 },
      { k: 'bramble', dy: 104 },
      { k: 'plot', dy: 150, dx: 44 },
      { k: 'puddle', dy: 180, dx: 30 },
      { k: 'gate', dy: 400 },
    ]);
    const [pud, wall, plot, off, far] = [0, 1, 2, 3, 4].map((i) => objs[i] as ElObj) as [ElObj, ElObj, ElObj, ElObj, ElObj];
    expect(burnTarget(s, pud.x, pud.y)).toBe(1);
    expect(burnTarget(s, plot.x, plot.y)).toBe(-1);
    expect(burnTarget(s, off.x, off.y)).toBe(-1);
    expect(burnTarget(s, trailX(tr, far.y), far.y)).toBe(-1);
    expect(burnTarget(s, trailX(tr, wall.y) + O.wallHalf + E.reach + 1, wall.y)).toBe(-1);
    expect(burnTarget(s, NaN, NaN)).toBe(1);
    // Fog over the wall veils it (and the puddle under it).
    place(s, [
      { k: 'bramble', dy: 100 },
      { k: 'fog', dy: 100, r: 60, awake: true },
    ]);
    expect(veiled(s, el(s).objs[0] as ElObj)).toBe(true);
    expect(burnTarget(s, NaN, NaN)).toBe(-1);
    // A puddle Ember reaches only after the TAG is not its own.
    const n = nextTagTicks(s);
    const after = worldYAtTick(s.world, s.tickAbs + n + 30) - s.nubs.y;
    if (after <= E.range) {
      const [q] = place(s, [{ k: 'puddle', dy: after }]) as [ElObj];
      expect(burnTarget(s, q.x, q.y)).toBe(-1);
    }
  });

  it('counts burnLeft, burnSweet and contactTicks as stepping does', () => {
    const s = runTo(1001, 'ember', 1);
    const [o] = place(s, [{ k: 'bramble', dy: 200 }]) as [ElObj];
    o.hit = true;
    const c = contactTicks(s, o);
    const l = burnLeft(s, o);
    expect(c).toBeGreaterThan(l);
    for (let i = 0; i < c - 1; i++) step(s, frame());
    expect(s.nubs.y).toBeLessThanOrEqual(o.y - O.wallDepth / 2 + 1e-9);
    step(s, frame());
    expect(s.nubs.y).toBeGreaterThanOrEqual(o.y - O.wallDepth / 2);
    expect(contactTicks(s, o)).toBe(-1);
    expect(arriveTicks(s, s.nubs.y - 1)).toBe(-1);
  });
});

describe('fire spreads with the wind and rain puts it out (§3.4)', () => {
  it('ignites downwind burnables at half burn while |wind| ≥ spreadAt, not upwind, not in calm', () => {
    for (const [wind, want] of [
      [20, [true, false]],
      [-20, [false, true]],
      [10, [false, false]],
    ] as const) {
      const s = runTo(1001, 'ember', 1);
      const objs = place(s, [
        { k: 'bramble', dy: 300 },
        { k: 'plot', dy: 310, dx: 40 },
        { k: 'plot', dy: 312, dx: -40 },
      ]);
      const src = objs.find((o) => o.kind === 'bramble') as ElObj;
      const east = objs.find((o) => o.kind === 'plot' && o.x > src.x) as ElObj;
      const west = objs.find((o) => o.kind === 'plot' && o.x < src.x) as ElObj;
      east.size = 30;
      west.size = 30;
      src.state = EL_BURNING;
      src.t = E.ember.burnTicks.bramble;
      for (let i = 0; i < E.ember.burnTicks.bramble / 2 + 2; i++) {
        el(s).wind = wind - s.trial!.breeze;
        step(s, frame());
      }
      expect([wind, east.state === EL_BURNING, west.state === EL_BURNING]).toEqual([wind, ...want]);
    }
  });

  it('douses a fire under rain: the cost is lost', () => {
    const s = runTo(1001, 'ember', 1);
    const [o] = place(s, [
      { k: 'bramble', dy: 150 },
      { k: 'rain', dy: 150, r: 50, awake: false },
    ]).filter((x) => x.kind === 'bramble') as [ElObj];
    s.nubs.chill = 90;
    step(s, frame({ verb: VERB_TAP, vx: trailX(s.world.trail, o.y), vy: o.y }));
    expect(o.state).toBe(EL_BURNING);
    const spent = el(s).spent;
    step(s, frame());
    expect(s.events.some((e) => e.e === 'doused')).toBe(true);
    expect([o.state, o.t, o.paid, el(s).spent]).toEqual([EL_IDLE, 0, 0, spent]);
  });
});

describe('Sprout (§2.4, §3.5)', () => {
  it('pours Sap into a held site at invest/s up to its need, and the hold ends near the site', () => {
    const s = runTo(1003, 'sprout', 1);
    const [g] = place(s, [{ k: 'gap', dy: 140, r: 14 }]) as [ElObj];
    expect(growTarget(s, trailX(s.world.trail, g.y), g.y)).toBe(0);
    s.nubs.chill = 80;
    step(s, frame({ verb: VERB_HOLD, vx: trailX(s.world.trail, g.y), vy: g.y }));
    expect(el(s).hold).toBe(0);
    expect(g.size).toBeCloseTo(E.sprout.invest * DT, 9);
    expect(s.nubs.chill).toBeCloseTo(80 - E.sprout.invest * DT + E.sprout.root * DT, 6);
    until(s, () => g.size >= needOf(g), 60);
    expect(g.size).toBe(needOf(g));
    for (let i = 0; i < 5; i++) step(s, frame());
    expect(g.size).toBe(needOf(g));
    until(s, () => el(s).hold < 0, 200);
    expect(g.y - g.r - s.nubs.y).toBeLessThan(E.near + 2);
    expect(bridged(g)).toBe(true);
  });

  it('never targets a site already poured to its need (the key moves on to the next one)', () => {
    const s = runTo(1003, 'sprout', 1);
    const [p, g] = place(s, [
      { k: 'plot', dy: 120, dx: 44 },
      { k: 'gap', dy: 220, r: 12 },
    ]) as [ElObj, ElObj];
    s.nubs.chill = 80;
    expect(growTarget(s, NaN, NaN)).toBe(1);
    step(s, frame({ verb: VERB_KEY_HOLD }));
    until(s, () => g.size >= needOf(g), 60);
    step(s, frame({ verb: VERB_RELEASE }));
    expect(bridged(g)).toBe(false);
    expect(growTarget(s, trailX(s.world.trail, g.y), g.y)).toBe(-1);
    expect(growTarget(s, NaN, NaN)).toBe(0);
    expect(p.size).toBe(0);
  });

  it('pours no more Sap than it holds, and its hold ends at the TAG', () => {
    const s = runTo(1003, 'sprout', 1);
    const n = nextTagTicks(s);
    const [p] = place(s, [{ k: 'plot', dy: 200, dx: 44 }]) as [ElObj];
    s.nubs.chill = 0.5;
    step(s, frame({ verb: VERB_HOLD, vx: p.x, vy: p.y }));
    expect(p.size).toBeCloseTo(0.5, 9);
    for (let i = 0; i < n; i++) step(s, frame());
    expect(s.nubs.hero).not.toBe('sprout');
    expect(el(s).hold).toBe(-1);
  });

  it('grows ×1 in shade, ×2 lit, ×3 wet; a plot stands as a tree caster once let go', () => {
    const s = runTo(1003, 'sprout', 1);
    const [p] = place(s, [{ k: 'plot', dy: 250, dx: 44 }]) as [ElObj];
    p.size = 30;
    const g = E.sprout.grow * DT;
    // Off the guide grid the light bits stay as set.
    while ((s.tickAbs + 1) % TUNING.guide.everyTicks === 0) step(s, frame());
    for (const [light, mul] of [
      [0, 1],
      [1, E.sprout.litMul],
      [3, E.sprout.litMul * E.sprout.rainMul],
    ] as const) {
      while ((s.tickAbs + 1) % TUNING.guide.everyTicks === 0) step(s, frame());
      p.grown = 0;
      p.light = light;
      step(s, frame());
      expect(p.grown).toBeCloseTo(g * mul, 9);
    }
    p.grown = p.size - 0.01;
    step(s, frame());
    expect(p.casterId).toBe(TREE_ID_BASE + 0);
    expect(s.world.byId.has(TREE_ID_BASE)).toBe(true);
    expect(s.events.some((e) => e.e === 'grown' && e.tree)).toBe(true);
    // Fire takes the tree with the plot.
    p.state = EL_BURNING;
    p.t = 1;
    step(s, frame());
    expect([p.state, p.casterId, s.world.byId.has(TREE_ID_BASE)]).toEqual([EL_GONE, -1, false]);
  });

  it('marks a site wet under its rain cloud though the cloud shades it', () => {
    const s = runTo(1003, 'sprout', 1);
    const [p] = place(s, [
      { k: 'plot', dy: 250, dx: 0 },
      { k: 'rain', dy: 250, r: 60, awake: false },
    ]).filter((o) => o.kind === 'plot') as [ElObj];
    p.size = 30;
    until(s, () => s.tickAbs % TUNING.guide.everyTicks === 0, 6);
    step(s, frame());
    until(s, () => (p.light & 2) === 2, 12);
    expect(p.light & 1).toBe(0);
  });

  it('is safe unless a crossing in range will not be ready', () => {
    const s = runTo(1003, 'sprout', 1);
    const [g] = place(s, [{ k: 'gap', dy: 60, r: 16 }]) as [ElObj];
    expect(growLeft(s, g)).toBeLessThan(0);
    step(s, frame());
    expect(s.nubs.safe).toBe(false);
    place(s, [{ k: 'gap', dy: 330, r: 12 }]);
    step(s, frame());
    expect(s.nubs.safe).toBe(true);
  });
});

describe('the contact table (§3.3)', () => {
  const cases: [HeroId, ElKind, (seen: SimState['events'], s: SimState) => void][] = [
    ['nubs', 'bramble', (seen) => expect(seen.some((e) => e.e === 'bump' && e.delta === -E.bump && e.hero === 'nubs')).toBe(true)],
    ['drip', 'gate', (seen) => expect(seen.some((e) => e.e === 'bump' && e.delta === -E.bump && e.hero === 'drip')).toBe(true)],
    ['sprout', 'ice', (seen, s) => expect([seen.some((e) => e.e === 'bump' && e.hero === 'sprout'), s.phase]).toEqual([true, 'day'])],
    ['gust', 'ice', (seen) => expect(seen.some((e) => e.e === 'bump')).toBe(false)],
    ['drip', 'stream', (seen) => expect(seen.some((e) => e.e === 'drink' && e.delta === E.drip.stream)).toBe(true)],
    ['nubs', 'stream', (seen, s) => expect([seen.some((e) => e.e === 'fall'), s.phase]).toEqual([false, 'day'])],
    ['gust', 'gap', (seen, s) => expect([seen.some((e) => e.e === 'fall'), s.phase]).toEqual([false, 'day'])],
  ];
  for (const [hero, kind, check] of cases) {
    it(`${hero} meets a ${kind}`, () => {
      const s = runTo(1007, hero, 1);
      place(s, [{ k: kind, dy: 30, r: kind === 'gap' || kind === 'stream' ? 12 : undefined }]);
      s.nubs.chill = 80;
      const seen = collect(s, () => (el(s).objs[0] as ElObj).hit, 60);
      check(seen, s);
    });
  }

  it('drops every walker but Gust into an unbridged gap, sweeps Sprout and puts Ember out in a stream', () => {
    for (const [hero, kind, cause] of [
      ['sprout', 'gap', 'fall'],
      ['ember', 'stream', 'swept'],
      ['sprout', 'stream', 'swept'],
      ['drip', 'gap', 'fall'],
    ] as const) {
      const s = runTo(1007, hero, 1);
      place(s, [{ k: kind, dy: 30, r: 12 }]);
      until(s, () => s.phase === 'dead', 60);
      expect([hero, s.death?.heroCause, s.death?.who]).toEqual([hero, cause, hero]);
      expect(s.events.some((e) => e.e === 'fall')).toBe(true);
    }
  });

  it('lets Drip drink a puddle (+30, gone) and stones feed Ember and sting Drip once', () => {
    const s = runTo(1007, 'drip', 1);
    const [p, st] = place(s, [
      { k: 'puddle', dy: 20 },
      { k: 'stone', dy: 60 },
    ]) as [ElObj, ElObj];
    s.nubs.chill = 50;
    until(s, () => p.state === EL_GONE, 40);
    expect(s.events.some((e) => e.e === 'drink' && e.delta === E.drip.puddle)).toBe(true);
    until(s, () => st.hit, 60);
    expect(s.events.some((e) => e.e === 'sizzle' && e.delta === -E.drip.stone)).toBe(true);
    const em = runTo(1007, 'ember', 1);
    const [st2] = place(em, [{ k: 'stone', dy: 20 }]) as [ElObj];
    until(em, () => st2.hit, 40);
    expect(em.events.some((e) => e.e === 'sizzle' && e.delta === E.ember.stone)).toBe(true);
  });

  it('counts Nubs\' ticks under rain as cloudRide', () => {
    const s = runTo(1004, 'nubs', 1);
    place(s, [{ k: 'rain', dy: 0, r: 60 }]);
    const r0 = s.stats.cloudRide as number;
    step(s, frame());
    expect(s.stats.cloudRide).toBe(r0 + 1);
  });
});

describe('Drip\'s lane and keys (§2.3, §3.7)', () => {
  it('slides toward its target, clamps dx (not dxTarget) to the lane, and Left steers west', () => {
    const s = runTo(1002, 'drip', 1);
    place(s, []);
    step(s, frame({ steer: 30 }));
    expect(el(s).dxTarget).toBe(30);
    expect(el(s).dx).toBeCloseTo(Math.min(30, E.drip.slide * DT), 9);
    const lane = new Float64Array(2);
    for (let k = 0; k < 120; k++) {
      step(s, frame());
      laneOf(s, lane);
      expect(el(s).dx).toBeLessThanOrEqual(Math.max(0, lane[1] as number) + 1e-9);
      expect(el(s).dxTarget).toBe(30);
    }
    step(s, frame({ steer: 100 }));
    expect(el(s).dxTarget).toBe(E.drip.range);
    step(s, frame({ key: 1 }));
    expect(el(s).dxTarget).toBeCloseTo(E.drip.range - E.drip.keyRate * DT, 9);
    step(s, frame({ key: -2 }));
    expect(el(s).dxTarget).toBeCloseTo(E.drip.range - E.drip.keyRate * DT + E.drip.keyFine * DT, 9);
  });
});

describe('Gust\'s wind and the weather (§2.5, §3.6)', () => {
  it('kicks the wind per swipe (halved in fog), clamps and decays it, and pays Lift or fizzles', () => {
    const s = runTo(1004, 'gust', 1);
    place(s, []);
    s.nubs.chill = 80;
    el(s).wind = 0;
    step(s, frame({ verb: VERB_EAST }));
    expect(el(s).wind).toBeCloseTo(E.gust.kick * E.gust.keep, 9);
    expect(el(s).spent).toBe(E.gust.swipe * s.trial!.tune.costMul);
    step(s, frame({ verb: VERB_EAST }));
    step(s, frame({ verb: VERB_EAST }));
    expect(el(s).wind).toBeCloseTo(E.gust.windMax * E.gust.keep, 9);
    el(s).wind = 0;
    place(s, [{ k: 'fog', dy: 0, r: 60 }]);
    step(s, frame({ verb: VERB_WEST }));
    expect(el(s).wind).toBeCloseTo(-E.gust.kick * E.gust.fogMuffle * E.gust.keep, 9);
    s.nubs.chill = E.gust.swipe * s.trial!.tune.costMul;
    step(s, frame({ verb: VERB_EAST }));
    expect(s.events.some((e) => e.e === 'fizz')).toBe(true);
    el(s).wind = 0.01;
    step(s, frame());
    expect(el(s).wind).toBe(0);
  });

  it('wakes weather within wake, drifts it with the wind, moves its proxy and prunes it', () => {
    const s = runTo(1004, 'gust', 1);
    const [near, far] = place(s, [
      { k: 'rain', dy: 300, r: 50, drift: 10 },
      { k: 'rain', dy: 600, r: 50, drift: 10 },
    ]) as [ElObj, ElObj];
    el(s).wind = 0;
    const x0 = near.x;
    const predicted = weatherXAt(s, near, 60);
    for (let i = 0; i < 60; i++) step(s, frame());
    expect(near.awake).toBe(true);
    expect(far.awake).toBe(false);
    expect(near.x).toBeCloseTo(predicted, 6);
    expect(near.x).toBeGreaterThan(x0);
    expect(s.world.clouds.find((c) => c.id === near.id)?.x0).toBe(near.x);
    near.x = trailX(s.world.trail, near.y) + E.weather.prune + 1;
    step(s, frame());
    expect(near.state).toBe(EL_GONE);
    expect(s.world.clouds.some((c) => c.id === near.id)).toBe(false);
    expect(windAt(s)).toBe(el(s).wind + s.trial!.breeze);
  });

  it('colours the arrival ghost by whose stretch it falls in (§3.6)', () => {
    const s = runTo(1004, 'gust', 1);
    const [r] = place(s, [{ k: 'rain', dy: 200, r: 50, dx: 0 }]) as [ElObj];
    expect(walkerAt(s, r.y)).toBe('gust');
    expect(weatherGood(s, r)).toBe(-1);
    r.x += 300;
    expect(weatherGood(s, r)).toBe(0);
    const n = runTo(1004, 'nubs', 1);
    const [q] = place(n, [{ k: 'rain', dy: 100, r: 50, dx: 200 }]) as [ElObj];
    expect(weatherGood(n, q)).toBe(1);
  });
});

describe('the Drip mask (§4.4)', () => {
  it('stores, per point, the bins where a lane point is shaded, as a direct computation finds them', () => {
    const s = createRun(campaignConfig(1002));
    const bot = createBot('reactive');
    const t = s.trial!;
    const i = t.relays.findIndex((r) => r.to === 'drip');
    const tag = tagTick(t, i);
    while (s.tickAbs < tag - 10) step(s, bot.next(s));
    const m = el(s).tagMask;
    // Point 0: the first time sample at the left lane.
    const y = worldYAtTick(s.world, tag);
    const x = trailX(s.world.trail, y) + (E.tagMask.lanes[0] as number);
    const eps = worldElevation(s.world, tag);
    const scene = createMaskScene();
    const lit = new Uint8Array(BINS);
    gatherScene(s.world, scene, x, y, TUNING.nubs.sampleOffset + 1, tag / 60, eps, 1 / tanD(eps), true, SNAP_ID_BASE);
    litMask(scene, x, y, false, lit, null);
    let same = 0;
    for (let b = 0; b < BINS; b++) if ((m[b] as number) === ((lit[b] as number) <= 1 ? 1 : 0)) same++;
    expect(same).toBe(BINS);
  });
});

describe('death lines (§10.4)', () => {
  const cases: [number, HeroId, Row[], string, RegExp][] = [
    [1007, 'ember', [{ k: 'puddle', dy: 0 }], 'douse', /^Ember was doused in a puddle at /],
    [1007, 'ember', [{ k: 'rain', dy: 0, r: 60 }], 'rain', /^Ember was doused by the rain at /],
    [1007, 'gust', [{ k: 'rain', dy: 0, r: 60 }], 'soak', /^Gust got soaked and grounded at /],
    [1007, 'gust', [{ k: 'fog', dy: 0, r: 60 }], 'fog', /^Gust got lost in the fog at /],
    [1007, 'drip', [{ k: 'stone', dy: 14 }], 'sizzle', /^Drip sizzled away on a hot stone at /],
    [1007, 'ember', [{ k: 'gate', dy: 10 }], 'crash', /^Ember crashed into a wooden gate at /],
  ];
  for (const [id, hero, rows, cause, line] of cases) {
    it(`${hero}: ${cause}`, () => {
      const s = runTo(id, hero, 1);
      place(s, rows);
      s.tagGrace = 0;
      s.nubs.chill = cause === 'sizzle' ? E.drip.stone - 1 : cause === 'crash' ? E.bump - 1 : 0.2;
      until(s, () => s.phase === 'dead', 120);
      expect(s.death?.heroCause).toBe(cause);
      expect(s.death?.who).toBe(hero);
      expect(s.death?.line).toMatch(line);
      expect(s.death?.cause).toBe(cause === 'rain' || cause === 'soak' ? 'cloud' : 'plain');
    });
  }
});

describe('the hash and replays (§7.8, §9.2)', () => {
  it('changes with any ElObj field of a Trial', () => {
    const s = runTo(1007, 'ember', 1);
    const h = hashState(s);
    const o = el(s).objs[0] as ElObj;
    for (const k of ['x', 't', 'paid', 'size', 'grown', 'light', 'casterId', 'state'] as const) {
      const v = o[k];
      (o as unknown as Record<string, number>)[k] = (v as number) + 1;
      expect(hashState(s)).not.toBe(h);
      (o as unknown as Record<string, number>)[k] = v as number;
    }
    for (const k of ['hit', 'awake'] as const) {
      o[k] = !o[k];
      expect(hashState(s)).not.toBe(h);
      o[k] = !o[k];
    }
    expect(hashState(s)).toBe(h);
  });

  it('replays a Trial run with verb frames bit for bit (T7: every verb)', () => {
    const s = createRun(campaignConfig(1007));
    const r = createReplay(s.cfg);
    const bot = createBot('reactive');
    const verbs = new Set<number>();
    while (s.phase !== 'won' && s.phase !== 'dead') {
      const f = bot.next(s);
      if (f.verb) verbs.add(f.verb);
      if (f.steer) verbs.add(100);
      recordFrame(r, f);
      step(s, f);
    }
    expect([...verbs].sort((a, b) => a - b)).toEqual(expect.arrayContaining([VERB_TAP, VERB_HOLD, VERB_RELEASE, 100]));
    expect(hashState(playReplay(r))).toBe(hashState(s));
  });
});
