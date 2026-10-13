// One recipe per cue (GDD §12, plus UI, campaign and concept cues). Every recipe builds a fresh
// Voice on a bus at time `t`, so the voice limiter can steal it and its nodes disconnect when it
// ends. Envelopes start and end at GAIN_FLOOR (never 0) and sources stop just after the floor.
// Tunes are written as note lists played by one of three instruments (seq), noises as filtered
// white noise (whoosh, burst). Levels were balanced with the audio lab's level check (README).

import { GAIN_FLOOR, ahr, glide, perc } from './engine.ts';
import type { AudioGraph, Voice } from './engine.ts';
import { bellDegree, degreeHz, degreeSemis, detentHz, keyRootHz, multUpNotes, semis } from './theory.ts';

export interface SfxParams {
  /** Day whose key tonal cues use (default 1 = C), and the chapter palette's base key (default 0). */
  day?: number;
  key?: number;
  /** Pentatonic degree: 0..9 for bells, 0..4 for flowers. */
  degree?: number;
  /** multUp: the multiplier (2..5); levelWin: the stars (1..3); swing: the chain. */
  level?: number;
  /** Detent index (the click's pitch step); gust: the wind direction (±1); lock: 1 = released. */
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
const MAX_PARTIAL_HZ = 8000;

/** A struck bell: sine fundamental plus bar partials (which die `partialDecay` sooner), 2 ms attack. */
export function bellTone(v: Voice, t: number, freq: number, peak: number, decay: number, partialDecay: number, dest: AudioNode = v.out): void {
  v.tone('sine', freq, t, peak, 0.002, decay, dest);
  for (const [ratio, rel] of BELL_PARTIALS) {
    if (freq * ratio <= MAX_PARTIAL_HZ) v.tone('sine', freq * ratio, t, peak * rel, 0.002, partialDecay, dest);
  }
}

/** bell: a struck bell. pluck: triangle + sine (marimba-ish). soft: a sine swelling in over 40 ms. */
type Inst = 'bell' | 'pluck' | 'soft';

/** One note of `inst` at `freq`. */
function note(v: Voice, inst: Inst, t: number, freq: number, peak: number, decay: number, dest: AudioNode = v.out): void {
  if (inst === 'bell') bellTone(v, t, freq, peak, decay, decay * 0.35, dest);
  else if (inst === 'soft') v.tone('sine', freq, t, peak, 0.04, decay, dest);
  else {
    v.tone('triangle', freq, t, peak * 0.55, 0.003, decay, dest);
    v.tone('sine', freq, t, peak * 0.45, 0.003, decay * 1.2, dest);
  }
}

/** [delay s, semitones above `root`] notes; the last one rings `ring` times longer. Returns the end. */
type Notes = readonly (readonly [number, number])[];
function seq(v: Voice, t: number, root: number, notes: Notes, inst: Inst, peak: number, decay: number, ring = 1, dest: AudioNode = v.out): number {
  notes.forEach(([dt, s], i) => note(v, inst, t + dt, root * semis(s), peak, i === notes.length - 1 ? decay * ring : decay, dest));
  return t + (notes.at(-1)?.[0] ?? 0);
}

/** Root-third-fifth-octave fanfare, 90 ms apart. */
const FANFARE: Notes = [
  [0, 0],
  [0.09, 4],
  [0.18, 7],
  [0.27, 12],
];
/** Pentatonic degrees as notes `step` s apart (semitones from the octave-5 tonic). */
const run = (degrees: readonly number[], step: number, from = 0): Notes => degrees.map((d, i) => [from + i * step, degreeSemis(d)]);

/**
 * Filtered white noise whose lowpass sweeps lo → hi → lo (peaking at 35 % of `dur`) while it pans
 * from `pan` to −`pan`: cloud capture, wind gusts, the SWING swoosh.
 */
function whoosh(g: AudioGraph, v: Voice, t: number, dur: number, lo: number, hi: number, q: number, peak: number, pan: number): void {
  const p = v.panner(pan);
  if (p.pan) p.pan.linearRampToValueAtTime(-pan, t + dur);
  const env = v.gain(GAIN_FLOOR, p);
  const mid = t + dur * 0.35;
  env.gain.setValueAtTime(GAIN_FLOOR, t);
  env.gain.linearRampToValueAtTime(peak, mid);
  env.gain.exponentialRampToValueAtTime(GAIN_FLOOR, t + dur);
  const lp = v.filter('lowpass', lo, q, env);
  glide(lp.frequency, t, lo, hi, dur * 0.35);
  lp.frequency.exponentialRampToValueAtTime(lo, t + dur);
  v.noise(g.white, t, t + dur, lp);
}

/** One heart sound: a falling low sine with two overtones (so phone speakers carry it) and a knock. */
function thump(g: AudioGraph, v: Voice, t: number, peak: number, dur: number): void {
  for (const [h, rel] of [
    [1, 0.75],
    [2, 0.6],
    [3, 0.3],
  ] as const) {
    const o = v.tone('sine', 62 * h, t, peak * rel, 0.006, dur * (1.1 - 0.15 * h));
    glide(o.frequency, t, 62 * h, 48 * h, dur);
  }
  v.burst(g.white, t, peak * 0.3, 0.002, 0.03, v.filter('lowpass', 600, 0.7));
}

/** The octave-5 tonic of the cue's key. */
const tonic5 = (p: SfxParams): number => degreeHz(p.day ?? 1, 0, 5, p.key ?? 0);

export const RECIPES = {
  /** Sun detent: a tiny triangle tick on a five-step pitch ladder plus a 6 ms air burst. */
  detent(g, t, p) {
    const v = g.voice('sfx', t);
    const k = p.gain ?? 1;
    v.tone('triangle', detentHz(p.index ?? 0), t, 0.1 * k, 0.001, 0.03);
    v.burst(g.white, t, 0.04 * k, 0.0005, 0.0055, v.filter('bandpass', 3200, 0.9));
  },

  /** Catching a coasting sun: a lowpassed knock, a short falling body and a wooden "tok". */
  catch(g, t) {
    const v = g.voice('sfx', t);
    v.burst(g.white, t, 0.2, 0.002, 0.08, v.filter('lowpass', 500, 0.9));
    for (const [f, peak, dur] of [
      [125, 0.18, 0.06],
      [250, 0.07, 0.05],
      [700, 0.035, 0.03],
    ] as const) glide(v.tone('sine', f, t, peak, 0.003, dur).frequency, t, f, f * 0.8, dur);
  },

  /** Shade re-entry: root + fifth with a 5 Hz ±3 cent vibrato and a breath of "haah". */
  ahh(g, t, p) {
    const v = g.voice('sfx', t);
    const root = tonic5(p);
    const end = t + 0.015 + 0.5;
    const vibrato = v.gain(3, null);
    v.osc('sine', 5, t, end, vibrato);
    for (const f of [root, root * semis(7)]) {
      const env = v.gain(GAIN_FLOOR);
      ahr(env.gain, t, 0.08, 0.015, 0.04, 0.45);
      vibrato.connect(v.osc('sine', f, t, end, env).detune);
    }
    v.burst(g.white, t, 0.012, 0.02, 0.3, v.filter('bandpass', 900, 2.5));
  },

  /** Flake pickup: pentatonic bell, degree 0..9 over octaves 5-6, panned gently by pitch. */
  bell(g, t, p) {
    const v = g.voice('sfx', t);
    const d = bellDegree(p.degree ?? 0);
    bellTone(v, t, degreeHz(p.day ?? 1, d, 5, p.key ?? 0), 0.18 * (p.gain ?? 1), 0.9, 0.35, v.panner((d / 9 - 0.5) * 0.5));
  },

  /** Ice crystal: a bell triad rolled 40 ms apart, then a quiet octave sparkle. */
  crystal(g, t, p) {
    const v = g.voice('sfx', t);
    const root = tonic5(p);
    seq(v, t, root, [[0, 0], [0.04, 4], [0.08, 7]], 'bell', 0.075, 1.2);
    bellTone(v, t + 0.12, root * 2, 0.035, 1.0, 0.3);
  },

  /** Night frost flower: a soft music-box note (sine + 3.0× partial). */
  flower(g, t, p) {
    const v = g.voice('sfx', t);
    const f = degreeHz(p.day ?? 1, (p.degree ?? 0) % 5, 5, p.key ?? 0);
    v.tone('sine', f, t, 0.09, 0.003, 0.7);
    v.tone('sine', f * 3, t, 0.022, 0.003, 0.25);
  },

  /** Flake melting: a soft "tss" and a falling droplet "plip". */
  melt(g, t) {
    const v = g.voice('sfx', t);
    v.burst(g.white, t, 0.08, 0.004, 0.1, v.filter('bandpass', 3800, 1.2));
    glide(v.tone('sine', 1400, t + 0.02, 0.05, 0.002, 0.06).frequency, t + 0.02, 1400, 650, 0.06);
  },

  /** Multiplier up: two triangle notes 70 ms apart, climbing with the level; ×5 rolls a full arpeggio. */
  multUp(g, t, p) {
    const v = g.voice('sfx', t);
    seq(v, t, tonic5(p), multUpNotes(p.level ?? 2).map((s, i) => [i * 0.07, s] as const), 'pluck', 0.13, 0.2, 1.5);
  },

  /** Multiplier reset: a soft square blip sliding 330 → 220 Hz through a 1.2 kHz lowpass. */
  multReset(g, t) {
    const v = g.voice('sfx', t);
    const env = v.gain(GAIN_FLOOR, v.filter('lowpass', 1200, 0.7));
    glide(v.osc('square', 330, t, ahr(env.gain, t, 0.05, 0.004, 0.09, 0.08), env).frequency, t, 330, 220, 0.12);
  },

  /** PHEW: a sine whooping 400 → 900 Hz, landing on a bell at the octave-6 tonic. */
  phew(g, t, p) {
    const v = g.voice('sfx', t);
    const env = v.gain(GAIN_FLOOR);
    glide(v.osc('sine', 400, t, ahr(env.gain, t, 0.1, 0.01, 0.15, 0.12), env).frequency, t, 400, 900, 0.18);
    bellTone(v, t + 0.16, tonic5(p) * 2, 0.1, 0.9, 0.35);
  },

  /** COMEBACK: a quick pluck climb up the scale landing on a bell fifth over the high tonic. */
  comeback(g, t, p) {
    const v = g.voice('sfx', t);
    const root = tonic5(p);
    seq(v, t, root, run([0, 2, 4, 5], 0.06), 'pluck', 0.09, 0.22);
    seq(v, t + 0.26, root, [[0, 12], [0.03, 19]], 'bell', 0.06, 0.9, 1.3);
  },

  /** Glare touch: a falling sawtooth buzz plus a band of noise at 1.2 kHz. */
  glare(g, t) {
    const v = g.voice('sfx', t);
    const env = v.gain(GAIN_FLOOR, v.filter('lowpass', 2400, 0.7));
    glide(v.osc('sawtooth', 180, t, perc(env.gain, t, 0.16, 0.002, 0.148), env).frequency, t, 180, 120, 0.15);
    v.burst(g.white, t, 0.16, 0.002, 0.148, v.filter('bandpass', 1200, 1.4));
  },

  /** Cloud capture: a soft whoosh drifting left to right. */
  cloud(g, t) {
    whoosh(g, g.voice('sfx', t), t, 0.7, 300, 1800, 1, 0.22, -0.5);
  },

  /** 'gusts': a breathy, slightly whistling whoosh blowing the way the wind turns the sun. */
  gust(g, t, p) {
    whoosh(g, g.voice('sfx', t), t, 0.6, 350, 2600, 3, 0.16, -0.6 * (p.index ?? 1));
  },

  /** A SWING landed: a quick swoosh and a pluck that climbs with the chain. */
  swing(g, t, p) {
    const v = g.voice('sfx', t);
    whoosh(g, v, t, 0.3, 500, 3000, 1.5, 0.1, 0.3);
    note(v, 'pluck', t + 0.12, degreeHz(p.day ?? 1, 2 + Math.min(7, p.level ?? 1), 5, p.key ?? 0), 0.09, 0.3);
  },

  /** 'lock': the sun's padlock clinks shut (index 1: it springs open, higher and lighter). */
  lock(g, t, p) {
    const v = g.voice('sfx', t);
    const open = p.index === 1;
    const k = open ? 0.7 : 1;
    for (const f of [2100, 3340]) v.tone('sine', f * (open ? 1.12 : 1), t, 0.05 * k, 0.001, 0.12);
    glide(v.tone('triangle', 260, t, 0.1 * k, 0.002, 0.07).frequency, t, open ? 200 : 260, open ? 300 : 170, 0.06);
    v.burst(g.white, t, 0.05 * k, 0.001, 0.02, v.filter('bandpass', 2800, 2));
  },

  /** A gate arch overhead: a little "ding-dong". */
  gate(g, t, p) {
    seq(g.voice('sfx', t), t, tonic5(p), [[0, 7], [0.16, 0]], 'bell', 0.07, 0.6, 1.4);
  },

  /** 'eclipse': the light drains away, a slow falling shimmer over a low swell. */
  eclipse(g, t, p) {
    const v = g.voice('sfx', t);
    seq(v, t, tonic5(p), run([9, 7, 5, 3, 0], 0.14), 'bell', 0.045, 0.9, 1.6);
    v.tone('sine', tonic5(p) / 4, t, 0.05, 0.5, 1.6);
  },

  /** Death: a 1200 → 280 Hz slide whistle with a 6 Hz wobble, then a "plop" into the puddle. */
  death(g, t) {
    const v = g.voice('sfx', t);
    const env = v.gain(GAIN_FLOOR);
    env.gain.setValueAtTime(GAIN_FLOOR, t);
    env.gain.linearRampToValueAtTime(0.1, t + 0.015);
    env.gain.linearRampToValueAtTime(0.065, t + 0.55);
    env.gain.exponentialRampToValueAtTime(GAIN_FLOOR, t + 0.78);
    const whistle = v.osc('sine', 1200, t, t + 0.78, env);
    glide(whistle.frequency, t, 1200, 280, 0.75);
    const wobble = v.gain(25, null);
    v.osc('sine', 6, t, t + 0.78, wobble);
    wobble.connect(whistle.frequency);
    const tp = t + 0.8;
    glide(v.tone('sine', 180, tp, 0.16, 0.004, 0.14).frequency, tp, 180, 60, 0.12);
    glide(v.tone('sine', 360, tp, 0.06, 0.004, 0.1).frequency, tp, 360, 120, 0.12);
  },

  /** NOON banner: a soft low gong on the tonic (octave 3) whose partials carry on small speakers. */
  noon(g, t, p) {
    const v = g.voice('sfx', t);
    const f0 = keyRootHz(p.day ?? 1, p.key ?? 0) / 2;
    const lp = v.filter('lowpass', 2200, 0.7);
    for (const [ratio, rel, decay] of [
      [1, 1, 2.6],
      [2, 0.55, 1.9],
      [2.76, 0.35, 1.4],
      [4.07, 0.18, 0.9],
      [5.43, 0.08, 0.6],
    ] as const) v.tone('sine', f0 * ratio, t, 0.09 * rel, 0.03, decay, lp);
    // A second fundamental 0.7 Hz sharp makes the gong slowly beat, like real metal.
    v.tone('sine', f0 + 0.7, t, 0.05, 0.03, 2.2, lp);
  },

  /** Noon passed: a relieved cascade down the pentatonic scale. */
  noonPassed(g, t, p) {
    seq(g.voice('sfx', t), t, tonic5(p), run([9, 7, 5, 4, 2, 0], 0.06), 'bell', 0.05, 0.6);
  },

  /** Nightfall: a warm falling fifth over the tonic, the "you made it" exhale. */
  nightfall(g, t, p) {
    const v = g.voice('sfx', t);
    seq(v, t, tonic5(p), [[0, 7], [0.22, 0]], 'soft', 0.05, 1.4, 1.3);
    v.tone('sine', tonic5(p) / 2, t, 0.035, 0.08, 2.0);
  },

  /** Dawn: root-third-fifth-octave pluck fanfare in the new day's key. */
  dayFanfare(g, t, p) {
    seq(g.voice('sfx', t), t, tonic5(p), FANFARE, 'pluck', 0.1, 0.4, 2.2);
  },

  /** The finish line is near: a hopeful lift up the scale. */
  finishNear(g, t, p) {
    seq(g.voice('sfx', t), t, tonic5(p), run([3, 4, 5], 0.08), 'pluck', 0.09, 0.3, 2);
  },

  /**
   * A Journey level won, tiered by stars: ★ the fanfare and a bass root; ★★ plus a ringing chord on
   * top; ★★★ plus a sparkle running up to the high tonic.
   */
  levelWin(g, t, p) {
    const v = g.voice('sfx', t);
    const root = tonic5(p);
    const stars = p.level ?? 1;
    seq(v, t, root, FANFARE, 'pluck', 0.11, 0.4, 2.4);
    note(v, 'soft', t + 0.27, root / 2, 0.06, 1.4);
    if (stars >= 2) seq(v, t + 0.45, root, [[0, 12], [0.03, 16], [0.06, 19]], 'bell', 0.05, 1.3);
    if (stars >= 3) seq(v, t + 0.6, root, run([5, 6, 7, 8, 9, 10], 0.055), 'bell', 0.04, 0.7, 2);
  },

  /** Finished without meeting the goal: a gentle "aww", not a punishment. */
  levelFail(g, t, p) {
    const v = g.voice('sfx', t);
    seq(v, t, tonic5(p), [[0, 7], [0.2, 3], [0.4, 0]], 'pluck', 0.08, 0.35, 2.2, v.filter('lowpass', 1600, 0.7));
  },

  /** New best: the fanfare, again an octave up, then a shimmer of four high bells. */
  newBest(g, t, p) {
    const v = g.voice('sfx', t);
    const root = tonic5(p);
    const t2 = seq(v, t, root, FANFARE, 'pluck', 0.1, 0.4, 2.2) + 0.15;
    const t3 = seq(v, t2, root * 2, FANFARE, 'pluck', 0.07, 0.4, 2.2) + 0.21;
    seq(v, t3, root, run([9, 7, 8, 9], 0.08), 'bell', 0.05, 0.8);
  },

  /** Low-Chill heartbeat: "lub" (90 ms) then "dub" (70 ms) 150 ms later. */
  heartbeat(g, t, p) {
    const v = g.voice('sfx', t);
    const k = p.strong ? 1.15 : 1;
    thump(g, v, t, 0.24 * k, 0.09);
    thump(g, v, t + 0.15, 0.17 * k, 0.07);
  },

  /** UI tap: a round, bubbly "pop" (a sine dropping an octave in 30 ms) with a tiny click of air. */
  uiTap(g, t) {
    const v = g.voice('sfx', t);
    const f = 1050 * (0.97 + 0.06 * Math.random());
    glide(v.tone('sine', f, t, 0.12, 0.002, 0.06).frequency, t, f, f / 2, 0.03);
    v.burst(g.white, t, 0.025, 0.0005, 0.006, v.filter('bandpass', 2500, 1.5));
  },

  /** Buy / equip: two bright plucks rising a fourth (fifth → octave), then a glassy bell. */
  uiBuy(g, t, p) {
    const v = g.voice('sfx', t);
    seq(v, t, tonic5(p), [[0, 7], [0.08, 12]], 'pluck', 0.08, 0.35, 1.3);
    bellTone(v, t + 0.12, tonic5(p) * semis(19), 0.025, 0.5, 0.15);
  },

  /** A reward lands (Snow, a cosmetic): a rolled bell sixth chord over a soft root, and a glint. */
  reward(g, t, p) {
    const v = g.voice('sfx', t);
    const root = tonic5(p);
    seq(v, t, root, [[0, 4], [0.05, 9], [0.1, 16]], 'bell', 0.06, 1.1, 1.4);
    note(v, 'soft', t, root / 2, 0.05, 0.9);
    bellTone(v, t + 0.16, root * semis(28), 0.018, 0.45, 0.12);
  },

  /** Rank up: the pluck fanfare over a bass root, a bell chord on the octave and a run to the top. */
  rankUp(g, t, p) {
    const v = g.voice('sfx', t);
    const root = tonic5(p);
    seq(v, t, root, FANFARE, 'pluck', 0.1, 0.4, 2.2);
    note(v, 'soft', t, root / 2, 0.06, 1.6);
    seq(v, t + 0.36, root, [[0, 12], [0.02, 16], [0.04, 19]], 'bell', 0.045, 1.4);
    seq(v, t + 0.5, root, run([5, 7, 9], 0.06, 0), 'bell', 0.035, 0.6, 2);
  },

  /** A Snow Globe opens: a rising shimmer (the shake), a glassy pop, then sparkles falling in. */
  open(g, t, p) {
    const v = g.voice('sfx', t);
    const root = tonic5(p);
    whoosh(g, v, t, 0.45, 600, 4200, 2, 0.1, 0.2);
    const tp = t + 0.32;
    glide(v.tone('sine', 900, tp, 0.12, 0.002, 0.07).frequency, tp, 900, 1800, 0.05);
    v.burst(g.white, tp, 0.05, 0.001, 0.03, v.filter('bandpass', 3000, 1.2));
    seq(v, tp + 0.04, root, run([9, 7, 8, 5, 7], 0.05), 'bell', 0.06, 0.7, 2);
    note(v, 'soft', tp, root / 2, 0.05, 1.2);
  },

  /** Claim: a quick bright two-bell "ka-ching" a fourth apart. */
  claim(g, t, p) {
    const v = g.voice('sfx', t);
    seq(v, t, tonic5(p), [[0, 12], [0.06, 17]], 'bell', 0.06, 0.5, 1.6);
    v.burst(g.white, t, 0.02, 0.0005, 0.01, v.filter('bandpass', 4000, 2));
  },

  /** Counter tick (XP and Snow count-ups): a tiny dry wooden click, quiet enough to repeat. */
  tick(g, t) {
    const v = g.voice('sfx', t);
    v.tone('triangle', 1600, t, 0.09, 0.001, 0.018);
    v.burst(g.white, t, 0.03, 0.0005, 0.004, v.filter('bandpass', 3500, 1.5));
  },

  /** Error: two soft low blips a semitone apart, "nuh-uh". */
  uiError(g, t) {
    const v = g.voice('sfx', t);
    const lp = v.filter('lowpass', 1100, 0.7);
    v.tone('triangle', 233, t, 0.07, 0.004, 0.07, lp);
    v.tone('triangle', 220, t + 0.09, 0.07, 0.004, 0.09, lp);
  },
} satisfies Record<string, Recipe>;

/** Every cue name (the keys of RECIPES). */
export type SfxName = keyof typeof RECIPES;

export const SFX_NAMES = Object.keys(RECIPES) as readonly SfxName[];
