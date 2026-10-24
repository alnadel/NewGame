// Elementals v2 skeleton (docs/ELEMENTALS_V2.md §7.1 C0c): the sun holds on Drip and Gust legs, taps
// burn, holds grow, Drip steers in its lane, swipes blow the weather, and every Trial runs to its
// finish with the reactive bot (its element legs played by elPolicy). Costs, feeds, contacts, fire
// spread, douse, veils and the element deaths are CORE's branch work and are not tested here.
import { describe, expect, it } from 'vitest';
import { TUNING } from '../../src/config/tuning.ts';
import { TRIAL_IDS, trialDef, type TrialDef } from '../../src/config/trials.ts';
import { campaignConfig } from '../../src/core/level.ts';
import { EL_BURNING, EL_GONE, EL_IDLE, TREE_ID_BASE, type ElObj } from '../../src/core/objects.ts';
import { createBot } from '../../src/core/sim/bots.ts';
import { createRun } from '../../src/core/sim/create.ts';
import {
  arriveTicks,
  bridged,
  burnSweet,
  burnTarget,
  contactTicks,
  growTarget,
  laneOf,
  needOf,
  walkerAt,
  weatherXAt,
  windAt,
} from '../../src/core/sim/elements.ts';
import { hashState } from '../../src/core/sim/hash.ts';
import { createReplay, playReplay, recordFrame } from '../../src/core/sim/replay.ts';
import { step } from '../../src/core/sim/step.ts';
import { VERB_EAST, VERB_HOLD, VERB_RELEASE, VERB_TAP, type InputFrame, type SimState } from '../../src/core/sim/types.ts';
import { trailX } from '../../src/core/trail.ts';

const E = TUNING.elements;

/** A frame with the finger held still on the sun (no turn), plus the given element fields. */
function frame(extra: Partial<InputFrame> = {}): InputFrame {
  return { dTheta: 0, down: true, downEdge: false, upEdge: false, release: 0, key: 0, ...extra };
}

/** A run of trial `id`, walked by the reactive bot until `hero` walks (and `extra` ticks more). */
function runTo(id: number, hero: string, extra = 0): SimState {
  const s = createRun(campaignConfig(id));
  const bot = createBot('reactive');
  while (s.nubs.hero !== hero) {
    step(s, bot.next(s));
    if (s.phase === 'dead' || s.phase === 'won') throw new Error(`${id} ended before ${hero}`);
  }
  for (let i = 0; i < extra; i++) step(s, bot.next(s));
  return s;
}

/** The first object of `kinds` whose contact is still ahead. */
function firstAhead(s: SimState, kinds: readonly string[]): number {
  return (s.el as NonNullable<SimState['el']>).objs.findIndex((o) => kinds.includes(o.kind) && o.state === EL_IDLE && contactTicks(s, o) > 0);
}

describe('the sun on a Trial (§4.1)', () => {
  it('holds while Drip or Gust walks and turns again when Nubs takes over', () => {
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
    expect(s.phase).toBe('won');
    expect(held).toBeGreaterThan(600);
    expect(free).toBeGreaterThan(600);
  });
});

describe('the reads (§7.7)', () => {
  it('know who walks where, how far things are and how the wind blows', () => {
    const s = createRun(campaignConfig(1007));
    const t = trialDef(1007) as TrialDef;
    expect(walkerAt(s, s.nubs.y)).toBe('nubs');
    expect(walkerAt(s, s.world.finishY)).toBe('nubs');
    expect(windAt(s)).toBe(t.breeze);
    const o = (s.el as NonNullable<SimState['el']>).objs[0] as ElObj;
    expect(arriveTicks(s, s.nubs.y - 1)).toBe(-1);
    expect(arriveTicks(s, o.y)).toBeGreaterThan(0);
    expect(contactTicks(s, o)).toBeLessThanOrEqual(arriveTicks(s, o.y));
    // A sleeping rain cloud waits, then drifts with its own drift and the breeze.
    const x0 = o.x;
    expect(weatherXAt(s, o, 0)).toBe(x0);
    expect(weatherXAt(s, o, 600)).not.toBe(x0);
    expect(needOf({ ...o, kind: 'gap', r: 14 })).toBe(28);
    expect(needOf({ ...o, kind: 'plot' })).toBe(E.sprout.treeMax);
  });
});

describe('the verbs, at no cost (skeleton)', () => {
  it('Ember: a tap burns a wall ahead, which burns out and is gone', () => {
    const s = runTo(1001, 'ember', 1);
    const el = s.el as NonNullable<SimState['el']>;
    const i = firstAhead(s, ['bramble', 'gate']);
    const o = el.objs[i] as ElObj;
    // Walk until it is in the window, then tap its middle.
    while (burnTarget(s, trailX(s.world.trail, o.y), o.y) !== i) step(s, frame());
    const flame = s.nubs.chill;
    step(s, frame({ verb: VERB_TAP, vx: trailX(s.world.trail, o.y), vy: o.y }));
    expect(s.events.some((e) => e.e === 'burn' && e.obj === i && e.cost === 0)).toBe(true);
    expect([o.state, o.t]).toEqual([EL_BURNING, E.ember.burnTicks[o.kind as 'bramble'] - 1]);
    expect(s.nubs.chill).toBeGreaterThanOrEqual(flame - 1);
    const burns = s.stats.burns as number;
    for (let k = 0; k < 120 && o.state === EL_BURNING; k++) step(s, frame());
    expect(o.state).toBe(EL_GONE);
    expect(s.stats.burns).toBe(burns + 1);
  });

  it('Ember: melted ice is a puddle where it stood', () => {
    const s = runTo(1005, 'ember', 1);
    const el = s.el as NonNullable<SimState['el']>;
    const i = firstAhead(s, ['ice']);
    const o = el.objs[i] as ElObj;
    while (burnTarget(s, trailX(s.world.trail, o.y), o.y) !== i) step(s, frame());
    step(s, frame({ verb: VERB_TAP, vx: trailX(s.world.trail, o.y), vy: o.y }));
    expect(o.state).toBe(EL_BURNING);
    for (let k = 0; k < 80 && o.state === EL_BURNING; k++) step(s, frame());
    expect([o.kind, o.r, o.state]).toEqual(['puddle', E.objects.puddleR, EL_IDLE]);
  });

  it('Sprout: a hold pours into a crossing until its bridge completes; a plot grows into a tree', () => {
    const s = runTo(1003, 'sprout', 1);
    const el = s.el as NonNullable<SimState['el']>;
    const i = firstAhead(s, ['gap']);
    const o = el.objs[i] as ElObj;
    while (growTarget(s, trailX(s.world.trail, o.y), o.y) !== i) step(s, frame());
    step(s, frame({ verb: VERB_HOLD, vx: trailX(s.world.trail, o.y), vy: o.y }));
    expect(el.hold).toBe(i);
    while (o.size < needOf(o)) step(s, frame());
    step(s, frame({ verb: VERB_RELEASE }));
    expect(el.hold).toBe(-1);
    let grown = false;
    for (let k = 0; k < 600 && !bridged(o); k++) {
      step(s, frame());
      grown ||= s.events.some((e) => e.e === 'grown' && e.obj === i && !e.tree);
    }
    expect(bridged(o) && grown).toBe(true);
    // A plot ahead: hold it past treeMin, let go, and a tree caster stands on it.
    const j = el.objs.findIndex((p, k) => k > i && p.kind === 'plot' && contactTicks(s, p) > 0);
    const p = el.objs[j] as ElObj;
    while (growTarget(s, p.x, p.y) !== j) step(s, frame());
    step(s, frame({ verb: VERB_HOLD, vx: p.x, vy: p.y }));
    for (let k = 0; k < 30; k++) step(s, frame());
    step(s, frame({ verb: VERB_RELEASE }));
    expect(p.size).toBeGreaterThanOrEqual(E.sprout.treeMin);
    for (let k = 0; k < 600 && p.casterId < 0; k++) step(s, frame());
    expect(p.casterId).toBe(TREE_ID_BASE + j);
    expect(s.world.byId.has(TREE_ID_BASE + j)).toBe(true);
    expect(s.stats.trees).toBe(1);
  });

  it('Drip: steers its target within ±range and its body within the lane', () => {
    const s = runTo(1002, 'drip', 1);
    const el = s.el as NonNullable<SimState['el']>;
    const lane = new Float64Array(2);
    for (let k = 0; k < 60; k++) {
      step(s, frame({ steer: 2 }));
      laneOf(s, lane);
      expect(el.dx).toBeLessThanOrEqual(Math.max(0, lane[1] as number) + 1e-9);
      expect(s.nubs.x).toBeCloseTo(trailX(s.world.trail, s.nubs.y) + el.dx, 9);
    }
    expect(el.dxTarget).toBe(E.drip.range);
    expect(el.dx).toBeGreaterThan(0);
  });

  it('Gust: a swipe adds wind that decays, and awake weather drifts with its rain proxy', () => {
    const s = runTo(1004, 'gust', 1);
    const el = s.el as NonNullable<SimState['el']>;
    step(s, frame({ verb: VERB_EAST }));
    expect(s.events.some((e) => e.e === 'gust' && e.dir === 1)).toBe(true);
    // The swipe's tick already decays it once (verbs, then the wind's decay, §7.8).
    expect(el.wind).toBeCloseTo(E.gust.kick * E.gust.keep, 9);
    expect(s.stats.gusts).toBe(1);
    step(s, frame());
    expect(el.wind).toBeCloseTo(E.gust.kick * E.gust.keep * E.gust.keep, 9);
    const rain = el.objs.find((o) => o.kind === 'rain' && o.awake && o.state !== EL_GONE) as ElObj;
    const x = rain.x;
    step(s, frame());
    expect(rain.x).not.toBe(x);
    expect(s.world.clouds.find((c) => c.id === rain.id)?.x0).toBe(rain.x);
  });
});

describe('a Trial with the skeleton bot', () => {
  it('runs every trial to its finish, exercising the verbs (the C0c headless check)', () => {
    const seen = new Set<string>();
    for (const id of TRIAL_IDS) {
      const s = createRun(campaignConfig(id));
      const bot = createBot('reactive');
      while (s.phase !== 'won' && s.phase !== 'dead') {
        step(s, bot.next(s));
        for (const e of s.events) seen.add(e.e === 'grown' ? `grown:${e.tree}` : e.e);
      }
      expect(`${id}:${s.phase}`).toBe(`${id}:won`);
      expect(s.relayIdx).toBe((trialDef(id) as TrialDef).relays.length);
      expect(s.stats.grove).toBe((s.el as NonNullable<SimState['el']>).objs.filter((o) => o.kind === 'plot' && o.casterId >= 0).length);
    }
    for (const e of ['burn', 'burnOut', 'grow', 'grown:false', 'grown:true', 'gust', 'tag']) expect(seen.has(e)).toBe(true);
  });

  it('taps only in the sweet window, and replays a run with verbs bit for bit', () => {
    const s = createRun(campaignConfig(1007));
    const r = createReplay(s.cfg);
    const bot = createBot('reactive');
    let verbs = 0;
    while (s.phase !== 'won' && s.phase !== 'dead') {
      const f = bot.next(s);
      if (f.verb === VERB_TAP) {
        const i = burnTarget(s, f.vx as number, f.vy as number);
        expect(i).toBeGreaterThanOrEqual(0);
        const o = (s.el as NonNullable<SimState['el']>).objs[i] as ElObj;
        if (o.kind !== 'puddle') expect(burnSweet(s, o)).toBe(true);
      }
      if (f.verb) verbs++;
      recordFrame(r, f);
      step(s, f);
    }
    expect(verbs).toBeGreaterThan(10);
    expect(hashState(playReplay(r))).toBe(hashState(s));
  });
});
