// Bots and guide (fast subset of the sim acceptance; the full check is `npm run sim -- --check`).
import { describe, expect, it } from 'vitest';
import { cosD, sinD } from '../../src/core/dmath.ts';
import { BOT_KINDS, createBot } from '../../src/core/sim/bots.ts';
import { createRun } from '../../src/core/sim/create.ts';
import { hashState } from '../../src/core/sim/hash.ts';
import { headlessConfig, runBot, runHeadless } from '../../src/core/sim/headless.ts';
import { campaignConfig } from '../../src/core/level.ts';
import { computeCoverage } from '../../src/core/sim/nubs.ts';
import { step } from '../../src/core/sim/step.ts';
import type { SimState } from '../../src/core/sim/types.ts';

describe('bots', () => {
  it('idle (holds θ0) melts before 8:00 AM on Day 1 on at least 9 of seeds 1-10', () => {
    let early = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const s = runBot(headlessConfig(seed, 3), 60 * 60, 'idle');
      expect(s.sun.theta).toBe(s.theta0);
      if (s.phase === 'dead' && s.minutes < 120) early++;
    }
    expect(early).toBeGreaterThanOrEqual(9);
  });

  it.each(['human', 'humanDial'] as const)('%s: a seeded model, deterministic per seed, that never flicks or uses keys', (kind) => {
    expect(BOT_KINDS).toContain(kind);
    const trace = (seed: number): { hashes: string[]; s: SimState } => {
      const s = createRun(headlessConfig(seed, 3));
      const bot = createBot(kind);
      const hashes: string[] = [];
      let moves = 0;
      for (let i = 0; i < 60 * 90 && s.phase !== 'dead'; i++) {
        const f = bot.next(s);
        expect(f.release).toBe(0);
        expect(f.key).toBe(0);
        if (f.downEdge && i > 0) moves++;
        step(s, f);
        if ((i + 1) % 300 === 0) hashes.push(hashState(s));
      }
      hashes.push(hashState(s));
      expect(moves, `seed ${seed} drags`).toBeGreaterThan(5);
      return { hashes, s };
    };
    for (const seed of [3, 8]) expect(trace(seed).hashes).toEqual(trace(seed).hashes);
    // Different seeds give different players (and different worlds).
    expect(trace(3).hashes).not.toEqual(trace(8).hashes);
    // The same seed through runHeadless matches too (?bot=human and the test hook use this path).
    expect(runHeadless(5, 2400, kind)).toBe(runHeadless(5, 2400, kind));
  });

  it('Controls v3: the touch bots expose their driver as drive; idleTouch plays idle\'s frames (no move, so no glide)', () => {
    for (const kind of ['humanTouch', 'reactiveTouch', 'idleTouch', 'mashTouch'] as const) {
      expect(BOT_KINDS).toContain(kind);
      const bot = createBot(kind);
      expect(bot.drive).toBeDefined();
      const s = createRun(campaignConfig(1001));
      for (let i = 0; i < 400; i++) step(s, bot.next(s));
      expect(bot.drive!.act).not.toBe(undefined);
    }
    for (const cfg of [headlessConfig(4, 3), campaignConfig(3), campaignConfig(1001)]) {
      const a = createRun(cfg);
      const b = createRun(cfg);
      const idle = createBot('idle');
      const touch = createBot('idleTouch');
      for (let i = 0; i < 3000 && a.phase !== 'dead' && a.phase !== 'won'; i++) {
        const fa = { ...idle.next(a) };
        const fb = { ...touch.next(b) };
        for (const k of ['dTheta', 'down', 'downEdge', 'upEdge', 'release', 'key'] as const) expect(fb[k], `${k} at ${i}`).toBe(fa[k]);
        step(a, fa);
        step(b, fb);
      }
      expect(hashState(b)).toBe(hashState(a));
    }
  });

  it('humanDial plays differently from human: some of its decisions aim for the lasting shade', () => {
    let differs = 0;
    for (const seed of [2, 6, 9]) if (runHeadless(seed, 1800, 'humanDial') !== runHeadless(seed, 1800, 'human')) differs++;
    expect(differs).toBeGreaterThanOrEqual(2);
  });

  it('human survives longer than idle (median over seeds 1-12, profile 3)', () => {
    const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
    const idle: number[] = [];
    const human: number[] = [];
    for (let seed = 1; seed <= 12; seed++) {
      idle.push(runBot(headlessConfig(seed, 3), 60 * 600, 'idle').tick);
      human.push(runBot(headlessConfig(seed, 3), 60 * 600, 'human').tick);
    }
    expect(median(human)).toBeGreaterThan(2 * median(idle));
  }, 60_000);

  it('bots only ever turn at their capped rate', () => {
    const s = createRun(headlessConfig(4, 3));
    const bot = createBot('reactive');
    for (let i = 0; i < 1200 && s.phase !== 'dead'; i++) {
      const f = bot.next(s);
      expect(Math.abs(f.dTheta)).toBeLessThanOrEqual(200 / 60 + 1e-9);
      step(s, f);
    }
  });
});

describe('guide', () => {
  it('guide.lit at θ = b equals the per-tick coverage with the sun at b°', () => {
    const s = createRun(headlessConfig(6, 3));
    const bot = createBot('reactive');
    let checked = 0;
    for (let i = 0; i < 1500 && s.phase !== 'dead'; i++) {
      step(s, bot.next(s));
      if (s.guide.tick !== s.tick || !s.sunUp || i % 60 !== 59) continue;
      const theta = s.sun.theta;
      for (let b = 0; b < 360; b += 7) {
        s.ux = cosD(b);
        s.uy = sinD(b);
        computeCoverage(s);
        expect(s.nubs.f * 5).toBe(s.guide.lit[b]);
        expect(s.guide.now[b]).toBe(s.nubs.f === 0 ? 1 : 0);
        checked++;
      }
      s.ux = cosD(theta);
      s.uy = sinD(theta);
      computeCoverage(s);
    }
    expect(checked).toBeGreaterThan(100);
  });
});
