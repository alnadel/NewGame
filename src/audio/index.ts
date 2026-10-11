// The one object the game wires: createAudio() → ShadyAudio. It owns the engine (context,
// unlock, mix), the router (events → cues, view → scene), the music and the ambience, and the
// 25 ms scheduler interval. See src/audio/README.md for the per-frame and per-event contract.

import type { SimEvent } from '../core/sim/events.ts';
import { Ambience } from './ambience.ts';
import { AudioEngine } from './engine.ts';
import type { AudioStatus } from './engine.ts';
import { Music } from './music.ts';
import { RECIPES } from './recipes.ts';
import type { SfxName, SfxParams } from './recipes.ts';
import type { AudioView, Scene } from './scene.ts';
import { SfxRouter } from './sfxRouter.ts';
import type { RouterOutput } from './sfxRouter.ts';

export type { AudioStatus } from './engine.ts';
export type { SfxName, SfxParams } from './recipes.ts';
export { SFX_NAMES } from './recipes.ts';
export type { AudioView, ScreenMode, SimPhase } from './scene.ts';
export { createAudioView } from './scene.ts';

/** Scheduler cadence and lookahead (TECH_SPEC §10). */
const PUMP_MS = 25;
const LOOKAHEAD_S = 0.12;
/** One-shots start this far ahead of currentTime so their attack is never cut off. */
const START_AHEAD_S = 0.01;

export interface AudioOptions {
  /** Start muted. Default: true when the page URL has `?mute=1`. */
  muted?: boolean;
  /** Initial volumes, Settings.sfx / Settings.music (0..1). Defaults 0.8 / 0.6. */
  sfx?: number;
  music?: number;
  /**
   * Where to listen for unlock gestures (pointerdown, pointerup, touchend, click, keydown;
   * capture phase, passive). Default `window`. Pass null to only unlock via ensure().
   */
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
  /** Once per rendered frame (also while paused or on menus) with real seconds elapsed. */
  update(view: Readonly<AudioView>, dtReal: number): void;
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

export function createAudio(opts: AudioOptions = {}): ShadyAudio {
  return new ShadyAudioImpl(opts);
}

/** True when the page URL carries `?mute=1`. */
export function muteParam(): boolean {
  if (typeof location === 'undefined') return false;
  return new URLSearchParams(location.search).get('mute') === '1';
}

class ShadyAudioImpl implements ShadyAudio {
  private readonly engine = new AudioEngine();
  private readonly router: SfxRouter;
  private music: Music | null = null;
  private amb: Ambience | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private analyser: AnalyserNode | null = null;
  private sfxVolume: number;
  private musicVolume: number;
  private isMuted: boolean;
  /** Key for direct play() calls: the day of the latest view. */
  private day = 1;

  constructor(opts: AudioOptions) {
    this.sfxVolume = opts.sfx ?? 0.8;
    this.musicVolume = opts.music ?? 0.6;
    this.isMuted = opts.muted ?? muteParam();
    const output: RouterOutput = {
      play: (name, params, quantize) => this.start(name, params, quantize),
      applyScene: (scene) => this.applyScene(scene),
    };
    this.router = new SfxRouter(output, () => performance.now());
    this.engine.onGraph((g) => {
      g.setVolumes(this.sfxVolume, this.musicVolume);
      g.setMuted(this.isMuted);
      this.music = new Music(g);
      this.amb = new Ambience(g);
      this.timer = setInterval(this.pump, PUMP_MS);
    });
    const target = opts.unlockTarget === undefined ? (typeof window === 'undefined' ? null : window) : opts.unlockTarget;
    if (target) this.engine.attachUnlock(target);
  }

  get status(): AudioStatus {
    return this.engine.status;
  }

  get running(): boolean {
    return this.engine.running;
  }

  get muted(): boolean {
    return this.isMuted;
  }

  get onHeartbeat(): ((strong: boolean) => void) | null {
    return this.router.onHeartbeat;
  }

  set onHeartbeat(cb: ((strong: boolean) => void) | null) {
    this.router.onHeartbeat = cb;
  }

  ensure(): void {
    this.engine.ensure();
  }

  setVolumes(sfx: number, music: number): void {
    this.sfxVolume = sfx;
    this.musicVolume = music;
    this.engine.graph?.setVolumes(sfx, music);
  }

  setMuted(muted: boolean): void {
    this.isMuted = muted;
    this.engine.graph?.setMuted(muted);
  }

  onEvents(events: readonly SimEvent[], view: Readonly<AudioView>): void {
    this.router.onEvents(events, view);
  }

  update(view: Readonly<AudioView>, dtReal: number): void {
    this.day = view.day;
    this.router.update(view, dtReal);
    this.pump();
  }

  resetRun(): void {
    this.router.resetRun();
    this.music?.stopMelody();
  }

  play(name: SfxName, params: SfxParams = {}): void {
    this.start(name, params.day === undefined ? { ...params, day: this.day } : params, false);
  }

  playMelody(degrees: readonly number[], day: number): number {
    if (!this.music || !this.engine.running) return 0;
    return this.music.playMelody(degrees, day);
  }

  stopMelody(): void {
    this.music?.stopMelody();
  }

  onStatusChange(cb: (s: AudioStatus) => void): void {
    this.engine.onStatus(cb);
  }

  meter(): AnalyserNode | null {
    const g = this.engine.graph;
    if (!g) return null;
    if (!this.analyser) {
      this.analyser = g.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      g.out.connect(this.analyser);
    }
    return this.analyser;
  }

  dispose(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.engine.dispose();
  }

  /** Plays a recipe now or on the grid. Dropped while the context isn't running, so nothing piles up. */
  private start(name: SfxName, params: SfxParams, quantize: boolean): void {
    const g = this.engine.graph;
    if (!g || !this.engine.running) return;
    const now = g.now + START_AHEAD_S;
    const t = quantize && this.music ? this.music.gridSlot(now) : now;
    RECIPES[name](g, t, params);
  }

  /** Skipped while the context isn't running: its clock is frozen, so automation would only pile up. */
  private applyScene(scene: Readonly<Scene>): void {
    const g = this.engine.graph;
    if (!g || !this.music || !this.amb || !this.engine.running) return;
    const now = g.now;
    this.music.applyScene(scene, now);
    this.amb.applyScene(scene, now);
  }

  private readonly pump = (): void => {
    const g = this.engine.graph;
    if (!g || !this.music || !this.amb || !this.engine.running) return;
    const now = g.now;
    this.music.pump(now, now + LOOKAHEAD_S);
    this.amb.pump(now, now + LOOKAHEAD_S);
  };
}
