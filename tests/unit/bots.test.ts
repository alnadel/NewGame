// Bots and guide (fast subset of the sim acceptance; the full check is `npm run sim -- --check`).
import { describe, expect, it } from 'vitest';
import { cosD, sinD } from '../../src/core/dmath.ts';
import { createBot } from '../../src/core/sim/bots.ts';
import { createRun } from '../../src/core/sim/create.ts';
import { headlessConfig, runBot } from '../../src/core/sim/headless.ts';
import { computeCoverage } from '../../src/core/sim/nubs.ts';
import { step } from '../../src/core/sim/step.ts';

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

  it('oracle survives through Day 3 on seeds 1-2', () => {
    for (const seed of [1, 2]) {
      const s = runBot(headlessConfig(seed, 3), 3 * 3480 + 60, 'oracle');
      expect(s.phase).not.toBe('dead');
      expect(s.day).toBeGreaterThanOrEqual(4);
    }
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
