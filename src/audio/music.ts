// Adaptive score (GDD §12): a 90 BPM 16th-note grid scheduled ahead of time, a detuned-saw pad
// cycling I-vi-IV-V every 4 bars with crossfades, a pluck arpeggio whose density follows the
// Frost multiplier, a key change every dawn, and the results-screen melody replay.
//
// Nothing here runs on its own timer: the owner calls pump(now, horizon) (from a 25 ms interval
// and every frame) and applyScene() every frame. pump() only ever schedules what falls inside
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
  keyRootHz,
  semis,
} from './theory.ts';
import type { Chord } from './theory.ts';
import { GridSlots, StepClock } from './timing.ts';

/**
 * Gain of each triad tone's main saw (its detuned twin runs at PAD_SECOND_SAW of this) and of the
 * bass saw. The GDD's 0.035 per tone masked the arpeggio completely in the level check; at these
 * levels the pad is a soft bed at ≈ −31 dBFS RMS.
 */
const PAD_TONE_GAIN = 0.028;
const PAD_BASS_GAIN = 0.03;
/**
 * The GDD's two equal saws at ±7 cents cancel completely at each tone's fundamental 1-2 times a
 * second (clear on/off stripes in the lab's spectrogram, an audible tremolo once the dawn cutoff
 * leaves mostly fundamentals). ±4 cents at a 1 : 0.6 balance keeps the chorus but makes it a slow,
 * shallow shimmer; the bass is a single saw so the low end never pumps.
 */
const PAD_DETUNE_CENTS = 4;
const PAD_SECOND_SAW = 0.6;
const PAD_Q = 0.7;
/** Regular chord changes crossfade 1.5 s in / 2 s out; a dawn key change is quicker and brighter. */
const PAD_ATTACK = 1.5;
const PAD_RELEASE = 2;
const KEY_ATTACK = 0.5;
const KEY_RELEASE = 1;

/** Raised from the GDD's 0.03 so plucks read clearly over the pad (peaks ≈ −22 dBFS). */
const ARP_GAIN = 0.09;
/**
 * Time for a pluck to fall to the −80 dB floor. The GDD's 180 ms, read that way, leaves a 26 ms
 * click; 0.4 s gives a soft marimba-like pluck that still never smears at ×5.
 */
const ARP_DECAY = 0.4;
const ARP_PAN = 0.3;

/** Results replay: 8th notes at 120 BPM, at most 32 notes. */
const MELODY_STEP_S = 0.25;
const MELODY_MAX = 32;
const MELODY_GAIN = 0.12;
const MELODY_LEAD_IN_S = 0.35;

/** One sustained pad chord: bass + triad (two detuned saws per triad tone), under one envelope. */
class PadChord {
  private readonly voice: Voice;
  private readonly env: GainNode;

  constructor(g: AudioGraph, dest: AudioNode, day: number, chord: Chord, t: number, attack: number) {
    // Not pooled: pads are long and the music owns their lifetime.
    this.voice = g.voice('music', t, dest, false);
    this.env = this.voice.gain(GAIN_FLOOR);
    // setTargetAtTime (not ramps) so a release can take over mid-attack without a jump.
    this.env.gain.setValueAtTime(GAIN_FLOOR, t);
    this.env.gain.setTargetAtTime(1, t, attack / 3);
    const root = keyRootHz(day);
    this.voice.osc('sawtooth', root * semis(chord.bass), t, undefined, this.voice.gain(PAD_BASS_GAIN, this.env));
    for (const tone of chord.tones) {
      const f = root * semis(tone);
      const main = this.voice.gain(PAD_TONE_GAIN, this.env);
      const second = this.voice.gain(PAD_TONE_GAIN * PAD_SECOND_SAW, this.env);
      this.voice.osc('sawtooth', f, t, undefined, main).detune.value = -PAD_DETUNE_CENTS;
      this.voice.osc('sawtooth', f, t, undefined, second).detune.value = PAD_DETUNE_CENTS;
    }
  }

  release(t: number, release: number): void {
    this.env.gain.setTargetAtTime(GAIN_FLOOR, t, release / 5);
    this.voice.stopAt(t + release + 0.3);
  }
}

export class Music {
  private readonly g: AudioGraph;
  private readonly clock = new StepClock();
  private readonly slots = new GridSlots();
  private readonly padFilter: BiquadFilterNode;
  private readonly padCutoff: Smoothed;
  private readonly padLevel: Smoothed;
  private readonly duck: Smoothed;
  private readonly muffle: Smoothed;
  private readonly arpOut: readonly AudioNode[];
  private readonly melodyOut: GainNode;

  private pad: PadChord | null = null;
  private chord: Chord = chordAt(0);
  private chordIndex = 0;
  private chordStep = 0;
  /** Key currently sounding, and the one the scene asks for (changes on the next beat). */
  private keyDay = 1;
  private wantDay = 1;
  private wantArp = 0;
  /** Arpeggio level latched on the beat: rises wait for the beat, drops apply at once. */
  private arpBeatLevel = 0;
  private arpNote = 0;

  private melody: number[] = [];
  private melodyIndex = 0;
  private melodyDay = 1;
  private melodyNext = 0;

  constructor(g: AudioGraph) {
    this.g = g;
    const ctx = g.ctx;
    // pad → padFilter → padLevel ┐
    // arp → pan L/R ─────────────┼→ duck → muffle → music bus
    // melody ────────────────────┘
    const muffle = ctx.createBiquadFilter();
    muffle.type = 'lowpass';
    muffle.Q.value = 0.5;
    muffle.connect(g.buses.music);
    this.muffle = new Smoothed(muffle.frequency, MUFFLE_OPEN);
    const duck = ctx.createGain();
    duck.connect(muffle);
    this.duck = new Smoothed(duck.gain, 1);

    const padLevel = ctx.createGain();
    padLevel.connect(duck);
    this.padLevel = new Smoothed(padLevel.gain, 0);
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.Q.value = PAD_Q;
    this.padFilter.connect(padLevel);
    this.padCutoff = new Smoothed(this.padFilter.frequency, 400);

    this.arpOut = [-ARP_PAN, ARP_PAN].map((p) => {
      const pan = makePanner(ctx, p);
      pan.connect(duck);
      return pan;
    });
    this.melodyOut = ctx.createGain();
    this.melodyOut.connect(duck);
  }

  /** Continuous targets for this frame. */
  applyScene(s: Readonly<Scene>, now: number): void {
    this.wantDay = s.day;
    this.wantArp = s.arp;
    this.padLevel.set(s.pad, now, 0.5);
    this.padCutoff.set(s.padCutoff, now, 0.35);
    this.duck.set(s.duck, now, s.duck < 1 ? 0.05 : 0.3);
    this.muffle.set(s.muffle, now, 0.12);
  }

  /** Schedules every musical event in [now, horizon). */
  pump(now: number, horizon: number): void {
    if (!this.clock.running) this.clock.start(now + 0.05);
    this.clock.advance(now, horizon, this.onStep);
    this.pumpMelody(now, horizon);
  }

  /** The next free 16th-note slot at or after `now` (quantized flake bells). */
  gridSlot(now: number): number {
    return this.slots.claim(this.clock, now);
  }

  /** Starts the results replay; returns its duration in seconds. */
  playMelody(degrees: readonly number[], day: number): number {
    this.melody = degrees.slice(0, MELODY_MAX).map(bellDegree);
    this.melodyIndex = 0;
    this.melodyDay = Math.max(1, Math.floor(day));
    this.melodyNext = this.g.now + MELODY_LEAD_IN_S;
    return this.melody.length * MELODY_STEP_S;
  }

  /** Stops scheduling melody notes (notes already scheduled ring out). */
  stopMelody(): void {
    this.melody = [];
    this.melodyIndex = 0;
  }

  private readonly onStep = (step: number, t: number): void => {
    const onBeat = step % 4 === 0;
    if (this.pad === null) {
      this.keyDay = this.wantDay;
      this.startChord(step, t, 0, PAD_ATTACK, PAD_RELEASE);
    } else if (this.wantDay !== this.keyDay && onBeat) {
      // Dawn: change key on the next beat, starting the new key's progression from I.
      this.keyDay = this.wantDay;
      this.startChord(step, t, 0, KEY_ATTACK, KEY_RELEASE);
    } else if (step - this.chordStep >= STEPS_PER_CHORD) {
      this.startChord(step, t, this.chordIndex + 1, PAD_ATTACK, PAD_RELEASE);
    }

    if (onBeat) this.arpBeatLevel = this.wantArp;
    if (step % 16 === 0) this.arpNote = 0;
    const level = Math.min(this.arpBeatLevel, this.wantArp);
    const hit = arpHit(level, step);
    if (hit === 0) return;
    const n = this.arpNote++;
    if (Math.random() >= ARP_CHANCE[arpLevel(level)]) return;
    const f = keyRootHz(this.keyDay) * semis(arpNoteSemis(this.chord, n, hit));
    const v = this.g.voice('music', t, this.arpOut[n & 1]);
    v.tone('triangle', f, t, ARP_GAIN, 0.004, ARP_DECAY);
  };

  private startChord(step: number, t: number, index: number, attack: number, release: number): void {
    this.pad?.release(t, release);
    this.chordIndex = index;
    this.chord = chordAt(index);
    this.chordStep = step;
    this.pad = new PadChord(this.g, this.padFilter, this.keyDay, this.chord, t, attack);
  }

  private pumpMelody(now: number, horizon: number): void {
    if (this.melodyIndex >= this.melody.length) return;
    // A stalled timer shifts the rest of the tune later rather than playing the backlog at once.
    if (this.melodyNext < now) this.melodyNext = now;
    while (this.melodyIndex < this.melody.length && this.melodyNext < horizon) {
      const d = this.melody[this.melodyIndex++] as number;
      const t = this.melodyNext;
      const v = this.g.voice('music', t, this.melodyOut);
      bellTone(v, t, degreeHz(this.melodyDay, d, 5), MELODY_GAIN, 0.9, 0.3);
      this.melodyNext += MELODY_STEP_S;
    }
  }
}
