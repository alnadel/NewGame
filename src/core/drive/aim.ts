// Controls v3 aim help (docs/CONTROLS_V3.md §4; CORE): the capture radius per run (§4.3), the
// magnet's target (§4.2: settle into lasting shade, or track a moving edge), the hand-over's before
// Drip (§4.4) and the glide's eased steps (§4.5). The driver decides when (§4.1) and plays the glide;
// settleTarget is the same plan for the dial's preview. Allocation-free: one module scratch mask.

import { HEROES } from '../../config/heroes.ts';
import { TRIAL_BASE } from '../../config/trials.ts';
import { AIM_OVERRIDE, TUNING } from '../../config/tuning.ts';
import { angleDiff } from '../dmath.ts';
import { BINS, binOf } from '../intervals.ts';
import { nextTagHero, tagLocked } from '../sim/elements.ts';
import type { RunConfig, SimState } from '../sim/types.ts';
import type { AimSetting } from './driver.ts';

const A = TUNING.drive.aim;

/**
 * §4.3: the capture radius (°; 0 off) and whether the magnet tracks, for a run. `level` is
 * RunConfig.level (a Trial's id, 1001..1007), `rung` the Endless comfort rung (−1 none). Standard
 * follows the schedule (Journey 14/12/10 by L1-40, 41-100, 101-200; Endless R0-R4 14, 14, 14, 12,
 * 10; Daily and challenges 10; Trials 14) unless AIM_OVERRIDE names the level, Trial or rung; Strong
 * is 14, Light 8 without track, Off and 'blind' levels 0.
 */
export function aimRadius(setting: AimSetting, ctx: { mode: RunConfig['mode']; level: number | null; rung: number; trial: boolean; blind: boolean }): { deg: number; track: boolean } {
  if (ctx.blind || setting === 'off') return { deg: 0, track: false };
  if (setting !== 'standard') return { deg: setting === 'light' ? A.light : A.strong, track: setting === 'strong' };
  const l = ctx.level ?? 1;
  const camp = ctx.mode === 'campaign';
  const endless = ctx.mode === 'endless';
  const o = AIM_OVERRIDE[ctx.trial ? `T${l - TRIAL_BASE}` : camp ? `L${l}` : endless ? `R${ctx.rung}` : ''];
  if (o) return { deg: o.deg, track: o.track };
  // Endless runs off the ladder (rung −1) play the standard rules: R4's radius.
  const deg = ctx.trial ? A.trials : camp ? A.journey[l <= 40 ? 0 : l <= 100 ? 1 : 2] : endless ? (A.endless[ctx.rung] ?? A.endless[4]) : A.daily;
  return { deg: deg as number, track: true };
}

/** The target mask T of §4.2 (scratch). */
const T = new Uint8Array(BINS);

/** What the last aimPlan or handPlan found: `kind` 1 a rescue, 0 a track (aimPlan); `bin` the hand-over's marked bin. */
export const aimOut = { kind: 0, bin: 0 };

/** The width of the arc seek found last. */
let seekW = 0;

/**
 * The nearest bin of `m` reached from bin b within R bins (b itself excluded): its offset (+ CCW,
 * − CW; 0 none), its arc's width in seekW. Ties at the same reach: the wider arc, then CCW. A
 * `glare` bin stops that direction (Nubs never crosses glare).
 */
function seek(m: Uint8Array, b: number, R: number, glare: Uint8Array | null): number {
  let ccw = true;
  let cw = true;
  for (let k = 1; k <= R && (ccw || cw); k++) {
    const p = (b + k) % BINS;
    const q = (b - k + BINS) % BINS;
    const wp = ccw && m[p] === 1 ? arcWidth(m, p, 1) : 0;
    const wq = cw && m[q] === 1 ? arcWidth(m, q, -1) : 0;
    if (wp > 0 || wq > 0) {
      seekW = wp >= wq ? wp : wq;
      return wp >= wq ? k : -k;
    }
    if (glare !== null) {
      if (glare[p] === 1) ccw = false;
      if (glare[q] === 1) cw = false;
    }
  }
  return 0;
}

/** Bins of `m` set in a row from bin c going `dir` (at most BINS). */
function arcWidth(m: Uint8Array, c: number, dir: number): number {
  let w = 0;
  while (w < BINS && m[(c + dir * w + 2 * BINS) % BINS] === 1) w++;
  return w;
}

/** min(v, w/2): an inset or edge band that fits an arc w bins wide. */
const fit = (v: number, w: number): number => (v < w / 2 ? v : w / 2);

/**
 * §4.2: where the magnet sends a sun at θ now (NaN: it leaves it alone), with radius R (bins), the
 * 'fog' now-only mask and track on or off; `ending` allows the rescue out of shade that is ending
 * (the driver: no hand for endingTicks). aimOut.kind tells a rescue (1) from a track (0). Bin b covers
 * [b − 0.5, b + 0.5), so an arc lo..hi has edges lo − 0.5 and hi + 0.5.
 */
export function aimPlan(s: SimState, theta: number, R: number, nowOnly: boolean, track: boolean, ending: boolean): number {
  const g = s.guide;
  const b = binOf(theta);
  // T: the landing during a snap; else the lasting shade now ∧ next ('fog': now only); else now.
  let any = false;
  if (s.snapTicks > 0) for (let i = 0; i < BINS; i++) any = (T[i] = g.land[i] as number) === 1 || any;
  if (!any && !nowOnly) for (let i = 0; i < BINS; i++) any = (T[i] = (g.now[i] as number) & (g.next[i] as number)) === 1 || any;
  if (!any) T.set(g.now);
  // A TAG telegraph into a sun element: where both walkers are served, when that is within reach.
  const h = tagLocked(s) ? nextTagHero(s) : null;
  const tele = h !== null && HEROES[h].drag === 'sun';
  if (tele) {
    let near = false;
    for (let k = -R; k <= R && !near; k++) {
      const c = (b + k + BINS) % BINS;
      near = T[c] === 1 && g.tag[c] === 1;
    }
    if (near) for (let i = 0; i < BINS; i++) T[i] = (T[i] as number) & (g.tag[i] as number);
  }
  // Honour a gold bud arc, a glass glint, a flare rim and the next element's aim the player chose.
  if (g.bud[b] === 1 || g.flake[b] === 1 || (g.flareTicks >= 0 && g.flare[b] === 1) || (tele && g.tag[b] === 1)) return NaN;
  // θ unwrapped around its bin.
  const t = b + angleDiff(theta, b);
  if (T[b] === 1) {
    // Track: a sun near the edge of its arc goes back inside it (never to another arc).
    if (!track) return NaN;
    const lo = b - arcWidth(T, b, -1) + 1;
    const hi = b + arcWidth(T, b, 1) - 1;
    const w = hi - lo + 1;
    if (w >= BINS) return NaN;
    const m = fit(A.edge, w);
    const dLo = t - (lo - 0.5);
    const dHi = hi + 0.5 - t;
    aimOut.kind = 0;
    if (dLo < m && dLo <= dHi) return lo - 0.5 + fit(A.inset, w);
    return dHi < m ? hi + 0.5 - fit(A.inset, w) : NaN;
  }
  // Settle: lit (Ember: not light) now, or shade that is ending once the hand has rested.
  if (g.now[b] === 1 && !ending) return NaN;
  const k = seek(T, b, R, s.nubs.hero === 'nubs' ? g.glare : null);
  if (k === 0) return NaN;
  aimOut.kind = 1;
  return k > 0 ? b + k - 0.5 + fit(A.inset, seekW) : b + k + 0.5 - fit(A.inset, seekW);
}

/** §4.2 for the dial's preview: where a lift at θ would settle now (NaN: it would not move). Allocation-free; the tests use it too. */
export function settleTarget(s: SimState, theta: number, aimDeg: number, nowOnly: boolean): number {
  return aimDeg > 0 && s.sunUp ? aimPlan(s, theta, aimDeg, nowOnly, false, true) : NaN;
}

/**
 * §4.4: the hand-over's target before a TAG into Drip (NaN: θ is already on the dashed arcs, or none
 * is within handReach): the nearest bin of guide.tag ∧ guide.now (Nubs stays shaded), else of
 * guide.tag, landing handInset (at most half the arc) inside it. aimOut.bin is that bin.
 */
export function handPlan(s: SimState, theta: number): number {
  const g = s.guide;
  const b = binOf(theta);
  if (g.tag[b] === 1) return NaN;
  for (let i = 0; i < BINS; i++) T[i] = (g.tag[i] as number) & (g.now[i] as number);
  let k = seek(T, b, A.handReach, null);
  if (k === 0) k = seek(g.tag, b, A.handReach, null);
  if (k === 0) return NaN;
  aimOut.bin = (b + k + BINS) % BINS;
  return k > 0 ? b + k - 0.5 + fit(A.handInset, seekW) : b + k + 0.5 - fit(A.handInset, seekW);
}

/** Quantizes to the input's 1/1024°. */
export const q1024 = (d: number): number => Math.round(d * 1024) / 1024;

/** A glide's ticks for a turn of Δ° at `rate` °/s (§4.5): max(2, ⌈2|Δ| / (rate·DT)⌉). */
export function glideTicks(delta: number, rate: number): number {
  const n = Math.ceil((120 * (delta < 0 ? -delta : delta)) / rate);
  return n < 2 ? 2 : n;
}

/** Tick k (1..n) of a glide of Δ°: q1024(Δ·(e(k/n) − e((k−1)/n))) with the ease-out e(x) = 1 − (1 − x)² (the caller sends the remainder on tick n). */
export function glideStep(delta: number, n: number, k: number): number {
  const a = 1 - k / n;
  const b = 1 - (k - 1) / n;
  return q1024(delta * (b * b - a * a));
}
