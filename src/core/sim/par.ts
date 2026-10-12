// The Daily par ("Snowbot", CC-17, A13): the novice bot plays the Daily's world until it melts or
// reaches the dawn of Day 8, as a resumable job the game runs in idle slices. Deterministic, so every
// device computes the same par.

import { TUNING } from '../../config/tuning.ts';
import { dayStartTick } from '../clock.ts';
import { generateSome } from '../gen/world.ts';
import { createBot } from './bots.ts';
import { createRun, prepareRun, prepareSome, type RunBuild } from './create.ts';
import { headlessConfig } from './headless.ts';
import { step } from './step.ts';
import type { SimState } from './types.ts';

/** World generation units per slice (≈ 0.2-0.8 ms on a phone; a chunk is ~60). */
const GEN_BUDGET = 12;
const END_TICK = dayStartTick(8);

export interface ParJob {
  /**
   * Advances the job by at most `maxTicks` sim ticks (or one slice of world building); true once
   * the par is known.
   */
  step(maxTicks: number): boolean;
  /** Score minutes the novice bot reached (final once step() returned true). */
  readonly minutes: number;
}

/**
 * The par job for a Daily seed: a profile-3 run with the Day Plan on (`plan` false for Dailies
 * before PLAN_START_DATE). World generation is spread over the slices too, so no slice pays for a
 * whole chunk.
 */
export function createParJob(dateSeed: number, plan = true): ParJob {
  const cfg = { ...headlessConfig(dateSeed, 3), mode: 'daily' as const, plan };
  const bot = createBot('novice');
  let build: RunBuild | null = prepareRun(cfg);
  let s: SimState | null = null;
  const done = (r: SimState): boolean => r.phase === 'dead' || r.tickAbs >= END_TICK;
  return {
    step(maxTicks: number): boolean {
      if (build) {
        if (!prepareSome(build, GEN_BUDGET)) return false;
        s = createRun(cfg, build);
        build = null;
        return false;
      }
      const r = s as SimState;
      if (done(r)) return true;
      generateSome(r.world, r.nubs.y + TUNING.world.idleAhead, GEN_BUDGET);
      for (let i = 0; i < maxTicks && !done(r); i++) step(r, bot.next(r));
      return done(r);
    },
    get minutes(): number {
      return s ? s.minutes : 0;
    },
  };
}
