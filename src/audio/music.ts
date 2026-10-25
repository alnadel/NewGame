// Adaptive score (GDD §12): a 16th-note grid scheduled ahead of time, a pad cycling through the
// palette's progression every 4 bars with crossfades, a pluck arpeggio whose density follows the
// Frost multiplier, a bass-and-shaker groove, a key change every dawn, and the results-screen
// melody replay. Each Journey chapter has its own palette (theory.PALETTES): key, tempo, pad and
// arpeggio voices and chord order; changes land on the next beat.
//
// Nothing here runs on its own timer: the owner calls pump(now, horizon) every frame (and from a
// fallback interval) and applyScene() every frame. pump() only ever schedules what falls inside
// [now, horizon), so a throttled timer or a suspended context never produces a burst.

import { GAIN_FLOOR, Smoothed, makePanner } from './engine.ts';
import type { AudioGraph, Voice } from './engine.ts';
import { bellTone } from './recipes.ts';
import { MUFFLE_OPEN } from './scene.ts';
import type { Scene } from './scene.ts';
import {
  ARP_CHANCE,
  STEPS_PER_CHORD,
  arpHit,
  arpLevel,
  arpNoteSemis,
  bellDegree,
  chordAt,
  degreeHz,
  degreeSemis,
  grooveHit,
  keyRootHz,
  paletteFor,
  semis,
  stepSeconds,
} from './theory.ts';
import type { ArpVoice, Chord, Palette, PadVoice } from './theory.ts';
import { GridSlots, StepClock } from './timing.ts';

/**
 * Gain of each triad tone's main oscillator (its detuned twin runs at PAD_SECOND of this) and of
 * the bass, scaled per pad voice so the three voices measure within ~1 dB of each other. At these
 * levels the pad is a soft bed about 8 dB under the reward cues (README "Mix and levels").
 */
const PAD_TONE_GAIN = 0.024;
const PAD_BASS_GAIN = 0.026;
const PAD_VOICE_GAIN: Readonly<Record<PadVoice, number>> = { sawtooth: 1, triangle: 1.1, square: 0.55 };
/** ±4 cents at 1 : 0.6 keeps the chorus a slow, shallow shimmer (equal saws at ±7 cents pumped). */
const PAD_DETUNE_CENTS = 4;
const PAD_SECOND = 0.6;
/** Regular chord changes crossfade 1.5 s in / 2 s out; a key or palette change is quicker. */
const PAD_ATTACK = 1.5;
const PAD_RELEASE = 2;
const KEY_ATTACK = 0.5;
const KEY_RELEASE = 1;

/** Arpeggio pluck level per voice (the bell and square are brighter than the triangle). */
const ARP_GAIN: Readonly<Record<ArpVoice, number>> = { triangle: 0.08, bell: 0.05, square: 0.03 };
/** Time for a pluck to fall to the −80 dB floor: a soft marimba-like pluck that never smears at ×5. */
const ARP_DECAY = 0.4;
const ARP_PAN = 0.3;
/** Groove: a round bass pluck on the chord root and a quiet shaker. */
const BASS_GAIN = 0.11;
const SHAKER_GAIN = 0.022;

/** The whole score sits this far under the cues (−3 dB; README "Mix and levels"). */
const SCORE_GAIN = 0.7;

/** Results replay: 8th notes at 120 BPM, at most 32 notes. */
const MELODY_STEP_S = 0.25;
const MELODY_MAX = 32;
const MELODY_GAIN = 0.16;
const MELODY_LEAD_IN_S = 0.35;

/** One sustained pad chord: bass + triad (two detuned oscillators per triad tone), under one envelope. */
class PadChord {
  readonly #voice: Voice;
  readonly #env: GainNode;

  constructor(g: AudioGraph, dest: AudioNode, root: number, chord: Chord, wave: PadVoice, t: number, attack: number) {
    // Not pooled: pads are long and the music owns their lifetime.
    this.#voice = g.voice('music', t, dest, false);
    this.#env = this.#voice.gain(GAIN_FLOOR);
    // setTargetAtTime (not ramps) so a release can take over mid-attack without a jump.
    this.#env.gain.setValueAtTime(GAIN_FLOOR, t);
    this.#env.gain.setTargetAtTime(PAD_VOICE_GAIN[wave], t, attack / 3);
    this.#voice.osc(wave, root * semis(chord.bass), t, undefined, this.#voice.gain(PAD_BASS_GAIN, this.#env));
    for (const tone of chord.tones) {
      const f = root * semis(tone);
      for (const [gain, cents] of [
        [PAD_TONE_GAIN, -PAD_DETUNE_CENTS],
        [PAD_TONE_GAIN * PAD_SECOND, PAD_DETUNE_CENTS],
      ] as const) {
        this.#voice.osc(wave, f, t, undefined, this.#voice.gain(gain, this.#env)).detune.value = cents;
      }
    }
  }

  release(t: number, release: number): void {
    this.#env.gain.setTargetAtTime(GAIN_FLOOR, t, release / 5);
    this.#voice.stopAt(t + release + 0.3);
  }
}

export class Music {
  readonly #g: AudioGraph;
  readonly #clock = new StepClock();
  readonly #slots = new GridSlots();
  readonly #padFilter: BiquadFilterNode;
  readonly #padCutoff: Smoothed;
  readonly #padLevel: Smoothed;
  readonly #duck: Smoothed;
  readonly #muffle: Smoothed;
  readonly #arpOut: readonly AudioNode[];
  /** Centred input of the score (bass, shaker, melody). */
  readonly #center: GainNode;

  #pad: PadChord | null = null;
  #chord: Chord = chordAt(0);
  #chordIndex = 0;
  #chordStep = 0;
  /** Key and palette currently sounding, and the ones the scene asks for (change on the next beat). */
  #keyDay = 1;
  #wantDay = 1;
  #palette: Palette = paletteFor(0);
  #paletteIndex = 0;
  #wantPalette = 0;
  #wantArp = 0;
  #wantVoice: ArpVoice | null = null;
  #wantGroove = 0;
  /** Arpeggio level latched on the beat: rises wait for the beat, drops apply at once. */
  #arpBeatLevel = 0;
  #arpNote = 0;

  #melody: number[] = [];
  #melodyIndex = 0;
  #melodyRoot = 0;
  #melodyNext = 0;

  constructor(g: AudioGraph) {
    this.#g = g;
    const ctx = g.ctx;
    // pad → padFilter → padLevel ┐
    // arp → pan L/R ─────────────┼→ duck → muffle → music bus
    // bass, shaker, melody ──────┘
    const muffle = ctx.createBiquadFilter();
    muffle.type = 'lowpass';
    muffle.Q.value = 0.5;
    muffle.connect(g.buses.music);
    this.#muffle = new Smoothed(muffle.frequency, MUFFLE_OPEN);
    const duck = ctx.createGain();
    duck.connect(muffle);
    this.#duck = new Smoothed(duck.gain, SCORE_GAIN);

    const padLevel = ctx.createGain();
    padLevel.connect(duck);
    this.#padLevel = new Smoothed(padLevel.gain, 0);
    this.#padFilter = ctx.createBiquadFilter();
    this.#padFilter.type = 'lowpass';
    this.#padFilter.Q.value = 0.7;
    this.#padFilter.connect(padLevel);
    this.#padCutoff = new Smoothed(this.#padFilter.frequency, 400);

    this.#arpOut = [-ARP_PAN, ARP_PAN].map((p) => makePanner(ctx, p).connect(duck));
    this.#center = ctx.createGain();
    this.#center.connect(duck);
  }

  /** Continuous targets for this frame. */
  applyScene(s: Readonly<Scene>, now: number): void {
    this.#wantDay = s.day;
    this.#wantPalette = s.palette;
    this.#wantArp = s.arp;
    this.#wantVoice = s.arpVoice;
    this.#wantGroove = s.groove;
    this.#padLevel.set(s.pad, now, 0.5);
    this.#padCutoff.set(s.padCutoff, now, 0.35);
    this.#duck.set(s.duck * SCORE_GAIN, now, s.duck < 1 ? 0.05 : 0.3);
    this.#muffle.set(s.muffle, now, 0.12);
  }

  /** The base key of the palette playing now (tonal one-shots follow it). */
  get key(): number {
    return this.#palette.key;
  }

  /** Schedules every musical event in [now, horizon). */
  pump(now: number, horizon: number): void {
    if (!this.#clock.running) this.#clock.start(now + 0.05);
    this.#clock.advance(now, horizon, this.#onStep);
    this.#pumpMelody(now, horizon);
  }

  /** The next free 16th-note slot at or after `now` (quantized flake bells). */
  gridSlot(now: number): number {
    return this.#slots.claim(this.#clock, now);
  }

  /** Starts the results replay in `day`'s key; returns its duration in seconds. */
  playMelody(degrees: readonly number[], day: number): number {
    this.#melody = degrees.slice(0, MELODY_MAX).map(bellDegree);
    this.#melodyIndex = 0;
    this.#melodyRoot = degreeHz(Math.max(1, Math.floor(day)), 0, 5, this.#palette.key);
    this.#melodyNext = this.#g.now + MELODY_LEAD_IN_S;
    return this.#melody.length * MELODY_STEP_S;
  }

  /** Stops scheduling melody notes (notes already scheduled ring out). */
  stopMelody(): void {
    this.#melody = [];
    this.#melodyIndex = 0;
  }

  readonly #onStep = (step: number, t: number): void => {
    const onBeat = step % 4 === 0;
    const changed = this.#wantDay !== this.#keyDay || this.#wantPalette !== this.#paletteIndex;
    if (this.#pad === null || (changed && onBeat)) {
      // First chord, a dawn key change or a new chapter: start the new key's progression from I.
      const first = this.#pad === null;
      this.#keyDay = this.#wantDay;
      this.#paletteIndex = this.#wantPalette;
      this.#palette = paletteFor(this.#wantPalette);
      this.#clock.stepS = stepSeconds(this.#palette.bpm);
      this.#startChord(step, t, 0, first ? PAD_ATTACK : KEY_ATTACK, first ? PAD_RELEASE : KEY_RELEASE);
    } else if (step - this.#chordStep >= STEPS_PER_CHORD) {
      this.#startChord(step, t, this.#chordIndex + 1, PAD_ATTACK, PAD_RELEASE);
    }

    const root = keyRootHz(this.#keyDay, this.#palette.key);
    const groove = grooveHit(this.#wantGroove, step);
    if (groove & 1) {
      const v = this.#g.voice('music', t, this.#center);
      const f = root * semis(this.#chord.bass);
      v.tone('triangle', f, t, BASS_GAIN * 0.6, 0.004, 0.35);
      v.tone('sine', f * 2, t, BASS_GAIN * 0.4, 0.004, 0.25);
    }
    if (groove & 2) {
      const v = this.#g.voice('music', t, this.#center);
      v.burst(this.#g.white, t, SHAKER_GAIN * (step % 4 === 2 ? 1 : 0.6), 0.008, 0.05, v.filter('bandpass', 5200, 0.9));
    }

    if (onBeat) this.#arpBeatLevel = this.#wantArp;
    if (step % 16 === 0) this.#arpNote = 0;
    const hit = arpHit(Math.min(this.#arpBeatLevel, this.#wantArp), step);
    if (hit === 0) return;
    const n = this.#arpNote++;
    if (Math.random() >= ARP_CHANCE[arpLevel(Math.min(this.#arpBeatLevel, this.#wantArp))]) return;
    const f = root * semis(arpNoteSemis(this.#chord, n, hit));
    const voice = this.#wantVoice ?? this.#palette.arp;
    const v = this.#g.voice('music', t, this.#arpOut[n & 1]);
    const gain = ARP_GAIN[voice];
    if (voice === 'bell') bellTone(v, t, f, gain, 0.7, 0.25);
    else v.tone(voice, f, t, gain, 0.004, ARP_DECAY, voice === 'square' ? v.filter('lowpass', 2200, 0.7) : v.out);
  };

  #startChord(step: number, t: number, index: number, attack: number, release: number): void {
    this.#pad?.release(t, release);
    this.#chordIndex = index;
    this.#chord = chordAt(index, this.#palette.prog);
    this.#chordStep = step;
    this.#pad = new PadChord(this.#g, this.#padFilter, keyRootHz(this.#keyDay, this.#palette.key), this.#chord, this.#palette.pad, t, attack);
  }

  #pumpMelody(now: number, horizon: number): void {
    if (this.#melodyIndex >= this.#melody.length) return;
    // A stalled timer shifts the rest of the tune later rather than playing the backlog at once.
    if (this.#melodyNext < now) this.#melodyNext = now;
    while (this.#melodyIndex < this.#melody.length && this.#melodyNext < horizon) {
      const d = this.#melody[this.#melodyIndex++] as number;
      const t = this.#melodyNext;
      bellTone(this.#g.voice('music', t, this.#center), t, this.#melodyRoot * semis(degreeSemis(d)), MELODY_GAIN, 0.9, 0.3);
      this.#melodyNext += MELODY_STEP_S;
    }
  }
}
