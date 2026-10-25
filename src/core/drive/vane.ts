// Controls v3 Gust vane predictions (docs/CONTROLS_V3.md §3.5; CORE): where a weather object lands.
// CORE's cut list 1 (§12.3, the bundle over its allowance): the set-vane prediction is cut, so every
// notch reads the calm-now ghost, today's weatherXAt.

import type { ElObj } from '../objects.ts';
import { weatherXAt } from '../sim/elements.ts';
import type { SimState } from '../sim/types.ts';

/** Weather object o's x after `ticks`: the calm-now prediction for every notch n (cut list 1, §12.3). */
export function driveWeatherX(s: SimState, o: ElObj, ticks: number, n: number): number {
  return n === n ? weatherXAt(s, o, ticks) : NaN;
}
