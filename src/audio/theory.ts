// Pure music maths for SHADY's synthesized score (GDD §12): keys, scales, chords, arpeggio
// patterns and the curves that map game state to sound. No WebAudio in here, so all of it is
// unit-testable in Node and shared by the live engine, the router and the audio lab.

/** Day 1 tonic: C4. */
export const C4_HZ = 261.6255653005986;

/** Tempo grid: 90 BPM, so a 16th note lasts 1/6 s and a bar of 16 steps lasts 8/3 s. */
export const BPM = 90;
export const STEP_S = 60 / BPM / 4;
export const STEPS_PER_BAR = 16;
/** Chords change every 4 bars (10.67 s). */
export const STEPS_PER_CHORD = 4 * STEPS_PER_BAR;

/** Major pentatonic, in semitones above the tonic. */
export const PENTATONIC: readonly number[] = [0, 2, 4, 7, 9];

/** Flake bells span two octaves of the pentatonic scale: degrees 0..9 (GDD §12). */
export const BELL_DEGREES = 10;

/** 2^(semitones/12). */
export function semis(n: number): number {
  return Math.pow(2, n / 12);
}

/**
 * Semitone offset of day N's tonic from C4. Each new day moves up a fifth (C, G, D, A, E, B, F#,
 * C#, ...), folded into [-5, +6] around C4 rather than [0, 12): keeping every key within a tritone
 * of C stops late days drifting into a shrill register while still sounding like a lift each dawn.
 */
export function keyOffset(day: number): number {
  const n = Math.max(0, Math.floor(day) - 1);
  const s = (7 * n) % 12;
  return s > 6 ? s - 12 : s;
}

/** Tonic of day N's key in octave 4 (Hz). Day 1 = C4 = 261.63 Hz. */
export function keyRootHz(day: number): number {
  return C4_HZ * semis(keyOffset(day));
}

/** Semitones above the tonic of a pentatonic degree. Degree 5 is the octave; negatives go down. */
export function degreeSemis(degree: number): number {
  const d = Math.floor(degree);
  const octave = Math.floor(d / 5);
  return 12 * octave + (PENTATONIC[d - 5 * octave] as number);
}

/** Frequency of a pentatonic degree of day N's key, counted from the tonic of `octave` (4 = C4's octave). */
export function degreeHz(day: number, degree: number, octave = 5): number {
  return keyRootHz(day) * semis(degreeSemis(degree) + 12 * (octave - 4));
}

/** Any integer folded into the flake-bell range 0..9. */
export function bellDegree(raw: number): number {
  const d = Math.floor(raw) % BELL_DEGREES;
  return d < 0 ? d + BELL_DEGREES : d;
}

// ---------------------------------------------------------------------------------------------
// Harmony: I-vi-IV-V with fixed, smoothly voice-led voicings.

export interface Chord {
  readonly name: 'I' | 'vi' | 'IV' | 'V';
  /** Bass note, semitones from the octave-4 tonic. */
  readonly bass: number;
  /** Close-position upper triad, semitones from the octave-4 tonic. */
  readonly tones: readonly [number, number, number];
}

/**
 * The smoothest cyclic voicing of I-vi-IV-V (found by exhaustive search; total motion 12
 * semitones per cycle): G-C-E, A-C-E, A-C-F, G-B-D in C. C is held through three chords, every
 * voice moves by a step except one minor third (F→D into V), and the bass walks C3-A2-F2-G2.
 * Everything sits within a fifth of the tonic, which keeps the pad warm, never muddy.
 */
export const PROGRESSION: readonly Chord[] = [
  { name: 'I', bass: -12, tones: [-5, 0, 4] },
  { name: 'vi', bass: -15, tones: [-3, 0, 4] },
  { name: 'IV', bass: -19, tones: [-3, 0, 5] },
  { name: 'V', bass: -17, tones: [-5, -1, 2] },
];

export function chordAt(index: number): Chord {
  const n = PROGRESSION.length;
  return PROGRESSION[((Math.floor(index) % n) + n) % n] as Chord;
}

// ---------------------------------------------------------------------------------------------
// Pluck arpeggio. Density follows the Frost multiplier (GDD §12 table).

/** Step values: 0 rest, 1 note, 2 note an octave up. */
export type ArpHit = 0 | 1 | 2;

/** One bar of 16 sixteenths per multiplier level. */
export const ARP_PATTERNS: Readonly<Record<1 | 2 | 3 | 4 | 5, readonly ArpHit[]>> = {
  // x1: quarter notes, each with 50% probability (see ARP_CHANCE).
  1: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
  // x2: quarter notes.
  2: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
  // x3: 8th notes.
  3: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
  // x4: 8th notes plus a syncopated 16th pick-up into beats 2 and 4.
  4: [1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0],
  // x5: full 16ths with octave jumps on the off-8ths and a lift into the next bar.
  5: [1, 1, 2, 1, 1, 1, 2, 1, 1, 1, 2, 1, 1, 2, 1, 2],
};

/** Probability that a pattern hit actually sounds, per level. */
export const ARP_CHANCE: Readonly<Record<1 | 2 | 3 | 4 | 5, number>> = { 1: 0.5, 2: 1, 3: 1, 4: 1, 5: 1 };

/** Clamps any multiplier value to an arpeggio level 1..5. */
export function arpLevel(mult: number): 1 | 2 | 3 | 4 | 5 {
  const m = Math.round(mult);
  return (m <= 1 ? 1 : m >= 5 ? 5 : m) as 1 | 2 | 3 | 4 | 5;
}

/** Pattern value of a 16th step (any integer) at a level (0 = arpeggio off). */
export function arpHit(level: number, step: number): ArpHit {
  if (level < 1) return 0;
  const pattern = ARP_PATTERNS[arpLevel(level)];
  return pattern[((step % STEPS_PER_BAR) + STEPS_PER_BAR) % STEPS_PER_BAR] as ArpHit;
}

/** Up-and-down walk over the chord's three tones plus the octave: 0 1 2 3 2 1 0 1 ... */
const ARP_WALK: readonly number[] = [0, 1, 2, 3, 2, 1];

/**
 * Semitones (from the octave-4 tonic) of the n-th arpeggio note in a bar. The arpeggio plays an
 * octave above the pad's triad; `hit === 2` lifts it a further octave.
 */
export function arpNoteSemis(chord: Chord, n: number, hit: ArpHit): number {
  const slot = ARP_WALK[((n % ARP_WALK.length) + ARP_WALK.length) % ARP_WALK.length] as number;
  const base = slot === 3 ? chord.tones[0] + 12 : chord.tones[slot as 0 | 1 | 2];
  return base + 12 + (hit === 2 ? 12 : 0);
}

// ---------------------------------------------------------------------------------------------
// Curves from game state to sound.

/** Pad lowpass cutoff (Hz): 300 + 2200·(ε/εnoon)² in daylight (warm dawn, bright noon), 500 at night. */
export function padCutoffHz(eps: number, epsNoon: number, night: boolean): number {
  if (night) return 500;
  const r = epsNoon > 0 ? Math.min(1, Math.max(0, eps / epsNoon)) : 0;
  return 300 + 2200 * r * r;
}

/**
 * Noon cicada envelope over the day fraction u = tDay/Dl: fades in over [0.4, 0.5] and out by 0.6,
 * smoothstep-shaped so the swell never has a corner.
 */
export function noonWindow(u: number): number {
  const x = u <= 0.5 ? (u - 0.4) / 0.1 : (0.6 - u) / 0.1;
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return x * x * (3 - 2 * x);
}

/** Sizzle level factor min(f, 1.5) (GDD: gain 0.22·min(f, 1.5)). */
export function sizzleAmount(f: number): number {
  return Math.min(Math.max(f, 0), 1.5);
}

/** Sizzle bandpass centre: 2500 + 3500·min(f, 1) Hz. */
export function sizzleHz(f: number): number {
  return 2500 + 3500 * Math.min(Math.max(f, 0), 1);
}

/** Crackle grains per second: 20·f, half again as many in glare, capped for CPU. */
export function crackleRate(f: number, glareW: number): number {
  const r = 20 * Math.max(f, 0) * (1 + 0.5 * Math.min(Math.max(glareW, 0), 1));
  return Math.min(r, 40);
}

/** Heartbeat period (s) for a Chill value: 0.85 below 25, 0.6 below 10, otherwise 0 (off). */
export function heartbeatPeriod(chill: number): number {
  if (chill < 10) return 0.6;
  if (chill < 25) return 0.85;
  return 0;
}

/** Detent click pitch: 1800·2^((i mod 5)/24) Hz, a five-step quarter-tone ladder. */
export function detentHz(index: number): number {
  const i = ((Math.floor(index) % 5) + 5) % 5;
  return 1800 * Math.pow(2, i / 24);
}

/**
 * Multiplier-up chime in semitones from the octave-5 tonic. ×2 is root→fifth (GDD); each level
 * climbs a pentatonic step so a rising multiplier is audible; ×5 adds the octave in a full
 * major arpeggio that lands on the high fifth.
 */
export function multUpNotes(level: number): readonly number[] {
  if (level >= 5) return [7, 12, 16, 19];
  if (level <= 2) return [0, 7];
  return level === 3 ? [2, 9] : [4, 11];
}
