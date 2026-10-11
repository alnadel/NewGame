// What the game tells the audio layer every frame (AudioView), and the pure mapping from it to
// the targets of every continuous layer (Scene). Kept free of WebAudio so it is unit-tested.

import {
  arpLevel,
  crackleRate,
  heartbeatPeriod,
  noonWindow,
  padCutoffHz,
  sizzleAmount,
  sizzleHz,
} from './theory.ts';

/** UI screen, as far as sound cares. Wardrobe, settings, daily, missions... are all 'menu'. */
export type ScreenMode = 'title' | 'play' | 'paused' | 'dying' | 'results' | 'menu';

/** SimState.phase. */
export type SimPhase = 'hold' | 'day' | 'night' | 'dead';

/**
 * Per-frame snapshot the session hands to `audio.update()` and `audio.onEvents()`. Plain numbers
 * from SimState and the UI; the audio layer never reads the sim directly. Reuse one object.
 */
export interface AudioView {
  /** Current UI screen. */
  screen: ScreenMode;
  /** SimState.phase of the run shown on screen (the title's attract run is in 'hold'). */
  phase: SimPhase;
  /** Day number, 1-based (selects the musical key). */
  day: number;
  /** Seconds into the current day's daylight (SimState.tDay). */
  tDay: number;
  /** Daylight length of the current day, Dl (s). */
  dayLength: number;
  /** Sun elevation ε (degrees). */
  eps: number;
  /** εnoon of the current day (degrees). */
  epsNoon: number;
  /** Nubs' lit fraction f in [0, 2] (glare counts double). */
  f: number;
  /** The glare part of the lit weight, in [0, 1] (SimState.nubs.glareW). */
  glareW: number;
  /** Current Chill (0..maxChill; GDD thresholds are absolute: 40, 25, 10). */
  chill: number;
  /** Frost multiplier level 1..5. */
  mult: number;
  /** Sun angular velocity (°/s, signed); softens detent clicks during fast spins. */
  omega: number;
}

/** A neutral view (title at dawn, day 1). Handy as the session's reusable view object. */
export function createAudioView(): AudioView {
  return {
    screen: 'title',
    phase: 'hold',
    day: 1,
    tDay: 0,
    dayLength: 50,
    eps: 6,
    epsNoon: 48,
    f: 0,
    glareW: 0,
    chill: 100,
    mult: 1,
    omega: 0,
  };
}

/** Targets for every continuous layer. Mutated in place each frame. */
export interface Scene {
  /** Day whose key the music is in. */
  day: number;
  /** Pad level, 0..1. */
  pad: number;
  /** Pad lowpass cutoff (Hz). */
  padCutoff: number;
  /** Arpeggio density level: 0 = silent, 1..5 = Frost multiplier pattern. */
  arp: number;
  /** Lowpass on the whole music bus (Hz); MUFFLE_OPEN = no filtering. */
  muffle: number;
  /** Music duck factor, 1 = none. */
  duck: number;
  /** Sizzle amount min(f, 1.5); 0 = silent. */
  sizzle: number;
  /** Sizzle bandpass centre (Hz). */
  sizzleHz: number;
  /** Crackle grains per second. */
  crackle: number;
  /** Noon cicada level, 0..1. */
  cicadas: number;
  /** Night cricket level, 0..1. */
  crickets: number;
  /** Heartbeat period (s); 0 = off. */
  heartbeat: number;
}

export const MUFFLE_OPEN = 18000;
/** Music-bus lowpass while paused: the score keeps breathing, but from another room. */
export const MUFFLE_PAUSED = 650;
/** Below this Chill the arpeggio drops out (GDD §12). */
export const ARP_MIN_CHILL = 40;

export function createScene(): Scene {
  return {
    day: 1,
    pad: 0,
    padCutoff: 400,
    arp: 0,
    muffle: MUFFLE_OPEN,
    duck: 1,
    sizzle: 0,
    sizzleHz: 2500,
    crackle: 0,
    cicadas: 0,
    crickets: 0,
    heartbeat: 0,
  };
}

/**
 * Maps a view to continuous targets.
 * - title / menu: a soft dawn-coloured pad only (the game's calm "home" tone).
 * - play: everything. Daylight adds the multiplier arpeggio (muted below 40 Chill), sizzle while
 *   lit, noon cicadas and the heartbeat below 25 Chill; night swaps them for crickets.
 * - paused: the pad keeps playing, ducked and muffled; every tension loop stops, so a pause is
 *   restful and resuming is seamless (no silence-to-music jolt).
 * - dying / results: the pad darkens under the death sweep and the results melody.
 */
export function sceneFor(v: Readonly<AudioView>, out: Scene): Scene {
  out.day = Math.max(1, Math.floor(v.day));
  out.muffle = MUFFLE_OPEN;
  out.duck = 1;
  out.arp = 0;
  out.sizzle = 0;
  out.sizzleHz = 2500;
  out.crackle = 0;
  out.cicadas = 0;
  out.crickets = 0;
  out.heartbeat = 0;

  const night = v.phase === 'night';
  const dayCutoff = padCutoffHz(v.eps, v.epsNoon, night);

  switch (v.screen) {
    case 'title':
    case 'menu':
      out.pad = 0.8;
      out.padCutoff = 420;
      return out;
    case 'paused':
      out.pad = 0.5;
      out.padCutoff = dayCutoff;
      out.muffle = MUFFLE_PAUSED;
      return out;
    case 'dying':
      out.pad = 0.65;
      out.padCutoff = 380;
      return out;
    case 'results':
      out.pad = 0.75;
      out.padCutoff = 650;
      return out;
    case 'play':
      break;
  }

  if (v.phase === 'dead') {
    out.pad = 0.65;
    out.padCutoff = 380;
    return out;
  }
  out.pad = v.phase === 'hold' ? 0.85 : 1;
  out.padCutoff = dayCutoff;
  if (night) {
    out.crickets = 1;
    return out;
  }
  if (v.phase !== 'day') return out;

  out.arp = v.chill >= ARP_MIN_CHILL ? arpLevel(v.mult) : 0;
  out.sizzle = sizzleAmount(v.f);
  out.sizzleHz = sizzleHz(v.f);
  out.crackle = crackleRate(v.f, v.glareW);
  out.cicadas = v.dayLength > 0 ? noonWindow(v.tDay / v.dayLength) : 0;
  out.heartbeat = heartbeatPeriod(v.chill);
  return out;
}
