// The comfort ladder (rungs, comfortAfterRun, rungConfig), the noonCloud world knob and the drain
// override: RunConfig.drain changes Chill only, never the world or its validator.
import { describe, expect, it } from 'vitest';
import {
  COMFORT_MAX,
  COMFORT_RUNGS,
  comfortAfterRun,
  dayParams,
  effectiveNoonCloud,
  PROFILES,
  rungConfig,
  type NoonCloud,
} from '../../src/config/days.ts';
import { TUNING } from '../../src/config/tuning.ts';
import { dayStartTick } from '../../src/core/clock.ts';
import { createWorld, ensureGenerated, type World } from '../../src/core/gen/world.ts';
import { createBot } from '../../src/core/sim/bots.ts';
import { createRun } from '../../src/core/sim/create.ts';
import { hashState } from '../../src/core/sim/hash.ts';
import { headlessConfig, runBot } from '../../src/core/sim/headless.ts';
import { effectiveDrain } from '../../src/core/sim/nubs.ts';
import { createReplay, playReplay, recordFrame } from '../../src/core/sim/replay.ts';
import { step } from '../../src/core/sim/step.ts';
import type { RunConfig } from '../../src/core/sim/types.ts';

function worldPrint(w: World): string {
  const cs = w.casters.map((c) => `${c.id}:${c.kind}:${c.x}:${c.y}:${c.rot}:${c.name}:${c.rescue}`).join('|');
  const cl = w.clouds.map((c) => `${c.id}:${c.kind}:${c.t0}:${c.x0}:${c.y0}:${c.vx}:${c.vy}:${c.rx}`).join('|');
  const ps = w.pickups.map((p) => `${p.id}:${p.kind}:${p.x}:${p.y}`).join('|');
  const bs = w.balls.map((b) => `${b.id}:${b.x}:${b.y}:${b.name}`).join('|');
  const st = w.stats;
  const v = `${st.chunksPlaced}/${st.chunksValidated}/${st.rescues}/${st.rescuesPerChunk.join(',')}/${st.parkedClouds}/${st.unresolved}/${st.dropped}`;
  return `${cs}#${cl}#${ps}#${bs}#${v}`;
}

describe('comfort ladder', () => {
  it('has five rungs: the tutorial, three assisted rungs and standard (the Daily rules)', () => {
    expect(COMFORT_MAX).toBe(4);
    expect(COMFORT_RUNGS.map((r) => [r.profile, r.drain, r.noonCloud])).toEqual([
      [0, 30, 1],
      [2, 40, 1],
      [3, 44, 1],
      [3, 50, 2],
      [3, 55, 0],
    ]);
    const std = COMFORT_RUNGS[COMFORT_MAX]!;
    expect(std.drain).toBe(PROFILES[3]!.drain);
    expect(effectiveNoonCloud({ profile: 3 })).toBe(std.noonCloud);
    for (let r = 1; r <= COMFORT_MAX; r++) expect(COMFORT_RUNGS[r]!.drain).toBeGreaterThan(COMFORT_RUNGS[r - 1]!.drain);
  });

  it('comfortAfterRun from the tutorial: Day 3 → standard, the first night → 2, else 1', () => {
    expect(comfortAfterRun(0, 0)).toBe(1);
    expect(comfortAfterRun(0, 719)).toBe(1);
    expect(comfortAfterRun(0, 720)).toBe(2);
    expect(comfortAfterRun(0, 1439)).toBe(2);
    expect(comfortAfterRun(0, 1440)).toBe(4);
    expect(comfortAfterRun(0, 9000)).toBe(4);
  });

  it('comfortAfterRun from rungs 1-4: up from 12:30 PM, down before 10:00 AM, standard from Day 3, within [1, 4]', () => {
    for (let r = 1; r <= 4; r++) {
      expect(comfortAfterRun(r, 0)).toBe(Math.max(1, r - 1));
      expect(comfortAfterRun(r, 239)).toBe(Math.max(1, r - 1));
      expect(comfortAfterRun(r, 240)).toBe(r);
      expect(comfortAfterRun(r, 389)).toBe(r);
      expect(comfortAfterRun(r, 390)).toBe(Math.min(4, r + 1));
      expect(comfortAfterRun(r, 1439)).toBe(Math.min(4, r + 1));
      expect(comfortAfterRun(r, 1440)).toBe(4);
    }
    // Never back to the tutorial, and defensive inputs.
    expect(comfortAfterRun(1, 10)).toBe(1);
    expect(comfortAfterRun(9, 300)).toBe(4);
    expect(comfortAfterRun(-2, 100)).toBe(1);
    expect(comfortAfterRun(Number.NaN, 800)).toBe(2);
    expect(comfortAfterRun(2.7, 300)).toBe(2);
  });

  it('rungConfig gives the rung rules, the tutorial on rung 0 and the lesson on rungs 0-1 until passed', () => {
    expect(rungConfig(0, { tutorialDone: false })).toEqual({ profile: 0, drain: 30, noonCloud: 1, tutorial: true, lesson: true });
    expect(rungConfig(1, { tutorialDone: false })).toEqual({ profile: 2, drain: 40, noonCloud: 1, tutorial: false, lesson: true });
    expect(rungConfig(1, { tutorialDone: true }).lesson).toBe(false);
    expect(rungConfig(0, { tutorialDone: true }).lesson).toBe(false);
    expect(rungConfig(2, { tutorialDone: false })).toEqual({ profile: 3, drain: 44, noonCloud: 1, tutorial: false, lesson: false });
    expect(rungConfig(3, { tutorialDone: true })).toEqual({ profile: 3, drain: 50, noonCloud: 2, tutorial: false, lesson: false });
    expect(rungConfig(4, { tutorialDone: true })).toEqual({ profile: 3, drain: 55, noonCloud: 0, tutorial: false, lesson: false });
    expect(rungConfig(17, { tutorialDone: true })).toEqual(rungConfig(4, { tutorialDone: true }));
  });
});

describe('noonCloud (the Day-1 parked training cloud)', () => {
  /** The parked noon cloud of a world: a 'parked' cloud living inside Day 1. */
  const noonCloudOf = (w: World) => w.clouds.find((c) => c.kind === 'parked' && c.t0 + c.life < dayStartTick(2) / 60);

  it('defaults to 1 for profiles 0-2 and 0 for profile 3 (v1.0 worlds), and is part of the world', () => {
    expect(([0, 1, 2, 3] as const).map((profile) => effectiveNoonCloud({ profile }))).toEqual([1, 1, 1, 0]);
    expect(effectiveNoonCloud({ profile: 3, noonCloud: 2 })).toBe(2);
    expect(effectiveNoonCloud({ profile: 1, noonCloud: 0 })).toBe(0);
    for (const nc of [0, 1, 2] as NoonCloud[]) expect(createWorld({ seed: 5, profile: 3, tutorial: false, noonCloud: nc }).noonCloud).toBe(nc);
  });

  it('noonCloud 1 and 0 build different worlds and runs on the same p3 seed', () => {
    const a = runBot(headlessConfig(12, 3, undefined, 0), 60 * 40, 'reactive');
    const b = runBot(headlessConfig(12, 3, undefined, 1), 60 * 40, 'reactive');
    expect(hashState(b)).not.toBe(hashState(a));
  });

  it('parks the cloud over 300-420 min (noonCloud 1) or only 330-390 min (noonCloud 2), with an overtaker first', () => {
    const dl = dayParams(1, 3).dayLen;
    const lead = TUNING.cloud.parkedLead;
    for (const [nc, from, to] of [
      [1, 300, 420],
      [2, 330, 390],
    ] as const) {
      for (const seed of [3, 4, 9]) {
        const w = createWorld({ seed, profile: 3, tutorial: false, noonCloud: nc });
        ensureGenerated(w, 3000);
        const cl = noonCloudOf(w)!;
        expect(cl.t0 + lead).toBeCloseTo((from / 720) * dl, 9);
        expect(cl.t0 + cl.life - lead).toBeCloseTo((to / 720) * dl, 9);
        expect(w.clouds[0]!.kind).toBe('overtaker');
      }
    }
  });
});

describe('drain override', () => {
  it('profiles drain 30 / 40 / 47 / 55, and every day of a profile keeps its drain', () => {
    expect(PROFILES.map((p) => p.drain)).toEqual([30, 40, 47, 55]);
    for (const profile of [0, 1, 2, 3] as const) {
      for (const day of [1, 2, 7, 12]) expect(dayParams(day, profile).drain).toBe(PROFILES[profile]!.drain);
    }
  });

  it('effectiveDrain prefers RunConfig.drain and falls back to the profile drain', () => {
    expect(effectiveDrain(createRun(headlessConfig(3, 3)))).toBe(55);
    expect(effectiveDrain(createRun(headlessConfig(3, 2)))).toBe(47);
    expect(effectiveDrain(createRun(headlessConfig(3, 3, 44)))).toBe(44);
    expect(headlessConfig(3, 3)).not.toHaveProperty('drain');
  });

  it('the same seed at profile 3 survives longer with cfg.drain = 30 than with the profile drain', () => {
    for (const bot of ['idle', 'novice'] as const) {
      let longer = 0;
      for (let seed = 1; seed <= 6; seed++) {
        const base = runBot(headlessConfig(seed, 3), 60 * 400, bot);
        const easy = runBot(headlessConfig(seed, 3, 30), 60 * 400, bot);
        expect(easy.tick).toBeGreaterThanOrEqual(base.tick);
        if (easy.tick > base.tick) longer++;
      }
      expect(longer, bot).toBeGreaterThanOrEqual(5);
    }
  }, 60_000);

  it('the world and validator output are identical with and without cfg.drain', () => {
    for (const [seed, profile] of [
      [5, 3],
      [8, 1],
      [2, 0],
    ] as const) {
      const a = createRun(headlessConfig(seed, profile));
      const b = createRun(headlessConfig(seed, profile, 30));
      const c = createRun(headlessConfig(seed, profile, 55));
      for (const s of [a, b, c]) ensureGenerated(s.world, 12_000);
      expect(worldPrint(b.world)).toBe(worldPrint(a.world));
      expect(worldPrint(c.world)).toBe(worldPrint(a.world));
      expect(b.theta0).toBe(a.theta0);
    }
  }, 60_000);

  it('a replay carries cfg.drain and reproduces the run', () => {
    const cfg: RunConfig = headlessConfig(14, 3, 36);
    const live = createRun(cfg);
    const bot = createBot('novice');
    const rec = createReplay(cfg);
    for (let i = 0; i < 3000 && live.phase !== 'dead'; i++) {
      const f = bot.next(live);
      recordFrame(rec, f);
      step(live, f);
    }
    expect(rec.cfg.drain).toBe(36);
    expect(hashState(playReplay(rec))).toBe(hashState(live));
    // Without the override the same frames give a different run.
    const plain = playReplay({ cfg: headlessConfig(14, 3), frames: rec.frames });
    expect(hashState(plain)).not.toBe(hashState(live));
  });
});
