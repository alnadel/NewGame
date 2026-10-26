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
  /** Current UI screen, and SimState.phase of the run shown (the Title's attract run is in 'hold'). */
  screen: ScreenMode;
  phase: SimPhase;
  /** Day number, 1-based (selects the musical key). */
  day: number;
  /** Seconds into the current day's daylight (SimState.tDay), and its length Dl (s). */
  tDay: number;
  dayLength: number;
  /** Sun elevation ε and the day's εnoon (degrees). */
  eps: number;
  epsNoon: number;
  /** Nubs' lit fraction f in [0, 2] (glare counts double; 0 when another hero leads a Trial) and its glare part in [0, 1]. */
  f: number;
  glareW: number;
  /** Current Chill (GDD thresholds are absolute: 40, 25, 10) and the Frost multiplier 1..5. */
  chill: number;
  mult: number;
  /** Sun angular velocity (°/s, signed); softens detent clicks during fast spins. */
  omega: number;
  // Campaign (v1.3). All optional: a view without them is a plain Endless run.
  /** Journey chapter 1..20 of the level being played (picks the music palette); 0 = none. */
  chapter?: number;
  /** Progress to the finish line, 0..1 (levelProgress); −1 = no finish line. */
  progress?: number;
  /** SimState.sun.locked ('lock'). */
  locked?: boolean;
  /** SimState.eclipse, 0..1. */
  eclipse?: number;
  /** SimState.moonlit, and whether the 'fog' concept is active. */
  moonlit?: boolean;
  fog?: boolean;
  /** Controls v3 (§4.5): a magnet glide runs: its sun detents are silent (the session filters per tick with feelEvents instead). */
  glide?: boolean;
  /** Elementals: on a Trial the lowest health (0..100) of any body, read where Nubs' Chill is (the heartbeat, the calm arpeggio); absent elsewhere. */
  health?: number;
}

/** A neutral view (title at dawn, day 1). Handy as the session's reusable view object. */
export function createAudioView(): AudioView {
  return {
    ...{ screen: 'title', phase: 'hold', day: 1, tDay: 0, dayLength: 50, eps: 6, epsNoon: 48, f: 0, glareW: 0, chill: 100, mult: 1, omega: 0 },
    ...{ chapter: 0, progress: -1, locked: false, eclipse: 0, moonlit: false, fog: false },
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
  /** Arpeggio density (0 = silent, 1..5 = multiplier pattern), its voice override (null = palette's), groove 0..3. */
  arp: number;
  arpVoice: ArpVoice | null;
  groove: number;
  /** Lowpass on the whole score (Hz; MUFFLE_OPEN = none) and its duck factor (1 = none). */
  muffle: number;
  duck: number;
  /** Sizzle amount min(f, 1.5) (0 = silent), its bandpass centre (Hz), crackle grains per second. */
  sizzle: number;
  sizzleHz: number;
  crackle: number;
  /** Noon cicada, night cricket and eclipse drone levels, 0..1. Heartbeat period (s; 0 = off). */
  cicadas: number;
  crickets: number;
  drone: number;
  heartbeat: number;
  /** Lazy layers (ambience.ts): the sizzle bed exists while in play; the cicadas from 0.5 s before the noon window to its end. */
  sizzleOn: boolean;
  cicadasOn: boolean;
}

/** The cicada layer is built this long (s) before the noon window opens, so it fades in from 0. */
export const CICADA_LEAD_S = 0.5;

export const MUFFLE_OPEN = 18000;
/** Score lowpass while paused (the score keeps breathing, from another room), in fog, at full eclipse. */
export const MUFFLE_PAUSED = 650;
export const MUFFLE_FOG = 1400;
export const MUFFLE_ECLIPSE = 450;
/** Below this Chill the arpeggio and groove drop out (GDD §12). */
export const ARP_MIN_CHILL = 40;
/** From this share of the level on, the "final stretch": a busier arpeggio and the full groove. */
export const FINAL_STRETCH = 0.85;

/** Everything off: sceneFor starts from this. */
const QUIET = { muffle: MUFFLE_OPEN, duck: 1, arp: 0, arpVoice: null, groove: 0, sizzle: 0, sizzleHz: 1800, crackle: 0 } as const;
const STILL = { cicadas: 0, crickets: 0, drone: 0, heartbeat: 0, sizzleOn: false, cicadasOn: false } as const;
/** [pad, cutoff] off the play screen (paused keeps the day's cutoff); the dead run's darker pad. */
const SCREEN_PAD: Readonly<Record<Exclude<ScreenMode, 'play'>, readonly [number, number]>> = {
  title: [0.85, 520],
  menu: [0.85, 520],
  paused: [0.5, 0],
  dying: [0.65, 380],
  results: [0.75, 650],
};

/** A fresh scene (the Title's targets). */
export function createScene(): Scene {
  return sceneFor(createAudioView(), {} as Scene);
}

/**
 * Maps a view to continuous targets.
 * - title / menu: a soft pad, a sparse music-box arpeggio and one bass note a bar (the "home" tune).
 * - play: everything. Daylight adds the multiplier arpeggio and groove (both muted below 40 Chill),
 *   sizzle while lit, noon cicadas and the heartbeat below 25 Chill; night swaps them for crickets.
 *   Campaign concepts colour it: moonlit plays the night bed by day, fog and eclipses muffle the
 *   score (an eclipse also hums a low drone), and the final stretch to a finish line lifts the beat.
 * - paused: the pad keeps playing, ducked and muffled; every tension loop stops.
 * - dying / results: the pad darkens under the death sweep and the results melody; the finish
 *   freeze (phase won) opens it up under the win jingle.
 */
export function sceneFor(v: Readonly<AudioView>, out: Scene): Scene {
  Object.assign(out, QUIET, STILL);
  out.day = Math.max(1, Math.floor(v.day));
  out.palette = v.chapter ?? 0;
  const night = v.phase === 'night';
  out.padCutoff = padCutoffHz(v.eps, v.epsNoon, night);

  if (v.screen !== 'play') {
    const [pad, cutoff] = SCREEN_PAD[v.screen];
    out.pad = pad;
    if (cutoff > 0) out.padCutoff = cutoff;
    if (v.screen === 'paused') out.muffle = MUFFLE_PAUSED;
    else if (v.screen === 'title' || v.screen === 'menu') Object.assign(out, { arp: 1, arpVoice: 'bell', groove: 1 });
    return out;
  }
  out.sizzleOn = true;
  if (v.phase === 'dead' || v.phase === 'won') {
    out.pad = v.phase === 'won' ? 0.9 : 0.65;
    out.padCutoff = v.phase === 'won' ? 1800 : 380;
    return out;
  }
  out.pad = v.phase === 'hold' ? 0.85 : 1;
  if (v.fog) out.muffle = MUFFLE_FOG;
  if (night) out.crickets = 1;
  if (v.phase !== 'day') return out;

  const hp = v.health ?? v.chill;
  const calm = hp >= ARP_MIN_CHILL;
  const final = (v.progress ?? -1) >= FINAL_STRETCH;
  const level = arpLevel(v.mult);
  out.arp = calm ? Math.min(5, level + (final ? 1 : 0)) : 0;
  out.groove = !calm ? 0 : final || level >= 4 ? 3 : level >= 2 ? 2 : 1;
  out.sizzle = sizzleAmount(v.f);
  out.sizzleHz = sizzleHz(v.f);
  out.crackle = crackleRate(v.f, v.glareW);
  out.heartbeat = heartbeatPeriod(hp);
  if (v.moonlit) {
    // A moon sun: crickets and a music box instead of noon cicadas, the pad kept dusky.
    Object.assign(out, { crickets: 0.7, arpVoice: 'bell', padCutoff: Math.min(out.padCutoff, 800) });
  } else if (v.dayLength > 0) {
    out.cicadas = noonWindow(v.tDay / v.dayLength) * (v.fog ? 0.5 : 1);
    out.cicadasOn = v.tDay >= NOON_WINDOW_START * v.dayLength - CICADA_LEAD_S && v.tDay <= NOON_WINDOW_END * v.dayLength;
  }
  const ecl = Math.min(1, Math.max(0, v.eclipse ?? 0));
  if (ecl > 0) {
    // The sun goes out: the score sinks under a lowpass and a drone, and past halfway the beat stops.
    out.drone = ecl;
    out.muffle = Math.min(out.muffle, MUFFLE_OPEN * Math.pow(MUFFLE_ECLIPSE / MUFFLE_OPEN, ecl));
    out.pad *= 1 - 0.4 * ecl;
    if (ecl > 0.5) out.arp = out.groove = 0;
  }
  return out;
}
