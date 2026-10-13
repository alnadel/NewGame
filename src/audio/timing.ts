// Pure timing helpers for the audio layer: rate limiters for bursty SFX, the 16th-note step clock
// with its lookahead window, and the heartbeat pulse. No WebAudio; times are plain numbers, so
// all of it is unit-tested in Node.

import { STEP_S } from './theory.ts';

/**
 * Allows an action at most `maxPerWindow` times per `windowMs` and never closer than `minGapMs`
 * apart. Rejected calls are dropped, not queued. Allocation-free after construction.
 */
export class RateLimiter {
  private readonly minGapMs: number;
  private readonly windowMs: number;
  /** Ring of the last `maxPerWindow` accepted timestamps; `head` is the oldest. */
  private readonly stamps: Float64Array;
  private head = 0;
  private last = Number.NEGATIVE_INFINITY;

  constructor(minGapMs: number, maxPerWindow: number, windowMs = 1000) {
    this.minGapMs = minGapMs;
    this.windowMs = windowMs;
    this.stamps = new Float64Array(Math.max(1, Math.floor(maxPerWindow))).fill(Number.NEGATIVE_INFINITY);
  }

  /** True (and recorded) if an action at time `nowMs` is allowed. */
  tryAcquire(nowMs: number): boolean {
    if (nowMs - this.last < this.minGapMs || nowMs - (this.stamps[this.head] as number) < this.windowMs) return false;
    this.stamps[this.head] = this.last = nowMs;
    this.head = (this.head + 1) % this.stamps.length;
    return true;
  }

  reset(): void {
    this.stamps.fill(Number.NEGATIVE_INFINITY);
    this.last = Number.NEGATIVE_INFINITY;
  }
}

/**
 * The 16th-note grid. `advance(now, horizon)` reports every step whose start time lies in
 * [now, horizon). Steps that already lie in the past (the timer was throttled, the tab slept, the
 * context was suspended) are skipped silently: a backlog is never burst-scheduled. `stepS` (the
 * tempo) may change at any time; the grid continues from the next step at the new spacing.
 */
export class StepClock {
  /** Index of the next step to schedule. */
  step = 0;
  /** Audio time of `step`. */
  time = 0;
  /** Length of a 16th note (s). */
  stepS = STEP_S;
  /** Number of steps skipped by the most recent advance() (for diagnostics and tests). */
  skipped = 0;
  private started = false;

  get running(): boolean {
    return this.started;
  }

  /** Starts the grid so that step 0 falls at `at`. */
  start(at: number): void {
    this.step = 0;
    this.time = at;
    this.started = true;
  }

  advance(now: number, horizon: number, onStep: (step: number, time: number) => void): void {
    this.skipped = 0;
    if (!this.started) return;
    if (this.time < now) {
      // Fell behind: jump to the first grid point at or after `now`, keeping the bar phase.
      const n = Math.ceil((now - this.time) / this.stepS - 1e-9);
      this.step += n;
      this.time += n * this.stepS;
      this.skipped = n;
    }
    while (this.time < horizon) {
      onStep(this.step, this.time);
      this.step++;
      this.time += this.stepS;
    }
  }

  /** The earliest grid time at or after `t`. Works before start() too (grid anchored at 0). */
  gridAtOrAfter(t: number): number {
    return this.time + Math.ceil((t - this.time) / this.stepS - 1e-9) * this.stepS;
  }
}

/**
 * Hands out 16th-note slots for quantized one-shots (flake bells). Each request gets the next
 * grid point after `now + margin`; if that slot is already taken by an earlier bell, the bell
 * moves to the following 16th, so a quick string of pickups plays as a little run, not a cluster.
 */
export class GridSlots {
  private lastSlot = Number.NEGATIVE_INFINITY;
  /** Maximum number of 16ths a bell may be pushed back before it just doubles up. */
  readonly maxPush: number;

  constructor(maxPush = 2) {
    this.maxPush = maxPush;
  }

  claim(clock: StepClock, now: number, margin = 0.005): number {
    const step = clock.stepS;
    let t = clock.gridAtOrAfter(now + margin);
    const limit = t + this.maxPush * step + 1e-6;
    while (t <= this.lastSlot + 1e-6 && t + step <= limit) t += step;
    if (t > this.lastSlot) this.lastSlot = t;
    return t;
  }
}

/**
 * A free-running beat for the low-Chill heartbeat. It fires immediately when it starts, adopts a
 * faster period at once (never waiting longer than the new period) and never fires more than once
 * per tick, so a long frame cannot cause a burst.
 */
export class Pulse {
  private wait = 0;
  private active = false;

  /** Advances by `dt` seconds; `period` ≤ 0 stops the pulse. Returns true when a beat fires. */
  tick(dt: number, period: number): boolean {
    if (!(period > 0)) {
      this.active = false;
      return false;
    }
    if (!this.active) {
      this.active = true;
      this.wait = 0;
    } else if (this.wait > period) {
      this.wait = period;
    }
    this.wait -= dt;
    if (this.wait > 0) return false;
    this.wait += period;
    if (this.wait <= 0) this.wait = period;
    return true;
  }

  reset(): void {
    this.active = false;
    this.wait = 0;
  }
}
