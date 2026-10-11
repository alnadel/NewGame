// Continuous world layers (GDD §12 "Ambience" and the sizzle): the sizzle bed and crackle while
// Nubs is lit, noon cicadas and night crickets. Crackle grains and cricket chirps are scheduled
// ahead in pump(), which, like the music, never schedules anything before `now`.
//
// Each layer exists only while it can be heard (silent-ambience-dsp-always-on): it is built and
// started on demand (the sizzle bed while the screen is in play, the cicadas from 0.5 s before the
// noon window until it ends, the crickets at night), and once it has not been wanted for a while
// (its target gain at the floor for ≥ 1 s, and five time constants of its fade) its gain is ramped
// to 0 over 50 ms, its sources are stopped and its nodes disconnected. Every start ramps from gain 0 with the layer's usual fade, so nothing
// clicks; nothing is built while a menu or the Title plays.

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
const CICADA_TAU = 0.4;
/** Crickets: two sines, panned ±0.4; a chirp is 3 × (25 ms on, 25 ms off). Peaks ≈ −28 dBFS. */
const CRICKET_GAIN = 0.05;
const CRICKET_TAU = 0.6;
const CHIRP_PULSES = 3;
const CHIRP_ON = 0.025;
const CHIRP_PERIOD = 0.05;
const CHIRP_EDGE = 0.004;
const CHIRP_EVERY = 0.7;
const CHIRP_JITTER = 0.15;
/**
 * A layer not wanted for this long (s) is stopped and disconnected: at least 1 s, and at least five
 * time constants of its fade (cicadas 2 s, crickets 3 s), so it is below −60 dBFS by then.
 */
export const LAYER_IDLE_S = 1;
const idleFor = (tau: number): number => Math.max(LAYER_IDLE_S, 5 * tau);
/** Its final fade to 0 before the sources stop (s). */
export const LAYER_STOP_FADE_S = 0.05;

interface Cricket {
  readonly hz: number;
  readonly osc: OscillatorNode;
  readonly gate: GainNode;
  next: number;
}

/** A built layer: its nodes, its sources and its level. */
interface Layer {
  readonly level: GainNode;
  readonly levelS: Smoothed;
  readonly nodes: AudioNode[];
  readonly sources: AudioScheduledSourceNode[];
  /** Graph time since which the layer has not been wanted (−1 = wanted). */
  idleSince: number;
}

interface SizzleLayer extends Layer {
  readonly band: Smoothed;
  readonly crackleIn: GainNode;
}

interface CricketLayer extends Layer {
  readonly crickets: readonly Cricket[];
}

export class Ambience {
  private readonly g: AudioGraph;
  private sizzle: SizzleLayer | null = null;
  private cicadas: Layer | null = null;
  private crickets: CricketLayer | null = null;
  private crackleRate = 0;
  private crackleNext = 0;
  private cricketsOn = false;
  /** Layer builds and stops so far (tests and the audio lab). */
  starts = 0;
  stops = 0;

  constructor(g: AudioGraph) {
    this.g = g;
  }

  /** Which layers are built right now (tests, the audio lab). */
  get live(): { sizzle: boolean; cicadas: boolean; crickets: boolean } {
    return { sizzle: this.sizzle !== null, cicadas: this.cicadas !== null, crickets: this.crickets !== null };
  }

  applyScene(s: Readonly<Scene>, now: number): void {
      // Sizzle bed and crackle: only in play.
    if (s.sizzleOn && !this.sizzle) this.sizzle = this.buildSizzle(now);
    const sz = this.sizzle;
    if (sz) {
      sz.levelS.set(s.sizzleOn ? SIZZLE_GAIN * s.sizzle : 0, now, SIZZLE_TAU);
      sz.band.set(s.sizzleHz, now, SIZZLE_TAU);
      if (this.idle(sz, s.sizzleOn, now, idleFor(SIZZLE_TAU))) this.sizzle = null;
    }
    this.crackleRate = this.sizzle && s.sizzleOn ? s.crackle : 0;

    // Cicadas: around the noon window.
    if (s.cicadasOn && !this.cicadas) this.cicadas = this.buildCicadas(now);
    const ci = this.cicadas;
    if (ci) {
      ci.levelS.set(s.cicadasOn ? CICADA_PEAK * s.cicadas : 0, now, CICADA_TAU);
      if (this.idle(ci, s.cicadasOn, now, idleFor(CICADA_TAU))) this.cicadas = null;
    }

    // Crickets: at night.
    const night = s.crickets > 0.01;
    if (night && !this.crickets) this.crickets = this.buildCrickets(now);
    const cr = this.crickets;
    if (cr) {
      cr.levelS.set(CRICKET_GAIN * s.crickets, now, CRICKET_TAU);
      if (this.idle(cr, night, now, idleFor(CRICKET_TAU))) this.crickets = null;
    }
    this.cricketsOn = night && this.crickets !== null;
  }

  /** Schedules crackle grains and cricket chirps falling in [now, horizon). */
  pump(now: number, horizon: number): void {
    const sz = this.sizzle;
    if (sz && this.crackleRate > 0.5) {
      if (this.crackleNext < now) this.crackleNext = now + this.poissonGap();
      while (this.crackleNext < horizon) {
        this.grain(sz, this.crackleNext);
        this.crackleNext += this.poissonGap();
      }
    }
    const cr = this.crickets;
    if (!this.cricketsOn || !cr) return;
    for (const c of cr.crickets) {
      if (c.next < now) c.next = now + Math.random() * 0.4;
      while (c.next < horizon) {
        this.chirp(c, c.next);
        c.next += CHIRP_EVERY + (Math.random() * 2 - 1) * CHIRP_JITTER;
      }
    }
  }

  /** Stops every layer at once (dispose). */
  stopAll(now: number): void {
    for (const l of [this.sizzle, this.cicadas, this.crickets]) if (l) this.stop(l, now);
    this.sizzle = null;
    this.cicadas = null;
    this.crickets = null;
  }

  /**
   * Tracks how long the layer has gone unwanted; after `hold` seconds it fades to 0 and stops.
   * Returns true when the layer was stopped.
   */
  private idle(l: Layer, wanted: boolean, now: number, hold: number): boolean {
    if (wanted) {
      l.idleSince = -1;
      return false;
    }
    if (l.idleSince < 0) l.idleSince = now;
    if (now - l.idleSince < hold) return false;
    this.stop(l, now);
    return true;
  }

  private stop(l: Layer, now: number): void {
    const p = l.level.gain;
    // Whatever is left of the fade goes to 0 on a short ramp, then the sources stop.
    p.cancelScheduledValues(now);
    p.setValueAtTime(p.value, now);
    p.linearRampToValueAtTime(0, now + LAYER_STOP_FADE_S);
    const end = now + LAYER_STOP_FADE_S + 0.01;
    let live = l.sources.length;
    const done = (): void => {
      if (--live > 0) return;
      for (const n of l.nodes) n.disconnect();
    };
    for (const src of l.sources) {
      src.onended = done;
      src.stop(end);
    }
    if (live === 0) done();
    this.stops++;
  }

  private layer(dest: AudioNode): Layer {
    const level = this.g.ctx.createGain();
    level.connect(dest);
    // Starts silent: the first target glides up from 0.
    const levelS = new Smoothed(level.gain, 0);
    this.starts++;
    return { level, levelS, nodes: [level], sources: [], idleSince: -1 };
  }

  private buildSizzle(now: number): SizzleLayer {
    const ctx = this.g.ctx;
    const base = this.layer(this.g.buses.sfx);
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = SIZZLE_Q;
    band.connect(base.level);
    base.nodes.push(band);
    this.loop(base, this.g.white, band, now);
    // Crackle grains share one highpass and level, straight to the sfx bus (not under the sizzle
    // level). No grain is pending when the layer stops: grains are scheduled only while it is wanted,
    // and it stops a second after that, far past the 120 ms lookahead.
    const crackleHp = ctx.createBiquadFilter();
    crackleHp.type = 'highpass';
    crackleHp.frequency.value = CRACKLE_HIGHPASS_HZ;
    const crackleIn = ctx.createGain();
    crackleIn.gain.value = CRACKLE_GAIN;
    crackleIn.connect(crackleHp).connect(this.g.buses.sfx);
    base.nodes.push(crackleHp, crackleIn);
    this.crackleNext = 0;
    return { ...base, band: new Smoothed(band.frequency, 2500), crackleIn };
  }

  /** Two cicada choruses, slightly apart in pitch, buzz rate, swell rate and stereo position. */
  private buildCicadas(now: number): Layer {
    const l = this.layer(this.g.buses.amb);
    this.cicada(l, 5200, 30, 0.3, -0.35, now);
    this.cicada(l, 4800, 27, 0.21, 0.35, now);
    return l;
  }

  /** Two crickets: sines whose gates get chirp envelopes. */
  private buildCrickets(now: number): CricketLayer {
    const l = this.layer(this.g.buses.amb);
    const crickets = [this.cricket(l, 4400, -0.4, now), this.cricket(l, 4700, 0.4, now)];
    return { ...l, crickets };
  }

  private poissonGap(): number {
    return -Math.log(1 - Math.random()) / this.crackleRate;
  }

  private loop(l: Layer, buffer: AudioBuffer, dest: AudioNode, t: number): void {
    const src = this.g.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.connect(dest);
    src.start(t, Math.random() * buffer.duration);
    l.sources.push(src);
    l.nodes.push(src);
  }

  /** Bandpassed noise, buzzed by a square LFO (depth 0.5) and swelled by a slow sine LFO. */
  private cicada(l: Layer, hz: number, buzzHz: number, swellHz: number, pan: number, t: number): void {
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
    band.connect(buzz).connect(swell).connect(panner).connect(l.level);
    l.nodes.push(band, buzz, swell, panner);
    this.loop(l, this.g.white, band, t);
    this.lfo(l, 'square', buzzHz, 0.25, buzz.gain, t);
    this.lfo(l, 'sine', swellHz, 0.4, swell.gain, t);
  }

  private lfo(l: Layer, type: OscillatorType, hz: number, depth: number, target: AudioParam, t: number): void {
    const ctx = this.g.ctx;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = hz;
    const amount = ctx.createGain();
    amount.gain.value = depth;
    osc.connect(amount).connect(target);
    osc.start(t);
    l.sources.push(osc);
    l.nodes.push(osc, amount);
  }

  private cricket(l: Layer, hz: number, pan: number, t: number): Cricket {
    const ctx = this.g.ctx;
    const osc = ctx.createOscillator();
    osc.frequency.value = hz;
    const gate = ctx.createGain();
    gate.gain.value = GAIN_FLOOR;
    const panner = makePanner(ctx, pan);
    osc.connect(gate).connect(panner).connect(l.level);
    osc.start(t);
    l.sources.push(osc);
    l.nodes.push(osc, gate, panner);
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
  private grain(l: SizzleLayer, t: number): void {
    const src = this.g.ctx.createBufferSource();
    src.buffer = this.g.crackle;
    src.playbackRate.value = 0.75 + 0.6 * Math.random();
    src.connect(l.crackleIn);
    src.onended = () => src.disconnect();
    const slot = Math.floor(Math.random() * CRACKLE_GRAINS);
    src.start(t, slot * CRACKLE_SLOT, CRACKLE_SLOT);
  }
}
