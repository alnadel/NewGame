// The one object the game wires: createAudio() → ShadyAudio. It owns the engine (context,
// unlock, mix), the router (events → cues, view → scene), the music and the ambience, and the
// scheduler pump: every update() (once per frame) pumps; a watchdog timer falls back to a 25 ms
// interval only while frames stop coming. See src/audio/README.md for the per-frame and per-event
// contract.

import type { SimEvent } from '../core/sim/events.ts';
import { Ambience } from './ambience.ts';
import { AudioEngine, prewarmNoise } from './engine.ts';
import type { AudioStatus } from './engine.ts';
import { Music } from './music.ts';
import { RECIPES } from './recipes.ts';
import type { SfxName, SfxParams } from './recipes.ts';
import type { AudioView, Scene } from './scene.ts';
import { SfxRouter } from './sfxRouter.ts';

export type { AudioStatus } from './engine.ts';
export type { SfxName, SfxParams } from './recipes.ts';
export { SFX_NAMES } from './recipes.ts';
export type { AudioView, ScreenMode, SimPhase } from './scene.ts';
export { createAudioView } from './scene.ts';

/** Scheduler cadence and lookahead (archive/TECH_SPEC §10). */
const PUMP_MS = 25;
const LOOKAHEAD_S = 0.12;
/**
 * The pump watchdog: one timeout every WATCHDOG_MS checks that update() ran in the last STALE_MS;
 * if not (a stalled main thread, a hidden page whose context still runs), the 25 ms interval pump
 * takes over until update() comes back: 4 timer wake-ups a second instead of 40 while frames run.
 */
const WATCHDOG_MS = 250;
const STALE_MS = 100;
/** One-shots start this far ahead of currentTime so their attack is never cut off. */
const START_AHEAD_S = 0.01;

export interface AudioOptions {
  /** Start muted. Default: true when the page URL has `?mute=1`. */
  muted?: boolean;
  /** Initial volumes, Settings.sfx / Settings.music (0..1). Defaults 0.8 / 0.6. */
  sfx?: number;
  music?: number;
  /** Where to listen for unlock gestures (capture, passive). Default `window`; null = only ensure(). */
  unlockTarget?: EventTarget | null;
}

export interface ShadyAudio {
  /** 'locked' until the first gesture; 'running' when sound can play. */
  readonly status: AudioStatus;
  /** True when the context is running (show the HUD's muted icon while false). */
  readonly running: boolean;
  readonly muted: boolean;

  /** Create/resume the AudioContext. Call synchronously in gesture handlers (e.g. Resume). */
  ensure(): void;
  /** Settings.sfx and Settings.music, 0..1. Ambience follows the music volume. */
  setVolumes(sfx: number, music: number): void;
  setMuted(muted: boolean): void;

  /** Every SimEvent of the frame (all ticks), in order, with the current view. */
  onEvents(events: readonly SimEvent[], view: Readonly<AudioView>): void;
  /** Controls v3 (docs/CONTROLS_V3.md §7.3): one driver note (code, a): its cue (sfxRouter driveCue) or none. */
  onDrive(code: number, a: number): void;
  /** Once per rendered frame (also while paused or on menus) with real seconds elapsed. Pumps the scheduler. */
  update(view: Readonly<AudioView>, dtReal: number): void;
  /** Precomputes the noise tables (call when idle, before the first tap: e.g. requestIdleCallback). */
  prewarm(): void;
  /** New run (start or retry): clears throttles, timers and the results melody. */
  resetRun(): void;

  /** Play a cue directly: UI sounds ('uiTap', 'uiBuy', 'uiError'), 'newBest', or any other. */
  play(name: SfxName, params?: SfxParams): void;
  /** Results replay of RunResult.melody in `day`'s key; returns its length in seconds (0 if silent). */
  playMelody(degrees: readonly number[], day: number): number;
  stopMelody(): void;

  /** Called on every heartbeat beat (wire `haptics.play('heartbeat')` here). */
  onHeartbeat: ((strong: boolean) => void) | null;
  /** Subscribe to status changes (e.g. to toggle the HUD's muted icon). */
  onStatusChange(cb: (s: AudioStatus) => void): void;
  /** Debug/dev: an AnalyserNode on the final output (null until audio is unlocked). */
  meter(): AnalyserNode | null;
  dispose(): void;
}

const nowMs = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function createAudio(opts: AudioOptions = {}): ShadyAudio {
  return new ShadyAudioImpl(opts);
}

/** True when the page URL carries `?mute=1`. */
export function muteParam(): boolean {
  return typeof location !== 'undefined' && new URLSearchParams(location.search).get('mute') === '1';
}

class ShadyAudioImpl implements ShadyAudio {
  readonly #engine = new AudioEngine();
  readonly #router: SfxRouter;
  #music: Music | null = null;
  #amb: Ambience | null = null;
  /** The fallback 25 ms pump (only while update() has stopped coming) and the watchdog timeout. */
  #fallback: ReturnType<typeof setInterval> | null = null;
  #watchdog: ReturnType<typeof setTimeout> | null = null;
  #lastUpdate = Number.NEGATIVE_INFINITY;
  #disposed = false;
  #analyser: AnalyserNode | null = null;
  #sfxVolume: number;
  #musicVolume: number;
  #isMuted: boolean;
  /** Key for direct play() calls: the day of the latest view. */
  #day = 1;
  onHeartbeat: ((strong: boolean) => void) | null = null;

  constructor(opts: AudioOptions) {
    this.#sfxVolume = opts.sfx ?? 0.8;
    this.#musicVolume = opts.music ?? 0.6;
    this.#isMuted = opts.muted ?? muteParam();
    this.#router = new SfxRouter({ play: (n, p, q) => this.#start(n, p, q), applyScene: (s) => this.#applyScene(s) }, nowMs);
    this.#router.onHeartbeat = (strong) => this.onHeartbeat?.(strong);
    this.#engine.onGraph((g) => {
      g.setVolumes(this.#sfxVolume, this.#musicVolume);
      g.setMuted(this.#isMuted);
      this.#music = new Music(g);
      // Cheap: its layers are built when first wanted, not inside the unlocking gesture.
      this.#amb = new Ambience(g);
      this.#armWatchdog();
    });
    const target = opts.unlockTarget === undefined ? (typeof window === 'undefined' ? null : window) : opts.unlockTarget;
    if (target) this.#engine.attachUnlock(target);
  }

  get status(): AudioStatus {
    return this.#engine.status;
  }

  get running(): boolean {
    return this.#engine.running;
  }

  get muted(): boolean {
    return this.#isMuted;
  }

  ensure(): void {
    this.#engine.ensure();
  }

  setVolumes(sfx: number, music: number): void {
    this.#sfxVolume = sfx;
    this.#musicVolume = music;
    this.#engine.graph?.setVolumes(sfx, music);
  }

  setMuted(muted: boolean): void {
    this.#isMuted = muted;
    this.#engine.graph?.setMuted(muted);
  }

  onDrive(code: number, a: number): void {
    this.#router.onDrive(code, a);
  }

  onEvents(events: readonly SimEvent[], view: Readonly<AudioView>): void {
    this.#router.onEvents(events, view);
  }

  update(view: Readonly<AudioView>, dtReal: number): void {
    this.#day = view.day;
    this.#lastUpdate = nowMs();
    if (this.#fallback !== null) {
      clearInterval(this.#fallback);
      this.#fallback = null;
    }
    this.#router.update(view, dtReal);
    this.#pump();
  }

  prewarm(): void {
    prewarmNoise();
  }

  resetRun(): void {
    this.#router.resetRun();
    this.#music?.stopMelody();
  }

  play(name: SfxName, params: SfxParams = {}): void {
    this.#router.cue(name, params.day === undefined ? { ...params, day: this.#day } : params);
  }

  playMelody(degrees: readonly number[], day: number): number {
    return this.#music && this.#engine.running ? this.#music.playMelody(degrees, day) : 0;
  }

  stopMelody(): void {
    this.#music?.stopMelody();
  }

  onStatusChange(cb: (s: AudioStatus) => void): void {
    this.#engine.onStatus(cb);
  }

  meter(): AnalyserNode | null {
    const g = this.#engine.graph;
    if (g && !this.#analyser) {
      this.#analyser = g.ctx.createAnalyser();
      this.#analyser.fftSize = 2048;
      g.out.connect(this.#analyser);
    }
    return this.#analyser;
  }

  dispose(): void {
    this.#disposed = true;
    if (this.#fallback !== null) clearInterval(this.#fallback);
    if (this.#watchdog !== null) clearTimeout(this.#watchdog);
    this.#fallback = null;
    this.#watchdog = null;
    const g = this.#engine.graph;
    if (g && this.#amb) this.#amb.stopAll(g.now);
    this.#engine.dispose();
  }

  #armWatchdog(): void {
    if (this.#disposed || this.#watchdog !== null) return;
    this.#watchdog = setTimeout(this.#onWatchdog, WATCHDOG_MS);
  }

  readonly #onWatchdog = (): void => {
    this.#watchdog = null;
    const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
    if (this.#engine.running && this.#fallback === null && (nowMs() - this.#lastUpdate > STALE_MS || hidden)) {
      this.#fallback = setInterval(this.#pump, PUMP_MS);
    }
    this.#armWatchdog();
  };

  /**
   * Plays a recipe now or on the grid, in the key of the palette playing. Dropped while the
   * context isn't running, so nothing piles up.
   */
  #start(name: SfxName, params: SfxParams, quantize: boolean): void {
    const g = this.#engine.graph;
    if (!g || !this.#engine.running) return;
    const now = g.now + START_AHEAD_S;
    const t = quantize && this.#music ? this.#music.gridSlot(now) : now;
    RECIPES[name](g, t, this.#music && params.key === undefined ? { ...params, key: this.#music.key } : params);
  }

  /** Skipped while the context isn't running: its clock is frozen, so automation would only pile up. */
  #applyScene(scene: Readonly<Scene>): void {
    const g = this.#engine.graph;
    if (!g || !this.#music || !this.#amb || !this.#engine.running) return;
    this.#music.applyScene(scene, g.now);
    this.#amb.applyScene(scene, g.now);
  }

  readonly #pump = (): void => {
    const g = this.#engine.graph;
    if (!g || !this.#music || !this.#amb || !this.#engine.running) return;
    const now = g.now;
    this.#music.pump(now, now + LOOKAHEAD_S);
    this.#amb.pump(now, now + LOOKAHEAD_S);
  };
}
