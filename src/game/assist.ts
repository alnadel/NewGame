// Onboarding assists (V1_PLAN §6.2-§6.3): the safe-arc guide's Auto alpha rules and the in-play
// ghost-thumb hint. Pure functions plus a tiny per-run hint tracker, so they are unit-testable.

import { angleDiff, type ProfileId } from '../core/index.ts';

export type GuideSetting = 'auto' | 'always' | 'off';

/**
 * Alpha (0..1) of the teal safe arcs. Glare arcs are always shown and are not affected.
 * - always → 1, off → 0 (a URL ?guide= override wins over the setting);
 * - Auto: profile 0 always on; lifetime runs ≤ 5: Days 1-2, fading linearly on Day 3 from 6 AM to
 *   noon; runs 6-10: Day 1 full, Day 2 at (10 − runs)/5; runs 11-20: Day 1 only; 21+: off.
 */
export function guideAlpha(setting: GuideSetting, profile: ProfileId, lifetimeRuns: number, day: number, dayFrac: number): number {
  if (setting === 'always') return 1;
  if (setting === 'off') return 0;
  if (profile === 0) return 1;
  const runs = lifetimeRuns;
  if (runs <= 5) {
    if (day <= 2) return 1;
    if (day === 3) return Math.max(0, 1 - dayFrac / 0.5);
    return 0;
  }
  if (runs <= 10) {
    if (day === 1) return 1;
    if (day === 2) return Math.max(0, Math.min(1, (10 - runs) / 5));
    return 0;
  }
  if (runs <= 20) return day === 1 ? 1 : 0;
  return 0;
}

/** Widest run of set bins (degrees) and the bin at its center; returns [width, center]. */
export function widestArc(mask: Uint8Array, out: Float64Array): void {
  let bestW = 0;
  let bestC = 0;
  let first = -1;
  for (let b = 0; b < 360; b++) {
    if (mask[b] === 0) {
      first = b;
      break;
    }
  }
  if (first < 0) {
    out[0] = 360;
    out[1] = 0;
    return;
  }
  let start = -1;
  for (let k = 1; k <= 360; k++) {
    const b = (first + k) % 360;
    const on = mask[b] !== 0;
    if (on && start < 0) start = first + k;
    if (!on && start >= 0) {
      const w = first + k - start;
      if (w > bestW) {
        bestW = w;
        bestC = (start + (w - 1) / 2) % 360;
      }
      start = -1;
    }
  }
  out[0] = bestW;
  out[1] = bestC;
}

/** Nearest safe bin to θ, or −1. Returns the signed shortest rotation to it in out[0]. */
export function nearestSafe(mask: Uint8Array, theta: number): number {
  let best = Infinity;
  let bestD = 0;
  for (let b = 0; b < 360; b++) {
    if (mask[b] === 0) continue;
    const d = angleDiff(b, theta);
    if (Math.abs(d) < Math.abs(best)) {
      best = d;
      bestD = d;
    }
  }
  return Number.isFinite(best) ? bestD : NaN;
}

const MAX_HINTS = 3;
const LIT_BEFORE_HINT = 0.3;
const MIN_ARC = 10;
const HINT_SECONDS = 1.6;

/** Per-run ghost-thumb hint state (profiles 0-1 only, at most 3 per run). */
export class HintTracker {
  shown = 0;
  private lit = 0;
  /** Seconds left on the hint being shown, and its direction. */
  active = 0;
  dir: 'left' | 'right' = 'left';
  private readonly arc = new Float64Array(2);

  reset(): void {
    this.shown = 0;
    this.lit = 0;
    this.active = 0;
  }

  /**
   * Call once per frame in play. Returns true when a new hint should start (direction in `dir`).
   * A rotation of +θ (counter-clockwise) needs a leftward drag.
   */
  update(dt: number, profile: ProfileId, f: number, sunUp: boolean, now: Uint8Array, theta: number, dragging: boolean): boolean {
    if (this.active > 0) this.active = Math.max(0, this.active - dt);
    if (profile > 1 || !sunUp) {
      this.lit = 0;
      return false;
    }
    this.lit = f > 0 ? this.lit + dt : 0;
    if (this.active > 0 || this.shown >= MAX_HINTS || dragging || this.lit < LIT_BEFORE_HINT) return false;
    widestArc(now, this.arc);
    if ((this.arc[0] as number) < MIN_ARC) return false;
    const d = nearestSafe(now, theta);
    if (!Number.isFinite(d) || d === 0) return false;
    this.dir = d > 0 ? 'left' : 'right';
    this.active = HINT_SECONDS;
    this.shown++;
    this.lit = 0;
    return true;
  }
}
