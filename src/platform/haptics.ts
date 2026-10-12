// Haptics (GDD §13, V1_PLAN §12.2, archive/TECH_SPEC §11): named vibration patterns behind a small
// interface, with the gating rules that keep phones from buzzing continuously:
// - no new pattern within 40 ms of the last one (the heartbeat is exempt); important patterns
//   landing inside the gap are deferred to its end instead of being lost;
// - sun detents vibrate only on 45° boundaries, at most 8 per second and ≥ 50 ms apart, and
//   never while the sun spins faster than 300°/s (the click sound and dial tick still mark
//   every 15°).
// The web backend wraps navigator.vibrate (absent on iOS Safari, so it falls back to Null).

import type { SimEvent } from '../core/sim/events.ts';

export type HapticName =
  | 'detent'
  | 'catch'
  | 'flake'
  | 'crystal'
  | 'shade'
  | 'multUp'
  | 'multMax'
  | 'phew'
  | 'glare'
  | 'heartbeat'
  | 'death'
  | 'day'
  | 'best'
  | 'ui'
  | 'tick';

/** A single pulse (ms) or an on/off/on... sequence (ms). */
export type HapticPattern = number | readonly number[];

/** GDD §13. */
export const HAPTIC_PATTERNS: Readonly<Record<HapticName, HapticPattern>> = {
  detent: 5,
  catch: 8,
  flake: 6,
  crystal: [10, 30, 10],
  shade: 8,
  multUp: [8, 40, 8],
  multMax: [10, 30, 10, 30, 20],
  phew: [10, 40, 10],
  glare: 15,
  heartbeat: [12, 110, 8],
  death: [30, 60, 80],
  day: [20, 80, 20],
  best: [15, 40, 15, 40, 40],
  ui: 4,
  tick: 6,
};

export const HAPTIC_RULES = {
  /** No new pattern within this many ms of the previous one (heartbeat exempt). */
  gapMs: 40,
  detentMinGapMs: 50,
  detentPerSecond: 8,
  /** No detent haptics while |ω| exceeds this (°/s). */
  detentMaxOmega: 300,
  /** Detent haptics only on multiples of this angle. */
  detentEveryDeg: 45,
  /** Shade re-entry only buzzes after at least this long lit (s), matching the "ahh". */
  shadeMinLit: 0.25,
  /** A SWING ticks at most this often (ms). */
  tickMinGapMs: 300,
} as const;

/**
 * Patterns that wait out the global gap instead of being dropped, ranked: when two are waiting,
 * the higher rank wins. Everything else is a light tick that is simply skipped inside the gap.
 */
const DEFER_RANK: Readonly<Partial<Record<HapticName, number>>> = {
  multUp: 1,
  crystal: 2,
  multMax: 3,
  phew: 4,
  day: 5,
  best: 6,
  death: 7,
};

const DETENT_STEP = 15;

/**
 * True if a detent crossing lands on a 45° boundary. `index` is the detent bucket after the
 * crossing (floor(θ/15)) and `dir` the direction of travel, so the boundary crossed is
 * `index` when moving up (+1) and `index + 1` when moving down (−1).
 */
export function isDetentHapticStep(index: number, dir: 1 | -1): boolean {
  const boundary = dir > 0 ? index : index + 1;
  const every = HAPTIC_RULES.detentEveryDeg / DETENT_STEP;
  return ((boundary % every) + every) % every === 0;
}

/** The haptic a SimEvent asks for, or null. Detents still need detent() gating (see onEvents). */
export function hapticForEvent(ev: SimEvent): HapticName | null {
  switch (ev.e) {
    case 'detent':
      return 'detent';
    case 'catch':
      return 'catch';
    case 'flake':
      return 'flake';
    case 'crystal':
      return 'crystal';
    case 'shadeEnter':
      return ev.litFor >= HAPTIC_RULES.shadeMinLit ? 'shade' : null;
    case 'multUp':
      return ev.level >= 5 ? 'multMax' : 'multUp';
    case 'phew':
      return 'phew';
    case 'glareTouch':
      return 'glare';
    case 'death':
      return 'death';
    case 'dawn':
      return 'day';
    case 'swing':
      return 'tick';
    default:
      // 'lowChill' is carried by the repeating heartbeat (audio.onHeartbeat → play('heartbeat'));
      // the rest have no haptic. 'best' and 'ui' are played by the UI directly.
      return null;
  }
}

export interface Haptics {
  /** False where the platform can't vibrate (e.g. iOS Safari). */
  readonly supported: boolean;
  /** The user setting (Settings.haptics). */
  readonly enabled: boolean;
  setEnabled(on: boolean): void;
  /** Plays a named pattern, subject to the global gap. */
  play(name: HapticName): void;
  /** A sun detent crossing: index = floor(θ/15) after it, dir = ±1, omega = sun speed (°/s). */
  detent(index: number, dir: 1 | -1, omega: number): void;
  /** Forwards a frame's SimEvents; `omega` is the sun's current angular velocity (°/s). */
  onEvents(events: readonly SimEvent[], omega: number): void;
}

/** What the gated player needs from the platform; injectable for tests. */
export interface VibrateBackend {
  vibrate(pattern: number | number[]): void;
  /** False until the browser accepts vibrate() (Chrome needs a first user tap). */
  ready(): boolean;
}

export interface WebVibrateOptions {
  enabled?: boolean;
  /** Defaults to navigator.vibrate; null when unavailable. */
  backend?: VibrateBackend | null;
  /** Millisecond clock; defaults to performance.now. */
  now?: () => number;
  /** Timer used to replay a deferred pattern; defaults to setTimeout. */
  schedule?: (fn: () => void, ms: number) => void;
}

interface UserActivationLike {
  readonly hasBeenActive: boolean;
}

/** navigator.vibrate as a backend, or null where it doesn't exist. */
export function webVibrateBackend(): VibrateBackend | null {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return null;
  const nav = navigator as Navigator & { userActivation?: UserActivationLike };
  return {
    vibrate(pattern) {
      try {
        nav.vibrate(pattern);
      } catch {
        /* Some WebViews throw instead of returning false; haptics are never essential. */
      }
    },
    ready: () => !nav.userActivation || nav.userActivation.hasBeenActive,
  };
}

export class WebVibrateHaptics implements Haptics {
  readonly supported: boolean;
  private on: boolean;
  private readonly backend: VibrateBackend | null;
  private readonly now: () => number;
  private readonly schedule: (fn: () => void, ms: number) => void;
  /** Start time of the last pattern played (ms). */
  private last = Number.NEGATIVE_INFINITY;
  private pending: HapticName | null = null;
  private timerArmed = false;
  /** Start times of the most recent detent pulses (ring of detentPerSecond). */
  private readonly detentTimes = new Float64Array(HAPTIC_RULES.detentPerSecond).fill(Number.NEGATIVE_INFINITY);
  private detentHead = 0;
  /** Start time of the last SWING tick (ms). */
  private lastTick = Number.NEGATIVE_INFINITY;

  constructor(opts: WebVibrateOptions = {}) {
    this.backend = opts.backend === undefined ? webVibrateBackend() : opts.backend;
    this.supported = this.backend !== null;
    this.on = opts.enabled ?? true;
    this.now = opts.now ?? (() => performance.now());
    this.schedule = opts.schedule ?? ((fn, ms) => void setTimeout(fn, ms));
  }

  get enabled(): boolean {
    return this.on;
  }

  setEnabled(on: boolean): void {
    this.on = on;
    if (!on) this.pending = null;
  }

  play(name: HapticName): void {
    if (!this.active()) return;
    const now = this.now();
    if (name === 'heartbeat') {
      this.fire(name, now);
      return;
    }
    const wait = this.last + HAPTIC_RULES.gapMs - now;
    if (wait <= 0) {
      this.fire(name, now);
      return;
    }
    const rank = DEFER_RANK[name];
    if (rank === undefined) return;
    const pendingRank = this.pending === null ? 0 : (DEFER_RANK[this.pending] ?? 0);
    if (rank < pendingRank) return;
    this.pending = name;
    if (!this.timerArmed) {
      this.timerArmed = true;
      this.schedule(this.flush, wait);
    }
  }

  detent(index: number, dir: 1 | -1, omega: number): void {
    if (!this.active()) return;
    if (Math.abs(omega) > HAPTIC_RULES.detentMaxOmega) return;
    if (!isDetentHapticStep(index, dir)) return;
    const now = this.now();
    if (now - this.last < HAPTIC_RULES.gapMs) return;
    const newest = this.detentTimes[(this.detentHead + this.detentTimes.length - 1) % this.detentTimes.length] as number;
    const oldest = this.detentTimes[this.detentHead] as number;
    if (now - newest < HAPTIC_RULES.detentMinGapMs || now - oldest < 1000) return;
    this.detentTimes[this.detentHead] = now;
    this.detentHead = (this.detentHead + 1) % this.detentTimes.length;
    this.fire('detent', now);
  }

  onEvents(events: readonly SimEvent[], omega: number): void {
    if (!this.on) return;
    for (const ev of events) {
      if (ev.e === 'detent') {
        this.detent(ev.index, ev.dir, omega);
        continue;
      }
      const name = hapticForEvent(ev);
      if (name === 'tick') {
        const now = this.now();
        if (now - this.lastTick < HAPTIC_RULES.tickMinGapMs) continue;
        this.lastTick = now;
      }
      if (name) this.play(name);
    }
  }

  private active(): boolean {
    return this.on && this.backend !== null && this.backend.ready();
  }

  private fire(name: HapticName, now: number): void {
    const p = HAPTIC_PATTERNS[name];
    this.backend?.vibrate(typeof p === 'number' ? p : p.slice());
    this.last = now;
  }

  private readonly flush = (): void => {
    this.timerArmed = false;
    const name = this.pending;
    this.pending = null;
    if (name) this.play(name);
  };
}

/** For platforms without vibration (iOS Safari): everything is a no-op. */
export class NullHaptics implements Haptics {
  readonly supported = false;
  private on: boolean;

  constructor(enabled = true) {
    this.on = enabled;
  }

  get enabled(): boolean {
    return this.on;
  }

  setEnabled(on: boolean): void {
    this.on = on;
  }

  play(): void {}

  detent(): void {}

  onEvents(): void {}
}

/** The best Haptics for this platform: WebVibrateHaptics where navigator.vibrate exists, else Null. */
export function createHaptics(enabled: boolean): Haptics {
  const backend = webVibrateBackend();
  return backend ? new WebVibrateHaptics({ enabled, backend }) : new NullHaptics(enabled);
}
