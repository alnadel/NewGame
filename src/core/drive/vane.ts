// Controls v3 Gust vane predictions (docs/CONTROLS_V3.md §3.5; CORE). The C0b contract: the arrival
// ghost reads today's weatherXAt for every notch until the governor lands.

import type { ElObj } from '../objects.ts';
import { weatherXAt } from '../sim/elements.ts';
import type { SimState } from '../sim/types.ts';

/** §3.5: weather object o's x after `ticks` with the vane held at notch n (the governor's gusts, no Lift limit); n = 0 is "calm now". */
export function driveWeatherX(s: SimState, o: ElObj, ticks: number, _n: number): number {
  return weatherXAt(s, o, ticks);
}
