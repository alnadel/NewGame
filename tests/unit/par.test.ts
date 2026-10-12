// The Daily par job (CC-17, A13): sliced, deterministic, and equal to a plain novice run.
import { describe, expect, it } from 'vitest';
import { dayStartTick } from '../../src/core/clock.ts';
import { createBot } from '../../src/core/sim/bots.ts';
import { createRun } from '../../src/core/sim/create.ts';
import { headlessConfig } from '../../src/core/sim/headless.ts';
import { createParJob } from '../../src/core/sim/par.ts';
import { step } from '../../src/core/sim/step.ts';

/** The par by definition: the novice bot on the Daily's world until it melts or Day 8 dawns. */
function plainPar(seed: number, plan: boolean): number {
  const s = createRun({ ...headlessConfig(seed, 3), mode: 'daily', plan });
  const bot = createBot('novice');
  while (s.phase !== 'dead' && s.tickAbs < dayStartTick(8)) step(s, bot.next(s));
  return s.minutes;
}

describe('createParJob', () => {
  it('equals a plain novice run for two Daily seeds, however it is sliced', () => {
    for (const seed of [20261014, 777]) {
      const want = plainPar(seed, true);
      for (const slice of [7, 180]) {
        const job = createParJob(seed);
        let calls = 0;
        while (!job.step(slice)) calls++;
        expect(job.minutes, `seed ${seed} slice ${slice}`).toBe(want);
        expect(calls).toBeGreaterThan(5);
        expect(job.step(slice)).toBe(true);
        expect(job.minutes).toBe(want);
      }
    }
  }, 60_000);

  it('builds the plan-off world for Dailies before the Day Plan', () => {
    const job = createParJob(4242, false);
    while (!job.step(600));
    expect(job.minutes).toBe(plainPar(4242, false));
    expect(createParJob(1).minutes).toBe(0);
  }, 30_000);
});
