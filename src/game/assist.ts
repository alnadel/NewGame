// Onboarding assists (V1_PLAN §6.2-§6.3): the safe-arc guide's Auto alpha rules and the in-play
// ghost-thumb hint with its first lesson. Pure functions plus a small per-run hint tracker, so they
// are unit-testable.

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
/** Within this many degrees of the half-turn, the two ways round count as equal: keep the old way. */
const TURN_HYSTERESIS = 20;
/** A tracked target is the same arc while a candidate arc reaches within this many degrees of it. */
const TRACK_SLACK = 15;
/** The lesson hint rests once Nubs has been fully shaded this long (s), until he is lit again. */
const LESSON_SHADE = 0.25;
/** A lesson hint whose target has been gone this long (s) stops (it returns when Nubs is lit). */
const LESSON_LOST = 0.5;
/** Gaps of up to this many degrees inside a safe region don't split it into two targets. */
const MERGE_GAP = 6;

/** Game time scale while the first lesson plays (V1_PLAN §6.2 forgiveness, CRITIQUE first minute). */
export const LESSON_TIME_SCALE = 0.5;

export interface HintInput {
  profile: ProfileId;
  /** Nubs' lit fraction (0 = fully shaded). */
  f: number;
  sunUp: boolean;
  /** Guide masks: safe now and 0.6 s ahead. */
  now: Uint8Array;
  next: Uint8Array;
  theta: number;
  /** A finger or rotation key is down. */
  dragging: boolean;
  /** Settings → invert: a rightward drag turns the sun counter-clockwise. */
  invert: boolean;
  /** The sim's first-run lesson is on (SimState.lessonOn: the Chill floor, until lessonDone). */
  lessonOn: boolean;
}

const MAX_ARCS = 180;

/**
 * Per-run ghost-thumb hint state (profiles 0-1 only, at most 3 plain hints per run), V1_PLAN §6.2.
 *
 * - **Target:** the widest arc that is safe now and still safe 0.6 s ahead (the arc that lasts),
 *   else the widest arc safe now; at least 10° wide.
 * - **Direction:** the short way round to the target's center, but sticky: while the same arc
 *   exists (tracked as it drifts) and the two ways round are within 20° of a half-turn, the first
 *   direction is kept, so a hint never flips sides on an unchanged sun.
 * - **Lesson (A5):** while the sim's lesson is on, hints are lesson hints: they don't time out or
 *   count against the 3, and loop until Nubs is fully shaded for 0.25 s (the hint rests and comes
 *   back when he is lit again), the target arc is gone for 0.5 s, the sun sets, or the lesson ends.
 *   The sim decides the pass (lessonDone); the session slows time to LESSON_TIME_SCALE from the
 *   first lesson hint (`lessonStarted`) until the lesson ends.
 */
export class HintTracker {
  shown = 0;
  /** Seconds left on a plain (non-lesson) hint. */
  active = 0;
  /** Drag direction for the ghost thumb (from `turn` and the invert setting). */
  dir: 'left' | 'right' = 'left';
  /** Rotation toward the target: +1 counter-clockwise (θ grows), −1 clockwise, 0 none. */
  turn: -1 | 0 | 1 = 0;
  /** Target arc center and width (degrees); NaN center when there is no target. */
  target = NaN;
  targetW = 0;
  /** A lesson hint is playing (it loops until Nubs finds shade). */
  lesson = false;
  /** A lesson hint has shown in this run (latched: the lesson's slow time runs from here). */
  lessonStarted = false;
  /** Plain (non-lesson) hints shown this run. */
  private plain = 0;
  private lit = 0;
  private lessonLost = 0;
  private lessonShade = 0;
  private readonly arcStart = new Int16Array(MAX_ARCS);
  private readonly arcWidth = new Int16Array(MAX_ARCS);
  private readonly stable = new Uint8Array(360);

  reset(): void {
    this.shown = 0;
    this.plain = 0;
    this.lit = 0;
    this.active = 0;
    this.turn = 0;
    this.target = NaN;
    this.targetW = 0;
    this.lesson = false;
    this.lessonStarted = false;
    this.lessonLost = 0;
  }

  /** The ghost thumb should be on screen now (the lesson hides it while a finger is down). */
  showing(dragging: boolean): boolean {
    if (Number.isNaN(this.target)) return false;
    return this.lesson ? !dragging : this.active > 0;
  }

  /** Degrees from θ to the target center going the `turn` way (0 when there is no target). */
  route(theta: number): number {
    if (Number.isNaN(this.target) || this.turn === 0) return 0;
    const d = (((this.target - theta) * this.turn) % 360 + 360) % 360;
    return d;
  }

  /** Ends the lesson (unpassed) and any hint: death, the Results, a pause on the way out, night. */
  stop(): void {
    this.lesson = false;
    this.active = 0;
    this.lit = 0;
  }

  /**
   * Call once per frame in play (real seconds). Returns true when a new hint starts (direction in
   * `dir`, target in `target`/`targetW`).
   */
  update(dt: number, p: HintInput): boolean {
    if (this.active > 0) this.active = Math.max(0, this.active - dt);
    if (p.profile > 1 || !p.sunUp) {
      this.stop();
      return false;
    }
    this.lit = p.f > 0 ? this.lit + dt : 0;

    if (this.lesson) {
      this.lessonShade = p.f === 0 ? this.lessonShade + dt : 0;
      if (!p.lessonOn || this.lessonShade >= LESSON_SHADE) {
        // The lesson ended, or Nubs is in shade: the hint rests (it returns when he is lit again).
        this.lesson = false;
        this.lit = 0;
        return false;
      }
      if (this.track(p)) this.lessonLost = 0;
      else if ((this.lessonLost += dt) >= LESSON_LOST) this.stop();
      return false;
    }
    if (this.active > 0) {
      this.track(p);
      return false;
    }
    if ((!p.lessonOn && this.plain >= MAX_HINTS) || p.dragging || this.lit < LIT_BEFORE_HINT) return false;
    if (!this.track(p)) return false;
    this.shown++;
    this.lit = 0;
    if (p.lessonOn) {
      this.lesson = true;
      this.lessonStarted = true;
      this.lessonLost = 0;
      this.lessonShade = 0;
    } else {
      this.plain++;
      this.active = HINT_SECONDS;
    }
    return true;
  }

  /**
   * Picks (or keeps tracking) the target arc and the way round. Returns false when no safe arc of
   * at least MIN_ARC exists (the target is cleared).
   */
  private track(p: HintInput): boolean {
    const st = this.stable;
    let anyStable = false;
    for (let b = 0; b < 360; b++) {
      const v = p.now[b] !== 0 && p.next[b] !== 0 ? 1 : 0;
      st[b] = v;
      if (v) anyStable = true;
    }
    let n = anyStable ? this.arcs(st) : 0;
    if (n === 0) n = this.arcs(p.now);
    if (n === 0) {
      this.target = NaN;
      this.targetW = 0;
      return false;
    }
    // Same arc as before (it drifts and grows as Nubs walks): the candidate nearest the old center.
    let pick = -1;
    if (!Number.isNaN(this.target)) {
      let best = Infinity;
      for (let i = 0; i < n; i++) {
        const w = this.arcWidth[i] as number;
        const c = (this.arcStart[i] as number) + (w - 1) / 2;
        const gap = Math.max(0, Math.abs(angleDiff(this.target, c)) - (w + this.targetW) / 2);
        if (gap <= TRACK_SLACK && gap < best) {
          best = gap;
          pick = i;
        }
      }
    }
    const tracked = pick >= 0;
    if (!tracked) {
      let bestW = 0;
      for (let i = 0; i < n; i++) {
        if ((this.arcWidth[i] as number) > bestW) {
          bestW = this.arcWidth[i] as number;
          pick = i;
        }
      }
    }
    const w = this.arcWidth[pick] as number;
    this.targetW = w;
    this.target = ((((this.arcStart[pick] as number) + (w - 1) / 2) % 360) + 360) % 360;
    const d = angleDiff(this.target, p.theta);
    const ad = Math.abs(d);
    if (ad <= w / 2) {
      // Already pointing into it: keep the way we were going.
      if (this.turn === 0) this.turn = d >= 0 ? 1 : -1;
    } else if (!(tracked && this.turn !== 0 && ad > 180 - TURN_HYSTERESIS)) {
      this.turn = d > 0 ? 1 : -1;
    }
    // A counter-clockwise turn (θ grows) is a leftward drag, unless the controls are inverted.
    this.dir = this.turn > 0 !== p.invert ? 'left' : 'right';
    return true;
  }

  /**
   * Lists the circular runs of set bins at least MIN_ARC wide, treating gaps of up to MERGE_GAP
   * degrees as part of the run (the masks have slivers at part edges that would make the target
   * jump between halves of one teal region); returns how many.
   */
  private arcs(mask: Uint8Array): number {
    // Start scanning just after a gap longer than MERGE_GAP, so no merged run wraps past the start.
    let first = -1;
    let gapRun = 0;
    for (let k = 0; k < 720 && first < 0; k++) {
      const b = k % 360;
      gapRun = mask[b] === 0 ? gapRun + 1 : 0;
      if (gapRun > MERGE_GAP) first = b;
    }
    if (first < 0) {
      this.arcStart[0] = 0;
      this.arcWidth[0] = 360;
      return 1;
    }
    let n = 0;
    let start = -1;
    let lastOn = -1;
    for (let k = 1; k <= 360; k++) {
      const b = (first + k) % 360;
      if (mask[b] === 0) {
        if (start >= 0 && first + k - lastOn > MERGE_GAP) {
          this.push(start, lastOn - start + 1, n++);
          start = -1;
        }
        continue;
      }
      if (start < 0) start = first + k;
      lastOn = first + k;
    }
    if (start >= 0) this.push(start, lastOn - start + 1, n++);
    // Drop the narrow ones (in place).
    let m = 0;
    for (let i = 0; i < n && i < MAX_ARCS; i++) {
      if ((this.arcWidth[i] as number) < MIN_ARC) continue;
      this.arcStart[m] = this.arcStart[i] as number;
      this.arcWidth[m] = this.arcWidth[i] as number;
      m++;
    }
    return m;
  }

  private push(start: number, width: number, i: number): void {
    if (i >= MAX_ARCS) return;
    this.arcStart[i] = start % 360;
    this.arcWidth[i] = width;
  }
}

/** CSS `ease-in-out` (cubic-bezier(0.42, 0, 0.58, 1)) at t ∈ [0, 1]. */
export function cssEaseInOut(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  // Solve x(u) = t for the bezier parameter u (Newton, then bisection as a fallback).
  const x1 = 0.42;
  const x2 = 0.58;
  const bx = (u: number): number => 3 * (1 - u) * (1 - u) * u * x1 + 3 * (1 - u) * u * u * x2 + u * u * u;
  let u = t;
  for (let i = 0; i < 6; i++) {
    const x = bx(u) - t;
    const dx = 3 * (1 - u) * (1 - u) * x1 + 6 * (1 - u) * u * (x2 - x1) + 3 * u * u * (1 - x2);
    if (Math.abs(x) < 1e-5 || dx < 1e-6) break;
    u -= x / dx;
  }
  u = Math.min(1, Math.max(0, u));
  // y(u) with y1 = 0, y2 = 1.
  return 3 * (1 - u) * u * u + u * u * u;
}

/**
 * Horizontal position (−1 left … +1 right) of the Title's ghost hand at progress p of its 2.4 s
 * `ghost-swing` loop (ui.css keyframes: hold left to 8 %, glide right to 50 %, hold to 58 %, glide
 * back to 92 %). The Title sway follows it, so the sun turns as the hand drags.
 */
export function ghostSwingX(p: number): number {
  const q = p - Math.floor(p);
  if (q < 0.08) return -1;
  if (q < 0.5) return -1 + 2 * cssEaseInOut((q - 0.08) / 0.42);
  if (q < 0.58) return 1;
  if (q < 0.92) return 1 - 2 * cssEaseInOut((q - 0.58) / 0.34);
  return -1;
}

/**
 * Progress (0..1) of the in-play ghost swipe at progress p of its `ghost-once` loop (ui.css: fade in
 * at the start to 15 %, glide to 75 %, fade out at the end), and its opacity in out[1].
 */
export function ghostSwipe(p: number, out: Float64Array): void {
  const q = p - Math.floor(p);
  if (q < 0.15) {
    out[0] = 0;
    out[1] = cssEaseInOut(q / 0.15);
  } else if (q < 0.75) {
    out[0] = cssEaseInOut((q - 0.15) / 0.6);
    out[1] = 1;
  } else {
    out[0] = 1;
    out[1] = 1 - cssEaseInOut((q - 0.75) / 0.25);
  }
}
