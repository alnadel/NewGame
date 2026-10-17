// v1.6 world (docs/V1_6_PLAN.md §2.3, §2.5, T1, T7; CORE-2): Noon Heat in the sim and the validator,
// Heat Flares (schedule, keep test, lift, the sim's state machine, parry and miss, guide.flare),
// glass clusters (two chunks behind, the contest test, guide.flake, clusterSaved), guide.deep and
// the hash.
import { describe, expect, it } from 'vitest';
import { TUNING } from '../../src/config/tuning.ts';
import { dayStartTick, dayStartY, dayTicks, elevation } from '../../src/core/clock.ts';
import { clusterEligible, contestCluster, glassQuota } from '../../src/core/gen/contest.ts';
import { flareLift, liftOf, noonHeatAt, paramsAt, worldElevation } from '../../src/core/gen/plan.ts';
import { insertCaster, insertPickup } from '../../src/core/gen/store.ts';
import { chillDeltaTable, deltaForSlot, keepRows, keepVerdict, slotDeltaAt, validatorDrain } from '../../src/core/gen/validator.ts';
import { createWorld, ensureGenerated, generateSome, type World } from '../../src/core/gen/world.ts';
import { makeCaster, makePrism } from '../../src/core/gen/catalog.ts';
import { rectPoly } from '../../src/core/geom.ts';
import { FLAKE_ID_BASE, FLARE_DROPPED, FLARE_KEPT, PICKUP_ALIVE, type Flare, type Pickup } from '../../src/core/objects.ts';
import { campaignConfig } from '../../src/core/level.ts';
import { createRun } from '../../src/core/sim/create.ts';
import type { SimEvent } from '../../src/core/sim/events.ts';
import { debugFlare, flareMeltMul } from '../../src/core/sim/flares.ts';
import { hashState } from '../../src/core/sim/hash.ts';
import { headlessConfig } from '../../src/core/sim/headless.ts';
import { meltBudgetOf } from '../../src/core/sim/pickups.ts';
import { step, syncTime } from '../../src/core/sim/step.ts';
import { payTrick } from '../../src/core/sim/tricks.ts';
import { NO_INPUT, type InputFrame, type SimState } from '../../src/core/sim/types.ts';
import { trailX } from '../../src/core/trail.ts';

const TAP: InputFrame = { dTheta: 0, down: false, downEdge: true, upEdge: true, release: 0, key: 0 };

/** A run started (tap + start beat), ready for clock ticks. */
function started(cfg = headlessConfig(1)): SimState {
  const s = createRun(cfg);
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
  w.buds.length = 0;
  w.validatedThrough = 1e6;
}

let rockId = 3_000_000;
/** Covers the trail with tall blocks so Nubs is shaded whatever the sun does. */
function shadeAll(s: SimState, from: number, to: number): void {
  for (let y = from; y <= to; y += 40) {
    const x = trailX(s.world.trail, y);
    insertCaster(s.world, makeCaster({ id: rockId++, kind: 'rock', name: 'the Test Rock', biome: 'meadow', x, y, rot: 0, parts: [makePrism(rectPoly(x, y, 80, 80, 1, 0), 100)], side: 1, rescue: false, gate: false, ballId: -1, chunk: 0 }));
  }
}

/** Jumps a started, stripped run's clock to `dayTick` of `day`. */
function jumpTo(s: SimState, day: number, dayTick: number): void {
  s.day = day;
  s.params = paramsAt(s.world, day);
  s.dayTick = dayTick;
  syncTime(s);
}

describe('Noon Heat (T1)', () => {
  it('multiplies the drain between 11 AM and 1 PM from Day 2 (profile 3), Endless only', () => {
    const w = createWorld(headlessConfig(1));
    const dl = dayTicks(2);
    expect(noonHeatAt(w, 1, Math.round(dl / 2))).toBe(1);
    expect(noonHeatAt(w, 2, Math.round(dl / 2))).toBe(1.1);
    const STEP = TUNING.validator.stepTicks;
    expect(noonHeatAt(w, 2, Math.floor((5 * dl) / 12) - 2 * STEP)).toBe(1);
    expect(noonHeatAt(w, 2, Math.ceil((7 * dl) / 12) + STEP)).toBe(1);
    // Exact in the validator: the edges sit on its 0.1 s step grid, so every tick of a DP step (t − 6,
    // t] has the heat of its end tick t, and the window keeps its 2 h length to within a step.
    for (const day of [2, 4]) {
      const t0 = dayStartTick(day);
      const d = dayTicks(day);
      let heated = 0;
      for (let t = Math.floor((4 * d) / 12); t < Math.ceil((8 * d) / 12); t++) {
        const h = noonHeatAt(w, day, t);
        if (h !== 1) heated++;
        const end = STEP * Math.ceil((t0 + t) / STEP);
        expect(h, `day ${day} tick ${t}`).toBe(noonHeatAt(w, day, end - t0));
      }
      expect(Math.abs(heated - d / 6)).toBeLessThanOrEqual(STEP);
    }
    expect(noonHeatAt(w, 4, Math.round(dl / 2))).toBe(1.2);
    // Profiles 0-2 one day later; off with the rule switched off and on every campaign level.
    expect(noonHeatAt(createWorld(headlessConfig(1, 2)), 2, Math.round(dl / 2))).toBe(1);
    expect(noonHeatAt(createWorld(headlessConfig(1, 2)), 3, Math.round(dl / 2))).toBe(1.1);
    expect(noonHeatAt(createWorld({ ...headlessConfig(1), v16: { noonHeat: false } }), 4, Math.round(dl / 2))).toBe(1);
    expect(noonHeatAt(createWorld(campaignConfig(100)), 1, Math.round(dl / 2))).toBe(1);
    // The validator's DP charges the same drain (a per-slot table).
    expect(deltaForSlot(w, 4, Math.round(dl / 2))).toBe(chillDeltaTable(validatorDrain(w) * 1.2, paramsAt(w, 1).regen));
    expect(deltaForSlot(w, 4, 10)).toBe(chillDeltaTable(validatorDrain(w), paramsAt(w, 1).regen));
  });

  it('a lit noon tick on Day 4 drains × 1.2', () => {
    const s = started();
    strip(s);
    jumpTo(s, 4, Math.round(dayTicks(4) / 2));
    s.nubs.chill = 80;
    step(s, NO_INPUT);
    expect(s.nubs.f).toBe(1);
    expect(s.nubs.chill).toBeCloseTo(80 - (55 * 1.2) / 60, 9);
  });
});

describe('Heat Flares (§2.5)', () => {
  it('lift: smoothstep rise, hold 1, mirrored fall; worldElevation is the sim elevation, capped below εnoon', () => {
    const s = started();
    strip(s);
    shadeAll(s, s.nubs.y - 200, s.nubs.y + 900);
    const f = debugFlare(s, 30, 10);
    expect([liftOf(f, f.riseTick - 1), liftOf(f, f.riseTick), liftOf(f, f.holdTick), liftOf(f, f.fallTick - 1), liftOf(f, f.endTick)]).toEqual([0, 0, 1, 1, 0]);
    expect(liftOf(f, f.riseTick + 9)).toBeCloseTo(0.5, 12);
    expect(liftOf(f, f.fallTick + 15)).toBeCloseTo(0.5, 12);
    let lifted = 0;
    for (let i = 0; i < 260; i++) {
      step(s, NO_INPUT);
      expect(worldElevation(s.world, s.tickAbs)).toBe(s.eps);
      const base = elevation(s.params, s.tDay);
      if (s.tickAbs >= f.holdTick && s.tickAbs < f.fallTick) {
        expect(s.eps).toBe(Math.min(base + 10, s.params.epsNoon - TUNING.flare.epsMargin));
        lifted++;
      }
      expect(flareLift(s.world, s.tickAbs)).toBe(liftOf(f, s.tickAbs));
    }
    expect(lifted).toBe(TUNING.flare.holdTicks);
  });

  it('the state machine: warn (with guide.flare), rise, hold, parry when shaded, end; a lit hold is a miss', () => {
    for (const shaded of [true, false]) {
      // In full sun the first-run lesson's Chill floor keeps Nubs alive through the flare.
      const s = started(shaded ? headlessConfig(1) : { ...headlessConfig(1), lesson: true });
      strip(s);
      if (shaded) shadeAll(s, s.nubs.y - 200, s.nubs.y + 1500);
      const f = debugFlare(s, 6, 10);
      const events: SimEvent[] = [];
      let warnGuide = 0;
      let flareTicksSeen = -1;
      for (let i = 0; i < 300; i++) {
        step(s, NO_INPUT);
        events.push(...s.events);
        if (s.flarePhase === 1 && s.guide.flare.some((v) => v === 1)) warnGuide++;
        if (s.flarePhase === 1 && s.guide.flareTicks >= 0) flareTicksSeen = s.guide.flareTicks;
      }
      const names = events.filter((e) => e.e.startsWith('flare')).map((e) => e.e);
      expect(names).toEqual(['flareWarn', 'flareRise', shaded ? 'flareParry' : 'flareMiss', 'flareEnd']);
      expect(events.find((e) => e.e === 'flareWarn')).toEqual({ e: 'flareWarn', id: f.id, ticks: TUNING.flare.warnTicks, d: 10 });
      expect(s.stats.flaresSeen).toBe(1);
      expect(s.stats.parries).toBe(shaded ? 1 : 0);
      if (shaded) {
        expect(warnGuide).toBeGreaterThan(0);
        expect(events.find((e) => e.e === 'flareParry')).toEqual({ e: 'flareParry', id: f.id, snap: false, snow: TUNING.flare.snow });
      } else {
        expect(events.find((e) => e.e === 'flareMiss')).toEqual({ e: 'flareMiss', id: f.id, lit: TUNING.flare.holdTicks });
      }
      expect(flareTicksSeen).toBeGreaterThanOrEqual(0);
      expect([s.flarePhase, s.flareId, s.flareTicks]).toEqual([0, -1, -1]);
    }
  });

  it('a parry and a saved glass cluster pay the Frost Bank and a ring trick (sim/tricks.ts, the bridge to CORE-1)', () => {
    for (const kind of ['parry', 'cluster'] as const) {
      // The Frost Bank ships off (V16_SHIP); switched on, the bridge pays it.
      const s = started({ ...headlessConfig(1), v16: { bank: true } });
      expect(s.world.v16.bank && s.world.v16.ring && s.world.mech.snap).toBe(true);
      const h = kind === 'parry' ? TUNING.bank.parryH : TUNING.bank.clusterH;
      const before = s.nubs.frostH;
      const tricks = s.stats.ringTricks ?? 0;
      s.events.length = 0;
      payTrick(s, kind);
      expect(s.nubs.frostH).toBe(Math.min(TUNING.bank.capH, before + h));
      expect(s.stats.ringTricks).toBe(tricks + 1);
      expect(s.events).toContainEqual({ e: 'ringTrick', kind, units: TUNING.ring.trick });
      expect(s.events).toContainEqual(expect.objectContaining({ e: 'frostGain', source: kind, amountH: h }));
    }
    // With the Bank and the ring off, the v1.5 meter takes the frost and the ring is untouched.
    const off = started({ ...headlessConfig(1), v16: { bank: false, ring: false } });
    const meter = off.nubs.frost;
    expect(meter).toBe(TUNING.frost.runStart);
    off.events.length = 0;
    payTrick(off, 'parry');
    expect(off.nubs.frost).toBeCloseTo(meter + TUNING.bank.parryH / 100, 12);
    expect(off.events.some((e) => e.e === 'ringTrick')).toBe(false);
  });

  it('flakes melt ×2 in the rise and hold', () => {
    const s = started();
    strip(s);
    shadeAll(s, s.nubs.y - 200, s.nubs.y + 900);
    const f = debugFlare(s, 0, 10);
    const p: Pickup = { id: FLAKE_ID_BASE + 9999, kind: 'flake', x: 0, y: 0, day: 1, melt: 0, state: PICKUP_ALIVE, cluster: -1, ci: 0, cn: 1, brittle: false };
    // The rate doubles in the rise and hold; the budget (the threshold) never moves.
    expect(flareMeltMul(s)).toBe(1);
    while (s.tickAbs < f.riseTick) step(s, NO_INPUT);
    expect(flareMeltMul(s)).toBe(TUNING.flare.meltMul);
    expect(meltBudgetOf(s, p)).toBe(s.params.meltBudget);
    while (s.tickAbs < f.fallTick) step(s, NO_INPUT);
    expect(flareMeltMul(s)).toBe(1);
    expect(meltBudgetOf(s, p)).toBe(s.params.meltBudget);
  });

  it('schedule and keep test (40 seeds × Days 1-4): p3 has none on Day 1, one on Day 2, two from Day 3; every kept flare passes both conditions', () => {
    let kept = 0;
    let decided = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const w = createWorld(headlessConfig(seed));
      // Each kept flare passes the keep test in the world as it stood when the validator kept it
      // (its chunk's rescue rocks and later chunks may still add shade afterwards).
      const checked = new Set<number>();
      while (!generateSome(w, dayStartY(5), 1)) {
        for (const f of w.flares) {
          if (f.state !== FLARE_KEPT || checked.has(f.id)) continue;
          checked.add(f.id);
          const v = keepVerdict(keepRows(w, f));
          expect(v.kept, `seed ${seed} flare ${f.id}: ${JSON.stringify(v)}`).toBe(true);
        }
      }
      const perDay = [0, 0, 0, 0, 0];
      for (const f of w.flares) {
        if (f.day <= 4) perDay[f.day] = (perDay[f.day] as number) + 1;
        if (f.day > 4 || f.state === 0) continue;
        decided++;
        if (f.state !== FLARE_KEPT) continue;
        kept++;
        // Never at night, in the Noon Heat window or straddling a day; the rise stays in its window of
        // TUNING.flare.windows (the keep test's shifts never move it out).
        const t0 = dayStartTick(f.day);
        expect(f.warnTick).toBeGreaterThanOrEqual(t0);
        expect(f.endTick).toBeLessThanOrEqual(t0 + dayTicks(f.day));
        expect(12 * (f.endTick - t0) <= 5 * dayTicks(f.day) || 12 * (f.riseTick - t0) >= 7 * dayTicks(f.day)).toBe(true);
        const u = (f.riseTick - t0) / dayTicks(f.day);
        const half = TUNING.validator.stepTicks / 2 / dayTicks(f.day);
        expect(TUNING.flare.windows.some(([a, b]) => u >= a - half && u <= b + half), `seed ${seed} flare ${f.id} rises at ${u}`).toBe(true);
      }
      expect(perDay.slice(1)).toEqual([0, 1, 2, 2]);
      for (let i = 1; i < w.flares.length; i++) expect((w.flares[i] as Flare).riseTick).toBeGreaterThan((w.flares[i - 1] as Flare).riseTick);
    }
    // The share kept is a sim --check row (§2.5's ≥ 85% of Days 2-4); here only that flares are kept at all.
    expect(kept / decided).toBeGreaterThan(0.5);
  }, 60_000);

  it("a lit hold tick burns TUNING.flare.burnPerLitTick on top of the drain; the validator's DP charges it on the hold's steps", () => {
    const burn = TUNING.flare.burnPerLitTick;
    expect(burn).toBeGreaterThan(0);
    // The sim: in full sun the first burning tick drops Chill by the burn more than the tick before the hold.
    const s = started();
    strip(s);
    const f = debugFlare(s, 6, 10);
    const drop = new Map<number, number>();
    for (let i = 0; i < 300 && s.tickAbs <= f.fallTick; i++) {
      s.nubs.chill = 60;
      step(s, NO_INPUT);
      drop.set(s.tickAbs, 60 - s.nubs.chill);
    }
    const before = drop.get(f.holdTick - 1) as number;
    expect(before).toBeGreaterThan(0);
    expect((drop.get(f.holdTick + 1) as number) - before).toBeCloseTo(burn, 1);
    expect((drop.get(f.fallTick) as number) - before).toBeGreaterThan(0.9 * burn);
    // The validator: the steps ending in (holdTick, fallTick] of a kept flare burn STEP × burn a lit count.
    const w = createWorld(headlessConfig(2));
    ensureGenerated(w, dayStartY(4));
    const k = w.flares.find((x) => x.state === FLARE_KEPT) as Flare;
    const STEP = TUNING.validator.stepTicks;
    const plain = (t: number): Float64Array => deltaForSlot(w, k.day, t - dayStartTick(k.day));
    for (const [t, burns] of [[k.holdTick, false], [k.holdTick + STEP, true], [k.fallTick, true], [k.fallTick + STEP, false]] as const) {
      const d = slotDeltaAt(w, t);
      const p0 = plain(t);
      expect(d[0], `tick ${t}`).toBe(p0[0]);
      expect((p0[STEP] as number) - (d[STEP] as number), `tick ${t}`).toBeCloseTo(burns ? STEP * burn : 0, 9);
    }
  });

  it('guide.flare is honest: every kept flare telegraphs angles, and holding any telegraphed angle through the hold parries it (fix round 2)', () => {
    let flares = 0;
    let holds = 0;
    for (const seed of [1, 2]) {
      const w = createWorld(headlessConfig(seed));
      ensureGenerated(w, dayStartY(4));
      for (const f of w.flares) {
        if (f.state !== FLARE_KEPT || f.day > 3) continue;
        const cfg = { ...headlessConfig(seed), startDay: f.day, startT: (f.warnTick - 90 - dayStartTick(f.day)) / 60, startChill: 100 };
        // Read the telegraph on the warning's last guide refresh (Chill pinned: only the parry counts).
        const s0 = createRun(cfg);
        step(s0, TAP);
        let mask: Uint8Array | null = null;
        while (s0.tickAbs < f.riseTick - 1) {
          step(s0, NO_INPUT);
          s0.nubs.chill = 100;
          if (s0.flarePhase === 1 && s0.guide.tick === s0.tick) mask = s0.guide.flare.slice();
        }
        expect(mask, `seed ${seed} flare ${f.id}: no warning`).not.toBeNull();
        const bins: number[] = [];
        (mask as Uint8Array).forEach((v, b) => {
          if (v === 1) bins.push(b);
        });
        expect(bins.length, `seed ${seed} flare ${f.id}: empty telegraph`).toBeGreaterThan(0);
        flares++;
        // The first, middle and last telegraphed bins, held from before the rise to the end.
        for (const b of new Set([bins[0], bins[bins.length >> 1], bins[bins.length - 1]] as number[])) {
          const s = createRun(cfg);
          step(s, TAP);
          let out = '';
          while (s.tickAbs < f.endTick + 2 && s.phase !== 'dead') {
            if (s.tickAbs >= f.riseTick - 30) {
              s.sun.theta = b;
              s.sun.lag = 0;
              s.sun.omega = 0;
            }
            step(s, NO_INPUT);
            s.nubs.chill = 100;
            for (const e of s.events) if (e.e === 'flareParry' || e.e === 'flareMiss') out = e.e === 'flareMiss' ? `miss ${e.lit}` : 'parry';
          }
          expect(out, `seed ${seed} flare ${f.id} held at ${b}°`).toBe('parry');
          holds++;
        }
      }
    }
    expect(flares).toBeGreaterThanOrEqual(4);
    expect(holds).toBeGreaterThanOrEqual(flares);
  }, 60_000);

  it('dropped flares never lift the sun; no flares with the rule off', () => {
    const w = createWorld(headlessConfig(3));
    ensureGenerated(w, dayStartY(5));
    for (const f of w.flares) if (f.state === FLARE_DROPPED) for (let t = f.riseTick; t < f.endTick; t += 6) expect(flareLift(w, t)).toBe(0);
    const off = createWorld({ ...headlessConfig(3), v16: { flares: false } });
    ensureGenerated(off, dayStartY(5));
    expect(off.flares).toEqual([]);
  });
});

/** Generates world `w` through `y` chunk by chunk, calling `onPlace` after each chunk placement. */
function generateWatching(w: World, y: number, onPlace: () => void): void {
  let placed = w.placedThrough;
  while (!generateSome(w, y, 1)) {
    if (w.placedThrough !== placed) {
      placed = w.placedThrough;
      onPlace();
    }
  }
}

describe('glass clusters (§2.3, T7)', () => {
  it('every glass cluster passes the contest test where it stands (40 seeds × Days 1-4); flakes trail the casters by two chunks', () => {
    let glass = 0;
    let eligible = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const w = createWorld(headlessConfig(seed));
      const seen = new Set<number>();
      generateWatching(w, dayStartY(5), () => {
        const job = w.lastJob;
        if (!job) return;
        // The clusters just placed belong to chunk placedThrough − 2, whose finished job is w.lastJob.
        expect(job.k).toBe(w.placedThrough - 2);
        for (const p of w.pickups) {
          if (p.kind !== 'flake' || p.ci !== p.cn - 1 || seen.has(p.cluster)) continue;
          seen.add(p.cluster);
          const first = w.pickups.find((q) => q.cluster === p.cluster && q.ci === 0) as Pickup;
          if (clusterEligible(w, job, p.y)) eligible++;
          if (!p.brittle) continue;
          glass++;
          expect(contestCluster(w, job, first.x, first.y, p.x, p.y).contested, `seed ${seed} cluster ${p.cluster}`).toBe(true);
        }
      });
      expect(w.glassMade).toBeLessThanOrEqual(Math.ceil(TUNING.brittle.quotaLater * w.glassEligible) + 1);
    }
    expect(glass).toBeGreaterThan(40);
    expect(eligible).toBeGreaterThan(glass);
  }, 120_000);

  it('glass quota: none in the tutorial, on profiles 0-1, on Quick Melt and Hardy days, or with the rule off; brittleShare forces it', () => {
    const p1 = paramsAt(createWorld(headlessConfig(1)), 1);
    expect(glassQuota(createWorld(headlessConfig(1)), 1, p1)).toBe(TUNING.brittle.quotaDay1);
    expect(glassQuota(createWorld(headlessConfig(1)), 2, paramsAt(createWorld(headlessConfig(1)), 2))).toBe(TUNING.brittle.quotaLater);
    expect(glassQuota(createWorld(headlessConfig(1, 2)), 2, p1)).toBe(TUNING.brittle.quotaLater / 2);
    expect(glassQuota(createWorld(headlessConfig(1, 1)), 2, p1)).toBe(0);
    expect(glassQuota(createWorld({ ...headlessConfig(1, 0), tutorial: true }), 2, p1)).toBe(0);
    expect(glassQuota(createWorld({ ...headlessConfig(1), v16: { brittle: false } }), 2, p1)).toBe(0);
    expect(glassQuota(createWorld({ ...headlessConfig(1), brittleShare: 1 }), 1, p1)).toBe(1);
    const melt = createWorld(campaignConfig(26));
    expect(glassQuota(melt, 1, paramsAt(melt, 1))).toBe(0);
    const hardy = createWorld(campaignConfig(27));
    expect(glassQuota(hardy, 1, paramsAt(hardy, 1))).toBe(0);
    // The Journey: from Glass Flakes' own level (60% there), never before it.
    const l21 = createWorld(campaignConfig(21));
    expect(glassQuota(l21, 1, paramsAt(l21, 1))).toBe(0.6);
    const l20 = createWorld(campaignConfig(20));
    expect(glassQuota(l20, 1, paramsAt(l20, 1))).toBe(0);
  });

  it('a glass cluster melts after 0.8 lit seconds; saved whole it emits clusterSaved and counts; guide.flake marks its shade', () => {
    for (const shaded of [true, false]) {
      const s = started({ ...headlessConfig(1), brittleShare: 1, lesson: !shaded });
      strip(s);
      if (shaded) shadeAll(s, s.nubs.y - 200, s.nubs.y + 900);
      const y0 = s.nubs.y + 200;
      const id = FLAKE_ID_BASE + 5000;
      for (let i = 0; i < 3; i++) {
        const y = y0 + 24 * i;
        insertPickup(s.world, { id: id + i, kind: 'flake', x: trailX(s.world.trail, y), y, day: 1, melt: 0, state: PICKUP_ALIVE, cluster: id, ci: i, cn: 3, brittle: true });
      }
      const events: SimEvent[] = [];
      let guided = 0;
      for (let i = 0; i < 400; i++) {
        step(s, NO_INPUT);
        events.push(...s.events);
        if (s.guide.flake.some((v) => v === 1)) guided++;
      }
      expect(s.stats.brittleSeen).toBe(1);
      expect(s.stats.brittleSaved).toBe(shaded ? 1 : 0);
      expect(s.stats.clustersSaved).toBe(shaded ? 1 : 0);
      const saved = events.filter((e) => e.e === 'clusterSaved');
      expect(saved).toHaveLength(shaded ? 1 : 0);
      if (shaded) {
        expect(saved[0]).toMatchObject({ e: 'clusterSaved', cluster: id, brittle: true, n: 3 });
        expect(guided).toBeGreaterThan(0);
      } else {
        expect(s.world.pickups.filter((p) => p.cluster === id && p.state === 2)).toHaveLength(3);
        // In full sun the glass melts within 0.8 s of its melt window: before Nubs arrives.
        expect(events.filter((e) => e.e === 'flakeMelt')).toHaveLength(3);
      }
      expect(s.clusterTaken).toBe(-1);
    }
  });
});

describe('guide.deep and the hash', () => {
  it('guide.deep is the part of guide.now where two sources cover the center sample', () => {
    const s = started(campaignConfig(5));
    let deep = 0;
    for (let i = 0; i < 1200 && s.phase === 'day'; i++) {
      step(s, NO_INPUT);
      for (let b = 0; b < 360; b++) if (s.guide.deep[b] === 1) {
        expect(s.guide.now[b]).toBe(1);
        deep++;
      }
    }
    expect(deep).toBeGreaterThan(0);
    expect(createRun(campaignConfig(4)).guide.deep.every((v) => v === 0)).toBe(true);
  });

  it('hashState reads the flare and glass state', () => {
    const a = started();
    const b = started();
    expect(hashState(a)).toBe(hashState(b));
    b.flareLit = 3;
    expect(hashState(a)).not.toBe(hashState(b));
    b.flareLit = 0;
    b.stats.brittleSaved = 1;
    expect(hashState(a)).not.toBe(hashState(b));
  });
});
