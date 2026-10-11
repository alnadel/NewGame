// Render cadence (K8, results-static-full-redraw, render-at-full-display-rate): which rAF callbacks
// redraw the canvas. Every rAF still steps the sim, generates the world, builds the next run and
// updates hints, the UI and audio; only renderer.draw is skipped.
//
// - Menus (Settings, Daily, Missions, Wardrobe: the UI paints an opaque background over the world
//   rect): one draw on entry, and again only after a resize, a DPR or governor change, or a
//   canvas-affecting setting (high contrast, the equipped cosmetics). Nothing animates behind them.
// - Pause: at most 30 fps. The Title under reduced motion: at most 10 fps.
// - Play, dying, Results and the Title: at most 60 fps on fast displays (90/120/144 Hz), on a 60 Hz
//   timeline so a 90 Hz display still gets 60 (frames 11 and 22 ms apart) rather than 45; but every
//   rAF while a finger or a key is down (lowest latency under the thumb) or while the clock runs
//   at another rate than 1 (hit-stop, slow-mo, the lesson's slow time).
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
}

/** Frame intervals (ms) of the capped screens. */
export const FRAME_60 = 1000 / 60;
export const FRAME_PAUSE = 1000 / 30;
export const FRAME_TITLE_RM = 1000 / 10;
/**
 * A frame may come this much early on its timeline (rAF timestamps jitter by a fraction of a ms;
 * on a 120 Hz display the 60 fps slot falls every other frame either way).
 */
const SLACK_MS = 3;

export class Cadence {
  /** Timestamp of the last drawn frame (ms), −∞ before the first. */
  lastDraw = Number.NEGATIVE_INFINITY;
  /** Next slot on the capped timeline (ms). */
  private due = Number.NEGATIVE_INFINITY;
  private interval = FRAME_60;
  private lastScreen: CadenceScreen | null = null;
  /** A menu still needs its one draw (entry, resize, DPR/governor change, canvas setting). */
  private menuDirty = true;
  /** Draws so far. */
  draws = 0;

  /** The canvas must be redrawn even on a menu (resize, DPR or governor change, a canvas setting). */
  invalidate(): void {
    this.menuDirty = true;
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
      default:
        break;
    }
    if (inp.inputActive || inp.timeScale !== 1) return 0;
    return FRAME_60;
  }

  shouldDraw(inp: CadenceInput): boolean {
    const interval = Cadence.intervalFor(inp);
    this.interval = interval;
    if (inp.screen !== this.lastScreen) {
      // A new screen always draws at once (and a menu draws exactly once from here).
      this.lastScreen = inp.screen;
      this.menuDirty = true;
      this.due = Number.NEGATIVE_INFINITY;
      return true;
    }
    if (inp.screen === 'menu') return this.menuDirty;
    if (interval <= 0) return true;
    return inp.now >= this.due - SLACK_MS;
  }

  /** Call after each draw with the frame's timestamp. */
  drawn(now: number): void {
    this.draws++;
    this.lastDraw = now;
    this.menuDirty = false;
    const interval = this.interval > 0 && Number.isFinite(this.interval) ? this.interval : FRAME_60;
    // Advance the timeline by one slot; resync when more than a slot behind (slow frames, a pause
    // in the rAF stream, an uncapped stretch).
    this.due = now - this.due > interval ? now + interval : this.due + interval;
  }
}
