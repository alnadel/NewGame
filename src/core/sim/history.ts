// Melt Map history: a ring of (x, y, chill, f) samples, one every 20 u of Nubs' y.

import { TUNING } from '../../config/tuning.ts';
import type { SimState } from './types.ts';

const CAP = TUNING.history.capacity;

/** Appends samples for every 20 u Nubs advanced since the last one. Called by step(). */
export function pushHistory(s: SimState): void {
  const nb = s.nubs;
  while (nb.y >= s.nextHistoryY) {
    const o = (s.historyCount % CAP) * 4;
    s.history[o] = nb.x;
    s.history[o + 1] = nb.y;
    s.history[o + 2] = nb.chill;
    s.history[o + 3] = nb.f;
    s.historyCount++;
    s.nextHistoryY += TUNING.history.every;
  }
}

/** Number of samples still held (the ring keeps the latest 1024, ≈ 20 000 u). */
export function historyLength(s: SimState): number {
  return s.historyCount < CAP ? s.historyCount : CAP;
}

/**
 * The i-th retained sample, oldest first (0 ≤ i < historyLength(s)): writes [x, y, chill, f]
 * into out.
 */
export function historyAt(s: SimState, i: number, out: Float64Array): void {
  const first = s.historyCount - historyLength(s);
  const o = ((first + i) % CAP) * 4;
  out[0] = s.history[o] as number;
  out[1] = s.history[o + 1] as number;
  out[2] = s.history[o + 2] as number;
  out[3] = s.history[o + 3] as number;
}
