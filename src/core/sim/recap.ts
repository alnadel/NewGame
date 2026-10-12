// Death recap (V1_1_PLAN GR12, moved to core by A13): the facts of a melt the Results screen turns
// into one line of advice, and the rule that picks it. Pure: read the state on the death tick.

import { TUNING } from '../../config/tuning.ts';
import { minutesOfDay } from '../clock.ts';
import { angleDiff } from '../dmath.ts';
import { BINS } from '../intervals.ts';
import { historyAt, historyLength } from './history.ts';
import type { DeathCause } from './events.ts';
import type { SimState } from './types.ts';

export interface DeathRecap {
  readonly cause: DeathCause;
  /** Share of the Melt Map samples over the last `window` seconds of walking that were lit (f > 0). */
  readonly litShare10: number;
  /** Seconds of walking those samples cover: 10, or fewer on a run that melted sooner (≥ 1). */
  readonly window: number;
  /** θ at death (°). */
  readonly theta: number;
  /** Signed turn (°, + counter-clockwise) from θ to the nearest bin of shade that lasts (guide now ∧ next), else null. */
  readonly away: number | null;
  /** Signed turn to the nearest bin of shade now (lasting or ending), else null (the dial showed none). */
  readonly nowAway: number | null;
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
  const v = s.params.v;
  const from = nb.y - 10 * v;
  let lit = 0;
  let n = 0;
  let oldest = nb.y;
  for (let i = historyLength(s) - 1; i >= 0; i--) {
    historyAt(s, i, sample);
    if ((sample[1] as number) < from) break;
    n++;
    oldest = sample[1] as number;
    if ((sample[3] as number) > 0) lit++;
  }
  const theta = s.sun.theta;
  return {
    cause: s.death?.cause ?? 'plain',
    litShare10: n > 0 ? lit / n : 0,
    window: Math.min(10, Math.max(1, Math.round((nb.y - oldest) / v))),
    theta,
    away: nearest(theta, g.now, g.next),
    nowAway: nearest(theta, g.now, null),
    exposure: nb.litSince >= 0 ? (s.tick - nb.litSince) / TUNING.tick.hz : 0,
    minuteOfDay: minutesOfDay(s.day, s.dayTick),
  };
}

/** Phrasings rotate with `variant` (the lifetime run count), so the same kind of melt reads fresh. */
const pick = (lines: readonly string[], variant: number): string => lines[Math.abs(Math.floor(variant)) % lines.length] as string;

/**
 * One line of advice for the Results screen, or null. First match: glare; shade was in reach (lit
 * for ≥ 0.5 s with shade that lasts — the dial's thick teal — within 120°, else any shade within
 * 120°: how far, and the finger's direction, honouring `invert`; no screen side, which disagreed
 * with the arrow whenever the sun pointer sat low on the dial); often lit lately (counted over the
 * seconds actually walked, at most 10); a noon melt (TUNING.recap). `variant` rotates the wording.
 */
export function deathTip(r: DeathRecap, invert: boolean, variant = 0): string | null {
  if (r.cause === 'glare') return pick(['Red arcs are glare. Keep the little sun out.', 'Glare! The red arcs blind Nubs. Swing the sun clear of them.'], variant);
  const reach = (a: number | null): number | null => (a !== null && Math.abs(a) <= R.maxAwayDeg && Math.round(Math.abs(a)) > 0 ? a : null);
  const lasting = reach(r.away);
  const target = lasting ?? reach(r.nowAway);
  if (target !== null && r.exposure >= R.exposureSec) {
    // Counter-clockwise needs a leftward drag (dθ = −dx…), unless the controls are inverted.
    const arrow = target > 0 !== invert ? '←' : '→';
    const deg = Math.round(Math.abs(target));
    return lasting !== null
      ? pick([`Thick teal was ${deg}° away. Drag ${arrow}.`, `Shade that lasts was ${deg}° away. Drag ${arrow}.`, `Drag ${arrow}: thick teal was ${deg}° away.`], variant)
      : `Shade was ${deg}° away. Drag ${arrow}.`;
  }
  if (r.litShare10 >= R.litShare) {
    const w = r.window;
    const lit = Math.max(1, Math.round(w * r.litShare10));
    return pick(
      [
        `In the sun ${lit} of the last ${w} s. Short dips add up.`,
        `${lit} of the last ${w} s in the sun. Swing before your shade runs out.`,
        `Lit ${lit} of the last ${w} s. Thick teal lasts; thin teal is ending.`,
      ],
      variant,
    );
  }
  if (r.minuteOfDay >= R.noonFrom && r.minuteOfDay <= R.noonTo) {
    return pick(['Noon shadows are stubs. Ride a cloud or hug tall walls.', 'At noon only tall things cast shade. Clouds help.'], variant);
  }
  return null;
}
