// v1.6 Heat Flares in the sim (docs/V1_6_PLAN.md §2.5; CORE-2 owns this file): the flare state
// machine (warning, rise, hold, fall), parry and miss, and the debug hook. The schedule and the keep
// test live in generation (world.flares, the validator); the sun's lift in gen/plan.ts
// (worldElevation, flareLift). Per-tick work must stay allocation-free (events excepted).

import { TUNING } from '../../config/tuning.ts';
import { FLARE_KEPT, type Flare } from '../objects.ts';
import type { SimState } from './types.ts';

const FL = TUNING.flare;

/**
 * Called by step() every running tick before the eclipse sync: advances s.flarePhase/flareIdx/
 * flareTicks/flareLit through the kept flares (flareWarn, flareRise, flareParry or flareMiss,
 * flareEnd). Contract stub: no-op.
 */
export function updateFlare(_s: SimState): void {}

/**
 * Debug and screenshot hook (never called by the game loop): adds a kept flare of lift `d` (°)
 * whose warning starts `inTicks` ticks from now, skipping the keep test, and returns it. Its ticks
 * follow TUNING.flare (the Journey's shorter warning on a campaign level). It only takes effect once
 * updateFlare and worldElevation read world.flares.
 */
export function debugFlare(s: SimState, inTicks: number, d: number): Flare {
  const w = s.world;
  const warnTick = s.tickAbs + Math.max(0, Math.round(inTicks));
  const riseTick = warnTick + (w.level ? FL.warnTicksJourney : FL.warnTicks);
  const holdTick = riseTick + FL.riseTicks;
  const fallTick = holdTick + FL.holdTicks;
  let id = 1;
  for (const f of w.flares) if (f.id >= id) id = f.id + 1;
  const flare: Flare = { id, day: s.day, d, warnTick, riseTick, holdTick, fallTick, endTick: fallTick + FL.fallTicks, state: FLARE_KEPT };
  let i = w.flares.length;
  while (i > 0 && (w.flares[i - 1] as Flare).riseTick > riseTick) i--;
  w.flares.splice(i, 0, flare);
  return flare;
}
