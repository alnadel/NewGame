// RunResult for the meta layer (src/core/sim/events.ts contract).

import { formatScore } from '../format.ts';
import { worldPlan } from '../gen/plan.ts';
import { deathCause } from './deathcause.ts';
import type { RunResult } from './events.ts';
import { effectiveDrain } from './nubs.ts';
import type { SimState } from './types.ts';

/**
 * Builds the RunResult of a finished run. `melody` is left empty (the session records flake notes)
 * and `assisted` false (the session knows the guide setting). For a run that has not melted (quit
 * from pause) the death info describes the current moment.
 */
export function buildRunResult(s: SimState): RunResult {
  const death = s.death ?? deathCause(s);
  const result: RunResult = {
    mode: s.cfg.mode,
    seed: s.cfg.seed,
    profile: s.cfg.profile,
    drain: effectiveDrain(s),
    noonCloud: s.world.noonCloud,
    plan: Array.from({ length: s.day }, (_, i) => worldPlan(s.world, i + 1)),
    minutes: s.minutes,
    day: s.day,
    clock: formatScore(s.minutes),
    stats: { ...s.stats, minutes: s.minutes },
    death,
    hourGlyphs: s.hourGlyphs.map((d) => d.slice()),
    melody: [],
    assisted: false,
  };
  if (s.cfg.dailyDate !== undefined) result.dailyDate = s.cfg.dailyDate;
  return result;
}
