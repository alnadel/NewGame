// Death recap (V1_1_PLAN GR12, moved to core by A13): the facts of a melt the Results screen turns
// into one line of advice, and the rule that picks it. Pure: read the state on the death tick.

import { TUNING } from '../../config/tuning.ts';
import { minutesOfDay } from '../clock.ts';
import { angleDiff, cosD } from '../dmath.ts';
import { BINS } from '../intervals.ts';
import { historyAt, historyLength } from './history.ts';
import type { DeathCause } from './events.ts';
import type { SimState } from './types.ts';

export interface DeathRecap {
  readonly cause: DeathCause;
  /** Share of the Melt Map samples over the last 10 s of walking that were lit (f > 0). */
  readonly litShare10: number;
  /** θ at death (°). */
  readonly theta: number;
  /**
   * Signed turn (°, + counter-clockwise) from θ to the nearest bin of shade that lasts (guide now ∧
   * next), else of shade now; null when the dial showed no shade at all.
   */
  readonly away: number | null;
  /** Seconds Nubs had been in the sun when he melted. */
  readonly exposure: number;
  /** In-game minutes since 6:00 AM at death (0..720). */
  readonly minuteOfDay: number;
}

const R = TUNING.recap;
const sample = new Float64Array(4);

/** Signed turn from θ to the nearest bin where mask a (and b, when given) is set, or null. */
function nearest(theta: number, a: Uint8Array, b: Uint8Array | null): number | null {
  let best: number | null = null;
  for (let bin = 0; bin < BINS; bin++) {
    if (a[bin] !== 1 || (b !== null && b[bin] !== 1)) continue;
    const d = angleDiff(bin, theta);
    if (best === null || Math.abs(d) < Math.abs(best)) best = d;
  }
  return best;
}

/** The recap of a run on its death tick (or any moment, for a quit run). */
export function deathRecap(s: SimState): DeathRecap {
  const nb = s.nubs;
  const g = s.guide;
  const from = nb.y - 10 * s.params.v;
  let lit = 0;
  let n = 0;
  for (let i = historyLength(s) - 1; i >= 0; i--) {
    historyAt(s, i, sample);
    if ((sample[1] as number) < from) break;
    n++;
    if ((sample[3] as number) > 0) lit++;
  }
  const theta = s.sun.theta;
  return {
    cause: s.death?.cause ?? 'plain',
    litShare10: n > 0 ? lit / n : 0,
    theta,
    away: nearest(theta, g.now, g.next) ?? nearest(theta, g.now, null),
    exposure: nb.litSince >= 0 ? (s.tick - nb.litSince) / TUNING.tick.hz : 0,
    minuteOfDay: minutesOfDay(s.day, s.dayTick),
  };
}

/**
 * One line of advice for the Results screen, or null. First match: glare; shade was close (lit for
 * ≥ 1.5 s with shade within 90°: which way the sun pointer had to go on screen, and the finger's
 * direction, honouring `invert`); often lit lately; a noon melt (TUNING.recap).
 */
export function deathTip(r: DeathRecap, invert: boolean): string | null {
  if (r.cause === 'glare') return 'Red arcs are glare. Keep the little sun out.';
  if (r.away !== null && r.exposure >= R.exposureSec && Math.abs(r.away) <= R.maxAwayDeg && Math.round(Math.abs(r.away)) > 0) {
    // Counter-clockwise needs a leftward drag (dθ = −dx…), unless the controls are inverted.
    const ccw = r.away > 0;
    const arrow = ccw !== invert ? '←' : '→';
    const dx = cosD(r.theta + r.away) - cosD(r.theta);
    const side = dx < -1e-9 ? 'left' : dx > 1e-9 ? 'right' : arrow === '←' ? 'left' : 'right';
    return `Shade was ${Math.round(Math.abs(r.away))}° ${side}. Drag ${arrow}.`;
  }
  if (r.litShare10 >= R.litShare) return `In the sun ${Math.round(10 * r.litShare10)} of the last 10 s. Short dips add up.`;
  if (r.minuteOfDay >= R.noonFrom && r.minuteOfDay <= R.noonTo) return 'Noon shadows are stubs. Ride a cloud or hug tall walls.';
  return null;
}
