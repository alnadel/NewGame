// What the game tells the audio layer every frame (AudioView), and the pure mapping from it to
// the targets of every continuous layer (Scene). Kept free of WebAudio so it is unit-tested.

import type { ArpVoice } from './theory.ts';
import {
  arpLevel,
  crackleRate,
  heartbeatPeriod,
  NOON_WINDOW_END,
  NOON_WINDOW_START,
  noonWindow,
  padCutoffHz,
  sizzleAmount,
  sizzleHz,
} from './theory.ts';

/** UI screen, as far as sound cares. Wardrobe, settings, daily, journey... are all 'menu'. */
export type ScreenMode = 'title' | 'play' | 'paused' | 'dying' | 'results' | 'menu';

/** SimState.phase. */
export type SimPhase = 'hold' | 'day' | 'night' | 'dead' | 'won';

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
  // Campaign (v1.3). All optional: a view without them is a plain Endless run.
  /** Journey chapter 1..20 of the level being played (picks the music palette); 0 = none. */
  chapter?: number;
  /** Progress to the finish line, 0..1 (levelProgress); −1 = no finish line. */
  progress?: number;
  /** 'gusts': the wind's turning direction this tick (SimState.sun.gust). */
  gust?: number;
  /** 'lock': the sun ignores input this tick (SimState.sun.locked). */
  locked?: boolean;
  /** 'eclipse': intensity 0..1 (SimState.eclipse). */
  eclipse?: number;
  /** 'moonlit': a moon sun; the night bed plays in daylight (SimState.moonlit). */
  moonlit?: boolean;
  /** 'fog' concept active: the score is muffled. */
  fog?: boolean;
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
    chapter: 0,
    progress: -1,
    gust: 0,
    locked: false,
    eclipse: 0,
    moonlit: false,
    fog: false,
  };
}

/** Targets for every continuous layer. Mutated in place each frame. */
export interface Scene {
  /** Day whose key the music is in, and the chapter palette (0 = default score). */
  day: number;
  palette: number;
  /** Pad level, 0..1, and its lowpass cutoff (Hz). */
  pad: number;
  padCutoff: number;
  /** Arpeggio density level: 0 = silent, 1..5 = Frost multiplier pattern. */
  arp: number;
  /** Arpeggio voice override (null = the palette's). */
  arpVoice: ArpVoice | null;
  /** Bass and shaker groove level 0..3 (theory.grooveHit). */
  groove: number;
  /** Lowpass on the whole music bus (Hz); MUFFLE_OPEN = no filtering. */
  muffle: number;
  /** Music duck factor, 1 = none. */
  duck: number;
  /** Sizzle amount min(f, 1.5); 0 = silent. Bandpass centre (Hz). Crackle grains per second. */
  sizzle: number;
  sizzleHz: number;
  crackle: number;
  /** Noon cicada, night cricket and eclipse drone levels, 0..1. */
  cicadas: number;
  crickets: number;
  drone: number;
  /** Heartbeat period (s); 0 = off. */
  heartbeat: number;
  /** The sizzle bed (and crackle) should exist: the screen is in play (built lazily, ambience.ts). */
  sizzleOn: boolean;
  /** The cicada choruses should exist: from 0.5 s before the noon window until it ends. */
  cicadasOn: boolean;
}

/** The cicada layer is built this long (s) before the noon window opens, so it fades in from 0. */
export const CICADA_LEAD_S = 0.5;

export const MUFFLE_OPEN = 18000;
/** Music-bus lowpass while paused: the score keeps breathing, but from another room. */
export const MUFFLE_PAUSED = 650;
/** Music-bus lowpass in fog, and at the height of an eclipse. */
export const MUFFLE_FOG = 1400;
export const MUFFLE_ECLIPSE = 450;
/** Below this Chill the arpeggio and groove drop out (GDD §12). */
export const ARP_MIN_CHILL = 40;
/** From this share of the level on, the "final stretch": a busier arpeggio and the full groove. */
export const FINAL_STRETCH = 0.85;

export function createScene(): Scene {
  return {
    day: 1,
    palette: 0,
    pad: 0,
    padCutoff: 400,
    arp: 0,
    arpVoice: null,
    groove: 0,
    muffle: MUFFLE_OPEN,
    duck: 1,
    sizzle: 0,
    sizzleHz: 1800,
    crackle: 0,
    cicadas: 0,
    crickets: 0,
    drone: 0,
    heartbeat: 0,
    sizzleOn: false,
    cicadasOn: false,
  };
}

/**
 * Maps a view to continuous targets.
 * - title / menu: a soft pad, a sparse music-box arpeggio and one bass note a bar (the "home" tune).
 * - play: everything. Daylight adds the multiplier arpeggio and groove (both muted below 40 Chill),
 *   sizzle while lit, noon cicadas and the heartbeat below 25 Chill; night swaps them for crickets.
 *   Campaign concepts colour it: moonlit plays the night bed by day, fog and eclipses muffle the
 *   score (an eclipse also hums a low drone), and the final stretch to a finish line lifts the beat.
 * - paused: the pad keeps playing, ducked and muffled; every tension loop stops.
 * - dying / results: the pad darkens under the death sweep and the results melody.
 */
export function sceneFor(v: Readonly<AudioView>, out: Scene): Scene {
  out.day = Math.max(1, Math.floor(v.day));
  out.palette = v.chapter ?? 0;
  out.muffle = MUFFLE_OPEN;
  out.duck = 1;
  out.arp = 0;
  out.arpVoice = null;
  out.groove = 0;
  out.sizzle = 0;
  out.sizzleHz = 1800;
  out.crackle = 0;
  out.cicadas = 0;
  out.crickets = 0;
  out.drone = 0;
  out.heartbeat = 0;
  out.sizzleOn = false;
  out.cicadasOn = false;

  const night = v.phase === 'night';
  const dayCutoff = padCutoffHz(v.eps, v.epsNoon, night);

  switch (v.screen) {
    case 'title':
    case 'menu':
      out.pad = 0.85;
      out.padCutoff = 520;
      out.arp = 1;
      out.arpVoice = 'bell';
      out.groove = 1;
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

  out.sizzleOn = true;
  if (v.phase === 'dead') {
    out.pad = 0.65;
    out.padCutoff = 380;
    return out;
  }
  if (v.phase === 'won') {
    // The finish freeze: a bright, open chord under the win jingle.
    out.pad = 0.9;
    out.padCutoff = 1800;
    return out;
  }
  out.pad = v.phase === 'hold' ? 0.85 : 1;
  out.padCutoff = dayCutoff;
  if (v.fog) out.muffle = MUFFLE_FOG;
  if (night) {
    out.crickets = 1;
    return out;
  }
  if (v.phase !== 'day') return out;

  const calm = v.chill >= ARP_MIN_CHILL;
  const final = (v.progress ?? -1) >= FINAL_STRETCH;
  const level = arpLevel(v.mult);
  out.arp = calm ? Math.min(5, level + (final ? 1 : 0)) : 0;
  out.groove = !calm ? 0 : final || level >= 4 ? 3 : level >= 2 ? 2 : 1;
  out.sizzle = sizzleAmount(v.f);
  out.sizzleHz = sizzleHz(v.f);
  out.crackle = crackleRate(v.f, v.glareW);
  out.heartbeat = heartbeatPeriod(v.chill);
  if (v.moonlit) {
    // A moon sun: crickets and a music box instead of noon cicadas, the pad kept dusky.
    out.crickets = 0.7;
    out.arpVoice = 'bell';
    out.padCutoff = Math.min(out.padCutoff, 800);
  } else if (v.dayLength > 0) {
    out.cicadas = noonWindow(v.tDay / v.dayLength) * (v.fog ? 0.5 : 1);
    out.cicadasOn = v.tDay >= NOON_WINDOW_START * v.dayLength - CICADA_LEAD_S && v.tDay <= NOON_WINDOW_END * v.dayLength;
  }
  const ecl = Math.min(1, Math.max(0, v.eclipse ?? 0));
  if (ecl > 0) {
    // The sun goes out: the score sinks under a lowpass and a drone while the beat stops.
    out.drone = ecl;
    out.muffle = Math.min(out.muffle, MUFFLE_OPEN * Math.pow(MUFFLE_ECLIPSE / MUFFLE_OPEN, ecl));
    out.pad *= 1 - 0.4 * ecl;
    if (ecl > 0.5) {
      out.arp = 0;
      out.groove = 0;
    }
  }
  return out;
}
