// WebAudio plumbing (archive/TECH_SPEC §10): the lazily created AudioContext and its unlock dance, the
// bus/master/compressor graph, shared noise buffers, and one-shot "voices" with a per-bus
// voice limiter. Recipes, music and ambience build on the AudioGraph defined here.
//
// AudioGraph works on any BaseAudioContext, so the audio lab can render the exact same chain
// into an OfflineAudioContext to measure levels.

/** Every gain envelope starts and ends here (−80 dB); exponential ramps can't reach 0. */
export const GAIN_FLOOR = 0.0001;
/** Sources stop this long after their envelope reaches the floor. */
export const STOP_TAIL = 0.05;

export type BusName = 'sfx' | 'music' | 'amb';

/** Concurrent one-shot voices per bus before the oldest is stolen. */
const VOICE_CAPS: Readonly<Record<BusName, number>> = { sfx: 24, music: 24, amb: 12 };

/** Mix constants (GDD §12, plus a gentle top-end shelf so nothing is shrill on cheap speakers). */
const MASTER_GAIN = 0.9;
const AIR_SHELF_HZ = 7500;
const AIR_SHELF_DB = -3;
const COMP = { threshold: -14, knee: 8, ratio: 4, attack: 0.003, release: 0.25 } as const;
/**
 * Post-compressor trim. The WebAudio compressor adds automatic make-up gain (about +6 dB with the
 * settings above), so signals under the threshold leave the chain louder than they enter it. This
 * trim was set with the audio lab's level check so the loudest realistic pile-up peaks near
 * −6 dBFS while single cues sit around −16 to −10 dBFS.
 */
const OUTPUT_TRIM = 0.9;
/** Ambience follows the music slider, scaled so the default music volume gives the GDD's 0.5. */
const AMB_PER_MUSIC = 0.5 / 0.6;

// ---------------------------------------------------------------------------------------------
// Envelope helpers. All of them start from and return to GAIN_FLOOR, so nothing ever clicks.

/** floor → peak (linear attack) → floor (exponential decay). Returns the time the floor is reached. */
export function perc(p: AudioParam, t: number, peak: number, attack: number, decay: number): number {
  p.setValueAtTime(GAIN_FLOOR, t);
  p.linearRampToValueAtTime(peak, t + attack);
  p.exponentialRampToValueAtTime(GAIN_FLOOR, t + attack + decay);
  return t + attack + decay;
}

/** floor → peak (linear attack) → hold → floor (exponential release). Returns the end time. */
export function ahr(p: AudioParam, t: number, peak: number, attack: number, hold: number, release: number): number {
  p.setValueAtTime(GAIN_FLOOR, t);
  p.linearRampToValueAtTime(peak, t + attack);
  p.setValueAtTime(peak, t + attack + hold);
  p.exponentialRampToValueAtTime(GAIN_FLOOR, t + attack + hold + release);
  return t + attack + hold + release;
}

/** Exponential glide of a (positive) frequency param from `from` to `to` over `dur`. */
export function glide(p: AudioParam, t: number, from: number, to: number, dur: number): void {
  p.setValueAtTime(from, t);
  p.exponentialRampToValueAtTime(to, t + dur);
}

/**
 * Drives an AudioParam toward per-frame targets with setTargetAtTime, skipping updates that
 * would not be audible so the automation timeline doesn't grow every frame.
 */
export class Smoothed {
  private readonly param: AudioParam;
  private target: number;

  constructor(param: AudioParam, initial: number) {
    this.param = param;
    this.target = initial;
    param.value = initial;
  }

  /** Glides toward `value` with time constant `tau` (s), starting at `now`. */
  set(value: number, now: number, tau: number): void {
    const diff = Math.abs(value - this.target);
    if (diff <= 0.005 * Math.max(Math.abs(value), Math.abs(this.target)) + 1e-6) return;
    this.target = value;
    this.param.setTargetAtTime(value, now, tau);
  }
}

// ---------------------------------------------------------------------------------------------
// Voices.

/**
 * One sound event: owns every node it creates, disconnects them all when its last source ends,
 * and can be stolen (faded out in ~20 ms) by the voice limiter. Recipes connect into `out`, or
 * into nodes made with the helpers below (which default to `out`).
 */
export class Voice {
  readonly ctx: BaseAudioContext;
  /** Voice output. Only the limiter automates it, so recipes never fight over its gain. */
  readonly out: GainNode;
  /** Latest scheduled stop time of any of its sources (Infinity while a source is open-ended). */
  end: number;
  private readonly nodes: AudioNode[] = [];
  private readonly sources: AudioScheduledSourceNode[] = [];
  private live = 0;
  private finished = false;
  private readonly onFinish: (v: Voice) => void;

  constructor(ctx: BaseAudioContext, dest: AudioNode, t0: number, onFinish: (v: Voice) => void) {
    this.ctx = ctx;
    this.end = t0;
    this.onFinish = onFinish;
    this.out = ctx.createGain();
    this.out.connect(dest);
    this.nodes.push(this.out);
  }

  /** A gain node; pass `dest = null` to leave it unconnected (e.g. an LFO depth for a param). */
  gain(value: number, dest: AudioNode | null = this.out): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = value;
    if (dest) g.connect(dest);
    this.nodes.push(g);
    return g;
  }

  filter(type: BiquadFilterType, freq: number, q = Math.SQRT1_2, dest: AudioNode = this.out): BiquadFilterNode {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    f.connect(dest);
    this.nodes.push(f);
    return f;
  }

  /** Stereo panner (a plain gain where StereoPannerNode is missing). */
  panner(pan: number, dest: AudioNode = this.out): AudioNode & { pan?: AudioParam } {
    const node = makePanner(this.ctx, pan);
    node.connect(dest);
    this.nodes.push(node);
    return node;
  }

  /** Oscillator started at `start`; stopped STOP_TAIL after `stop` (`undefined` = open-ended). */
  osc(type: OscillatorType, freq: number, start: number, stop: number | undefined, dest: AudioNode = this.out): OscillatorNode {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.connect(dest);
    o.start(start);
    this.track(o, stop);
    return o;
  }

  /** Noise (or any buffer) from a random offset, looping; stopped STOP_TAIL after `stop`. */
  noise(buffer: AudioBuffer, start: number, stop: number, dest: AudioNode = this.out): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource();
    s.buffer = buffer;
    s.loop = true;
    s.connect(dest);
    s.start(start, Math.random() * buffer.duration * 0.9);
    this.track(s, stop);
    return s;
  }

  /** An oscillator with its own percussive envelope. */
  tone(type: OscillatorType, freq: number, t: number, peak: number, attack: number, decay: number, dest: AudioNode = this.out): OscillatorNode {
    const env = this.gain(GAIN_FLOOR, dest);
    const end = perc(env.gain, t, peak, attack, decay);
    return this.osc(type, freq, t, end, env);
  }

  /** A noise burst with its own percussive envelope. */
  burst(buffer: AudioBuffer, t: number, peak: number, attack: number, decay: number, dest: AudioNode = this.out): AudioBufferSourceNode {
    const env = this.gain(GAIN_FLOOR, dest);
    const end = perc(env.gain, t, peak, attack, decay);
    return this.noise(buffer, t, end, env);
  }

  /** Schedules every source to stop at `at` (used by open-ended voices such as pad chords). */
  stopAt(at: number): void {
    for (const s of this.sources) s.stop(at);
    this.end = at;
  }

  /** Steal: fade the whole voice out from `now` and stop it shortly after. */
  kill(now: number): void {
    this.out.gain.setTargetAtTime(0, now, 0.006);
    this.stopAt(now + 0.05);
  }

  private track(src: AudioScheduledSourceNode, stop: number | undefined): void {
    this.sources.push(src);
    this.nodes.push(src);
    this.live++;
    if (stop === undefined) {
      this.end = Number.POSITIVE_INFINITY;
    } else {
      src.stop(stop + STOP_TAIL);
      if (stop + STOP_TAIL > this.end) this.end = stop + STOP_TAIL;
    }
    src.onended = () => {
      if (--this.live === 0) this.finish();
    };
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    for (const n of this.nodes) n.disconnect();
    this.nodes.length = 0;
    this.sources.length = 0;
    this.onFinish(this);
  }
}

/** Caps concurrent voices; when full, the oldest voice is stolen. */
export class VoicePool {
  readonly cap: number;
  private readonly voices: Voice[] = [];

  constructor(cap: number) {
    this.cap = cap;
  }

  add(v: Voice, now: number): void {
    // Drop entries whose sources already stopped (onended can lag, or never come while suspended).
    for (let i = this.voices.length - 1; i >= 0; i--) {
      if ((this.voices[i] as Voice).end < now) this.voices.splice(i, 1);
    }
    if (this.voices.length >= this.cap) this.voices.shift()?.kill(now);
    this.voices.push(v);
  }

  remove(v: Voice): void {
    const i = this.voices.indexOf(v);
    if (i >= 0) this.voices.splice(i, 1);
  }
}

export function makePanner(ctx: BaseAudioContext, pan: number): AudioNode & { pan?: AudioParam } {
  if (typeof ctx.createStereoPanner === 'function') {
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    return p;
  }
  return ctx.createGain();
}

// ---------------------------------------------------------------------------------------------
// Noise buffers, built once per context.

/** Crackle buffer layout: CRACKLE_GRAINS pre-enveloped grains, one per CRACKLE_SLOT seconds. */
export const CRACKLE_GRAINS = 16;
export const CRACKLE_SLOT = 0.006;

/** Seconds of looped white and pink noise per context. */
const NOISE_SECONDS = 2;
/** Prewarm rate: the usual hardware rate; a 44.1 kHz context uses a prefix of the same samples. */
const PREWARM_RATE = 48000;

/**
 * Noise samples computed ahead of the first tap (first-tap-audio-graph-in-gesture): the context
 * and graph are built inside that gesture, and filling ~200k random samples there cost tens of ms
 * on slow phones. prewarmNoise() fills them during the Title's idle time; AudioGraph then copies
 * them into its buffers (copyToChannel) and falls back to computing them if they aren't ready or
 * don't fit (a context faster than 48 kHz; crackle grains, whose envelope is in samples, need the
 * exact rate).
 */
let warm: { rate: number; white: Float32Array<ArrayBuffer>; pink: Float32Array<ArrayBuffer>; crackle: Float32Array<ArrayBuffer> } | null = null;

/** Computes the noise tables once (idempotent). */
export function prewarmNoise(rate: number = PREWARM_RATE): void {
  if (warm && warm.rate === rate) return;
  const n = Math.floor(rate * NOISE_SECONDS);
  warm = { rate, white: fillWhite(new Float32Array(n)), pink: fillPink(new Float32Array(n)), crackle: fillCrackle(new Float32Array(crackleLength(rate)), rate) };
}

/** True once prewarmNoise() has run (tests). */
export function noiseWarm(): boolean {
  return warm !== null;
}

function fillWhite(d: Float32Array): Float32Array<ArrayBuffer> {
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return d as Float32Array<ArrayBuffer>;
}

/** A mono buffer filled from `prefix` (when it is long enough) or by `fill`. */
function noiseBuffer(
  ctx: BaseAudioContext,
  n: number,
  prefix: Float32Array<ArrayBuffer> | null,
  fill: (d: Float32Array) => void,
): AudioBuffer {
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  if (prefix && prefix.length >= n) buf.copyToChannel(prefix.length === n ? prefix : prefix.subarray(0, n), 0);
  else fill(buf.getChannelData(0));
  return buf;
}

function whiteNoise(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  return noiseBuffer(ctx, Math.floor(ctx.sampleRate * seconds), warm?.white ?? null, fillWhite);
}

/** Pink noise via Paul Kellet's refined filter, normalised to a ±0.9 peak. */
function pinkNoise(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  return noiseBuffer(ctx, Math.floor(ctx.sampleRate * seconds), warm?.pink ?? null, fillPink);
}

function fillPink(d: Float32Array): Float32Array<ArrayBuffer> {
  const n = d.length;
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    const v = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
    d[i] = v;
    if (Math.abs(v) > peak) peak = Math.abs(v);
  }
  const k = peak > 0 ? 0.9 / peak : 1;
  for (let i = 0; i < n; i++) d[i] = (d[i] as number) * k;
  return d as Float32Array<ArrayBuffer>;
}

function crackleLength(rate: number): number {
  return Math.floor(rate * CRACKLE_SLOT) * CRACKLE_GRAINS;
}

/** Short noise ticks with a 0.2 ms attack and a ~0.6 ms decay, random level and polarity. */
function fillCrackle(d: Float32Array, rate: number): Float32Array<ArrayBuffer> {
  const slot = Math.floor(rate * CRACKLE_SLOT);
  const atk = Math.max(1, Math.floor(rate * 0.0002));
  const tau = rate * 0.0006;
  for (let g = 0; g < CRACKLE_GRAINS; g++) {
    const amp = 0.45 + 0.55 * Math.random();
    for (let i = 0; i < slot; i++) {
      const env = i < atk ? i / atk : Math.exp(-(i - atk) / tau);
      d[g * slot + i] = amp * env * (Math.random() * 2 - 1);
    }
  }
  return d as Float32Array<ArrayBuffer>;
}

function crackleGrains(ctx: BaseAudioContext): AudioBuffer {
  const rate = ctx.sampleRate;
  const prefix = warm && warm.rate === rate ? warm.crackle : null;
  return noiseBuffer(ctx, crackleLength(rate), prefix, (d) => fillCrackle(d, rate));
}

// ---------------------------------------------------------------------------------------------
// The mix graph.

/**
 * buses (sfx, music, amb) → master (0.9) → air shelf → compressor → out (trim · mute) → destination.
 */
export class AudioGraph {
  readonly ctx: BaseAudioContext;
  readonly buses: Readonly<Record<BusName, GainNode>>;
  /** Sum of all buses before shaping and compression (tap point for meters). */
  readonly master: GainNode;
  readonly compressor: DynamicsCompressorNode;
  /** Final output; mute lives here. */
  readonly out: GainNode;
  readonly white: AudioBuffer;
  readonly pink: AudioBuffer;
  readonly crackle: AudioBuffer;
  private readonly pools: Readonly<Record<BusName, VoicePool>>;
  private readonly busLevels: Readonly<Record<BusName, Smoothed>>;
  private readonly outLevel: Smoothed;

  constructor(ctx: BaseAudioContext, destination: AudioNode = ctx.destination) {
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = MASTER_GAIN;
    const air = ctx.createBiquadFilter();
    air.type = 'highshelf';
    air.frequency.value = AIR_SHELF_HZ;
    air.gain.value = AIR_SHELF_DB;
    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = COMP.threshold;
    this.compressor.knee.value = COMP.knee;
    this.compressor.ratio.value = COMP.ratio;
    this.compressor.attack.value = COMP.attack;
    this.compressor.release.value = COMP.release;
    this.out = ctx.createGain();
    this.master.connect(air);
    air.connect(this.compressor);
    this.compressor.connect(this.out);
    this.out.connect(destination);
    this.outLevel = new Smoothed(this.out.gain, OUTPUT_TRIM);

    const bus = (): GainNode => {
      const g = ctx.createGain();
      g.connect(this.master);
      return g;
    };
    this.buses = { sfx: bus(), music: bus(), amb: bus() };
    this.busLevels = {
      sfx: new Smoothed(this.buses.sfx.gain, 0.8),
      music: new Smoothed(this.buses.music.gain, 0.6),
      amb: new Smoothed(this.buses.amb.gain, 0.6 * AMB_PER_MUSIC),
    };
    this.pools = {
      sfx: new VoicePool(VOICE_CAPS.sfx),
      music: new VoicePool(VOICE_CAPS.music),
      amb: new VoicePool(VOICE_CAPS.amb),
    };
    this.white = whiteNoise(ctx, NOISE_SECONDS);
    this.pink = pinkNoise(ctx, NOISE_SECONDS);
    this.crackle = crackleGrains(ctx);
  }

  get now(): number {
    return this.ctx.currentTime;
  }

  /**
   * A new one-shot voice on `bus` starting at `when`. Pooled voices count toward the bus's
   * limiter; pass `pooled = false` for long-lived voices that manage their own lifetime.
   */
  voice(bus: BusName, when: number, dest: AudioNode = this.buses[bus], pooled = true): Voice {
    const pool = this.pools[bus];
    const v = new Voice(this.ctx, dest, when, pooled ? (done) => pool.remove(done) : () => undefined);
    if (pooled) pool.add(v, this.ctx.currentTime);
    return v;
  }

  /** Settings volumes 0..1. Ambience follows the music slider. */
  setVolumes(sfx: number, music: number): void {
    const now = this.ctx.currentTime;
    const s = clamp01(sfx);
    const m = clamp01(music);
    this.busLevels.sfx.set(s, now, 0.05);
    this.busLevels.music.set(m, now, 0.05);
    this.busLevels.amb.set(m * AMB_PER_MUSIC, now, 0.05);
  }

  setMuted(muted: boolean): void {
    this.outLevel.set(muted ? 0 : OUTPUT_TRIM, this.ctx.currentTime, 0.03);
  }
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

// ---------------------------------------------------------------------------------------------
// The live context: lazy creation, unlock on gestures, visibility suspend/resume.

export type AudioStatus = 'locked' | 'running' | 'suspended' | 'interrupted' | 'closed' | 'unavailable';

/** Gestures that may unlock audio. Touch only counts on pointerup/touchend (archive/CRITIQUE #19). */
const UNLOCK_EVENTS = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'] as const;
const LISTEN: AddEventListenerOptions = { capture: true, passive: true };

interface UserActivationLike {
  readonly isActive: boolean;
  readonly hasBeenActive: boolean;
}

export class AudioEngine {
  /** The mix graph, once the context exists. */
  graph: AudioGraph | null = null;
  private ctx: AudioContext | null = null;
  private unavailable = false;
  private disposed = false;
  private armed = false;
  /** A first-gesture ensure() is queued (see onGesture). */
  private deferred = false;
  private suspendedForHidden = false;
  private lastStatus: AudioStatus = 'locked';
  private readonly targets: EventTarget[] = [];
  private readonly graphListeners: ((g: AudioGraph) => void)[] = [];
  private readonly statusListeners: ((s: AudioStatus) => void)[] = [];

  constructor() {
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisibility);
  }

  get status(): AudioStatus {
    if (this.unavailable) return 'unavailable';
    if (!this.ctx) return 'locked';
    return this.ctx.state;
  }

  get running(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  /** Runs `cb` with the graph as soon as it exists (immediately if it already does). */
  onGraph(cb: (g: AudioGraph) => void): void {
    if (this.graph) cb(this.graph);
    else this.graphListeners.push(cb);
  }

  onStatus(cb: (s: AudioStatus) => void): void {
    this.statusListeners.push(cb);
  }

  /**
   * Creates and/or resumes the context. Safe to call from any input handler, any number of
   * times; it does nothing once audio is running. Call it synchronously inside gesture handlers
   * (iOS only honours resume() there).
   */
  ensure(): void {
    if (this.unavailable || this.disposed || !allowedToStart()) return;
    if (!this.ctx && !this.create()) return;
    const ctx = this.ctx as AudioContext;
    if (ctx.state === 'running' || ctx.state === 'closed') return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    ctx.resume().catch(() => {
      /* Still locked (no activation yet, or an iOS interruption): the next gesture retries. */
    });
    playSilence(ctx);
  }

  /**
   * Listens for gestures on `target` (capture phase, passive) and calls ensure() until audio
   * runs. Listeners re-arm whenever the context drops out of 'running'. Returns a detach function.
   */
  attachUnlock(target: EventTarget): () => void {
    this.targets.push(target);
    if (this.armed) for (const type of UNLOCK_EVENTS) target.addEventListener(type, this.onGesture, LISTEN);
    else this.syncListeners();
    return () => {
      const i = this.targets.indexOf(target);
      if (i < 0) return;
      this.targets.splice(i, 1);
      for (const type of UNLOCK_EVENTS) target.removeEventListener(type, this.onGesture, LISTEN);
    };
  }

  dispose(): void {
    this.disposed = true;
    this.setArmed(false);
    this.targets.length = 0;
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility);
    if (this.ctx && this.ctx.state !== 'closed') void this.ctx.close().catch(() => undefined);
  }

  private create(): boolean {
    const w = globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
    const Ctor = w.AudioContext ?? w.webkitAudioContext;
    if (!Ctor) {
      this.unavailable = true;
      this.emitStatus();
      return false;
    }
    try {
      this.ctx = new Ctor({ latencyHint: 'interactive' });
      this.graph = new AudioGraph(this.ctx);
    } catch {
      this.ctx = null;
      this.graph = null;
      this.unavailable = true;
      this.emitStatus();
      return false;
    }
    this.ctx.addEventListener('statechange', this.onStateChange);
    const graph = this.graph;
    for (const cb of this.graphListeners.splice(0)) cb(graph);
    this.onStateChange();
    return true;
  }

  /**
   * The first pointerdown or keydown builds the context and graph in a task right after the event
   * (first-tap-audio-graph-in-gesture): creating an AudioContext costs tens of ms on phones, and
   * that would otherwise sit inside the press that starts the run. Chrome accepts the late start
   * (the activation is still live); if a browser doesn't, the pointerup/touchend/click that follows
   * calls ensure() inside its own handler, which also covers iOS (its touches only activate on the
   * way up). Once a context exists, every gesture resumes it synchronously.
   */
  private readonly onGesture = (e: Event): void => {
    if (!this.ctx && (e.type === 'pointerdown' || e.type === 'keydown')) {
      if (!this.deferred) {
        this.deferred = true;
        setTimeout(() => {
          this.deferred = false;
          this.ensure();
        }, 0);
      }
      return;
    }
    this.ensure();
  };

  private readonly onStateChange = (): void => {
    this.syncListeners();
    this.emitStatus();
  };

  private readonly onVisibility = (): void => {
    const ctx = this.ctx;
    if (!ctx || ctx.state === 'closed') return;
    if (document.visibilityState === 'hidden') {
      if (ctx.state === 'running') {
        this.suspendedForHidden = true;
        void ctx.suspend().catch(() => undefined);
      }
    } else if (this.suspendedForHidden) {
      this.suspendedForHidden = false;
      // Works without a new gesture where the browser keeps sticky activation; otherwise the
      // re-armed gesture listeners pick it up on the next touch.
      if (allowedToStart()) void ctx.resume().catch(() => undefined);
    }
  };

  private syncListeners(): void {
    const needUnlock = !this.disposed && !this.unavailable && (!this.ctx || (this.ctx.state !== 'running' && this.ctx.state !== 'closed'));
    this.setArmed(needUnlock);
  }

  private setArmed(on: boolean): void {
    if (on === this.armed) return;
    this.armed = on;
    for (const t of this.targets) {
      for (const type of UNLOCK_EVENTS) {
        if (on) t.addEventListener(type, this.onGesture, LISTEN);
        else t.removeEventListener(type, this.onGesture, LISTEN);
      }
    }
  }

  private emitStatus(): void {
    const s = this.status;
    if (s === this.lastStatus) return;
    this.lastStatus = s;
    for (const cb of this.statusListeners) cb(s);
  }
}

/**
 * Whether the browser will let audio start now. Where the User Activation API exists we wait for
 * a real activation (so a touch pointerdown doesn't trigger "AudioContext was not allowed to
 * start" warnings); elsewhere we just try.
 */
function allowedToStart(): boolean {
  if (typeof navigator === 'undefined') return true;
  const ua = (navigator as Navigator & { userActivation?: UserActivationLike }).userActivation;
  return !ua || ua.isActive || ua.hasBeenActive;
}

/** iOS unlock: play a one-sample silent buffer inside the gesture. */
function playSilence(ctx: AudioContext): void {
  try {
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    src.connect(ctx.destination);
    src.onended = () => src.disconnect();
    src.start(0);
  } catch {
    /* A closed or broken context: nothing to unlock. */
  }
}
