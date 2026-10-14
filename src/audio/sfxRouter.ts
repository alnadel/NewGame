// SimEvents (and campaign view edges) → sound cues, with throttles for the bursty ones and music
// ducks under the big moments, plus the per-frame drive of every continuous layer (via Scene).
// Pure logic: it talks to the WebAudio side through RouterOutput, so tests drive it with a fake.

import type { SimEvent } from '../core/sim/events.ts';
import type { SfxName, SfxParams } from './recipes.ts';
import { FINAL_STRETCH, createScene, sceneFor } from './scene.ts';
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
  gust: [1000, 1],
  /** v1.5: a growing bud's tick, and deep shade's whoom (it comes and goes at shadow edges). */
  bud: [90, 8],
  deep: [2500, 1],
} as const;

/**
 * Music ducks under the moments that must read clearly: [music level, seconds]. The day fanfare's
 * 60 % for 1 s is the GDD's; the others were set by ear-proxy in the level check (the jingle's
 * loudest 400 ms sits ≥ 8 dB over the ducked score).
 */
export const DUCKS: Readonly<Partial<Record<SfxName, readonly [number, number]>>> = {
  dayFanfare: [0.6, 1],
  noon: [0.7, 1.5],
  finishNear: [0.75, 0.6],
  levelWin: [0.4, 2.4],
  levelFail: [0.6, 1.4],
  newBest: [0.5, 2],
  snap: [0.7, 0.8],
};

/** Shade re-entry only sighs with relief after at least this much time lit (GDD §11.4). */
export const AHH_MIN_LIT_S = 0.25;
/** PHEW slow-mo (0.4× for 350 ms real): the music dips under a lowpass for the same time. */
const SLOWMO_S = 0.35;
const SLOWMO_MUFFLE_HZ = 1100;
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
  private readonly gusts = new RateLimiter(THROTTLES.gust[0], THROTTLES.gust[1]);
  private readonly buds = new RateLimiter(THROTTLES.bud[0], THROTTLES.bud[1]);
  private readonly deeps = new RateLimiter(THROTTLES.deep[0], THROTTLES.deep[1]);
  private readonly pulse = new Pulse();
  private readonly scene = createScene();
  private slowMo = 0;
  private duckLevel = 1;
  private duckLeft = 0;
  private flowers = 0;
  /** Campaign view state seen last frame (edges become cues). */
  private gust = 0;
  private locked = false;
  private eclipse = 0;
  private progress = -1;

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

  /** Plays a cue (from an event, a view edge or the game's direct play()) and applies its duck. */
  cue(name: SfxName, params: SfxParams = {}, quantize = false): void {
    this.out.play(name, params, quantize);
    const duck = DUCKS[name];
    if (!duck) return;
    this.duckLevel = Math.min(this.duckLeft > 0 ? this.duckLevel : 1, duck[0]);
    this.duckLeft = Math.max(this.duckLeft, duck[1]);
  }

  /** Once per rendered frame, with real (unscaled) seconds since the last call. */
  update(view: Readonly<AudioView>, dtReal: number): void {
    const dt = Number.isFinite(dtReal) && dtReal > 0 ? Math.min(dtReal, 0.25) : 0;
    this.edges(view);
    const scene = sceneFor(view, this.scene);
    if (this.slowMo > 0) {
      this.slowMo -= dt;
      scene.muffle = Math.min(scene.muffle, SLOWMO_MUFFLE_HZ);
    }
    if (this.duckLeft > 0) {
      this.duckLeft -= dt;
      scene.duck = Math.min(scene.duck, this.duckLevel);
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
    for (const r of [this.detents, this.melts, this.bells, this.gusts, this.buds, this.deeps]) r.reset();
    this.pulse.reset();
    this.slowMo = 0;
    this.duckLeft = 0;
    this.flowers = 0;
    this.progress = -1;
    this.gust = 0;
    this.locked = false;
    this.eclipse = 0;
  }

  /** Concept signatures from the view: a gust starting, the lock shutting or opening, an eclipse, the final stretch. */
  private edges(v: Readonly<AudioView>): void {
    const gust = v.gust ?? 0;
    const locked = v.locked ?? false;
    const eclipse = v.eclipse ?? 0;
    const progress = v.progress ?? -1;
    if (v.screen === 'play' && (v.phase === 'day' || v.phase === 'night')) {
      if (gust !== 0 && this.gust === 0 && this.gusts.tryAcquire(this.clockMs())) this.cue('gust', { index: gust });
      if (locked !== this.locked) this.cue('lock', { index: locked ? 0 : 1 });
      if (eclipse > 0 && this.eclipse === 0) this.cue('eclipse', { day: v.day });
      if (progress >= FINAL_STRETCH && this.progress >= 0 && this.progress < FINAL_STRETCH) this.cue('finishNear', { day: v.day });
    }
    this.gust = gust;
    this.locked = locked;
    this.eclipse = eclipse;
    this.progress = progress;
  }

  private route(ev: SimEvent, view: Readonly<AudioView>, now: number): void {
    const day = view.day;
    switch (ev.e) {
      case 'detent':
        if (this.detents.tryAcquire(now)) {
          const spin = Math.min(1, Math.abs(view.omega) / DETENT_SOFT_OMEGA);
          this.cue('detent', { index: ev.index, gain: 1 - 0.4 * spin });
        }
        return;
      case 'catch':
        return this.cue('catch');
      case 'flake':
        if (this.bells.tryAcquire(now)) this.cue('bell', { day, degree: ev.degree }, true);
        return;
      case 'crystal':
        return this.cue('crystal', { day });
      case 'flower':
        // Each night's flowers climb the pentatonic scale, on the grid like the flake bells.
        return this.cue('flower', { day, degree: this.flowers++ % 5 }, true);
      case 'flakeMelt':
        if (this.melts.tryAcquire(now)) this.cue('melt');
        return;
      case 'shadeEnter':
        if (ev.litFor >= AHH_MIN_LIT_S) this.cue('ahh', { day });
        return;
      case 'multUp':
        return this.cue('multUp', { day, level: ev.level });
      case 'multReset':
        if (ev.from > 1) this.cue('multReset');
        return;
      case 'phew':
        this.slowMo = SLOWMO_S;
        return this.cue('phew', { day });
      case 'noonBanner':
        return this.cue('noon', { day });
      case 'noonPassed':
        return this.cue('noonPassed', { day });
      case 'nightStart':
        this.flowers = 0;
        return this.cue('nightfall', { day: ev.day });
      case 'dawn':
        return this.cue('dayFanfare', { day: ev.day });
      case 'cloudCapture':
        return this.cue('cloud');
      case 'glareTouch':
        return this.cue('glare');
      case 'gateArch':
        return this.cue('gate', { day });
      case 'swing':
        return this.cue('swing', { day, level: ev.chain });
      case 'death':
        return this.cue('death');
      case 'levelWon':
        return ev.passed ? this.cue('levelWin', { day, level: ev.stars }) : this.cue('levelFail', { day });
      // v1.5 core mechanics.
      case 'budGrow':
        // The tick climbs the scale as the bud grows (a rising count-up to the bloom).
        if (this.buds.tryAcquire(now)) this.cue('budGrow', { day, degree: Math.round(Math.max(0, Math.min(1, ev.grow)) * 7) });
        return;
      case 'bloom':
        return this.cue('bloom', { day });
      case 'frostReady':
        return this.cue('frostReady', { day });
      case 'snap':
        return this.cue('snap', { day });
      case 'snapEnd':
        return this.cue('snapEnd', { day });
      case 'deepEnter':
        if (this.deeps.tryAcquire(now)) this.cue('deepEnter', { day });
        return;
      case 'start':
      case 'go':
      case 'shadeExit':
      case 'lowChill':
        // Carried by continuous layers: the arpeggio entering, the sizzle, the heartbeat.
        return;
      case 'hourEnd':
      case 'ballPassed':
      case 'lessonDone':
        // Bookkeeping events with no sound of their own (fx and the cue line carry lessons).
        return;
    }
  }
}
