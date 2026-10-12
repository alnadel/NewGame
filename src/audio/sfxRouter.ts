// SimEvents → sound cues, with throttles for the bursty ones, plus the per-frame drive of every
// continuous layer (via Scene). Pure logic: it talks to the WebAudio side through RouterOutput,
// so tests drive it with a recording fake.

import type { SimEvent } from '../core/sim/events.ts';
import type { SfxName, SfxParams } from './recipes.ts';
import { createScene, sceneFor } from './scene.ts';
import type { AudioView, Scene } from './scene.ts';
import { Pulse, RateLimiter } from './timing.ts';

/** Where the router sends its decisions (implemented by the audio facade). */
export interface RouterOutput {
  /** Play a one-shot now, or on the next free 16th note when `quantize` is set. */
  play(name: SfxName, params: SfxParams, quantize: boolean): void;
  /** Apply this frame's continuous targets. */
  applyScene(scene: Readonly<Scene>): void;
}

/** Throttles (archive/TECH_SPEC §10, archive/CRITIQUE #27): [min gap ms, max per second]. */
export const THROTTLES = {
  detent: [50, 20],
  melt: [0, 3],
  bell: [0, 12],
} as const;

/** Shade re-entry only sighs with relief after at least this much time lit (GDD §11.4). */
export const AHH_MIN_LIT_S = 0.25;
/** PHEW slow-mo (0.4× for 350 ms real): the music dips under a lowpass for the same time. */
const SLOWMO_S = 0.35;
const SLOWMO_MUFFLE_HZ = 1100;
/** The music bus ducks to 60% for 1 s under the day fanfare (GDD §12). */
const FANFARE_DUCK = 0.6;
const FANFARE_DUCK_S = 1;
/** Detent clicks fade toward 60% at full spin speed, so fast swings purr instead of rattle. */
const DETENT_SOFT_OMEGA = 600;

export class SfxRouter {
  /** Called on every heartbeat the router plays (wire haptics here so both stay in sync). */
  onHeartbeat: ((strong: boolean) => void) | null = null;

  private readonly out: RouterOutput;
  private readonly clockMs: () => number;
  private readonly detents = new RateLimiter(THROTTLES.detent[0], THROTTLES.detent[1]);
  private readonly melts = new RateLimiter(THROTTLES.melt[0], THROTTLES.melt[1]);
  private readonly bells = new RateLimiter(THROTTLES.bell[0], THROTTLES.bell[1]);
  private readonly pulse = new Pulse();
  private readonly scene = createScene();
  private slowMo = 0;
  private fanfare = 0;
  private flowers = 0;

  /** `clockMs` is a real-time clock in milliseconds (performance.now in the browser). */
  constructor(out: RouterOutput, clockMs: () => number) {
    this.out = out;
    this.clockMs = clockMs;
  }

  /** Feed every SimEvent emitted by the sim this frame (any number of ticks' worth). */
  onEvents(events: readonly SimEvent[], view: Readonly<AudioView>): void {
    if (events.length === 0) return;
    const now = this.clockMs();
    for (const ev of events) this.route(ev, view, now);
  }

  /** Once per rendered frame, with real (unscaled) seconds since the last call. */
  update(view: Readonly<AudioView>, dtReal: number): void {
    const dt = Number.isFinite(dtReal) && dtReal > 0 ? Math.min(dtReal, 0.25) : 0;
    const scene = sceneFor(view, this.scene);
    if (this.slowMo > 0) {
      this.slowMo -= dt;
      scene.muffle = Math.min(scene.muffle, SLOWMO_MUFFLE_HZ);
    }
    if (this.fanfare > 0) {
      this.fanfare -= dt;
      scene.duck = Math.min(scene.duck, FANFARE_DUCK);
    }
    this.out.applyScene(scene);
    if (this.pulse.tick(dt, scene.heartbeat)) {
      const strong = view.chill < 10;
      this.out.play('heartbeat', { strong }, false);
      this.onHeartbeat?.(strong);
    }
  }

  /** New run (start or retry): forget throttles, timers and per-run counters. */
  resetRun(): void {
    this.detents.reset();
    this.melts.reset();
    this.bells.reset();
    this.pulse.reset();
    this.slowMo = 0;
    this.fanfare = 0;
    this.flowers = 0;
  }

  private route(ev: SimEvent, view: Readonly<AudioView>, now: number): void {
    const day = view.day;
    switch (ev.e) {
      case 'detent':
        if (this.detents.tryAcquire(now)) {
          const spin = Math.min(1, Math.abs(view.omega) / DETENT_SOFT_OMEGA);
          this.out.play('detent', { index: ev.index, gain: 1 - 0.4 * spin }, false);
        }
        return;
      case 'catch':
        this.out.play('catch', {}, false);
        return;
      case 'flake':
        if (this.bells.tryAcquire(now)) this.out.play('bell', { day, degree: ev.degree }, true);
        return;
      case 'crystal':
        this.out.play('crystal', { day }, false);
        return;
      case 'flower':
        // Each night's flowers climb the pentatonic scale, on the grid like the flake bells.
        this.out.play('flower', { day, degree: this.flowers++ % 5 }, true);
        return;
      case 'flakeMelt':
        if (this.melts.tryAcquire(now)) this.out.play('melt', {}, false);
        return;
      case 'shadeEnter':
        if (ev.litFor >= AHH_MIN_LIT_S) this.out.play('ahh', { day }, false);
        return;
      case 'multUp':
        this.out.play('multUp', { day, level: ev.level }, false);
        return;
      case 'multReset':
        if (ev.from > 1) this.out.play('multReset', {}, false);
        return;
      case 'phew':
        this.out.play('phew', { day }, false);
        this.slowMo = SLOWMO_S;
        return;
      case 'noonBanner':
        this.out.play('noon', { day }, false);
        return;
      case 'noonPassed':
        this.out.play('noonPassed', { day }, false);
        return;
      case 'nightStart':
        this.out.play('nightfall', { day: ev.day }, false);
        this.flowers = 0;
        return;
      case 'dawn':
        this.out.play('dayFanfare', { day: ev.day }, false);
        this.fanfare = FANFARE_DUCK_S;
        return;
      case 'cloudCapture':
        this.out.play('cloud', {}, false);
        return;
      case 'glareTouch':
        this.out.play('glare', {}, false);
        return;
      case 'death':
        this.out.play('death', {}, false);
        return;
      case 'start':
      case 'go':
      case 'shadeExit':
      case 'lowChill':
        // Carried by continuous layers: the arpeggio entering, the sizzle, the heartbeat.
        return;
      case 'hourEnd':
      case 'gateArch':
      case 'ballPassed':
        // Bookkeeping events with no sound of their own.
        return;
      case 'swing':
      case 'lessonDone':
        // v1.1 has no audio work: fx, haptics and the cue line carry these.
        return;
    }
  }
}
