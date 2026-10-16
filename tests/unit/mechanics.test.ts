// v1.5 core mechanics (docs/V1_5_PLAN.md §2): Sunflower buds (placement, growth, bloom, guide.bud),
// the frost meter and the Cold Snap, deep shade; the validator ignores what a run makes; hashes.
import { describe, expect, it } from 'vitest';
import { TUNING } from '../../src/config/tuning.ts';
import { angleDiff, wrapDeg } from '../../src/core/dmath.ts';
import { makeCaster, makePrism } from '../../src/core/gen/catalog.ts';
import { insertBud, insertCaster, insertPickup } from '../../src/core/gen/store.ts';
import { createWorld, ensureGenerated, generateSome, validatedY } from '../../src/core/gen/world.ts';
import { stepLit, stepLitLive } from '../../src/core/gen/validator.ts';
import { rectPoly } from '../../src/core/geom.ts';
import { BUD_ID_BASE, RUNTIME_ID_BASE, SNAP_ID_BASE, type Bud } from '../../src/core/objects.ts';
import { createBot } from '../../src/core/sim/bots.ts';
import { createRun } from '../../src/core/sim/create.ts';
import type { SimEvent } from '../../src/core/sim/events.ts';
import { hashState } from '../../src/core/sim/hash.ts';
import { headlessConfig } from '../../src/core/sim/headless.ts';
import { debugBloom, SNAP_TICKS } from '../../src/core/sim/mechanics.ts';
import { createReplay, playReplay, recordFrame } from '../../src/core/sim/replay.ts';
import { buildRunResult } from '../../src/core/sim/result.ts';
import { step } from '../../src/core/sim/step.ts';
import { NO_INPUT, type InputFrame, type RunConfig, type SimState } from '../../src/core/sim/types.ts';
import { trailX } from '../../src/core/trail.ts';

const B = TUNING.buds;
const F = TUNING.frost;
const TAP: InputFrame = { dTheta: 0, down: false, downEdge: true, upEdge: true, release: 0, key: 0 };
const SNAP: InputFrame = { ...NO_INPUT, snap: true };

/** An emptied, frozen world (Nubs in full sun), started past the start beat. */
function lab(cfg: Partial<RunConfig> = {}): SimState {
  const s = createRun({ ...headlessConfig(1), plan: false, ...cfg });
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

let rockId = 2_000_000;
/** A 60×60 block, 100 high, centered on the trail at y (Nubs inside it is fully shaded at any θ). */
function block(s: SimState, y: number, dx = 0): void {
  const x = trailX(s.world.trail, y) + dx;
  insertCaster(
    s.world,
    makeCaster({ id: rockId++, kind: 'rock', name: 'the Test Rock', biome: 'meadow', x, y, rot: 0, parts: [makePrism(rectPoly(x, y, 60, 60, 1, 0), 100)], side: 1, rescue: false, gate: false, ballId: -1, chunk: 0 }),
  );
}

function run(s: SimState, n: number, f: InputFrame = NO_INPUT): SimEvent[] {
  const all: SimEvent[] = [];
  for (let i = 0; i < n && s.phase !== 'dead'; i++) {
    step(s, f);
    all.push(...s.events);
  }
  return all;
}

/** A bud `ahead` u up the trail beside it, facing `face`. */
function bud(s: SimState, ahead: number, face: number): Bud {
  const y = s.nubs.y + ahead;
  const b: Bud = { id: BUD_ID_BASE + s.world.buds.length, x: trailX(s.world.trail, y) + 40, y, face, grow: 0, state: 0, casterId: -1 };
  insertBud(s.world, b);
  return b;
}

describe('Sunflower buds', () => {
  it('are placed beside the trail every few seconds of walking, never facing θ0, the same however the world is sliced', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const w = createWorld({ seed, profile: 3, tutorial: false });
      ensureGenerated(w, 6000);
      expect(w.buds.length).toBeGreaterThan(8);
      for (let i = 0; i < w.buds.length; i++) {
        const b = w.buds[i] as Bud;
        if (i > 0) expect(b.y).toBeGreaterThan((w.buds[i - 1] as Bud).y);
        expect(b.id).toBeGreaterThanOrEqual(BUD_ID_BASE);
        expect(Number.isInteger(b.face) && b.face >= 0 && b.face < 360).toBe(true);
        expect(Math.abs(angleDiff(b.face, w.theta0))).toBeGreaterThanOrEqual(B.faceTol + B.avoidTheta0 - 0.5);
        expect(Math.abs(b.x - trailX(w.trail, b.y))).toBeGreaterThanOrEqual(B.latMin - 1e-9);
        expect(Math.abs(b.x - trailX(w.trail, b.y))).toBeLessThanOrEqual(B.latMax + 8 * TUNING.world.pushStep + 1e-9);
        expect([b.grow, b.state, b.casterId]).toEqual([0, 0, -1]);
        // The face throws the bloom's shadow back across the trail before the bud (± aimJitter).
        let near = Infinity;
        for (let back = B.aimBackMin; back <= B.aimBackMax; back += 2) {
          const toBud = (Math.atan2(back, b.x - trailX(w.trail, b.y - back)) * 180) / Math.PI;
          near = Math.min(near, Math.abs(angleDiff(b.face, toBud)));
        }
        expect(near).toBeLessThanOrEqual(B.aimJitter + 1);
      }
      // Generated ids never move: casters are numbered exactly as without buds.
      const plain = createWorld({ seed, profile: 3, tutorial: false, mechanics: { buds: false } });
      ensureGenerated(plain, 6000);
      expect(plain.buds).toHaveLength(0);
      expect(w.casters.map((c) => `${c.id}:${c.name}:${c.x}`)).toEqual(plain.casters.map((c) => `${c.id}:${c.name}:${c.x}`));
      // Sliced generation builds the same buds.
      const sliced = createWorld({ seed, profile: 3, tutorial: false });
      while (validatedY(sliced) < validatedY(w)) generateSome(sliced, validatedY(w), 3);
      expect(sliced.buds.map((b) => [b.id, b.x, b.y, b.face])).toEqual(w.buds.map((b) => [b.id, b.x, b.y, b.face]));
    }
  }, 30_000);

  it('come about once every 3-5 s of daylight walking (more on later days), none in the tutorial chunk', () => {
    const w = createWorld({ seed: 9, profile: 3, tutorial: false });
    ensureGenerated(w, 20000);
    const day1 = w.buds.filter((b) => b.y < 50 * 70);
    // Day 1: 50 s at 70 u/s, the window t/Dl ∈ [0.06, 0.94]: ~44 s / 4 s ≈ 11 buds (some spots are taken).
    expect(day1.length).toBeGreaterThanOrEqual(7);
    expect(day1.length).toBeLessThanOrEqual(15);
    const tut = createWorld({ seed: 9, profile: 0, tutorial: true });
    ensureGenerated(tut, 3000);
    expect(tut.buds.every((b) => b.y >= TUNING.world.chunkLen)).toBe(true);
    expect(tut.buds.length).toBeGreaterThan(0);
  });

  it('grow while the sun shines from within ±faceTol of the face, fade otherwise, and bloom into a sunflower caster', () => {
    const s = lab();
    const b = bud(s, 120, wrapDeg(s.sun.theta + 90));
    // Facing away: nothing grows.
    run(s, 30);
    expect(b.grow).toBe(0);
    // Turn the sun onto the face (within tolerance) and hold.
    s.sun.theta = wrapDeg(b.face + B.faceTol - 1);
    const n = Math.ceil(B.growSec * 60) - 1;
    let ev = run(s, n - 10);
    expect(b.grow).toBeGreaterThan(0.6);
    expect(ev.some((e) => e.e === 'budGrow')).toBe(true);
    // Turn away for a moment: growth fades at `decay` per second.
    s.sun.theta = wrapDeg(b.face + 180);
    const g0 = b.grow;
    run(s, 15);
    expect(b.grow).toBeCloseTo(g0 - (B.decay * 15) / 60, 9);
    s.sun.theta = b.face;
    const snow0 = s.stats.snow;
    ev = run(s, 60);
    const bloom = ev.find((e) => e.e === 'bloom');
    expect(bloom).toEqual({ e: 'bloom', id: b.id, x: b.x, y: b.y, snow: B.snow });
    expect([b.state, b.grow]).toEqual([1, 1]);
    expect(b.casterId).toBe(RUNTIME_ID_BASE + (b.id - BUD_ID_BASE));
    const c = s.world.byId.get(b.casterId);
    expect(c?.kind).toBe('sunflower');
    expect([c?.x, c?.y]).toEqual([b.x, b.y]);
    expect(c?.parts.map((p) => p.t)).toEqual(['prism', 'disc']);
    expect(s.world.casters).toContain(c);
    expect(s.stats.blooms).toBe(1);
    expect(s.stats.snow).toBe(snow0 + B.snow);
    expect(s.nubs.frost).toBeCloseTo(F.perBloom, 9);
    // A bloomed bud never grows again.
    expect(run(s, 60).some((e) => e.e === 'bloom')).toBe(false);
  });

  it('only grow within reach of Nubs and while the sun is up', () => {
    const s = lab();
    const far = bud(s, B.reachAhead + 50, 0);
    const near = bud(s, 60, 0);
    s.sun.theta = 0;
    run(s, 10);
    expect(far.grow).toBe(0);
    expect(near.grow).toBeGreaterThan(0);
  });

  it('guide.bud marks the gold arcs: face ± faceTol of every unbloomed bud within reach', () => {
    const s = lab();
    bud(s, 100, 40);
    bud(s, 200, 200);
    bud(s, B.reachAhead + 100, 300);
    while (s.guide.tick !== s.tick) step(s, NO_INPUT);
    const g = s.guide.bud;
    for (let b = 0; b < 360; b++) {
      const want = Math.abs(angleDiff(b, 40)) <= B.faceTol || Math.abs(angleDiff(b, 200)) <= B.faceTol;
      expect(g[b], `bin ${b}`).toBe(want ? 1 : 0);
    }
  });

  it('an idle sun never grows a bud (faces avoid θ0), and debugBloom forces one for screenshots', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const s = createRun(headlessConfig(seed, 3));
      const bot = createBot('idle');
      for (let i = 0; i < 4000 && s.phase !== 'dead'; i++) step(s, bot.next(s));
      expect(s.stats.blooms, `seed ${seed}`).toBe(0);
    }
    const s = createRun(headlessConfig(3, 3));
    const b = debugBloom(s);
    expect(b).not.toBeNull();
    expect(s.events.some((e) => e.e === 'bloom')).toBe(true);
    expect(s.world.byId.get((b as Bud).casterId)?.kind).toBe('sunflower');
  }, 30_000);
});

describe('Cold Snap', () => {
  it('the frost meter fills from full shade (×frostMul in deep shade), flakes and blooms; frostReady fires once', () => {
    const s = lab({ mechanics: { deep: false } });
    for (let dy = 40; dy <= 700; dy += 50) block(s, s.nubs.y + dy);
    // Walk into the block: one source over Nubs.
    for (let i = 0; i < 400 && s.nubs.f > 0; i++) step(s, NO_INPUT);
    expect(s.nubs.f).toBe(0);
    const f0 = s.nubs.frost;
    run(s, 60);
    expect(s.nubs.frost - f0).toBeCloseTo(F.perShadeSec, 9);
    const fl = s.nubs.frost;
    insertPickup(s.world, { id: 9_000_000, kind: 'flake', x: s.nubs.x, y: s.nubs.y + 1, day: 1, melt: 0, state: 0, cluster: -1, ci: 0, cn: 1, brittle: false });
    run(s, 1);
    expect(s.nubs.frost - fl).toBeCloseTo(F.perFlake + F.perShadeSec / 60, 9);
    s.nubs.frost = 0.9999;
    const ev = run(s, 30);
    expect(ev.filter((e) => e.e === 'frostReady')).toHaveLength(1);
    expect(s.nubs.frost).toBe(1);
  });

  it('a snap with a full meter drops a cloud at z 0 that keeps Nubs fully shaded at every θ for snapSec, then ends', () => {
    const s = lab({ startFrost: 1 });
    expect(s.nubs.frost).toBe(1);
    expect(s.nubs.f).toBe(1);
    step(s, SNAP);
    const snap = s.events.find((e) => e.e === 'snap');
    expect(snap).toEqual({ e: 'snap', x: s.nubs.x, y: s.nubs.y, cloudId: SNAP_ID_BASE });
    expect([s.snapTicks, s.snapCloudId, s.nubs.frost, s.stats.snaps]).toEqual([SNAP_TICKS, SNAP_ID_BASE, 0, 1]);
    const cl = s.world.clouds.find((c) => c.id === SNAP_ID_BASE);
    expect([cl?.kind, cl?.z]).toEqual(['snap', 0]);
    expect(s.nubs.f).toBe(0);
    // Shaded whatever the sun does, and the meter does not charge meanwhile.
    const ev: SimEvent[] = [];
    for (let i = 1; i < SNAP_TICKS; i++) {
      s.sun.theta = wrapDeg(s.sun.theta + 7);
      step(s, SNAP);
      ev.push(...s.events);
      expect(s.nubs.f, `tick ${i}`).toBe(0);
      expect(s.nubs.cloudId).toBe(-1);
    }
    expect(s.nubs.frost).toBe(0);
    expect(ev.some((e) => e.e === 'snap' || e.e === 'snapEnd')).toBe(false);
    step(s, NO_INPUT);
    expect(s.events).toContainEqual({ e: 'snapEnd' });
    expect([s.snapTicks, s.snapCloudId]).toEqual([0, -1]);
    expect(s.nubs.f).toBe(1);
    expect(s.stats.cloudRideBest).toBe(0);
  });

  it('a snap does nothing with a meter that is not full, at night, or when the mechanic is off', () => {
    const s = lab({ startFrost: 0.99 });
    step(s, SNAP);
    expect(s.snapTicks).toBe(0);
    expect(s.events.some((e) => e.e === 'snap')).toBe(false);
    const off = lab({ startFrost: 1, mechanics: { snap: false } });
    expect(off.nubs.frost).toBe(0);
    step(off, SNAP);
    expect(off.snapTicks).toBe(0);
    const night = lab({ startFrost: 1, startT: 49.9 });
    run(night, 30);
    expect(night.phase).toBe('night');
    step(night, SNAP);
    expect(night.snapTicks).toBe(0);
    expect(night.nubs.frost).toBe(1);
  });

  it('guide masks show every angle safe under the snap; the death line never blames the snap cloud', () => {
    const s = lab({ startFrost: 1 });
    step(s, SNAP);
    while (s.guide.tick !== s.tick) step(s, NO_INPUT);
    expect(s.guide.now.every((v) => v === 1)).toBe(true);
    run(s, SNAP_TICKS);
    run(s, 400);
    expect(s.phase).toBe('dead');
    expect(s.death?.cause).not.toBe('cloud');
  });

  it('replays record the snap input and reproduce the run', () => {
    const cfg: RunConfig = { ...headlessConfig(5, 3), startFrost: 1 };
    const s = createRun(cfg);
    const rep = createReplay(cfg);
    const bot = createBot('reactive');
    for (let i = 0; i < 1500 && s.phase !== 'dead'; i++) {
      const f = bot.next(s);
      if (i === 300) f.snap = true;
      recordFrame(rep, f);
      step(s, f);
      f.snap = false;
    }
    expect(s.stats.snaps).toBeGreaterThanOrEqual(1);
    expect(hashState(playReplay(rep))).toBe(hashState(s));
  });
});

describe('deep shade', () => {
  it('two sources over the center sample while fully shaded: deep, ×2 regen and multiplier charge, deepEnter', () => {
    const s = lab({ startChill: 40 });
    const y = s.nubs.y + 30;
    block(s, y);
    block(s, y + 20);
    for (let i = 0; i < 400 && s.nubs.f > 0; i++) step(s, NO_INPUT);
    // Inside both blocks.
    for (let i = 0; i < 400 && !s.nubs.deep; i++) step(s, NO_INPUT);
    expect(s.nubs.deep).toBe(true);
    const c0 = s.nubs.chill;
    const m0 = s.nubs.shadeTicks;
    run(s, 6);
    expect(s.nubs.deep).toBe(true);
    expect(s.nubs.chill - c0).toBeCloseTo(Math.min(100 - c0, (6 * TUNING.nubs.regen * TUNING.deep.regenMul) / 60), 9);
    expect(s.nubs.shadeTicks - m0).toBe(6 * TUNING.deep.multMul);
    expect(s.stats.deepSeconds).toBeGreaterThan(0);
  });

  it('a single source is plain shade; deep shade is off when the mechanic is', () => {
    const s = lab();
    block(s, s.nubs.y + 40);
    const ev: SimEvent[] = [];
    for (let i = 0; i < 300; i++) {
      step(s, NO_INPUT);
      ev.push(...s.events);
      expect(s.nubs.deep).toBe(false);
    }
    const off = lab({ mechanics: { deep: false } });
    block(off, off.nubs.y + 30);
    block(off, off.nubs.y + 50);
    for (let i = 0; i < 300; i++) {
      step(off, NO_INPUT);
      expect(off.nubs.deep).toBe(false);
    }
  });

  it('deepEnter fires on entry, then again only after reenterTicks out of deep shade', () => {
    const s = lab();
    const y = s.nubs.y + 30;
    block(s, y);
    block(s, y + 20);
    let enters = 0;
    for (let i = 0; i < 300; i++) {
      step(s, NO_INPUT);
      enters += s.events.filter((e) => e.e === 'deepEnter').length;
    }
    expect(enters).toBe(1);
  });
});

describe('the world stays a pure function of its config', () => {
  it('the validator and its cache ignore sunflowers and the snap cloud; stepLitLive sees them', () => {
    const s = createRun({ ...headlessConfig(7, 3), startFrost: 1 });
    step(s, TAP);
    while (s.ready > 0) step(s, NO_INPUT);
    for (let i = 0; i < 4; i++) debugBloom(s);
    expect(s.stats.blooms).toBe(4);
    const j = Math.round(s.tickAbs / 6) + 3;
    const cached = new Uint8Array(360);
    const fresh = new Uint8Array(360);
    stepLit(s.world, j, cached);
    // A world built from the same config without the blooms gives the same validator rows.
    const twin = createRun({ ...headlessConfig(7, 3), startFrost: 1 });
    stepLit(twin.world, j, fresh);
    expect(Array.from(cached)).toEqual(Array.from(fresh));
    step(s, SNAP);
    expect(s.snapTicks).toBe(SNAP_TICKS);
    const live = new Uint8Array(360);
    expect(stepLitLive(s.world, Math.round(s.tickAbs / 6) + 1, live)).toBe(true);
    expect(live.every((v) => v === 0)).toBe(true);
  });

  it('the run result and the hash carry the new state', () => {
    const s = lab({ startFrost: 1 });
    const h0 = hashState(s);
    s.nubs.frost = 0.5;
    expect(hashState(s)).not.toBe(h0);
    s.nubs.frost = 1;
    step(s, SNAP);
    const r = buildRunResult(s);
    expect([r.stats.snaps, r.stats.blooms, r.stats.deepSeconds]).toEqual([1, 0, 0]);
  });
});
