// Frame-time governor (TECH_SPEC §15). Quality steps down one notch at a time when frames are late —
// DPR 1 → 0.75 → 0.625 of the cap, then particles 400 → 200, then the ground detail tiles off — and
// may step back up once.
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
const MAX_LEVEL = 4;

export class Governor {
  enabled = true;
  level = 0;
  dprScale = 1;
  particleCap = 400;
  detail = true;
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
    if (this.clean >= UP_AFTER_S && this.level > 0 && this.stepsUp === 0 && this.cooldown <= 0) {
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

  /** Settings for the current level. */
  private apply(): void {
    const l = this.level;
    this.dprScale = l >= 2 ? 0.625 : l >= 1 ? 0.75 : 1;
    this.particleCap = l >= 3 ? 200 : 400;
    this.detail = l < 4;
  }
}
