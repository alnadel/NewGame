// Fixed-step clock (TECH_SPEC §9.10): a 60 Hz accumulator fed by real frame time scaled by slow-mo,
// paused by hit-stop, capped at 5 ticks per frame (×fast for soak runs). Slow-mo and hit-stop
// timers run in real time. The interpolation alpha is acc / DT.

import { DT } from '../core/index.ts';

export class FixedClock {
  /** Accumulated game time not yet stepped (s). */
  acc = 0;
  /** URL ?fast=N multiplier (ticks per frame). */
  fast = 1;
  /** Test hook / debug multiplier on time. */
  debugScale = 1;
  private hitStop = 0;
  private slowScale = 1;
  private slowLeft = 0;
  /** Game seconds advanced in the last frame (for render animations). */
  gameDt = 0;

  /** Freezes the sim for `sec` real seconds. */
  addHitStop(sec: number): void {
    this.hitStop = Math.max(this.hitStop, sec);
  }

  /** Runs time at `scale` for `sec` real seconds (after any hit-stop). */
  slowMo(scale: number, sec: number): void {
    if (this.slowLeft > 0 && this.slowScale < scale) {
      this.slowLeft = Math.max(this.slowLeft, sec);
      return;
    }
    this.slowScale = scale;
    this.slowLeft = sec;
  }

  get timeScale(): number {
    if (this.hitStop > 0) return 0;
    return (this.slowLeft > 0 ? this.slowScale : 1) * this.debugScale;
  }

  reset(): void {
    this.acc = 0;
    this.hitStop = 0;
    this.slowLeft = 0;
    this.slowScale = 1;
    this.gameDt = 0;
  }

  /** Advances by `real` seconds; returns the number of ticks to run this frame. */
  advance(real: number): number {
    let scaled: number;
    if (this.hitStop > 0) {
      this.hitStop -= real;
      scaled = 0;
    } else {
      const s = this.slowLeft > 0 ? this.slowScale : 1;
      if (this.slowLeft > 0) this.slowLeft -= real;
      scaled = real * s * this.debugScale;
    }
    this.gameDt = scaled;
    this.acc += scaled * this.fast;
    const cap = 5 * this.fast;
    let n = Math.floor(this.acc / DT);
    if (n > cap) {
      n = cap;
      this.acc = 0;
    } else {
      this.acc -= n * DT;
    }
    return n;
  }

  get alpha(): number {
    return Math.min(1, this.acc / DT);
  }
}
