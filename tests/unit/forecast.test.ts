// The Day Plan (CO2 with amendments A1, A7, A8, A9): planDay draws, worldPlan, forecast tuning, the
// plan-on rule, and that a forecast never touches the clock.
import { describe, expect, it } from 'vitest';
import { START_HUT } from '../../src/config/casters.ts';
import { TUNING } from '../../src/config/tuning.ts';
import { dayParams, dayPlan, legacyPlan, type BiomeId, type DayPlan } from '../../src/config/days.ts';
import { FORECAST_IDS, FORECASTS, forecastFits, PLAN_START_DATE, PLAN_WEIGHTS, type ForecastId } from '../../src/config/forecasts.ts';
import { dayStartY, yAtTime } from '../../src/core/clock.ts';
import { biomeAtY, firstTownDay, paramsAt, planDay, worldPlan } from '../../src/core/gen/plan.ts';
import { placeChunk } from '../../src/core/gen/placer.ts';
import { createWorld, type World, type WorldConfig } from '../../src/core/gen/world.ts';
import { createBot } from '../../src/core/sim/bots.ts';
import { createRun, prepareRun, prepareSome } from '../../src/core/sim/create.ts';
import { hashState } from '../../src/core/sim/hash.ts';
import { headlessConfig } from '../../src/core/sim/headless.ts';
import { buildRunResult } from '../../src/core/sim/result.ts';
import { step } from '../../src/core/sim/step.ts';
import { trailX } from '../../src/core/trail.ts';

const world = (seed: number, extra: Partial<WorldConfig> = {}) => createWorld({ seed, profile: 3, tutorial: false, ...extra });

/** A world with its chunks placed through y but not validated (no rescues): fast, for layout checks. */
function placed(seed: number, y: number, extra: Partial<WorldConfig> = {}): World {
  const w = world(seed, extra);
  for (let k = w.placedThrough + 1; k * TUNING.world.chunkLen < y; k++) {
    placeChunk(w, k);
    w.placedThrough = k;
  }
  return w;
}

/** Plan-on worlds of seeds 1-20 placed through Day 4 (shared by the layout checks below). */
let layouts: World[] | null = null;
const plannedWorlds = (): World[] => (layouts ??= Array.from({ length: 20 }, (_, i) => placed(i + 1, dayStartY(5))));

describe('Day Plan draws (planDay)', () => {
  it('is pure: the same (seed, day) always gives the same plan, in any call order', () => {
    const fwd = Array.from({ length: 12 }, (_, i) => planDay(77, i + 1));
    const back = Array.from({ length: 12 }, (_, i) => planDay(77, 12 - i)).reverse();
    expect(back).toEqual(fwd);
    expect(planDay(77, 5)).toBe(planDay(77, 5)); // interned
    expect(planDay(77, 0)).toEqual(planDay(77, 1));
  });

  it('alternates the biome from Day 2 and never repeats a non-clear forecast on consecutive days (1,000 seeds × 12 days)', () => {
    for (let seed = 1; seed <= 1000; seed++) {
      let prev = planDay(seed, 1);
      for (let d = 2; d <= 12; d++) {
        const p = planDay(seed, d);
        expect(p.biome).not.toBe(prev.biome);
        if (p.forecast !== 'clear') expect(p.forecast, `seed ${seed} day ${d}`).not.toBe(prev.forecast);
        expect(forecastFits(p.forecast, p.biome)).toBe(true);
        prev = p;
      }
    }
  });

  it('Day-1 biome and forecast frequencies over 10,000 seeds are within ±2 points of the weights', () => {
    const n = 10_000;
    const biomes: Record<BiomeId, number> = { meadow: 0, oldtown: 0 };
    const counts = Object.fromEntries(FORECAST_IDS.map((id) => [id, 0])) as Record<ForecastId, number>;
    for (let seed = 1; seed <= n; seed++) {
      const p = planDay(seed, 1);
      biomes[p.biome]++;
      counts[p.forecast]++;
    }
    expect(Math.abs(biomes.meadow / n - 0.5)).toBeLessThan(0.02);
    // Each biome's Day-1 weights sum to 100: the five shared forecasts plus its own (half the seeds).
    const total = PLAN_WEIGHTS.day1.slice(0, 5).reduce((a, b) => a + b, 0) + 10;
    FORECAST_IDS.forEach((id, i) => {
      const share = (PLAN_WEIGHTS.day1[i]! / total) * (FORECASTS[id].biome ? 0.5 : 1);
      expect(Math.abs(counts[id] / n - share), id).toBeLessThan(0.02);
    });
  });

  it('later days weigh clear 30 and 14 for each other fitting forecast (5,000 seeds, Day 2)', () => {
    let clear = 0;
    for (let seed = 1; seed <= 5000; seed++) if (planDay(seed, 2).forecast === 'clear') clear++;
    // Day 2's total is 30 + 5·14 = 100, or 86 after a Day 1 of breezy, overcast, heat or long (50%).
    const expected = 0.5 * 0.3 + 0.5 * (30 / 86);
    expect(Math.abs(clear / 5000 - expected)).toBeLessThan(0.02);
  });

  it('biome-only forecasts never fall on the other biome', () => {
    expect(FORECASTS.dazzle.biome).toBe('meadow');
    expect(FORECASTS.market.biome).toBe('oldtown');
    for (let seed = 1; seed <= 2000; seed++) {
      for (let d = 1; d <= 6; d++) {
        const p = planDay(seed, d);
        if (p.forecast === 'dazzle') expect(p.biome).toBe('meadow');
        if (p.forecast === 'market') expect(p.biome).toBe('oldtown');
      }
    }
  });
});

describe('worldPlan and the plan-on rule (A1)', () => {
  it('is on for standard runs (profile 3 without the tutorial), off for onboarding profiles, and RunConfig.plan forces it', () => {
    expect(world(1).planOn).toBe(true);
    expect(world(1, { plan: false }).planOn).toBe(false);
    expect(world(1, { profile: 2 }).planOn).toBe(false);
    expect(world(1, { profile: 2, plan: true }).planOn).toBe(true);
    expect(world(1, { profile: 0, tutorial: true }).planOn).toBe(false);
    expect(world(1, { profile: 0, tutorial: true, forecast: 'heat' }).planOn).toBe(true);
    expect(world(1, { plan: false, forecast: 'long' }).planOn).toBe(true);
    expect(PLAN_START_DATE).toBe('2026-10-14');
  });

  it('plan-off worlds alternate clear days from a Meadow Day 1; plan-on worlds follow planDay', () => {
    const off = world(9, { plan: false });
    const on = world(9);
    for (let d = 1; d <= 10; d++) {
      expect(worldPlan(off, d)).toBe(legacyPlan(d));
      expect(worldPlan(off, d)).toEqual({ biome: d % 2 === 1 ? 'meadow' : 'oldtown', forecast: 'clear' });
      expect(worldPlan(on, d)).toBe(planDay(9, d));
    }
  });

  it('cfg.forecast forces every eligible day; the others are clear and the biomes still come from planDay (A8)', () => {
    for (const f of FORECAST_IDS) {
      for (const seed of [2, 3, 8]) {
        const w = world(seed, { forecast: f });
        for (let d = 1; d <= 12; d++) {
          const natural = planDay(seed, d);
          const p = worldPlan(w, d);
          expect(p.biome).toBe(natural.biome);
          expect(p.forecast).toBe(forecastFits(f, p.biome) ? f : 'clear');
        }
      }
    }
  });

  it('every reader follows the plan: biomeAtY, s.params at dawn and at creation, RunResult.plan', () => {
    const seed = [...Array(50).keys()].map((i) => i + 1).find((s) => planDay(s, 1).biome === 'oldtown')!;
    const s = createRun({ ...headlessConfig(seed, 3), startDay: 2 });
    expect(s.params).toBe(paramsAt(s.world, 2));
    expect(s.params.biome).toBe('meadow');
    expect(biomeAtY(s.world, dayStartY(1) + 10)).toBe('oldtown');
    expect(biomeAtY(s.world, dayStartY(2) - 5)).toBe('oldtown'); // Day 1's night keeps its biome
    expect(biomeAtY(s.world, dayStartY(2) + 5)).toBe('meadow');
    const run = createRun(headlessConfig(seed, 3));
    const bot = createBot('oracle');
    while (run.day < 2) step(run, bot.next(run));
    expect(run.params).toBe(paramsAt(run.world, 2));
    expect(run.params.forecast).toBe(planDay(seed, 2).forecast);
    const res = buildRunResult(run);
    expect(res.plan).toEqual([planDay(seed, 1), planDay(seed, 2)]);
    expect(res.noonCloud).toBe(0);
    expect(res.drain).toBe(55);
    // Plan-off runs carry the legacy plans.
    expect(buildRunResult(createRun({ ...headlessConfig(seed, 3), plan: false, startDay: 3 })).plan).toEqual([1, 2, 3].map(legacyPlan));
  }, 30_000);

  it('a plan-on world is identical whether it is built at once or in slices', () => {
    for (const cfg of [headlessConfig(61, 3), { ...headlessConfig(62, 3), forecast: 'overcast' as const }, { ...headlessConfig(63, 3), startDay: 3 }]) {
      const plain = createRun(cfg);
      const build = prepareRun(cfg);
      while (!prepareSome(build, 4));
      const sliced = createRun(cfg, build);
      expect(hashState(sliced)).toBe(hashState(plain));
      const a = createBot('reactive');
      const b = createBot('reactive');
      for (let i = 0; i < 1200; i++) {
        step(plain, a.next(plain));
        step(sliced, b.next(sliced));
      }
      expect(hashState(sliced)).toBe(hashState(plain));
    }
  }, 30_000);
});

describe('forecast tuning', () => {
  it('no forecast changes dayLen, nightLen, v, drain, phewT or floor (days 1-12, both biomes, every profile)', () => {
    for (let d = 1; d <= 12; d++) {
      for (const profile of [0, 1, 2, 3] as const) {
        const base = dayParams(d, profile);
        for (const biome of ['meadow', 'oldtown'] as const) {
          for (const f of FORECAST_IDS) {
            const p = dayParams(d, profile, dayPlan(biome, f));
            expect([p.dayLen, p.nightLen, p.v, p.drain, p.phewT, p.floor]).toEqual([base.dayLen, base.nightLen, base.v, base.drain, base.phewT, base.floor]);
            expect([p.biome, p.forecast]).toEqual([biome, f]);
          }
        }
      }
    }
  });

  it('applies the table: heat, long, overcast, breezy, dazzle and market', () => {
    const clear = dayParams(3, 3, dayPlan('meadow', 'clear'));
    const at = (f: ForecastId, biome: BiomeId = 'meadow') => dayParams(3, 3, dayPlan(biome, f));
    expect(clear).toBe(dayParams(3, 3)); // the legacy Day 3 is a clear Meadow day
    expect(at('heat').epsNoon).toBe(clear.epsNoon + 2);
    expect(at('heat').flakesPerCluster).toBe(clear.flakesPerCluster + 1);
    expect(at('heat').spacing).toBeCloseTo(clear.spacing * 0.92, 9);
    expect(at('heat').snowMult).toBe(1.5);
    expect(at('long').epsNoon).toBe(clear.epsNoon - 10);
    expect(at('long').latMax).toBe(clear.latMax + 10);
    expect(at('long').spacing).toBeCloseTo(clear.spacing * 1.15, 9);
    expect(at('overcast').clouds).toHaveLength(Math.round(clear.clouds.length * 1.5));
    expect(at('overcast').clouds[0]).toBe(clear.clouds[0]);
    expect(at('overcast').clouds.at(-1)).toBe(clear.clouds.at(-1));
    expect([at('overcast').sky.rxMin, at('overcast').sky.rxMax]).toEqual([80, 100]);
    expect(at('breezy').sky).toMatchObject({ drift: 30, overtakeMin: 1.35, overtakeMax: 1.6, waitMin: 0.5, waitMax: 0.65 });
    expect(clear.sky).toMatchObject({ rxMin: 60, rxMax: 80, drift: 10, overtakeMin: 1.2, overtakeMax: 1.35, waitMin: 0.65, waitMax: 0.8 });
    expect([at('dazzle').ballStart, at('dazzle').ballEvery]).toEqual([6, 12]);
    expect([at('market', 'oldtown').ballStart, at('market', 'oldtown').ballEvery]).toEqual([0, 0]);
    expect(clear.snowMult).toBe(1);
  });

  it('gazing balls follow the Old Town ordinal: the k-th Old Town day ≥ 2 uses day 2k of the table (A7)', () => {
    for (let d = 2; d <= 12; d++) {
      const town = dayParams(d, 3, dayPlan('oldtown', 'clear'));
      const row = dayParams(2 * Math.floor(d / 2), 3, dayPlan('oldtown', 'clear'));
      expect([town.ballStart, town.ballEvery]).toEqual([row.ballStart, row.ballEvery]);
      expect(town.ballEvery).toBeGreaterThan(0);
      expect(dayParams(d, 3, dayPlan('meadow', 'clear')).ballEvery).toBe(0);
    }
    expect(dayParams(1, 3, dayPlan('oldtown', 'clear')).ballEvery).toBe(0);
    expect(dayParams(1, 3, dayPlan('meadow', 'dazzle')).ballEvery).toBe(12);
  });

  it('every generated Old Town day ≥ 2 has gazing balls unless it is market day (seeds 1-20, days 1-4)', () => {
    for (const w of plannedWorlds()) {
      const seed = w.seed;
      for (let d = 1; d <= 4; d++) {
        const p = worldPlan(w, d);
        const balls = w.balls.filter((b) => b.day === d).length;
        if (p.biome === 'oldtown' && d >= 2 && p.forecast !== 'market') expect(balls, `seed ${seed} day ${d}`).toBeGreaterThan(0);
        if ((p.biome === 'meadow' && p.forecast !== 'dazzle') || p.forecast === 'market' || (d === 1 && p.forecast !== 'dazzle')) expect(balls).toBe(0);
      }
    }
  });

  it('puts the noon gate arch on the first Old Town day ≥ 2 and clears 200 u past the hut when Day 1 is Old Town', () => {
    let townFirst = 0;
    for (const w of plannedWorlds()) {
      const seed = w.seed;
      const d = firstTownDay(w);
      expect(d).toBe(worldPlan(w, 1).biome === 'oldtown' ? 3 : 2);
      const dl = dayParams(d, 3).dayLen;
      const noonY = yAtTime(d, dl / 2);
      expect(w.casters.some((c) => c.gate && Math.abs(c.y - noonY) < 1e-6), `seed ${seed}`).toBe(true);
      const clear = START_HUT.clearAhead[worldPlan(w, 1).biome];
      if (worldPlan(w, 1).biome === 'oldtown') townFirst++;
      for (const c of w.casters) {
        if (c.id === w.startHutId || c.y <= 0 || c.y >= clear) continue;
        expect(c.gate, `seed ${seed} ${c.name}`).toBe(false);
        expect(Math.sign(c.x - trailX(w.trail, c.y)), `seed ${seed} ${c.name}`).toBe(-w.startSide);
      }
    }
    expect(townFirst).toBeGreaterThan(3);
    expect(START_HUT.clearAhead).toEqual({ meadow: 140, oldtown: 200 });
  });

  it('market days stack stalls and gate arches; Heat Wave flakes pay ×1.5', () => {
    const marketShare = (forecast: ForecastId): number => {
      let stalls = 0;
      let all = 0;
      for (let seed = 1; seed <= 12; seed++) {
        const w = placed(seed, dayStartY(4), { forecast });
        for (const c of w.casters) {
          if (c.biome !== 'oldtown' || c.rescue || c.kind === 'pedestal' || c.id === w.startHutId) continue;
          if (c.kind === 'stall' || c.gate) stalls++;
          all++;
        }
      }
      return stalls / all;
    };
    expect(marketShare('market')).toBeGreaterThan(1.8 * marketShare('clear'));

    const s = createRun({ ...headlessConfig(4, 3), forecast: 'heat' });
    const bot = createBot('reactive');
    let paid = 0;
    for (let i = 0; i < 60 * 40 && s.phase !== 'dead'; i++) {
      step(s, bot.next(s));
      for (const e of s.events) if (e.e === 'flake') {
        // v1.6 T2: flake Snow uses min(mult, ring.snowCap) with the ring on (×4 and ×5 pay through the
        // snap's cash-in, on the Bank or the shipped v1.5 meter).
        const cap = s.world.v16.ring ? TUNING.ring.snowCap : Infinity;
        expect(e.snow).toBe(Math.round(Math.min(e.mult, cap) * 1.5));
        paid++;
      }
    }
    expect(paid).toBeGreaterThan(3);
  }, 30_000);

  it('interns plans so they compare by identity', () => {
    const a: DayPlan = dayPlan('meadow', 'long');
    expect(dayPlan('meadow', 'long')).toBe(a);
    expect(Object.isFrozen(a)).toBe(true);
  });
});
