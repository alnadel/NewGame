// Simulation state and its inputs (V1_PLAN §3.1). Everything here is advanced only by step(); the
// renderer and session read it and never write it.

import type { DayParams, ProfileId } from '../../config/days.ts';
import type { World } from '../gen/store.ts';
import type { DeathInfo, HourGlyph, RunMode, RunStats, SimEvent } from './events.ts';

/** One 60 Hz tick of player input, produced by src/game/input.ts (V1_PLAN §3.1). */
export interface InputFrame {
  /** Degrees requested this tick, sign/sensitivity applied, quantized to 1/1024°. */
  dTheta: number;
  /** A pointer is held during this tick (after downEdge/upEdge are applied). */
  down: boolean;
  /** A pointer went down this tick (catch). */
  downEdge: boolean;
  /** The pointer went up this tick (release). */
  upEdge: boolean;
  /** Release angular velocity °/s on the upEdge tick, quantized to 1/64 °/s; 0 otherwise. */
  release: number;
  /** Keyboard: +1 = counter-clockwise (Left/A), −1 = clockwise (Right/D). */
  key: -1 | 0 | 1;
}

/** A frame with no input. */
export const NO_INPUT: Readonly<InputFrame> = Object.freeze({
  dTheta: 0,
  down: false,
  downEdge: false,
  upEdge: false,
  release: 0,
  key: 0,
});

export interface RunConfig {
  /** World seed (uint32). */
  seed: number;
  mode: RunMode;
  /** Onboarding profile (V1_PLAN §6); daily and challenge runs use 3. */
  profile: ProfileId;
  /** Use the authored tutorial chunk (normally profile 0). */
  tutorial: boolean;
  /** Sun follow 300°/s and inertia cap 180°/s. */
  reducedMotion: boolean;
  /** Debug: start at this day (default 1)… */
  startDay?: number;
  /** …and this many seconds after its dawn (default 0). */
  startT?: number;
  /** Debug: starting Chill (default max). */
  startChill?: number;
  /** Daily runs: the local date, YYYY-MM-DD. */
  dailyDate?: string;
}

/**
 * hold: before the first touch (clock, Nubs and Chill frozen); day/night: running (the first
 * `ready` ticks of 'day' are the start beat: the sun moves, everything else waits); dead: Chill hit 0
 * in daylight (step() is then a no-op).
 */
export type Phase = 'hold' | 'day' | 'night' | 'dead';

export type SunMode = 'idle' | 'dragging' | 'chasing' | 'coasting';

export interface SunState {
  /** Azimuth θ in [0, 360): 0 east, 90 north, counter-clockwise positive. Light comes from θ. */
  theta: number;
  /** Finger target minus θ, unwrapped (°). The target is wrapDeg(theta + lag). */
  lag: number;
  /** Coasting angular velocity (°/s). */
  omega: number;
  /** Release velocity stored while chasing the remaining lag (°/s). */
  omegaRel: number;
  mode: SunMode;
  /** floor(θ / 15): the current detent. */
  detent: number;
  /** Signed θ change applied this tick (°). */
  dTheta: number;
}

export interface NubsState {
  x: number;
  y: number;
  chill: number;
  maxChill: number;
  /** Lit weight per coverage sample (0 shaded, 1 lit, 2 glare), order SAMPLE_DX/DY: C, E, W, N, S. */
  readonly w: Float64Array;
  /** Mean lit weight Σw/5 ∈ [0, 2]. 0 = fully shaded. */
  f: number;
  /** Samples inside a glare spot (0..5). */
  glare: number;
  /** Frost multiplier ×1..×5 and its timers (ticks). */
  mult: number;
  shadeTicks: number;
  litTicks: number;
  x5Ticks: number;
  /** PHEW latch (open = may fire) and the last tick Chill was ≥ 40. */
  phewOpen: boolean;
  highChillTick: number;
  /** Tick at which the current lit streak began (−1 while fully shaded). */
  litSince: number;
  /** Caster shading the center sample this tick (−1 none) and the most recent one (for the death line). */
  shaderId: number;
  lastShaderId: number;
  lastShaderName: string;
  lastShaderTick: number;
  /** Cloud fully covering all 5 samples this tick (−1 none), the one ridden last tick, ride length (ticks). */
  cloudId: number;
  rideId: number;
  rideTicks: number;
  /** Ball whose glare touches Nubs this tick, and last tick (−1 none). */
  glareBallId: number;
  prevGlareBallId: number;
}

export interface GuideState {
  /** 1 where θ = b° fully shades Nubs now with no glare (strict), from the last guide update. */
  readonly now: Uint8Array;
  /** Same 0.6 s ahead (position, elevation and clouds then). */
  readonly next: Uint8Array;
  /** 1 where some sample would be in glare now. Always shown. */
  readonly glare: Uint8Array;
  /** Lit counts now, 0..10 per bin (f = lit / 5). */
  readonly lit: Uint8Array;
  /** Sim tick of the last update (updates every 6 ticks on the absolute step grid). */
  tick: number;
  /** False at night (no sun): masks are all 0. */
  sunUp: boolean;
}

export interface SimState {
  readonly cfg: RunConfig;
  /** Parameters of the current day (profile applied). */
  params: DayParams;
  phase: Phase;
  /** Sim ticks since the run started (hold excluded; the start beat counts). */
  tick: number;
  /**
   * Start-beat ticks left (TUNING.start.readyTicks after the first touch, then 0). While > 0 the
   * sun follows the input and coverage is live, but the clock, Nubs' walk, Chill, the multiplier
   * and pickups wait.
   */
  ready: number;
  day: number;
  /** Ticks since the current day's dawn (daylight then night). */
  dayTick: number;
  /** Seconds since dawn: dayTick / 60. */
  tDay: number;
  /** Absolute ticks/seconds since Day 1 dawn (clouds use tAbs). */
  tickAbs: number;
  tAbs: number;
  /** Score in in-game minutes: (day − 1)·720 + floor(720·t/Dl). */
  minutes: number;
  /** Sun elevation ε (°), tan ε and cot ε; sunUp false at night (then all three are 0). */
  eps: number;
  tanEps: number;
  cot: number;
  sunUp: boolean;
  /** Sun vector u = (cos θ, sin θ), pointing toward the sun. */
  ux: number;
  uy: number;
  /** Initial azimuth (toward the start hut). */
  readonly theta0: number;
  readonly sun: SunState;
  readonly nubs: NubsState;
  readonly guide: GuideState;
  readonly world: World;
  readonly stats: RunStats;
  /** One glyph array per day reached (V1_PLAN §5.5). */
  readonly hourGlyphs: HourGlyph[][];
  /** Lit seconds (∫f dt) and the "Chill < 25" flag of the current in-game hour. */
  hourLit: number;
  hourHot: boolean;
  /** Melt Map ring: (x, y, chill, f) every 20 u of y; historyCount entries pushed in total. */
  readonly history: Float64Array;
  historyCount: number;
  nextHistoryY: number;
  /** Death-cause ring per tick: (θ, Σw, glare weight, glare ball id); recentCount ticks pushed. */
  readonly recent: Float64Array;
  recentCount: number;
  /** Events of the last step (cleared at the start of each step). */
  readonly events: SimEvent[];
  death: DeathInfo | null;
  /** Flakes collected today (bell pitch). */
  flakesToday: number;
  /** Clouds that already fired cloudCapture, balls that glared Nubs. */
  readonly captured: Set<number>;
  readonly glaredBalls: Set<number>;
}
