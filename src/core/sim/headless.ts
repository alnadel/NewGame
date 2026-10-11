// Headless runs for tests, the sim script and the in-browser test hook.

import type { ProfileId } from '../../config/days.ts';
import { createBot, type BotKind } from './bots.ts';
import { createRun } from './create.ts';
import { hashState } from './hash.ts';
import { step } from './step.ts';
import type { RunConfig, SimState } from './types.ts';

/** Default endless config for a seed/profile (the tutorial chunk goes with profile 0). */
export function headlessConfig(seed: number, profile: ProfileId = 3): RunConfig {
  return { seed: seed >>> 0, mode: 'endless', profile, tutorial: profile === 0, reducedMotion: false };
}

/** Runs `ticks` ticks (or until death) with a bot. Returns the final state. */
export function runBot(cfg: RunConfig, ticks: number, bot: BotKind): SimState {
  const s = createRun(cfg);
  const b = createBot(bot);
  for (let i = 0; i < ticks && s.phase !== 'dead'; i++) step(s, b.next(s));
  return s;
}

/** Same as runBot, returning hashState() of the final state (engine-determinism check). */
export function runHeadless(seed: number, ticks: number, bot: BotKind, profile: ProfileId = 3): string {
  return hashState(runBot(headlessConfig(seed, profile), ticks, bot));
}
