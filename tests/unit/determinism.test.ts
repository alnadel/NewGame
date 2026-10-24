// Determinism (archive/TECH_SPEC §16.1, archive/CRITIQUE #17): identical runs hash identically, replays reproduce
// live runs, idle-time generation never changes play, and the golden values hold.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { generateSome } from '../../src/core/gen/world.ts';
import { createBot } from '../../src/core/sim/bots.ts';
import { createRun, prepareRun, prepareSome } from '../../src/core/sim/create.ts';
import { hashState } from '../../src/core/sim/hash.ts';
import { headlessConfig, runHeadless } from '../../src/core/sim/headless.ts';
import { campaignConfig } from '../../src/core/level.ts';
import { createReplay, playReplay, recordFrame } from '../../src/core/sim/replay.ts';
import { step } from '../../src/core/sim/step.ts';
import { scriptedHashes, scriptedInput } from '../../scripts/golden.ts';

const golden = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../golden/hashes.json'), 'utf8'),
) as { scripted: string[]; oracle3min: string[]; headless_7_3600_reactive: string; forecasts: Record<string, string>; rungs: string[] };

describe('determinism', () => {
  it('the scripted input run is identical twice and matches the golden hashes', () => {
    const a = scriptedHashes();
    const b = scriptedHashes();
    expect(b).toEqual(a);
    expect(a).toEqual(golden.scripted);
    expect(new Set(a).size).toBeGreaterThan(10);
  }, 30_000);

  it('runHeadless(7, 3600, reactive) matches the golden hash (also checked in the browser e2e)', () => {
    expect(runHeadless(7, 3600, 'reactive')).toBe(golden.headless_7_3600_reactive);
  });

  it('an Elementals relay (T5) and the grand relay (T8) replay bit for bit', () => {
    for (const id of [1005, 1008]) {
      const cfg = campaignConfig(id);
      const live = createRun(cfg);
      const bot = createBot('reactive', 3);
      const rec = createReplay(cfg);
      const liveHashes: string[] = [];
      for (let i = 0; i < 3000 && live.phase !== 'dead' && live.phase !== 'won'; i++) {
        const f = bot.next(live);
        recordFrame(rec, f);
        step(live, f);
        if ((i + 1) % 150 === 0) liveHashes.push(hashState(live));
      }
      expect(liveHashes.length).toBeGreaterThan(3);
      const replayHashes: string[] = [];
      const replayed = playReplay(rec, (s, i) => {
        if ((i + 1) % 150 === 0) replayHashes.push(hashState(s));
      });
      expect(replayHashes).toEqual(liveHashes);
      expect(hashState(replayed)).toBe(hashState(live));
      expect(replayed.events).toEqual(live.events);
    }
  }, 60_000);

  it('a recorded run replays to the same state at every checkpoint', () => {
    const cfg = headlessConfig(21, 3);
    const live = createRun(cfg);
    const bot = createBot('reactive');
    const rec = createReplay(cfg);
    const liveHashes: string[] = [];
    for (let i = 0; i < 2400 && live.phase !== 'dead'; i++) {
      const f = bot.next(live);
      recordFrame(rec, f);
      step(live, f);
      if ((i + 1) % 300 === 0) liveHashes.push(hashState(live));
    }
    const replayHashes: string[] = [];
    const replayed = playReplay(rec, (s, i) => {
      if ((i + 1) % 300 === 0) replayHashes.push(hashState(s));
    });
    expect(replayHashes).toEqual(liveHashes);
    expect(hashState(replayed)).toBe(hashState(live));
  });

  it('idle-time generation far ahead (any budget) never changes play', () => {
    const cfg = headlessConfig(33, 3);
    const plain = createRun(cfg);
    const eager = createRun(cfg);
    const botA = createBot('reactive');
    const botB = createBot('reactive');
    for (let i = 0; i < 2400 && plain.phase !== 'dead'; i++) {
      step(plain, botA.next(plain));
      generateSome(eager.world, eager.nubs.y + 4000, 1 + (i % 5));
      step(eager, botB.next(eager));
      if ((i + 1) % 600 === 0) expect(hashState(eager)).toBe(hashState(plain));
    }
    expect(eager.world.validatedThrough).toBeGreaterThan(plain.world.validatedThrough);
  }, 60_000);

  it('a run prepared in slices (the next-run prebuild) plays exactly like one created at once', () => {
    for (const cfg of [headlessConfig(41, 3), { ...headlessConfig(42, 0), tutorial: true }, { ...headlessConfig(43, 3), startDay: 2, startT: 20 }]) {
      const plain = createRun(cfg);
      const build = prepareRun(cfg);
      let slices = 0;
      while (!prepareSome(build, 3)) slices++;
      expect(slices).toBeGreaterThan(5);
      const sliced = createRun(cfg, build);
      expect(hashState(sliced)).toBe(hashState(plain));
      const botA = createBot('reactive');
      const botB = createBot('reactive');
      for (let i = 0; i < 900; i++) {
        step(plain, botA.next(plain));
        step(sliced, botB.next(sliced));
      }
      expect(hashState(sliced)).toBe(hashState(plain));
    }
  }, 60_000);

  it('a run created with less of its world generated (1100 u, as the Title may) plays exactly like a full one', () => {
    const cfg = headlessConfig(44, 3);
    const full = createRun(cfg);
    const lean = createRun(cfg, undefined, 1100);
    expect(lean.world.validatedThrough).toBeLessThan(full.world.validatedThrough);
    expect(hashState(lean)).toBe(hashState(full));
    const a = createBot('reactive');
    const b = createBot('reactive');
    for (let i = 0; i < 1200; i++) {
      step(full, a.next(full));
      generateSome(lean.world, lean.nubs.y + 2400, 2);
      step(lean, b.next(lean));
    }
    expect(hashState(lean)).toBe(hashState(full));
  });

  it('the scripted input exercises drags, flicks, catches, taps and keys', () => {
    const frames = Array.from({ length: 2000 }, (_, i) => scriptedInput(i));
    expect(frames.some((f) => f.upEdge && f.release > 100)).toBe(true);
    expect(frames.some((f) => f.downEdge && f.upEdge)).toBe(true);
    for (const key of [1, -1, 2, -2]) expect(frames.some((f) => f.key === key)).toBe(true);
    expect(frames.some((f) => f.snap === true)).toBe(true);
    expect(frames.every((f) => f.dTheta * 1024 === Math.round(f.dTheta * 1024))).toBe(true);
  });
});
