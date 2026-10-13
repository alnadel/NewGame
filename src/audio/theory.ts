// Pure music maths for SHADY's synthesized score (GDD §12): keys, scales, chords, chapter palettes,
// arpeggio patterns and the curves that map game state to sound. No WebAudio in here, so all of it
// is unit-testable in Node and shared by the live engine, the router and the audio lab.

/** Day 1 tonic: C4. */
export const C4_HZ = 261.6255653005986;

/** Default tempo: 90 BPM, so a 16th note lasts 1/6 s. Chapter palettes pick their own. */
export const BPM = 90;
export const STEP_S = 60 / BPM / 4;
export const STEPS_PER_BAR = 16;
/** Chords change every 4 bars. */
export const STEPS_PER_CHORD = 4 * STEPS_PER_BAR;

/** Major pentatonic, in semitones above the tonic. */
export const PENTATONIC: readonly number[] = [0, 2, 4, 7, 9];

/** Flake bells span two octaves of the pentatonic scale: degrees 0..9 (GDD §12). */
export const BELL_DEGREES = 10;

/** 2^(semitones/12). */
export function semis(n: number): number {
  return Math.pow(2, n / 12);
}

/** Length of a 16th note at `bpm`. */
export function stepSeconds(bpm: number): number {
  return 60 / bpm / 4;
}

/**
 * Semitone offset of day N's tonic from C4, starting from a palette's `base` key. Each new day
 * moves up a fifth, folded into [-5, +6] around C4: every key stays within a tritone of C, so late
 * days never drift shrill or muddy while each dawn still sounds like a lift.
 */
export function keyOffset(day: number, base = 0): number {
  const n = Math.max(0, Math.floor(day) - 1);
  const s = (((7 * n + base) % 12) + 12) % 12;
  return s > 6 ? s - 12 : s;
}

/** Tonic of day N's key in octave 4 (Hz). Day 1 of the default palette = C4 = 261.63 Hz. */
export function keyRootHz(day: number, base = 0): number {
  return C4_HZ * semis(keyOffset(day, base));
}

/** Semitones above the tonic of a pentatonic degree. Degree 5 is the octave; negatives go down. */
export function degreeSemis(degree: number): number {
  const d = Math.floor(degree);
  const octave = Math.floor(d / 5);
  return 12 * octave + (PENTATONIC[d - 5 * octave] as number);
}

/** Frequency of a pentatonic degree of day N's key, counted from the tonic of `octave` (4 = C4's octave). */
export function degreeHz(day: number, degree: number, octave = 5, base = 0): number {
  return keyRootHz(day, base) * semis(degreeSemis(degree) + 12 * (octave - 4));
}

/** Any integer folded into the flake-bell range 0..9. */
export function bellDegree(raw: number): number {
  const d = Math.floor(raw) % BELL_DEGREES;
  return d < 0 ? d + BELL_DEGREES : d;
}

// ---------------------------------------------------------------------------------------------
// Harmony: four close voicings, played in the order of the palette's progression.

export interface Chord {
  readonly name: 'I' | 'vi' | 'IV' | 'V';
  /** Bass note, semitones from the octave-4 tonic. */
  readonly bass: number;
  /** Close-position upper triad, semitones from the octave-4 tonic. */
  readonly tones: readonly [number, number, number];
}

/**
 * The smoothest cyclic voicing of I-vi-IV-V (found by exhaustive search; total motion 12
 * semitones per cycle): G-C-E, A-C-E, A-C-F, G-B-D in C. Everything sits within a fifth of the
 * tonic, so any order of these four stays warm and close (no voice jumps more than a fourth).
 */
export const PROGRESSION: readonly Chord[] = [
  { name: 'I', bass: -12, tones: [-5, 0, 4] },
  { name: 'vi', bass: -15, tones: [-3, 0, 4] },
  { name: 'IV', bass: -19, tones: [-3, 0, 5] },
  { name: 'V', bass: -17, tones: [-5, -1, 2] },
];

/** Chord orders (indices into PROGRESSION): I-vi-IV-V, I-IV-vi-V, vi-IV-I-V, I-V-vi-IV. */
export const PROGRESSIONS: readonly (readonly number[])[] = [
  [0, 1, 2, 3],
  [0, 2, 1, 3],
  [1, 2, 0, 3],
  [0, 3, 1, 2],
];

export function chordAt(index: number, prog = 0): Chord {
  const order = PROGRESSIONS[prog] ?? (PROGRESSIONS[0] as readonly number[]);
  return PROGRESSION[order[((Math.floor(index) % 4) + 4) % 4] as number] as Chord;
}

// ---------------------------------------------------------------------------------------------
// Chapter palettes: 200 Journey levels must not all sound like one loop, so each chapter gets its
// own key, tempo, pad and arpeggio voice and chord order. Index 0 (Endless, Daily, the Title) is
// the original score.

/** Pad voice: warm detuned saws, a soft triangle organ, or a lowpassed square reed. */
export type PadVoice = 'sawtooth' | 'triangle' | 'square';
/** Arpeggio voice: marimba (triangle), music box (sine bell), or a soft chip pluck (square). */
export type ArpVoice = 'triangle' | 'bell' | 'square';

export interface Palette {
  /** Base key, semitones from C. */
  readonly key: number;
  readonly bpm: number;
  readonly pad: PadVoice;
  readonly arp: ArpVoice;
  /** Index into PROGRESSIONS. */
  readonly prog: number;
}

const pal = (key: number, bpm: number, pad: PadVoice, arp: ArpVoice, prog: number): Palette => ({ key, bpm, pad, arp, prog });
const SAW = 'sawtooth';
const TRI = 'triangle';
const SQR = 'square';

export const PALETTES: readonly Palette[] = [
  pal(0, 90, SAW, TRI, 0), // Endless, Daily, menus
  pal(0, 90, SAW, TRI, 0), // 1 First Light
  pal(5, 96, SQR, TRI, 1), // 2 Town and Weather
  pal(2, 84, TRI, 'bell', 2), // 3 Frost and Flurry
  pal(-3, 92, SAW, SQR, 3), // 4 Strange Suns
  pal(-5, 100, TRI, TRI, 1), // 5 Rolling Meadows
  pal(-2, 104, SQR, TRI, 0), // 6 Cobbled Lanes
  pal(4, 108, SAW, SQR, 3), // 7 Summer Heat
  pal(2, 96, SAW, TRI, 2), // 8 Harbour Winds
  pal(3, 80, SAW, TRI, 0), // 9 Giant Country
  pal(0, 112, SQR, SQR, 3), // 10 Clockwork Town
  pal(-3, 92, TRI, 'bell', 1), // 11 Flurry Fields
  pal(5, 84, TRI, 'bell', 2), // 12 Dusk Streets
  pal(-1, 96, TRI, 'bell', 3), // 13 Glass Meadow
  pal(1, 88, SAW, 'bell', 2), // 14 Eclipse Row
  pal(-5, 100, SAW, TRI, 0), // 15 The Long Road
  pal(2, 116, SQR, TRI, 1), // 16 Market Rush
  pal(4, 108, SAW, SQR, 2), // 17 Storm Pass
  pal(-4, 90, TRI, 'bell', 3), // 18 Frost Quarter
  pal(6, 112, SAW, SQR, 1), // 19 High Summer
  pal(-2, 120, SAW, SQR, 3), // 20 Heat Dome
];

/** The palette of a chapter (0 or out of range: the default score). */
export function paletteFor(chapter: number): Palette {
  return PALETTES[Math.floor(chapter)] ?? (PALETTES[0] as Palette);
}

// ---------------------------------------------------------------------------------------------
// Pluck arpeggio. Density follows the Frost multiplier (GDD §12 table).

/** Step values: 0 rest, 1 note, 2 note an octave up. */
export type ArpHit = 0 | 1 | 2;

/** One bar of 16 sixteenths per multiplier level. */
export const ARP_PATTERNS: Readonly<Record<1 | 2 | 3 | 4 | 5, readonly ArpHit[]>> = {
  // x1: quarter notes, each with 50% probability (see ARP_CHANCE). x2: quarter notes.
  1: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
  2: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
  // x3: 8th notes. x4: 8ths plus a syncopated 16th pick-up into beats 2 and 4.
  3: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
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

/**
 * Groove under the arpeggio, one bar of 16ths: 1 = bass pluck on the chord root, 2 = shaker,
 * 3 = both. Level 1: a bass note per bar (menus and calm play); 2: bass on 1 and 3; 3: plus shaker
 * on the off-8ths (×4 and up, and the final stretch to a finish line).
 */
const GROOVE: readonly (readonly number[])[] = [
  [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
  [1, 0, 2, 0, 0, 0, 2, 0, 1, 0, 2, 0, 0, 0, 2, 1],
];

export function grooveHit(level: number, step: number): number {
  const row = GROOVE[Math.min(3, Math.floor(level)) - 1];
  return row ? (row[((step % STEPS_PER_BAR) + STEPS_PER_BAR) % STEPS_PER_BAR] as number) : 0;
}

// ---------------------------------------------------------------------------------------------
// Curves from game state to sound.

/** Pad lowpass cutoff (Hz): 300 + 2200·(ε/εnoon)² in daylight (warm dawn, bright noon), 500 at night. */
export function padCutoffHz(eps: number, epsNoon: number, night: boolean): number {
  if (night) return 500;
  const r = epsNoon > 0 ? Math.min(1, Math.max(0, eps / epsNoon)) : 0;
  return 300 + 2200 * r * r;
}

/** The noon window, as fractions of the daylight: cicadas swell from 0.4 to 0.5 and fade by 0.6. */
export const NOON_WINDOW_START = 0.4;
export const NOON_WINDOW_END = 0.6;

/** Noon cicada envelope over u = tDay/Dl: smoothstep in over [0.4, 0.5], out by 0.6. */
export function noonWindow(u: number): number {
  const x = u <= 0.5 ? (u - NOON_WINDOW_START) / 0.1 : (NOON_WINDOW_END - u) / 0.1;
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return x * x * (3 - 2 * x);
}

/** Sizzle level factor min(f, 1.5) (GDD: gain ∝ min(f, 1.5)). */
export function sizzleAmount(f: number): number {
  return Math.min(Math.max(f, 0), 1.5);
}

/**
 * Sizzle bandpass centre: 1800 + 2200·min(f, 1) Hz. The GDD's 2500-6000 Hz put 45 % of the
 * sizzle's energy above 6 kHz (a harsh hiss on phone speakers); this keeps the "frying" texture in
 * the presence band.
 */
export function sizzleHz(f: number): number {
  return 1800 + 2200 * Math.min(Math.max(f, 0), 1);
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
 * climbs a pentatonic step; ×5 rolls a full major arpeggio that lands on the high fifth.
 */
export function multUpNotes(level: number): readonly number[] {
  if (level >= 5) return [7, 12, 16, 19];
  if (level <= 2) return [0, 7];
  return level === 3 ? [2, 9] : [4, 11];
}
