// One function per sound (GDD §12, plus a few UI and moment cues). Every recipe builds a fresh
// Voice on a bus at time `t`, so the voice limiter can steal it and its nodes disconnect when it
// ends. Envelopes start and end at GAIN_FLOOR (never 0) and sources stop just after the floor.
//
// Shapes and pitches follow the GDD. Levels were then balanced against the score with the audio
// lab's "Level check" (README: "Deliberate deviations"), which renders each recipe through the real
// mix chain and reports peaks; retune there rather than by guesswork.

import { GAIN_FLOOR, ahr, glide, perc } from './engine.ts';
import type { AudioGraph, Voice } from './engine.ts';
import { bellDegree, degreeHz, detentHz, keyRootHz, multUpNotes, semis } from './theory.ts';

export type SfxName =
  | 'detent'
  | 'catch'
  | 'ahh'
  | 'bell'
  | 'crystal'
  | 'flower'
  | 'melt'
  | 'multUp'
  | 'multReset'
  | 'phew'
  | 'glare'
  | 'cloud'
  | 'death'
  | 'noon'
  | 'noonPassed'
  | 'nightfall'
  | 'dayFanfare'
  | 'newBest'
  | 'heartbeat'
  | 'uiTap'
  | 'uiBuy'
  | 'uiError';

export interface SfxParams {
  /** Day whose key tonal cues use (default 1 = C). */
  day?: number;
  /** Pentatonic degree: 0..9 for bells, 0..4 for flowers. */
  degree?: number;
  /** Multiplier level for multUp (2..5). */
  level?: number;
  /** Detent index (selects the click's pitch step). */
  index?: number;
  /** Extra level factor, 0..1 (default 1). */
  gain?: number;
  /** Heartbeat: the harder beat used below 10 Chill. */
  strong?: boolean;
}

export type Recipe = (g: AudioGraph, t: number, p: SfxParams) => void;

/** Inharmonic partials of a free bar (ratio, relative gain): what makes a sine sound like a bell. */
const BELL_PARTIALS: readonly (readonly [number, number])[] = [
  [2.756, 0.35],
  [5.404, 0.12],
];
/** Partials above this are skipped so high bells stay sweet instead of piercing. */
const MAX_PARTIAL_HZ = 9000;

/**
 * A struck bell: sine fundamental plus bar partials, 2 ms attack. `decay` applies to the
 * fundamental and `partialDecay` to the partials, so the tone mellows as it rings.
 */
export function bellTone(v: Voice, t: number, freq: number, peak: number, decay: number, partialDecay: number, dest: AudioNode = v.out): void {
  v.tone('sine', freq, t, peak, 0.002, decay, dest);
  for (const [ratio, rel] of BELL_PARTIALS) {
    if (freq * ratio > MAX_PARTIAL_HZ) continue;
    v.tone('sine', freq * ratio, t, peak * rel, 0.002, partialDecay, dest);
  }
}

/** Triangle + sine pluck, the fanfare voice. */
function pluck(v: Voice, t: number, freq: number, peak: number, decay: number): void {
  v.tone('triangle', freq, t, peak * 0.55, 0.003, decay);
  v.tone('sine', freq, t, peak * 0.45, 0.003, decay * 1.2);
}

/** Root-third-fifth-octave arpeggio, 90 ms apart; the last note rings longer. */
function fanfare(v: Voice, t: number, root: number, peak: number): number {
  const steps = [0, 4, 7, 12];
  steps.forEach((s, i) => pluck(v, t + i * 0.09, root * semis(s), peak, i === steps.length - 1 ? 0.9 : 0.4));
  return t + steps.length * 0.09;
}

/** One heart sound: a falling low sine, its octave (so phone speakers can carry it) and a soft knock. */
function thump(v: Voice, noise: AudioBuffer, t: number, peak: number, dur: number): void {
  const body = v.tone('sine', 62, t, peak, 0.006, dur);
  glide(body.frequency, t, 62, 48, dur);
  const octave = v.tone('sine', 124, t, peak * 0.3, 0.006, dur * 0.8);
  glide(octave.frequency, t, 124, 96, dur);
  const knock = v.filter('lowpass', 320, 0.7);
  v.burst(noise, t, peak * 0.25, 0.002, 0.03, knock);
}

function tonic5(p: SfxParams): number {
  return degreeHz(p.day ?? 1, 0, 5);
}

export const RECIPES: Readonly<Record<SfxName, Recipe>> = {
  /** Sun detent: a tiny triangle tick on a five-step pitch ladder plus a 6 ms air burst. */
  detent(g, t, p) {
    const v = g.voice('sfx', t);
    const k = p.gain ?? 1;
    v.tone('triangle', detentHz(p.index ?? 0), t, 0.1 * k, 0.001, 0.03);
    v.burst(g.white, t, 0.05 * k, 0.0005, 0.0055, v.filter('highpass', 3000, 0.7));
  },

  /** Catching a coasting sun: a dull lowpassed knock with a short falling 110 Hz body. */
  catch(g, t) {
    const v = g.voice('sfx', t);
    v.burst(g.white, t, 0.24, 0.002, 0.088, v.filter('lowpass', 400, 0.9));
    const body = v.tone('sine', 120, t, 0.2, 0.003, 0.06);
    glide(body.frequency, t, 125, 100, 0.06);
    const octave = v.tone('sine', 240, t, 0.05, 0.003, 0.05);
    glide(octave.frequency, t, 250, 200, 0.05);
  },

  /** Shade re-entry: root + fifth (octave 5) with a 5 Hz ±3 cent vibrato and a breath of air. */
  ahh(g, t, p) {
    const v = g.voice('sfx', t);
    const root = tonic5(p);
    const end = t + 0.015 + 0.5;
    const vibrato = v.gain(3, null);
    v.osc('sine', 5, t, end, vibrato);
    for (const f of [root, root * semis(7)]) {
      const env = v.gain(GAIN_FLOOR);
      ahr(env.gain, t, 0.08, 0.015, 0.04, 0.45);
      const o = v.osc('sine', f, t, end, env);
      vibrato.connect(o.detune);
    }
    // A whisper of "haah": pink noise through a vowel-ish formant, far below the tones.
    v.burst(g.pink, t, 0.02, 0.02, 0.3, v.filter('bandpass', 900, 2.5));
  },

  /** Flake pickup: pentatonic bell, degree 0..9 over octaves 5-6, panned gently by pitch. */
  bell(g, t, p) {
    const v = g.voice('sfx', t);
    const d = bellDegree(p.degree ?? 0);
    // 0.18 rather than the GDD's 0.12: the core reward has to ring clearly over the score.
    bellTone(v, t, degreeHz(p.day ?? 1, d, 5), 0.18 * (p.gain ?? 1), 0.9, 0.35, v.panner((d / 9 - 0.5) * 0.5));
  },

  /** Ice crystal: a bell triad rolled 40 ms apart, then a quiet octave sparkle. */
  crystal(g, t, p) {
    const v = g.voice('sfx', t);
    const root = tonic5(p);
    [0, 4, 7].forEach((s, i) => bellTone(v, t + i * 0.04, root * semis(s), 0.1, 1.2, 0.45, v.panner(-0.25 + 0.25 * i)));
    bellTone(v, t + 0.12, root * 2, 0.045, 1.0, 0.3);
  },

  /** Night frost flower: a soft music-box note (sine + 3.0× partial). */
  flower(g, t, p) {
    const v = g.voice('sfx', t);
    const f = degreeHz(p.day ?? 1, (p.degree ?? 0) % 5, 5);
    v.tone('sine', f, t, 0.09, 0.003, 0.7);
    v.tone('sine', f * 3, t, 0.022, 0.003, 0.25);
  },

  /** Flake melting: a 120 ms "tss" of highpassed noise. */
  melt(g, t) {
    const v = g.voice('sfx', t);
    const band = v.filter('highpass', 5000, 0.7, v.filter('lowpass', 9000, 0.7));
    v.burst(g.white, t, 0.09, 0.004, 0.116, band);
  },

  /** Multiplier up: two triangle notes 70 ms apart, climbing with the level; ×5 rolls a full arpeggio. */
  multUp(g, t, p) {
    const v = g.voice('sfx', t);
    const root = tonic5(p);
    multUpNotes(p.level ?? 2).forEach((s, i) => v.tone('triangle', root * semis(s), t + i * 0.07, 0.12, 0.003, 0.2));
  },

  /** Multiplier reset: a soft square blip sliding 330 → 220 Hz through a 1.2 kHz lowpass. */
  multReset(g, t) {
    const v = g.voice('sfx', t);
    const env = v.gain(GAIN_FLOOR, v.filter('lowpass', 1200, 0.7));
    const end = ahr(env.gain, t, 0.05, 0.004, 0.09, 0.08);
    const o = v.osc('square', 330, t, end, env);
    glide(o.frequency, t, 330, 220, 0.12);
  },

  /** PHEW: a sine whooping 400 → 900 Hz, landing on a bell at the octave-6 tonic. */
  phew(g, t, p) {
    const v = g.voice('sfx', t);
    const env = v.gain(GAIN_FLOOR);
    const end = ahr(env.gain, t, 0.1, 0.01, 0.15, 0.12);
    const o = v.osc('sine', 400, t, end, env);
    glide(o.frequency, t, 400, 900, 0.18);
    bellTone(v, t + 0.16, tonic5(p) * 2, 0.1, 0.9, 0.35);
  },

  /** Glare touch: a falling sawtooth buzz plus a band of noise at 1.2 kHz. */
  glare(g, t) {
    const v = g.voice('sfx', t);
    const env = v.gain(GAIN_FLOOR, v.filter('lowpass', 2400, 0.7));
    const end = perc(env.gain, t, 0.16, 0.002, 0.148);
    const saw = v.osc('sawtooth', 180, t, end, env);
    glide(saw.frequency, t, 180, 120, 0.15);
    v.burst(g.white, t, 0.16, 0.002, 0.148, v.filter('bandpass', 1200, 1.4));
  },

  /** Cloud capture: pink noise through a lowpass sweeping 300 → 1800 → 300 Hz, drifting left to right. */
  cloud(g, t) {
    const v = g.voice('sfx', t);
    const pan = v.panner(-0.5);
    if (pan.pan) {
      pan.pan.setValueAtTime(-0.5, t);
      pan.pan.linearRampToValueAtTime(0.5, t + 0.7);
    }
    const env = v.gain(GAIN_FLOOR, pan);
    env.gain.setValueAtTime(GAIN_FLOOR, t);
    env.gain.linearRampToValueAtTime(0.2, t + 0.25);
    env.gain.exponentialRampToValueAtTime(GAIN_FLOOR, t + 0.7);
    const lp = v.filter('lowpass', 300, 1, env);
    lp.frequency.setValueAtTime(300, t);
    lp.frequency.exponentialRampToValueAtTime(1800, t + 0.25);
    lp.frequency.exponentialRampToValueAtTime(300, t + 0.7);
    v.noise(g.pink, t, t + 0.7, lp);
  },

  /** Death: a 1200 → 280 Hz slide whistle with a 6 Hz wobble, then a "plop" into the puddle. */
  death(g, t) {
    const v = g.voice('sfx', t);
    const env = v.gain(GAIN_FLOOR);
    env.gain.setValueAtTime(GAIN_FLOOR, t);
    env.gain.linearRampToValueAtTime(0.12, t + 0.015);
    env.gain.linearRampToValueAtTime(0.08, t + 0.55);
    env.gain.exponentialRampToValueAtTime(GAIN_FLOOR, t + 0.78);
    const whistle = v.osc('sine', 1200, t, t + 0.78, env);
    glide(whistle.frequency, t, 1200, 280, 0.75);
    const wobble = v.gain(25, null);
    v.osc('sine', 6, t, t + 0.78, wobble);
    wobble.connect(whistle.frequency);
    const tp = t + 0.8;
    const plop = v.tone('sine', 180, tp, 0.2, 0.004, 0.14);
    glide(plop.frequency, tp, 180, 60, 0.12);
    const plop2 = v.tone('sine', 360, tp, 0.05, 0.004, 0.1);
    glide(plop2.frequency, tp, 360, 120, 0.12);
  },

  /** NOON banner: a soft low gong on the tonic (octave 3) whose partials carry on small speakers. */
  noon(g, t, p) {
    const v = g.voice('sfx', t);
    const f0 = keyRootHz(p.day ?? 1) / 2;
    const lp = v.filter('lowpass', 2200, 0.7);
    const partials: readonly (readonly [number, number, number])[] = [
      [1, 1, 2.6],
      [2, 0.55, 1.9],
      [2.76, 0.35, 1.4],
      [4.07, 0.18, 0.9],
      [5.43, 0.08, 0.6],
    ];
    for (const [ratio, rel, decay] of partials) v.tone('sine', f0 * ratio, t, 0.09 * rel, 0.03, decay, lp);
    // A second fundamental 0.7 Hz sharp makes the gong slowly beat, like real metal.
    v.tone('sine', f0 + 0.7, t, 0.05, 0.03, 2.2, lp);
  },

  /** Noon passed: a relieved cascade down the pentatonic scale. */
  noonPassed(g, t, p) {
    const v = g.voice('sfx', t);
    const day = p.day ?? 1;
    [9, 7, 5, 4, 2, 0].forEach((d, i) => bellTone(v, t + i * 0.06, degreeHz(day, d, 5), 0.05, 0.6, 0.2));
  },

  /** Nightfall: a warm falling fifth over the tonic, the "you made it" exhale. */
  nightfall(g, t, p) {
    const v = g.voice('sfx', t);
    const root = tonic5(p);
    v.tone('sine', root * semis(7), t, 0.05, 0.04, 1.4);
    v.tone('sine', root, t + 0.22, 0.05, 0.04, 1.8);
    v.tone('sine', root / 2, t, 0.035, 0.08, 2.0);
  },

  /** Dawn: root-third-fifth-octave pluck fanfare in the new day's key. */
  dayFanfare(g, t, p) {
    fanfare(g.voice('sfx', t), t, tonic5(p), 0.1);
  },

  /** New best: the fanfare, again an octave up, then a shimmer of four high bells. */
  newBest(g, t, p) {
    const v = g.voice('sfx', t);
    const day = p.day ?? 1;
    const root = tonic5(p);
    const t2 = fanfare(v, t, root, 0.1) + 0.06;
    const t3 = fanfare(v, t2, root * 2, 0.07) + 0.12;
    for (let i = 0; i < 4; i++) {
      const d = 5 + Math.floor(Math.random() * 5);
      bellTone(v, t3 + i * 0.08, degreeHz(day, d, 5), 0.05, 0.8, 0.25, v.panner(i % 2 === 0 ? -0.35 : 0.35));
    }
  },

  /** Low-Chill heartbeat: "lub" (90 ms) then "dub" (70 ms) 150 ms later. */
  heartbeat(g, t, p) {
    const v = g.voice('sfx', t);
    const k = p.strong ? 1.15 : 1;
    thump(v, g.white, t, 0.25 * k, 0.09);
    thump(v, g.white, t + 0.15, 0.18 * k, 0.07);
  },

  /** UI tap: a 40 ms 660 Hz sine. */
  uiTap(g, t) {
    g.voice('sfx', t).tone('sine', 660, t, 0.07, 0.002, 0.038);
  },

  /** Buy / equip: two bright plucks rising a fourth (fifth → octave) with a glassy overtone. */
  uiBuy(g, t, p) {
    const v = g.voice('sfx', t);
    const root = tonic5(p);
    [root * semis(7), root * 2].forEach((f, i) => {
      const at = t + i * 0.08;
      v.tone('sine', f, at, 0.05, 0.003, 0.45);
      v.tone('triangle', f, at, 0.025, 0.003, 0.3);
      v.tone('sine', f * 3, at, 0.01, 0.003, 0.15);
    });
  },

  /** Error: two soft low blips a semitone apart, "nuh-uh". */
  uiError(g, t) {
    const v = g.voice('sfx', t);
    const lp = v.filter('lowpass', 1100, 0.7);
    v.tone('triangle', 233, t, 0.06, 0.004, 0.07, lp);
    v.tone('triangle', 220, t + 0.09, 0.06, 0.004, 0.09, lp);
  },
};

export const SFX_NAMES = Object.keys(RECIPES) as readonly SfxName[];
