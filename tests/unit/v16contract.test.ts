// v1.6 contract (docs/V1_6_PLAN.md §10, src/core/README.md §16): the shapes exist with their
// neutral starting values, and the readers the builders will plumb agree with today's sim. Owners
// replace the "stub" expectations below as their bodies land.
import { describe, expect, it } from 'vitest';
import { goalMet, featMet, levelDef, starsFor, type LevelDef } from '../../src/config/campaign.ts';
import { TUNING } from '../../src/config/tuning.ts';
import { worldElevation } from '../../src/core/gen/plan.ts';
import { jobRows } from '../../src/core/gen/validator.ts';
import { createWorld, ensureGenerated } from '../../src/core/gen/world.ts';
import { FLARE_KEPT, type Pickup } from '../../src/core/objects.ts';
import { BOT_KINDS, BOT_POLICIES, createBot } from '../../src/core/sim/bots.ts';
import { createRun } from '../../src/core/sim/create.ts';
import { debugFlare } from '../../src/core/sim/flares.ts';
import { headlessConfig } from '../../src/core/sim/headless.ts';
import { debugRing } from '../../src/core/sim/nubs.ts';
import { meltBudgetOf } from '../../src/core/sim/pickups.ts';
import { step } from '../../src/core/sim/step.ts';
import { V16_ALL, V16_NONE, V16_RULES } from '../../src/core/sim/types.ts';

describe('v1.6 contract', () => {
  it('worlds carry their v1.6 rules (all on by default; RunConfig.v16 switches single rules off)', () => {
    expect(createWorld(headlessConfig(1)).v16).toBe(V16_ALL);
    const some = createWorld({ ...headlessConfig(1), v16: { ring: false, flares: false } });
    expect(some.v16).toEqual({ ...V16_ALL, ring: false, flares: false });
    const none = createWorld({ ...headlessConfig(1), v16: Object.fromEntries(V16_RULES.map((r) => [r, false])) });
    expect(none.v16).toBe(V16_NONE);
    expect(createWorld({ ...headlessConfig(1), brittleShare: 2 }).brittleShare).toBe(1);
    expect(createWorld(headlessConfig(1)).flares).toEqual([]);
  });

  it('createRun fills every new field with its neutral value', () => {
    const s = createRun({ ...headlessConfig(3), startFrost: 1 });
    const nb = s.nubs;
    expect([nb.ringCharge, nb.litStartMult, nb.streak, nb.swFreshN, nb.frostH, nb.swFresh.length]).toEqual([0, 1, 0, 0, 100, 2 * TUNING.ring.freshSlots]);
    expect([s.snapBankH, s.snapExt, s.snapBlooms, s.landTicks, s.landSrc, s.clusterId, s.flareId, s.flarePhase, s.flareTicks]).toEqual([0, 0, 0, -1, -1, -1, -1, 0, -1]);
    for (const m of [s.guide.deep, s.guide.flake, s.guide.land, s.guide.flare]) expect(m.length === 360 && m.every((v) => v === 0)).toBe(true);
    expect(s.guide.flareTicks).toBe(-1);
    for (const k of ['multTicks', 'frostEarnedH', 'snapLands', 'brittleSaved', 'parries', 'deepTicks', 'gustWindows'] as const) expect(s.stats[k]).toBe(0);
  });

  it('flake clusters carry their cluster (first flake id), index and size; nothing is glass yet', () => {
    const w = createWorld(headlessConfig(5));
    ensureGenerated(w, 6000);
    const byCluster = new Map<number, Pickup[]>();
    for (const p of w.pickups) {
      expect(p.brittle).toBe(false);
      if (p.kind !== 'flake') {
        expect([p.cluster, p.ci, p.cn]).toEqual([-1, 0, 1]);
        continue;
      }
      byCluster.set(p.cluster, [...(byCluster.get(p.cluster) ?? []), p]);
    }
    expect(byCluster.size).toBeGreaterThan(10);
    const s = createRun(headlessConfig(5));
    for (const [id, ps] of byCluster) {
      expect(ps.map((p) => p.ci)).toEqual(ps.map((_, i) => i));
      expect(ps.every((p) => p.cn === ps.length && p.id === id + p.ci)).toBe(true);
      expect(meltBudgetOf(s, ps[0] as Pickup)).toBe(s.params.meltBudget);
    }
  });

  it('worldElevation is exactly the elevation the sim uses on every daylight tick (no flares yet)', () => {
    const s = createRun(headlessConfig(2));
    const bot = createBot('reactive');
    let checked = 0;
    for (let i = 0; i < 4000 && s.phase !== 'dead'; i++) {
      step(s, bot.next(s));
      if (s.phase === 'day' && s.ready === 0) {
        expect(worldElevation(s.world, s.tickAbs)).toBe(s.eps);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it('jobRows maps a finished job onto absolute ticks', () => {
    const w = createWorld(headlessConfig(4));
    ensureGenerated(w, 3000);
    const job = w.lastJob;
    if (!job) throw new Error('no finished job');
    const r = jobRows(job);
    expect(r.slots).toBe(job.pre + job.n + 2);
    for (let s = 0; s < r.slots; s++) expect(Math.round((job.sT[s] as number) * 60)).toBe(r.slot0Tick + s * TUNING.validator.stepTicks);
  });

  it('debug hooks: debugRing sets the level and charge; debugFlare adds a kept flare on the TUNING.flare shape', () => {
    const s = createRun(headlessConfig(1));
    debugRing(s, 9, 1234.4);
    expect([s.nubs.mult, s.nubs.ringCharge]).toEqual([5, 1234]);
    const late = debugFlare(s, 600, 10);
    const soon = debugFlare(s, 0, 8);
    const F = TUNING.flare;
    expect(s.world.flares).toEqual([soon, late]);
    expect([soon.state, soon.riseTick - soon.warnTick, soon.holdTick - soon.riseTick, soon.fallTick - soon.holdTick, soon.endTick - soon.fallTick]).toEqual([FLARE_KEPT, F.warnTicks, F.riseTicks, F.holdTicks, F.fallTicks]);
    expect(soon.id).not.toBe(late.id);
  });

  it('campaign: no Dares or boss flares yet; the soft-fail scores the goal as finish', () => {
    const l2 = levelDef(2) as LevelDef;
    expect([l2.feats, l2.flares]).toEqual([[], []]);
    const none = { flakes: 0, snow: 0, minChill: 50 };
    expect(featMet(l2, none)).toBe(false);
    expect(l2.goal.kind).toBe('flakes');
    expect(goalMet(l2, none)).toBe(false);
    expect(goalMet(l2, none, true)).toBe(true);
    expect(starsFor(l2, none, true)).toBeGreaterThanOrEqual(1);
  });

  it('bots: humanFeat and the v1.6 options exist (no behaviour behind them yet)', () => {
    expect(BOT_KINDS).toContain('humanFeat');
    expect(BOT_POLICIES).toEqual(['plain', 'chase', 'naive', 'safe']);
    const s = createRun(headlessConfig(1));
    const bot = createBot('reactive', 0, true, { policy: 'chase', snap: 'plan', preAim: true });
    for (let i = 0; i < 300; i++) step(s, bot.next(s));
    expect(s.tick).toBeGreaterThan(0);
  });
});
