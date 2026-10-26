// Continuous world layers (GDD §12 "Ambience" and the sizzle): the sizzle bed and crackle while
// Nubs is lit, noon cicadas, night crickets (also the 'moonlit' bed) and the 'eclipse' drone.
// Crackle grains and cricket chirps are scheduled ahead in pump(), which, like the music, never
// schedules anything before `now`.
//
// Each layer exists only while it can be heard (silent-ambience-dsp-always-on): it is built and
// started on demand, and once it has not been wanted for a while (≥ 1 s and five time constants of
// its fade) its gain is ramped to 0 over 50 ms, its sources stop and its nodes disconnect. Every
// start ramps from gain 0 with the layer's usual fade, so nothing clicks; nothing is built while a
// menu or the Title plays.

import { CRACKLE_GRAINS, CRACKLE_SLOT, GAIN_FLOOR, Smoothed, makePanner } from './engine.ts';
import type { AudioGraph } from './engine.ts';
import type { Scene } from './scene.ts';

/**
 * Sizzle: looped white noise → bandpass (Q 0.9) → gain·min(f, 1.5), τ 30 ms. The GDD's 0.22 made
 * full-scale noise the loudest thing in the game; this level puts full sun just under the reward
 * cues, "burning" without hissing over the music.
 */
const SIZZLE_GAIN = 0.055;
const SIZZLE_Q = 0.9;
const SIZZLE_TAU = 0.03;
/** Crackle grains: short noise ticks at 20·f per second. */
const CRACKLE_GAIN = 0.07;
const CRACKLE_HIGHPASS_HZ = 1800;
/** Cicadas peak gain (a Q 6 band keeps ~4 % of white noise's energy, so it needs a high gain). */
const CICADA_PEAK = 0.4;
const CICADA_TAU = 0.4;
/** Crickets: two sines, panned ±0.4; a chirp is 3 × (25 ms on, 25 ms off). */
const CRICKET_GAIN = 0.05;
const CRICKET_TAU = 0.6;
const CHIRP = { pulses: 3, on: 0.025, period: 0.05, edge: 0.004, every: 0.7, jitter: 0.15 } as const;
/** Eclipse drone: a low open fifth with a slow beat, under a lowpass; fades with the eclipse. */
const DRONE_GAIN = 0.04;
const DRONE_TAU = 0.5;
/** A layer not wanted for this long (s, and ≥ 5 fade time constants) is stopped and disconnected. */
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

/** A built layer: its nodes, its sources and its level (plus the sizzle's and crickets' extras). */
interface Layer {
  readonly level: GainNode;
  readonly levelS: Smoothed;
  readonly nodes: AudioNode[];
  readonly sources: AudioScheduledSourceNode[];
  /** Graph time since which the layer has not been wanted (−1 = wanted). */
  idleSince: number;
  band?: Smoothed;
  crackleIn?: GainNode;
  crickets?: Cricket[];
}

type LayerName = 'sizzle' | 'cicadas' | 'crickets' | 'drone';

function link(a: AudioNode, b: AudioNode | AudioParam): void {
  if (b instanceof AudioParam) a.connect(b);
  else a.connect(b);
}

export class Ambience {
  readonly #g: AudioGraph;
  readonly #layers: Record<LayerName, Layer | null> = { sizzle: null, cicadas: null, crickets: null, drone: null };
  #crackleRate = 0;
  #crackleNext = 0;

  constructor(g: AudioGraph) {
    this.#g = g;
  }

  applyScene(s: Readonly<Scene>, now: number): void {
    const sz = this.#drive('sizzle', s.sizzleOn, SIZZLE_GAIN * s.sizzle, SIZZLE_TAU, now);
    sz?.band?.set(s.sizzleHz, now, SIZZLE_TAU);
    this.#crackleRate = sz && s.sizzleOn ? s.crackle : 0;
    this.#drive('cicadas', s.cicadasOn, CICADA_PEAK * s.cicadas, CICADA_TAU, now);
    this.#drive('crickets', s.crickets > 0.01, CRICKET_GAIN * s.crickets, CRICKET_TAU, now);
    this.#drive('drone', s.drone > 0.001, DRONE_GAIN * s.drone, DRONE_TAU, now);
  }

  /** Schedules crackle grains and cricket chirps falling in [now, horizon). */
  pump(now: number, horizon: number): void {
    const sz = this.#layers.sizzle;
    if (sz?.crackleIn && this.#crackleRate > 0.5) {
      if (this.#crackleNext < now) this.#crackleNext = now + this.#poissonGap();
      while (this.#crackleNext < horizon) {
        this.#grain(sz.crackleIn, this.#crackleNext);
        this.#crackleNext += this.#poissonGap();
      }
    }
    const cr = this.#layers.crickets;
    if (!cr?.crickets || cr.idleSince >= 0) return;
    for (const c of cr.crickets) {
      if (c.next < now) c.next = now + Math.random() * 0.4;
      while (c.next < horizon) {
        this.#chirp(c, c.next);
        c.next += CHIRP.every + (Math.random() * 2 - 1) * CHIRP.jitter;
      }
    }
  }

  /** Stops every layer at once (dispose). */
  stopAll(now: number): void {
    for (const name of Object.keys(this.#layers) as LayerName[]) {
      const l = this.#layers[name];
      if (l) this.#stop(l, now);
      this.#layers[name] = null;
    }
  }

  /** Builds the layer when first wanted, glides its level, and retires it once idle long enough. */
  #drive(name: LayerName, wanted: boolean, level: number, tau: number, now: number): Layer | null {
    let l = this.#layers[name];
    if (wanted && !l) l = this.#layers[name] = this.#build(name, now);
    if (!l) return null;
    l.levelS.set(wanted ? level : 0, now, tau);
    if (wanted) {
      l.idleSince = -1;
      return l;
    }
    if (l.idleSince < 0) l.idleSince = now;
    if (now - l.idleSince < idleFor(tau)) return l;
    this.#stop(l, now);
    this.#layers[name] = null;
    return null;
  }

  #stop(l: Layer, now: number): void {
    const p = l.level.gain;
    // Whatever is left of the fade goes to 0 on a short ramp, then the sources stop.
    p.cancelScheduledValues(now);
    p.setValueAtTime(p.value, now);
    p.linearRampToValueAtTime(0, now + LAYER_STOP_FADE_S);
    let live = l.sources.length;
    const done = (): void => {
      if (--live > 0) return;
      for (const n of l.nodes) n.disconnect();
    };
    for (const src of l.sources) {
      src.onended = done;
      src.stop(now + LAYER_STOP_FADE_S + 0.01);
    }
    if (live === 0) done();
  }

  #build(name: LayerName, t: number): Layer {
    const ctx = this.#g.ctx;
    const level = ctx.createGain();
    level.connect(name === 'sizzle' ? this.#g.buses.sfx : this.#g.buses.amb);
    const l: Layer = { level, levelS: new Smoothed(level.gain, 0), nodes: [level], sources: [], idleSince: -1 };
    // Connects a chain of nodes into the layer's level and tracks them.
    const chain = (...nodes: AudioNode[]): AudioNode => {
      nodes.reduce((a, b) => a.connect(b)).connect(level);
      l.nodes.push(...nodes);
      return nodes[0] as AudioNode;
    };
    const filter = (type: BiquadFilterType, hz: number, q: number): BiquadFilterNode => {
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = hz;
      f.Q.value = q;
      return f;
    };
    const gain = (v: number): GainNode => {
      const gn = ctx.createGain();
      gn.gain.value = v;
      return gn;
    };
    const source = <S extends AudioScheduledSourceNode>(src: S, dest: AudioNode | AudioParam, offset?: number): S => {
      link(src, dest);
      if (src instanceof AudioBufferSourceNode) src.start(t, offset);
      else src.start(t);
      l.sources.push(src);
      l.nodes.push(src);
      return src;
    };
    const noise = (dest: AudioNode): void => {
      const src = ctx.createBufferSource();
      src.buffer = this.#g.white;
      src.loop = true;
      source(src, dest, Math.random() * this.#g.white.duration);
    };
    const osc = (type: OscillatorType, hz: number, dest: AudioNode | AudioParam, depth = 1): OscillatorNode => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = hz;
      if (depth === 1) return source(o, dest);
      const amount = gain(depth);
      link(amount, dest);
      l.nodes.push(amount);
      return source(o, amount);
    };

    switch (name) {
      case 'sizzle': {
        const band = filter('bandpass', 1800, SIZZLE_Q);
        noise(chain(band));
        l.band = new Smoothed(band.frequency, 1800);
        // Crackle grains share one highpass and level, straight to the sfx bus (not under the
        // sizzle level). No grain is pending when the layer stops: grains are scheduled only while
        // it is wanted, and it stops a second after that, far past the 120 ms lookahead.
        const hp = filter('highpass', CRACKLE_HIGHPASS_HZ, 0.7);
        l.crackleIn = gain(CRACKLE_GAIN);
        l.crackleIn.connect(hp).connect(this.#g.buses.sfx);
        l.nodes.push(hp, l.crackleIn);
        this.#crackleNext = 0;
        break;
      }
      case 'cicadas':
        // Two choruses, slightly apart in pitch, buzz rate, swell rate and stereo position: noise
        // through a narrow band, buzzed by a square LFO (gain 0.5..1), swelled by a slow sine.
        for (const [hz, buzzHz, swellHz, pan] of [
          [5200, 30, 0.3, -0.35],
          [4800, 27, 0.21, 0.35],
        ] as const) {
          const buzz = gain(0.75);
          const swell = gain(0.6);
          noise(chain(filter('bandpass', hz, 6), buzz, swell, makePanner(ctx, pan)));
          osc('square', buzzHz, buzz.gain, 0.25);
          osc('sine', swellHz, swell.gain, 0.4);
        }
        break;
      case 'crickets':
        l.crickets = [4400, 4700].map((hz, i) => {
          const gate = gain(GAIN_FLOOR);
          return { hz, gate, osc: osc('sine', hz, chain(gate, makePanner(ctx, i === 0 ? -0.4 : 0.4))), next: 0 };
        });
        break;
      case 'drone': {
        const lp = filter('lowpass', 700, 0.8);
        chain(lp);
        osc('triangle', 110, lp);
        osc('triangle', 165.4, lp);
        osc('sine', 220.6, lp, 0.4);
        osc('sine', 0.13, lp.frequency, 250);
        break;
      }
    }
    return l;
  }

  #poissonGap(): number {
    return -Math.log(1 - Math.random()) / this.#crackleRate;
  }

  /** Three 25 ms pulses with 4 ms edges (no clicks), and a hair of pitch variation per chirp. */
  #chirp(c: Cricket, t: number): void {
    c.osc.frequency.setValueAtTime(c.hz * (1 + (Math.random() - 0.5) * 0.02), t);
    const p = c.gate.gain;
    for (let i = 0; i < CHIRP.pulses; i++) {
      const t0 = t + i * CHIRP.period;
      p.setValueAtTime(GAIN_FLOOR, t0);
      p.linearRampToValueAtTime(1, t0 + CHIRP.edge);
      p.setValueAtTime(1, t0 + CHIRP.on - CHIRP.edge);
      p.linearRampToValueAtTime(GAIN_FLOOR, t0 + CHIRP.on);
    }
  }

  /** One crackle tick: a random pre-enveloped grain at a random playback rate. */
  #grain(dest: GainNode, t: number): void {
    const src = this.#g.ctx.createBufferSource();
    src.buffer = this.#g.crackle;
    src.playbackRate.value = 0.75 + 0.6 * Math.random();
    src.connect(dest);
    src.onended = () => src.disconnect();
    src.start(t, Math.floor(Math.random() * CRACKLE_GRAINS) * CRACKLE_SLOT, CRACKLE_SLOT);
  }
}
