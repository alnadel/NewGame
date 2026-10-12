// Frame-time governor (TECH_SPEC §15). Quality steps down one notch at a time when frames are late,
// over a 4-level ladder, and may step back up once:
//   0 full: soft shadows (the half-res layer's full-screen blit);
//   1 crisp shadows (the shadow path filled straight onto the world, no blit);
//   2 DPR × 0.75;
//   3 DPR × 0.625 (never below 1 device px per CSS px) and the particle cap 400 → 200.
// Devices that look low-end before the first frame (≤ 4 GB or ≤ 4 cores, not iOS) start at level 1
// with DPR capped at 1.5 (deviceClass below): even with the matched source-over shadow composite,
// the soft pass alone at DPR 1.5 under a 2× CPU throttle takes ~9 ms of software raster a frame
// (vs ~16 ms with the multiply blit), over half the 16.7 ms budget, so they keep crisp shadows.
//
// Two signals per frame: the rAF interval, which carries everything (JS, canvas raster, compositing,
// vsync), and the frame's own JS work. Raster cost is only visible in the interval, so the interval
// is the main signal — but not every long interval is a slow frame. A display or browser that runs
// rAF at a steady 30-45 Hz (iOS Low Power Mode, Android battery saver, capped WebViews) gives long
// intervals however little a frame costs, and lowering the resolution there only blurs the game for
// the whole session. So, over a rolling window of intervals:
//   - a steady cadence (p25..p75 within 12% of the median) with a median of 22-36 ms is taken as the
//     display's rate: step down only if the JS work alone takes more than 60% of it;
//   - otherwise step down when the mean interval is over the 20 ms budget.
// The window (the last 120 frames, or the last 2 s when frames are slower than that) restarts with a
// 2 s warm-up after boot, any resize and every change, and changes are at least 3 s apart. One step back up is allowed per session, after 10 s of clean 60 Hz frames
// (steady median ≤ 17.5 ms) with light JS work (mean ≤ 6 ms); if frames then turn late again it
// steps down and stays there.

/** Rolling window: the last 120 frames, or fewer when they already span 2 s (slow frames). */
const WINDOW = 120;
const MIN_SPAN_MS = 2000;
const MIN_SAMPLES = 12;
const LIMIT_MS = 20;
const COOLDOWN_S = 3;
const WARMUP_S = 2;
/** Re-evaluate every this many samples (or this many ms) once the window is ready. */
const EVAL_EVERY = 15;
const EVAL_MS = 250;
/** Steady cadence: interquartile spread within this fraction of the median. */
const STEADY_SPREAD = 0.12;
/** Medians in this range (ms) on a steady cadence are a capped display rate (≈ 28-45 Hz). */
const CAPPED_MIN_MS = 22;
const CAPPED_MAX_MS = 36;
/** On a capped cadence, step down only when JS work takes more than this share of the interval. */
const CAPPED_WORK_SHARE = 0.6;
/** Step back up after this long at clean 60 Hz with light work. */
const UP_AFTER_S = 10;
const UP_MEDIAN_MS = 17.5;
const UP_WORK_MS = 6;
const MAX_LEVEL = 3;

export class Governor {
  enabled = true;
  level = 0;
  /** The lowest level it may step back up to (1 on low-end devices: crisp shadows from the start). */
  floor = 0;
  dprScale = 1;
  particleCap = 400;
  softShadows = true;
  /** Last evaluated cadence (ms) and whether it counted as a capped display rate (debug overlay). */
  median = 0;
  capped = false;
  private readonly intervals = new Float32Array(WINDOW);
  private readonly work = new Float32Array(WINDOW);
  private readonly sorted = new Float32Array(WINDOW);
  private head = 0;
  private count = 0;
  private sumInterval = 0;
  private sumWork = 0;
  private sinceEval = 0;
  private msSinceEval = 0;
  private warmup = WARMUP_S;
  private cooldown = 0;
  private clean = 0;
  private stepsUp = 0;
  /** Called after a change of DPR scale. */
  onChange: (() => void) | null = null;

  /** Mean rAF interval over the window (ms). */
  get mean(): number {
    return this.count > 0 ? this.sumInterval / this.count : 0;
  }

  /** Mean JS work per frame over the window (ms). */
  get meanWork(): number {
    return this.count > 0 ? this.sumWork / this.count : 0;
  }

  /** Restarts the window and the warm-up (call after a resize: new buffers, first-frame costs). */
  reset(): void {
    this.intervals.fill(0);
    this.work.fill(0);
    this.head = 0;
    this.count = 0;
    this.sumInterval = 0;
    this.sumWork = 0;
    this.sinceEval = 0;
    this.msSinceEval = 0;
    this.warmup = WARMUP_S;
    this.clean = 0;
  }

  /**
   * Feeds one frame: its rAF interval and its JS work (ms), and the real seconds it covered.
   * Ignores huge gaps (tab switches, debugger pauses).
   */
  sample(intervalMs: number, workMs: number, dtReal: number): void {
    if (!this.enabled || intervalMs > 250) return;
    this.cooldown -= dtReal;
    if (this.warmup > 0) {
      this.warmup -= dtReal;
      return;
    }
    this.sumInterval += intervalMs - (this.intervals[this.head] as number);
    this.sumWork += workMs - (this.work[this.head] as number);
    this.intervals[this.head] = intervalMs;
    this.work[this.head] = workMs;
    this.head = (this.head + 1) % WINDOW;
    if (this.count < WINDOW) this.count++;
    this.sinceEval++;
    this.msSinceEval += intervalMs;
    if (this.count < WINDOW && (this.sumInterval < MIN_SPAN_MS || this.count < MIN_SAMPLES)) return;
    if (this.sinceEval < EVAL_EVERY && this.msSinceEval < EVAL_MS) return;
    const dt = this.msSinceEval / 1000;
    this.sinceEval = 0;
    this.msSinceEval = 0;
    this.evaluate(dt);
  }

  private evaluate(dt: number): void {
    // Quantiles of the filled part of the ring (unfilled slots sort last as +∞).
    const n = this.count;
    const s = this.sorted;
    s.fill(Infinity);
    for (let i = 0; i < n; i++) s[i] = this.intervals[(this.head - n + i + WINDOW) % WINDOW] as number;
    s.sort();
    const q1 = s[Math.floor(n * 0.25)] as number;
    const med = s[Math.floor(n * 0.5)] as number;
    const q3 = s[Math.floor(n * 0.75)] as number;
    const steady = q3 - q1 <= STEADY_SPREAD * med;
    const work = this.meanWork;
    this.median = med;
    this.capped = steady && med >= CAPPED_MIN_MS && med <= CAPPED_MAX_MS;

    const late = this.capped ? work > CAPPED_WORK_SHARE * med : this.mean > LIMIT_MS;
    if (late) {
      this.clean = 0;
      if (this.cooldown <= 0 && this.level < MAX_LEVEL) this.change(1);
      return;
    }
    const smooth = steady && med <= UP_MEDIAN_MS && work <= UP_WORK_MS;
    this.clean = smooth ? this.clean + dt : 0;
    if (this.clean >= UP_AFTER_S && this.level > this.floor && this.stepsUp === 0 && this.cooldown <= 0) {
      this.stepsUp++;
      this.change(-1);
    }
  }

  private change(dir: 1 | -1): void {
    this.level += dir;
    this.cooldown = COOLDOWN_S;
    this.apply();
    this.reset();
    this.onChange?.();
  }

  /** Starts at `level` (and never steps back above it): low-end devices start at 1. */
  startAt(level: number): void {
    this.level = Math.max(0, Math.min(MAX_LEVEL, level));
    this.floor = this.level;
    this.apply();
  }

  /** Settings for the current level. */
  private apply(): void {
    const l = this.level;
    this.softShadows = l < 1;
    this.dprScale = l >= 3 ? 0.625 : l >= 2 ? 0.75 : 1;
    this.particleCap = l >= 3 ? 200 : 400;
  }
}

/** The canvas DPR for a device DPR, a cap and the governor's scale: never below 1 by scaling. */
export function canvasDpr(deviceDpr: number, cap: number, scale: number): number {
  const base = Math.min(cap, deviceDpr > 0 ? deviceDpr : 1);
  return Math.max(Math.min(1, base), base * scale);
}

export interface DeviceHints {
  /** navigator.deviceMemory (GB; Chromium only, capped at 8), or undefined. */
  memory: number | undefined;
  /** navigator.hardwareConcurrency, or undefined. */
  cores: number | undefined;
  ios: boolean;
}

/**
 * 'low' for devices that are likely to rasterize a DPR-2 canvas too slowly (TECH_SPEC §15 targets a
 * Pixel 4a / Moto G class device): ≤ 4 GB of memory or ≤ 4 cores.
 * iOS is left out (Safari reports a fixed core count, and every supported iPhone has the GPU for it).
 */
export function deviceClass(h: DeviceHints): 'low' | 'normal' {
  if (h.ios) return 'normal';
  const lowMemory = h.memory !== undefined && h.memory > 0 && h.memory <= 4;
  const fewCores = h.cores !== undefined && h.cores > 0 && h.cores <= 4;
  return lowMemory || fewCores ? 'low' : 'normal';
}

/** DPR cap for a device class (TECH_SPEC §15: DPR ≤ 2). */
export function dprCap(cls: 'low' | 'normal'): number {
  return cls === 'low' ? 1.5 : 2;
}
