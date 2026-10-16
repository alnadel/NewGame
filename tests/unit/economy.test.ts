// v1.6 economy (docs/V1_6_PLAN.md §2.1 Flow Ring, §2.2 Frost Bank, §2.4 Frost Garden and Landing,
// T2-T5): ring charge, bleed, tricks, freshness and PHEW on scripted applyDaylight ticks; the Bank,
// the cash-in, the Garden, the re-aimed snap cloud, guide.land and the landing on emptied worlds;
// the kill switches.
import { describe, expect, it } from 'vitest';
import { TUNING } from '../../src/config/tuning.ts';
import { dayTicks } from '../../src/core/clock.ts';
import { wrapDeg } from '../../src/core/dmath.ts';
import { makeCaster, makePrism } from '../../src/core/gen/catalog.ts';
import { insertBud, insertCaster, insertPickup } from '../../src/core/gen/store.ts';
import { rectPoly } from '../../src/core/geom.ts';
import { worldYAtDayTick } from '../../src/core/gen/plan.ts';
import { BUD_ID_BASE, SNAP_ID_BASE, type Bud, type Cloud } from '../../src/core/objects.ts';
import { cloudShades } from '../../src/core/shadows.ts';
import { createBot } from '../../src/core/sim/bots.ts';
import { createRun } from '../../src/core/sim/create.ts';
import type { SimEvent } from '../../src/core/sim/events.ts';
import { hashState } from '../../src/core/sim/hash.ts';
import { headlessConfig } from '../../src/core/sim/headless.ts';
import { campaignConfig } from '../../src/core/level.ts';
import { debugBloom, SNAP_TICKS } from '../../src/core/sim/mechanics.ts';
import { applyDaylight, debugRing } from '../../src/core/sim/nubs.ts';
import { step } from '../../src/core/sim/step.ts';
import { NO_INPUT, type InputFrame, type RunConfig, type SimState } from '../../src/core/sim/types.ts';
import { trailX } from '../../src/core/trail.ts';

const R = TUNING.ring;
const BK = TUNING.bank;
const G = TUNING.garden;
const SW = TUNING.swing;
const TAP: InputFrame = { dTheta: 0, down: false, downEdge: true, upEdge: true, release: 0, key: 0 };
const SNAP: InputFrame = { ...NO_INPUT, snap: true };

type Ev<K extends SimEvent['e']> = Extract<SimEvent, { e: K }>;
const only = <K extends SimEvent['e']>(ev: SimEvent[], k: K): Ev<K>[] => ev.filter((e): e is Ev<K> => e.e === k);

// ---------------------------------------------------------------------------------------------
// Scripted daylight ticks (coverage set by hand), as in swing.test.ts.

/** The Frost Bank ships off (V16_SHIP); these tests measure the economy with it on unless a test switches it. */
const bankOn = (cfg: Partial<RunConfig> = {}): Partial<RunConfig> => ({ ...cfg, v16: { bank: true, ...cfg.v16 } });

function rig(cfg: Partial<RunConfig> = {}): SimState {
  const s = createRun({ ...headlessConfig(1), plan: false, ...bankOn(cfg) });
  s.phase = 'day';
  s.tick = 1000;
  return s;
}

/**
 * One scripted daylight tick: Nubs fully shaded by caster `src` (src ≥ 0; deep when `deep`), or lit
 * with these per-sample weights (src < 0; default full sun), the sun at θ, Chill held at `chill`.
 */
function tick(s: SimState, src: number, theta = 100, w: number[] = [1, 1, 1, 1, 1], chill = 90, deep = false): SimEvent[] {
  s.events.length = 0;
  s.tick++;
  const nb = s.nubs;
  for (let k = 0; k < 5; k++) nb.w[k] = src >= 0 ? 0 : (w[k] as number);
  nb.f = src >= 0 ? 0 : w.reduce((a, v) => a + v, 0) / 5;
  nb.shaderId = src;
  nb.cloudId = -1;
  nb.deep = src >= 0 && deep;
  nb.chill = chill;
  s.sun.theta = theta;
  applyDaylight(s);
  return [...s.events];
}

function ticks(s: SimState, n: number, src: number, theta = 100, w?: number[]): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < n; i++) out.push(...tick(s, src, theta, w));
  return out;
}

/** Shade under A at θ, a 5-tick lit swing of `turn`°, then B held for the confirmation: one SWING. */
function swing(s: SimState, a: number, b: number, theta: number, turn = 60): SimEvent[] {
  const out = ticks(s, 20, a, theta);
  out.push(...ticks(s, 5, -1, theta + turn / 2));
  out.push(...ticks(s, SW.confirmTicks, b, theta + turn));
  return out;
}

describe('Flow Ring (§2.1)', () => {
  it('full shade fills shadeUnits a tick (× deepMul in deep shade) and levels up at need, carrying the remainder; x5 keeps a buffer of need[3]', () => {
    const s = rig();
    expect([s.nubs.mult, s.nubs.ringCharge]).toEqual([1, 0]);
    let ev = ticks(s, R.need[0] / R.shadeUnits - 1, 7);
    expect([s.nubs.mult, s.nubs.ringCharge]).toEqual([1, R.need[0] - R.shadeUnits]);
    ev = tick(s, 7);
    expect(only(ev, 'multUp')).toEqual([{ e: 'multUp', level: 2, reason: 'shade' }]);
    expect([s.nubs.mult, s.nubs.ringCharge]).toEqual([2, 0]);
    s.events.length = 0;
    tick(s, 7, 100, undefined, 90, true);
    expect(s.nubs.ringCharge).toBe(R.shadeUnits * R.deepMul);
    // 25.2 s of plain shade take x1 to x5 (need 1080 + 1440 + 2160 + 2880 units at 5 a tick).
    const t = rig();
    const total = R.need.reduce((a, v) => a + v, 0) / R.shadeUnits;
    expect(total).toBe(1512);
    ticks(t, total, 7);
    expect([t.nubs.mult, t.nubs.ringCharge]).toEqual([5, 0]);
    ticks(t, 1000, 7);
    expect([t.nubs.mult, t.nubs.ringCharge]).toEqual([5, R.need[3]]);
    expect(t.stats.maxMult).toBe(5);
  });

  it('bleeds from the 7th lit tick at bleedK[m − 1]·Σw: x5 lasts 0.4 s of full sun after the free ticks, then drops to ¾ of x4', () => {
    const s = rig();
    debugRing(s, 5, R.need[3]);
    const ev = ticks(s, R.freeLitTicks, -1);
    expect([s.nubs.mult, s.nubs.ringCharge]).toEqual([5, R.need[3]]);
    expect(ev.some((e) => e.e === 'multDown')).toBe(false);
    ticks(s, R.need[3] / (5 * R.bleedK[4]), -1);
    expect(R.need[3] / (5 * R.bleedK[4])).toBe(24);
    expect([s.nubs.mult, s.nubs.ringCharge]).toEqual([5, 0]);
    const drop = tick(s, -1);
    expect(only(drop, 'multDown')).toEqual([{ e: 'multDown', from: 5, to: 4, cause: 'bleed' }]);
    expect([s.nubs.mult, s.nubs.ringCharge]).toEqual([4, (3 * R.need[3]) / 4]);
    expect(s.stats.multDowns).toBe(1);
    // Edge-riding (Σw = 1) bleeds an x5 level away in 2 s; glare counts 2.
    const e = rig();
    debugRing(e, 5, R.need[3]);
    ticks(e, R.freeLitTicks + R.need[3] / R.bleedK[4], -1, 100, [0, 1, 0, 0, 0]);
    expect([e.nubs.mult, e.nubs.ringCharge]).toEqual([5, 0]);
    const g = rig();
    debugRing(g, 3, 1000);
    ticks(g, R.freeLitTicks + 1, -1, 100, [2, 0, 0, 0, 0]);
    expect(g.nubs.ringCharge).toBe(1000 - 2 * (R.bleedK[2] as number));
    // x1 floors at 0, and multReset never fires with the ring on.
    const one = rig();
    one.nubs.ringCharge = 50;
    const ev1 = ticks(one, 60, -1);
    expect([one.nubs.mult, one.nubs.ringCharge]).toEqual([1, 0]);
    expect(ev1.some((x) => x.e === 'multReset' || x.e === 'multDown')).toBe(false);
  });

  it('a shaded tick restarts the free lit ticks, and the tick after a bud grew never bleeds', () => {
    const s = rig();
    debugRing(s, 3, 1000);
    for (let i = 0; i < 10; i++) {
      ticks(s, R.freeLitTicks, -1);
      tick(s, 7);
    }
    expect(s.nubs.ringCharge).toBe(1000 + 10 * R.shadeUnits);
    const b = rig();
    debugRing(b, 3, 1000);
    ticks(b, R.freeLitTicks, -1);
    b.nubs.budGrewTick = b.tick;
    tick(b, -1);
    expect(b.nubs.ringCharge).toBe(1000);
    tick(b, -1);
    expect(b.nubs.ringCharge).toBe(1000 - 5 * (R.bleedK[2] as number));
  });

  it('PHEW restores the levels a lit stretch bled away, never one above the stretch’s first level', () => {
    const s = rig();
    debugRing(s, 4, 0);
    s.nubs.phewOpen = true;
    tick(s, -1, 100, undefined, 60);
    expect(s.nubs.litStartMult).toBe(4);
    for (let i = 0; i < 200 && s.nubs.mult > 2; i++) tick(s, -1, 100, undefined, 60);
    expect(s.nubs.mult).toBe(2);
    s.nubs.highChillTick = s.tick;
    tick(s, -1, 100, undefined, 5);
    const ev = tick(s, 7, 100, undefined, 5);
    expect(ev.some((e) => e.e === 'phew')).toBe(true);
    expect(only(ev, 'multUp')).toContainEqual({ e: 'multUp', level: 4, reason: 'phew' });
    expect(s.nubs.mult).toBe(4);
    // A PHEW at the stretch's own level adds nothing.
    const t = rig();
    debugRing(t, 2, 600);
    t.nubs.phewOpen = true;
    t.nubs.highChillTick = t.tick + 1;
    tick(t, -1, 100, undefined, 5);
    const ev2 = tick(t, 7, 100, undefined, 5);
    expect(ev2.some((e) => e.e === 'phew')).toBe(true);
    expect(t.nubs.mult).toBe(2);
    expect(ev2.some((e) => e.e === 'multUp')).toBe(false);
  });

  it('a fresh SWING pumps the ring; a scripted A→B→A hand-off loop earns at most one fresh SWING per 3 s', () => {
    const s = rig();
    const first = swing(s, 1, 2, 100);
    expect(only(first, 'swing')).toHaveLength(1);
    expect(only(first, 'ringTrick')).toEqual([{ e: 'ringTrick', kind: 'swing', units: R.trick }]);
    // The farm: back and forth every ~40 ticks for 10 s.
    let fresh = 0;
    let swings = 0;
    for (let i = 0; i < 15; i++) {
      const ev = i % 2 === 0 ? swing(s, 2, 1, 160, -60) : swing(s, 1, 2, 100);
      swings += only(ev, 'swing').length;
      fresh += only(ev, 'ringTrick').filter((e) => e.kind === 'swing').length;
    }
    expect(swings).toBe(15);
    expect(fresh).toBe(0);
    // A new source is fresh; after freshTicks without a SWING the old ends are fresh again.
    expect(only(swing(s, 2, 3, 100), 'ringTrick')).toHaveLength(1);
    ticks(s, R.freshTicks + 1, 3, 160);
    expect(only(swing(s, 3, 2, 160), 'ringTrick')).toHaveLength(1);
    expect(s.stats.ringTricks).toBe(3);
  });

  it('every 3rd flake or crystal in a row pays a streak trick; a melt resets it; flake and crystal Snow cap at x3 (T2)', () => {
    const s = createRun({ ...headlessConfig(1), plan: false });
    const w = s.world;
    w.casters.length = 0;
    w.byId.clear();
    w.clouds.length = 0;
    w.balls.length = 0;
    w.pickups.length = 0;
    w.buds.length = 0;
    w.validatedThrough = 1e6;
    step(s, TAP);
    while (s.ready > 0) step(s, NO_INPUT);
    debugRing(s, 5, 0);
    const y0 = s.nubs.y;
    let id = 9_100_000;
    for (let k = 1; k <= 4; k++) insertPickup(w, { id: id++, kind: 'flake', x: trailX(w.trail, y0 + 8 * k), y: y0 + 8 * k, day: 1, melt: 0, state: 0, cluster: -1, ci: 0, cn: 1, brittle: false });
    const ev: SimEvent[] = [];
    for (let i = 0; i < 40; i++) {
      s.nubs.chill = 100;
      step(s, NO_INPUT);
      ev.push(...s.events);
    }
    const flakes = only(ev, 'flake');
    expect(flakes.length).toBe(4);
    expect(flakes.every((f) => f.snow === R.snowCap && f.mult >= 4)).toBe(true);
    expect(only(ev, 'ringTrick').filter((e) => e.kind === 'streak')).toEqual([{ e: 'ringTrick', kind: 'streak', units: R.streakTrick }]);
    expect(s.nubs.streak).toBe(4);
    // A melt resets the streak.
    insertPickup(w, { id: id++, kind: 'flake', x: trailX(w.trail, s.nubs.y + 110) + 200, y: s.nubs.y + 110, day: 1, melt: 0, state: 0, cluster: -1, ci: 0, cn: 1, brittle: false });
    for (let i = 0; i < 200 && s.nubs.streak > 0; i++) {
      s.nubs.chill = 100;
      step(s, NO_INPUT);
    }
    expect(s.nubs.streak).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// Emptied worlds driven by step().

function lab(cfg: Partial<RunConfig> = {}): SimState {
  const s = createRun({ ...headlessConfig(1), plan: false, ...bankOn(cfg) });
  const w = s.world;
  w.casters.length = 0;
  w.byId.clear();
  w.clouds.length = 0;
  w.balls.length = 0;
  w.pickups.length = 0;
  w.buds.length = 0;
  w.validatedThrough = 1e6;
  step(s, TAP);
  while (s.ready > 0) step(s, NO_INPUT);
  return s;
}

let rockId = 3_000_000;
/** A 60×60 block, 100 high, centered on the trail at y + dx. */
function block(s: SimState, y: number, dx = 0, size = 60): number {
  const x = trailX(s.world.trail, y) + dx;
  const id = rockId++;
  insertCaster(s.world, makeCaster({ id, kind: 'rock', name: 'the Test Rock', biome: 'meadow', x, y, rot: 0, parts: [makePrism(rectPoly(x, y, size, size, 1, 0), 100)], side: 1, rescue: false, gate: false, ballId: -1, chunk: 0 }));
  return id;
}

function run(s: SimState, n: number, f: InputFrame = NO_INPUT, chill?: number): SimEvent[] {
  const all: SimEvent[] = [];
  for (let i = 0; i < n && s.phase !== 'dead'; i++) {
    if (chill !== undefined) s.nubs.chill = chill;
    step(s, f);
    all.push(...s.events);
  }
  return all;
}

function bud(s: SimState, ahead: number, face: number): Bud {
  const y = s.nubs.y + ahead;
  const b: Bud = { id: BUD_ID_BASE + s.world.buds.length, x: trailX(s.world.trail, y) + 40, y, face, grow: 0, state: 0, casterId: -1 };
  insertBud(s.world, b);
  return b;
}

describe('Frost Bank (§2.2)', () => {
  it('starts with one snap in Endless, none in a lesson run, half a pip in the Journey and a full pip on the Cold Snap level', () => {
    const on = (cfg: RunConfig): RunConfig => ({ ...cfg, ...bankOn(cfg) });
    expect(createRun(on(headlessConfig(1))).nubs.frostH).toBe(BK.runStartH);
    expect(createRun(on({ ...headlessConfig(1), mode: 'daily', dailyDate: '2026-10-16' })).nubs.frostH).toBe(BK.runStartH);
    expect(createRun(on(headlessConfig(1, 0))).nubs.frostH).toBe(0);
    expect(createRun(on(campaignConfig(11))).nubs.frostH).toBe(BK.campaignStartH);
    expect(createRun(on(campaignConfig(10))).nubs.frostH).toBe(BK.teachStartH);
    const two = createRun(on({ ...headlessConfig(1), startFrost: 2 }));
    expect([two.nubs.frostH, two.nubs.frost]).toEqual([200, 2]);
    expect(createRun(on({ ...headlessConfig(1), startFrost: 5 })).nubs.frostH).toBe(BK.capH);
    expect(createRun(on({ ...headlessConfig(1), mechanics: { snap: false } })).nubs.frostH).toBe(0);
  });

  it('only risky acts pay: shade, deep shade and flakes pay nothing; a bloom pays bloomH; frostReady on each charge; anything above capH spills', () => {
    const s = lab({ startFrost: 0.5 });
    for (let dy = 40; dy <= 900; dy += 25) block(s, s.nubs.y + dy);
    for (let i = 0; i < 400 && s.nubs.f > 0; i++) step(s, NO_INPUT);
    run(s, 300);
    expect(s.nubs.frostH).toBe(50);
    insertPickup(s.world, { id: 9_200_000, kind: 'flake', x: s.nubs.x, y: s.nubs.y + 1, day: 1, melt: 0, state: 0, cluster: -1, ci: 0, cn: 1, brittle: false });
    run(s, 2);
    expect(s.stats.flakes).toBe(1);
    expect(s.nubs.frostH).toBe(50);
    const b1 = debugBloom(s, bud(s, 100, 0).id);
    expect(b1).not.toBeNull();
    expect(only(s.events, 'frostGain')).toEqual([{ e: 'frostGain', source: 'bloom', amountH: BK.bloomH, charges: 0 }]);
    s.nubs.frostH = 99;
    s.events.length = 0;
    debugBloom(s, bud(s, 110, 0).id);
    expect(only(s.events, 'frostReady')).toEqual([{ e: 'frostReady', charges: 1 }]);
    expect([s.nubs.frostH, s.nubs.frost]).toEqual([99 + BK.bloomH, (99 + BK.bloomH) / 100]);
    s.nubs.frostH = 190;
    s.events.length = 0;
    debugBloom(s, bud(s, 120, 0).id);
    expect(only(s.events, 'frostReady')).toEqual([{ e: 'frostReady', charges: 2 }]);
    expect(only(s.events, 'frostSpill')).toEqual([{ e: 'frostSpill', lostH: 190 + BK.bloomH - BK.capH }]);
    expect([s.nubs.frostH, s.stats.frostSpilledH, s.stats.frostEarnedH]).toEqual([BK.capH, 190 + BK.bloomH - BK.capH, 3 * BK.bloomH]);
  });

  it('a snap costs one charge and cashes the ring in: +cashPerLevelH per level above x1, the ring back to x1 at 0', () => {
    const s = lab({ startFrost: 1.5 });
    debugRing(s, 4, 700);
    step(s, SNAP);
    const ev = s.events;
    expect(ev.find((e) => e.e === 'snap')).toBeDefined();
    expect(only(ev, 'multDown')).toEqual([{ e: 'multDown', from: 4, to: 1, cause: 'snap' }]);
    expect(only(ev, 'snapCash')).toEqual([{ e: 'snapCash', level: 4, refundH: 3 * BK.cashPerLevelH }]);
    expect(only(ev, 'frostGain')).toEqual([{ e: 'frostGain', source: 'cash', amountH: 3 * BK.cashPerLevelH, charges: 0 }]);
    // The snap's own cover is full shade: the ring refills from x1 at once.
    expect([s.nubs.frostH, s.nubs.mult, s.nubs.ringCharge, s.stats.snapCashH]).toEqual([150 - BK.costH + 3 * BK.cashPerLevelH, 1, R.shadeUnits, 3 * BK.cashPerLevelH]);
    // No second snap while one is on, and none below a full charge.
    run(s, SNAP_TICKS + 2);
    expect(s.stats.snaps).toBe(1);
    step(s, SNAP);
    expect(s.stats.snaps).toBe(1);
  });

  it('two charges give two snaps; charges keep through the night and dawn', () => {
    const s = lab({ startFrost: 2 });
    step(s, SNAP);
    run(s, SNAP_TICKS + 1, NO_INPUT, 100);
    expect(s.nubs.frostH).toBe(100);
    // Three seconds under the snap filled the ring (900 units, short of x2's need): put it at x2 so the
    // second snap cashes a level in.
    expect([s.nubs.mult, s.nubs.ringCharge]).toEqual([1, 3 * 60 * R.shadeUnits]);
    debugRing(s, 2, 0);
    step(s, SNAP);
    expect([s.stats.snaps, s.nubs.frostH]).toEqual([2, BK.cashPerLevelH]);
    const n = lab({ startFrost: 2, startT: 49.5 });
    run(n, 90, NO_INPUT, 100);
    expect(n.phase).toBe('night');
    for (let i = 0; i < 100000 && n.phase === 'night'; i++) step(n, NO_INPUT);
    expect(n.day).toBe(2);
    expect(n.nubs.frostH).toBe(200);
  });

  it('income under a snap is banked (at most bankCapH) and paid when it ends', () => {
    const s = lab({ startFrost: 1, v16: { garden: false } });
    step(s, SNAP);
    for (let k = 0; k < 2; k++) debugBloom(s, bud(s, 100 + 10 * k, 0).id);
    expect([s.nubs.frostH, s.snapBankH]).toEqual([0, G.bankCapH]);
    expect(s.events.some((e) => e.e === 'frostGain')).toBe(false);
    const ev = run(s, SNAP_TICKS, NO_INPUT, 100);
    expect(only(ev, 'frostGain')).toEqual([{ e: 'frostGain', source: 'garden', amountH: G.bankCapH, charges: 0 }]);
    expect([s.nubs.frostH, s.snapBankH, s.stats.frostEarnedH]).toEqual([G.bankCapH, 0, G.bankCapH]);
  });

  it('a fresh SWING pays swingH at most once per swingEveryTicks', () => {
    const s = rig({ startFrost: 0 });
    swing(s, 1, 2, 100);
    expect(s.nubs.frostH).toBe(BK.swingH);
    swing(s, 2, 3, 160, -60);
    expect(s.nubs.frostH).toBe(BK.swingH);
    ticks(s, BK.swingEveryTicks, 3, 100);
    swing(s, 3, 4, 100);
    expect(s.nubs.frostH).toBe(2 * BK.swingH);
  });
});

describe('Frost Garden and Landing (§2.4)', () => {
  it('under a snap buds grow ×growMul with the longer reach; a bloom stretches the snap (capped) and the cloud lives as long', () => {
    const s = lab({ startFrost: 1 });
    const far = bud(s, G.reach - 20, wrapDeg(s.sun.theta));
    const near = bud(s, 100, wrapDeg(s.sun.theta));
    run(s, 5, NO_INPUT, 100);
    expect(far.grow).toBe(0);
    expect(near.grow).toBeCloseTo(5 / (TUNING.buds.growSec * 60), 9);
    step(s, SNAP);
    near.grow = 0;
    run(s, 5, NO_INPUT, 100);
    expect(near.grow).toBeCloseTo((G.growMul * 5) / (TUNING.buds.growSec * 60), 9);
    expect(far.grow).toBeGreaterThan(0);
    const ev = run(s, 30, NO_INPUT, 100);
    expect(only(ev, 'bloom').length).toBe(2);
    expect(only(ev, 'snapExtend')).toEqual([
      { e: 'snapExtend', ticks: G.extendTicks },
      { e: 'snapExtend', ticks: G.extendTicks },
    ]);
    expect([s.snapExt, s.snapBlooms, s.stats.gardenBlooms]).toEqual([G.extendCapTicks, 2, 2]);
    debugBloom(s, bud(s, 150, 0).id);
    expect(s.snapExt).toBe(G.extendCapTicks);
    const cl = s.world.clouds.find((c) => c.id === s.snapCloudId) as Cloud;
    expect(cl.life).toBeCloseTo((SNAP_TICKS + G.extendCapTicks - 0.5) / 60, 9);
    // The snap (and Nubs' cover) lasts SNAP_TICKS + the extension in all.
    const want = SNAP_TICKS + G.extendCapTicks - (SNAP_TICKS + s.snapExt - s.snapTicks);
    let left = 0;
    while (s.snapTicks > 0) {
      s.nubs.chill = 100;
      step(s, NO_INPUT);
      left++;
      if (s.snapTicks > 0) expect(s.nubs.f).toBe(0);
    }
    expect(left).toBe(want);
  });

  it('a bloom never stretches the snap past the day’s last daylight tick', () => {
    const s = lab({ startFrost: 1, startT: 46 });
    const dl = dayTicks(1);
    for (let i = 0; i < 400 && dl - s.dayTick > SNAP_TICKS + 10; i++) run(s, 1, NO_INPUT, 100);
    step(s, SNAP);
    debugBloom(s, bud(s, 100, 0).id);
    debugBloom(s, bud(s, 120, 0).id);
    expect(s.dayTick + s.snapTicks).toBeLessThanOrEqual(dl);
  });

  it('T5: the snap cloud re-aims every reaimTicks along Nubs’ scheduled path, so no sample is ever lit under it (40 seeds, every snap)', () => {
    let snaps = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const s = createRun({ ...headlessConfig(seed, 3), startFrost: 2 });
      const bot = createBot('reactive');
      let prevC: [number, number] | null = null;
      for (let i = 0; i < 2400 && s.phase !== 'dead'; i++) {
        const f = bot.next(s);
        if (s.snapTicks === 0 && s.phase === 'day' && s.ready === 0 && i % 240 === 0) {
          s.nubs.frostH = Math.max(s.nubs.frostH, BK.costH);
          s.nubs.frost = s.nubs.frostH / 100;
          f.snap = true;
        }
        const before = s.snapCloudId;
        step(s, f);
        f.snap = false;
        if (s.snapTicks > 0) {
          if (s.snapCloudId !== before) {
            snaps++;
            prevC = null;
          }
          // Every sample is under the cloud (glare still ignores shade, as everywhere: weight 2).
          for (let k = 0; k < 5; k++) expect(s.nubs.w[k], `seed ${seed} tick ${i} sample ${k}`).not.toBe(1);
          const cl = s.world.clouds.find((c) => c.id === s.snapCloudId) as Cloud;
          const dt = s.tAbs - cl.t0;
          const c: [number, number] = [cl.x0 + cl.vx * dt, cl.y0 + cl.vy * dt];
          // The path is continuous (it moves at most a walking tick and a bit), and stays on Nubs.
          if (prevC) expect(Math.hypot(c[0] - prevC[0], c[1] - prevC[1])).toBeLessThan(4);
          expect(Math.hypot(c[0] - s.nubs.x, c[1] - s.nubs.y)).toBeLessThan(6);
          for (const [dx, dy] of [[0, 0], [5.5, 0], [-5.5, 0], [0, 5.5], [0, -5.5]] as const) expect(cloudShades(cl, s.tAbs, s.nubs.x + dx, s.nubs.y + dy, s.ux, s.uy, s.cot)).toBe(true);
          prevC = c;
        }
      }
    }
    expect(snaps).toBeGreaterThan(80);
  }, 60_000);

  it('T3: the snap cloud is not a deep-shade source', () => {
    const s = lab({ startFrost: 1 });
    block(s, s.nubs.y + 30);
    for (let i = 0; i < 400 && s.nubs.f > 0; i++) step(s, NO_INPUT);
    expect(s.nubs.deep).toBe(false);
    step(s, SNAP);
    run(s, 10);
    expect([s.nubs.f, s.nubs.deep]).toEqual([0, false]);
    // With the Garden off (v1.5) the snap counts.
    const o = lab({ startFrost: 1, v16: { garden: false } });
    block(o, o.nubs.y + 30);
    for (let i = 0; i < 400 && o.nubs.f > 0; i++) step(o, NO_INPUT);
    step(o, SNAP);
    run(o, 10);
    expect(o.nubs.deep).toBe(true);
  });

  it('guide.land is the full-shade mask at the snap’s end (his scheduled spot), 0 outside a snap', () => {
    const s = lab({ startFrost: 1 });
    const y = s.nubs.y;
    // Shade waiting 2 s up the trail, on the east side.
    for (let dy = 100; dy <= 260; dy += 20) block(s, y + dy + 70 * 2.2, 30, 40);
    while (s.guide.tick !== s.tick) step(s, NO_INPUT);
    expect(s.guide.land.every((v) => v === 0)).toBe(true);
    step(s, SNAP);
    while (s.guide.tick !== s.tick) run(s, 1, NO_INPUT, 100);
    const land = Array.from(s.guide.land);
    expect(land.some((v) => v === 1)).toBe(true);
    // Play to the end with the sun on a land bin: Nubs is shaded at the end.
    const b = land.indexOf(1) + 3;
    s.sun.theta = b;
    const end = s.snapTicks;
    run(s, end - 1, NO_INPUT, 100);
    s.sun.theta = b;
    step(s, NO_INPUT);
    expect(s.events.some((e) => e.e === 'snapEnd')).toBe(true);
    expect(s.nubs.f).toBe(0);
    while (s.guide.tick !== s.tick) step(s, NO_INPUT);
    expect(s.guide.land.every((v) => v === 0)).toBe(true);
  });

  /**
   * A noon snap with a bud beside the trail where Nubs will be when it ends (bloomed under the snap
   * unless `bloom` is false), then the sun put where that sunflower shades Nubs (own) or onto a rock
   * over the trail there (not own), played until the landing window closes.
   */
  function landing(own: boolean, bloom = true): { s: SimState; ev: SimEvent[] } {
    const s = lab({ startFrost: 1, startT: 22 });
    const w = s.world;
    step(s, SNAP);
    s.nubs.swChain = 1;
    s.nubs.swLastTick = s.tick - 10;
    // Where Nubs is when the snap (stretched by this bloom) ends, a little ahead so the hold stays under the head.
    const yEnd = worldYAtDayTick(w, s.day, s.dayTick + s.snapTicks + (bloom ? G.extendTicks : 0)) + 8;
    const xEnd = trailX(w.trail, yEnd);
    // Its face points away from the sun, so it grows only when debugBloom blooms it.
    const b: Bud = { id: BUD_ID_BASE + w.buds.length, x: xEnd + (own ? 40 : -40), y: own ? yEnd : yEnd + 600, face: wrapDeg(s.sun.theta + 180), grow: 0, state: 0, casterId: -1 };
    insertBud(w, b);
    if (bloom) debugBloom(s, b.id);
    if (!own) for (let dy = -60; dy <= 400; dy += 30) block(s, yEnd + dy, 0, 50);
    // From Nubs' end spot toward the flower: its head's shadow lies back over him.
    const theta = own ? wrapDeg((Math.atan2(b.y - yEnd, b.x - xEnd) * 180) / Math.PI) : wrapDeg(s.sun.theta + 90);
    const ev: SimEvent[] = [];
    for (let i = 0; i < 400 && (s.snapTicks > 0 || s.landTicks >= 0); i++) {
      s.sun.theta = theta;
      s.nubs.chill = 100;
      step(s, NO_INPUT);
      ev.push(...s.events);
    }
    return { s, ev };
  }

  it('a snap that bloomed arms the landing: shade from another source held landHoldTicks within the window lands (chain + 1 only)', () => {
    const { s, ev } = landing(false);
    const lands = only(ev, 'snapLand');
    expect(lands.length).toBe(1);
    expect(lands[0]?.own).toBe(false);
    expect(lands[0]?.chain).toBe(2);
    expect([s.stats.snapLands, s.stats.snapLandsOwn, s.nubs.swChain, s.landTicks]).toEqual([1, 0, 2, -1]);
    expect(only(ev, 'ringTrick').filter((e) => e.kind === 'land')).toHaveLength(0);
    // The landing tick is landHoldTicks into the window.
    const end = ev.findIndex((e) => e.e === 'snapEnd');
    expect(end).toBeGreaterThanOrEqual(0);
    // No bloom under the snap: no landing.
    expect(only(landing(false, false).ev, 'snapLand')).toHaveLength(0);
  });

  it('an own landing (this snap’s sunflower) counts as a fresh SWING: Snow = chain, +landH frost, a land trick', () => {
    const { s, ev } = landing(true);
    const lands = only(ev, 'snapLand');
    expect(lands).toHaveLength(1);
    expect(lands[0]?.own).toBe(true);
    expect(lands[0]?.chain).toBe(2);
    expect(only(ev, 'ringTrick').filter((e) => e.kind === 'land')).toEqual([{ e: 'ringTrick', kind: 'land', units: R.trick }]);
    expect(only(ev, 'frostGain').filter((e) => e.source === 'land')).toEqual([{ e: 'frostGain', source: 'land', amountH: BK.landH, charges: expect.any(Number) }]);
    expect([s.stats.snapLandsOwn, s.stats.swings]).toEqual([1, 1]);
  });

  it('a landing needs its hold to start within landWindowTicks of snapEnd', () => {
    const s = lab({ startFrost: 1, startT: 22 });
    step(s, SNAP);
    debugBloom(s, bud(s, 600, wrapDeg(s.sun.theta + 180)).id);
    while (s.snapTicks > 0) run(s, 1, NO_INPUT, 100);
    expect(s.landTicks).toBe(G.landWindowTicks - 1);
    run(s, G.landWindowTicks, NO_INPUT, 100);
    expect(s.landTicks).toBe(-1);
    // Shade arriving after the window closed is no landing.
    for (let dy = -60; dy <= 400; dy += 30) block(s, s.nubs.y + dy, 0, 50);
    expect(only(run(s, 60, NO_INPUT, 100), 'snapLand')).toHaveLength(0);
  });
});

describe('v1.6 economy state and switches', () => {
  it('hashState reads the ring and the bank', () => {
    const s = lab({ startFrost: 1 });
    const h0 = hashState(s);
    s.nubs.ringCharge += 5;
    const h1 = hashState(s);
    expect(h1).not.toBe(h0);
    s.nubs.frostH += 1;
    expect(hashState(s)).not.toBe(h1);
  });

  it('with ring, bank and garden off the v1.5 rules return: an empty start, passive frost income, multReset', () => {
    const off = { ring: false, bank: false, garden: false } as const;
    const s = lab({ v16: off, mechanics: { deep: false } });
    expect(s.nubs.frostH).toBe(0);
    for (let dy = 40; dy <= 900; dy += 25) block(s, s.nubs.y + dy);
    for (let i = 0; i < 400 && s.nubs.f > 0; i++) step(s, NO_INPUT);
    run(s, TUNING.mult.stepTicks + 10);
    expect(s.nubs.frost).toBeGreaterThan(0);
    expect(s.nubs.mult).toBe(2);
    expect(s.world.clouds.length).toBe(0);
    const t = lab({ v16: off, startFrost: 1 });
    step(t, SNAP);
    const cl = t.world.clouds.find((c) => c.id === SNAP_ID_BASE);
    expect(Object.isFrozen(cl)).toBe(true);
  });
});
