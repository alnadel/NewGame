// K2 drain: the profile table, the endless onboarding ramp (endlessDrain / RunConfig.drain) and the
// guarantee that the override changes Chill only, never the world or its validator.
import { describe, expect, it } from 'vitest';
import { dayParams, endlessDrain, ONBOARD_DRAIN, PROFILES } from '../../src/config/days.ts';
import { ensureGenerated, type World } from '../../src/core/gen/world.ts';
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

describe('K2 drain', () => {
  it('profiles drain 30 / 40 / 47 / 55, and every day of a profile keeps its drain', () => {
    expect(PROFILES.map((p) => p.drain)).toEqual([30, 40, 47, 55]);
    for (const profile of [0, 1, 2, 3] as const) {
      for (const day of [1, 2, 7, 12]) expect(dayParams(day, profile).drain).toBe(PROFILES[profile]!.drain);
    }
  });

  it('endlessDrain ramps 30 + 3/run to 55 and never exceeds the profile drain', () => {
    expect(ONBOARD_DRAIN).toEqual({ start: 30, perRun: 3, max: 55 });
    expect(Object.isFrozen(ONBOARD_DRAIN)).toBe(true);
    const table = Array.from({ length: 10 }, (_, n) => endlessDrain(n));
    expect(table).toEqual([30, 33, 36, 39, 42, 45, 48, 51, 54, 55]);
    for (const n of [9, 10, 11, 25, 1000]) expect(endlessDrain(n)).toBe(55);
    for (let n = 0; n <= 40; n++) {
      expect(endlessDrain(n)).toBeLessThanOrEqual(PROFILES[Math.min(3, n)]!.drain);
      expect(endlessDrain(n)).toBeLessThanOrEqual(ONBOARD_DRAIN.max);
    }
    // Defensive inputs: negative and fractional counts.
    expect(endlessDrain(-3)).toBe(30);
    expect(endlessDrain(2.7)).toBe(36);
    expect(endlessDrain(Number.NaN)).toBe(30);
  });

  it('effectiveDrain prefers RunConfig.drain and falls back to the profile drain', () => {
    expect(effectiveDrain(createRun(headlessConfig(3, 3)))).toBe(55);
    expect(effectiveDrain(createRun(headlessConfig(3, 2)))).toBe(47);
    expect(effectiveDrain(createRun(headlessConfig(3, 3, 39)))).toBe(39);
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
