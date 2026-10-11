// Continuous world layers (GDD §12 "Ambience" and the sizzle): the sizzle bed and crackle while
// Nubs is lit, noon cicadas and night crickets. Persistent nodes are built once and steered by
// Scene targets; crackle grains and cricket chirps are scheduled ahead in pump(), which, like the
// music, never schedules anything before `now`.

import { CRACKLE_GRAINS, CRACKLE_SLOT, GAIN_FLOOR, Smoothed, makePanner } from './engine.ts';
import type { AudioGraph } from './engine.ts';
import type { Scene } from './scene.ts';

/**
 * Sizzle: looped white noise → bandpass (Q 0.9) → gain·min(f, 1.5), τ 30 ms (GDD §12). The GDD's
 * 0.22 made full-scale noise the loudest thing in the game; 0.12 puts full sun at ≈ −29 dBFS RMS,
 * clearly "burning" without hissing over the music.
 */
const SIZZLE_GAIN = 0.12;
const SIZZLE_Q = 0.9;
const SIZZLE_TAU = 0.03;
/** Crackle grains: short noise ticks at 20·f per second, gain 0.08. */
const CRACKLE_GAIN = 0.08;
const CRACKLE_HIGHPASS_HZ = 1800;
/**
 * Cicadas peak gain (following the noon window). A Q 6 band keeps only ~4% of white noise's
 * energy, so the GDD's 0.07 measured −51 dBFS RMS (inaudible); 0.4 lands near −36 dBFS.
 */
const CICADA_PEAK = 0.4;
/** Crickets: two sines, panned ±0.4; a chirp is 3 × (25 ms on, 25 ms off). Peaks ≈ −28 dBFS. */
const CRICKET_GAIN = 0.05;
const CHIRP_PULSES = 3;
const CHIRP_ON = 0.025;
const CHIRP_PERIOD = 0.05;
const CHIRP_EDGE = 0.004;
const CHIRP_EVERY = 0.7;
const CHIRP_JITTER = 0.15;

interface Cricket {
  readonly hz: number;
  readonly osc: OscillatorNode;
  readonly gate: GainNode;
  next: number;
}

export class Ambience {
  private readonly g: AudioGraph;
  private readonly sizzleBand: Smoothed;
  private readonly sizzleLevel: Smoothed;
  private readonly crackleIn: GainNode;
  private readonly cicadaLevel: Smoothed;
  private readonly cricketLevel: Smoothed;
  private readonly crickets: readonly Cricket[];
  private crackleRate = 0;
  private crackleNext = 0;
  private cricketsOn = false;

  constructor(g: AudioGraph) {
    this.g = g;
    const ctx = g.ctx;
    const t = ctx.currentTime;

    // Sizzle bed.
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = SIZZLE_Q;
    const sizzle = ctx.createGain();
    band.connect(sizzle).connect(g.buses.sfx);
    this.loop(g.white, band, t);
    this.sizzleBand = new Smoothed(band.frequency, 2500);
    this.sizzleLevel = new Smoothed(sizzle.gain, 0);

    // Crackle grains share one highpass and level.
    const crackleHp = ctx.createBiquadFilter();
    crackleHp.type = 'highpass';
    crackleHp.frequency.value = CRACKLE_HIGHPASS_HZ;
    this.crackleIn = ctx.createGain();
    this.crackleIn.gain.value = CRACKLE_GAIN;
    this.crackleIn.connect(crackleHp).connect(g.buses.sfx);

    // Two cicada choruses, slightly apart in pitch, buzz rate, swell rate and stereo position.
    const cicadas = ctx.createGain();
    cicadas.connect(g.buses.amb);
    this.cicadaLevel = new Smoothed(cicadas.gain, 0);
    this.cicada(5200, 30, 0.3, -0.35, cicadas, t);
    this.cicada(4800, 27, 0.21, 0.35, cicadas, t);

    // Two crickets: persistent sines whose gates get chirp envelopes.
    const crickets = ctx.createGain();
    crickets.connect(g.buses.amb);
    this.cricketLevel = new Smoothed(crickets.gain, 0);
    this.crickets = [
      this.cricket(4400, -0.4, crickets, t),
      this.cricket(4700, 0.4, crickets, t),
    ];
  }

  applyScene(s: Readonly<Scene>, now: number): void {
    this.sizzleLevel.set(SIZZLE_GAIN * s.sizzle, now, SIZZLE_TAU);
    this.sizzleBand.set(s.sizzleHz, now, SIZZLE_TAU);
    this.crackleRate = s.crackle;
    this.cicadaLevel.set(CICADA_PEAK * s.cicadas, now, 0.4);
    this.cricketLevel.set(CRICKET_GAIN * s.crickets, now, 0.6);
    this.cricketsOn = s.crickets > 0.01;
  }

  /** Schedules crackle grains and cricket chirps falling in [now, horizon). */
  pump(now: number, horizon: number): void {
    if (this.crackleRate > 0.5) {
      if (this.crackleNext < now) this.crackleNext = now + this.poissonGap();
      while (this.crackleNext < horizon) {
        this.grain(this.crackleNext);
        this.crackleNext += this.poissonGap();
      }
    }
    if (!this.cricketsOn) return;
    for (const c of this.crickets) {
      if (c.next < now) c.next = now + Math.random() * 0.4;
      while (c.next < horizon) {
        this.chirp(c, c.next);
        c.next += CHIRP_EVERY + (Math.random() * 2 - 1) * CHIRP_JITTER;
      }
    }
  }

  private poissonGap(): number {
    return -Math.log(1 - Math.random()) / this.crackleRate;
  }

  private loop(buffer: AudioBuffer, dest: AudioNode, t: number): void {
    const src = this.g.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.connect(dest);
    src.start(t, Math.random() * buffer.duration);
  }

  /** Bandpassed noise, buzzed by a square LFO (depth 0.5) and swelled by a slow sine LFO. */
  private cicada(hz: number, buzzHz: number, swellHz: number, pan: number, dest: AudioNode, t: number): void {
    const ctx = this.g.ctx;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = hz;
    band.Q.value = 6;
    const buzz = ctx.createGain();
    buzz.gain.value = 0.75; // ± 0.25 from the square LFO → gain swings 0.5..1
    const swell = ctx.createGain();
    swell.gain.value = 0.6; // ± 0.4 from the slow LFO
    const panner = makePanner(ctx, pan);
    band.connect(buzz).connect(swell).connect(panner).connect(dest);
    this.loop(this.g.white, band, t);
    this.lfo('square', buzzHz, 0.25, buzz.gain, t);
    this.lfo('sine', swellHz, 0.4, swell.gain, t);
  }

  private lfo(type: OscillatorType, hz: number, depth: number, target: AudioParam, t: number): void {
    const ctx = this.g.ctx;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = hz;
    const amount = ctx.createGain();
    amount.gain.value = depth;
    osc.connect(amount).connect(target);
    osc.start(t);
  }

  private cricket(hz: number, pan: number, dest: AudioNode, t: number): Cricket {
    const ctx = this.g.ctx;
    const osc = ctx.createOscillator();
    osc.frequency.value = hz;
    const gate = ctx.createGain();
    gate.gain.value = GAIN_FLOOR;
    osc.connect(gate).connect(makePanner(ctx, pan)).connect(dest);
    osc.start(t);
    return { hz, osc, gate, next: 0 };
  }

  /** Three 25 ms pulses with 4 ms edges (no clicks), and a hair of pitch variation per chirp. */
  private chirp(c: Cricket, t: number): void {
    c.osc.frequency.setValueAtTime(c.hz * (1 + (Math.random() - 0.5) * 0.02), t);
    const p = c.gate.gain;
    for (let i = 0; i < CHIRP_PULSES; i++) {
      const t0 = t + i * CHIRP_PERIOD;
      p.setValueAtTime(GAIN_FLOOR, t0);
      p.linearRampToValueAtTime(1, t0 + CHIRP_EDGE);
      p.setValueAtTime(1, t0 + CHIRP_ON - CHIRP_EDGE);
      p.linearRampToValueAtTime(GAIN_FLOOR, t0 + CHIRP_ON);
    }
  }

  /** One crackle tick: a random pre-enveloped grain at a random playback rate. */
  private grain(t: number): void {
    const src = this.g.ctx.createBufferSource();
    src.buffer = this.g.crackle;
    src.playbackRate.value = 0.75 + 0.6 * Math.random();
    src.connect(this.crackleIn);
    src.onended = () => src.disconnect();
    const slot = Math.floor(Math.random() * CRACKLE_GRAINS);
    src.start(t, slot * CRACKLE_SLOT, CRACKLE_SLOT);
  }
}
