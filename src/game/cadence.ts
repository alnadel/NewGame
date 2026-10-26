// Render cadence (K8, results-static-full-redraw, render-at-full-display-rate): which rAF callbacks
// redraw the canvas. Every rAF still steps the sim, generates the world, builds the next run and
// updates hints, the UI and audio; only renderer.draw is skipped.
//
// - Menus (Settings, Daily, Missions, Wardrobe: the UI paints an opaque background over the world
//   rect): one draw on entry, and again only after a resize, a DPR or governor change, or a
//   canvas-affecting setting (high contrast, the equipped cosmetics). Nothing animates behind them.
// - Pause: at most 30 fps. The Title under reduced motion: at most 10 fps. The settled Results (the
//   Melt Map has stopped moving and only the puddle ring pulses: renderer.settled): at most 20 fps.
// - Play, dying, Results and the Title: at most 60 fps on fast displays (90/120/144 Hz), on a 60 Hz
//   timeline so a 90 Hz display still gets 60 (frames 11 and 22 ms apart) rather than 45; but every
//   rAF while a finger or a key is down (lowest latency under the thumb) or while the clock runs
//   at another rate than 1 (hit-stop, slow-mo, the lesson's slow time).
// - Any screen: an invalidation (a resize, a DPR or governor change) draws the next frame, so a
//   resized canvas, whose bitmap the resize clears, is never left blank until the next slot.
//
// Pure: the caller passes the rAF timestamp and calls drawn() after each draw.

export type CadenceScreen = 'boot' | 'title' | 'play' | 'pause' | 'dying' | 'results' | 'menu';

export interface CadenceInput {
  /** rAF timestamp (ms). */
  now: number;
  screen: CadenceScreen;
  /** A pointer or a rotation key is down. */
  inputActive: boolean;
  /** The game clock's time scale (1 = normal; hit-stop 0, slow-mo, the lesson's slow time). */
  timeScale: number;
  reducedMotion: boolean;
  /** The last drawn frame was the settled Results (renderer.settled). */
  settled: boolean;
}

/** Frame intervals (ms) of the capped screens. */
export const FRAME_60 = 1000 / 60;
export const FRAME_PAUSE = 1000 / 30;
export const FRAME_TITLE_RM = 1000 / 10;
export const FRAME_SETTLED = 50;
/**
 * A frame may come this much early on its timeline (rAF timestamps jitter by a fraction of a ms;
 * on a 120 Hz display the 60 fps slot falls every other frame either way).
 */
const SLACK_MS = 3;

export class Cadence {
  /** Timestamp of the last drawn frame (ms), −∞ before the first. */
  lastDraw = Number.NEGATIVE_INFINITY;
  /** Next slot on the capped timeline (ms). */
  #due = Number.NEGATIVE_INFINITY;
  #interval = FRAME_60;
  #lastScreen: CadenceScreen | null = null;
  /** The next frame draws: a menu's one draw (entry, resize, DPR/governor change, canvas setting), a resized canvas. */
  #dirty = true;
  /** Draws so far. */
  draws = 0;

  /** The next frame draws, whatever the screen's cap (resize, DPR or governor change, a canvas setting). */
  invalidate(): void {
    this.#dirty = true;
  }

  /** Frame interval (ms) the screen is capped to; 0 = every rAF. */
  static intervalFor(inp: CadenceInput): number {
    switch (inp.screen) {
      case 'menu':
        return Number.POSITIVE_INFINITY;
      case 'pause':
        return FRAME_PAUSE;
      case 'title':
        if (inp.reducedMotion) return FRAME_TITLE_RM;
        break;
      case 'results':
        if (inp.settled) return FRAME_SETTLED;
        break;
      default:
        break;
    }
    if (inp.inputActive || inp.timeScale !== 1) return 0;
    return FRAME_60;
  }

  shouldDraw(inp: CadenceInput): boolean {
    const interval = Cadence.intervalFor(inp);
    this.#interval = interval;
    if (inp.screen !== this.#lastScreen) {
      // A new screen always draws at once (and a menu draws exactly once from here).
      this.#lastScreen = inp.screen;
      this.#dirty = true;
      this.#due = Number.NEGATIVE_INFINITY;
      return true;
    }
    if (this.#dirty) return true;
    if (inp.screen === 'menu') return false;
    if (interval <= 0) return true;
    return inp.now >= this.#due - SLACK_MS;
  }

  /** Call after each draw with the frame's timestamp. */
  drawn(now: number): void {
    this.draws++;
    this.lastDraw = now;
    this.#dirty = false;
    const interval = this.#interval > 0 && Number.isFinite(this.#interval) ? this.#interval : FRAME_60;
    // Advance the timeline by one slot when this draw kept to it (up to SLACK_MS early, under a slot
    // late); otherwise restart it from this draw: slow frames, a pause in the rAF stream, and draws
    // off the timeline (every rAF while a finger is down or slow-mo runs, an invalidated redraw).
    // Those come faster than a slot a frame on a 90-144 Hz display: a slot per draw pushed the
    // timeline ahead of the clock and held the canvas still after the finger lifted while the run
    // went on underneath.
    const late = now - this.#due;
    this.#due = this.#interval > 0 && late >= -SLACK_MS && late <= interval ? this.#due + interval : now + interval;
  }
}
