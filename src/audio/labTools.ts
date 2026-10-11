// Dev-only measurement tools for the audio lab: renders sounds through the real mix chain into an
// OfflineAudioContext and reports levels, and draws waveforms and spectrograms. They exist so the
// mix can be checked objectively (and by people or agents who can't listen right now).

import { Ambience } from './ambience.ts';
import { AudioGraph } from './engine.ts';
import { Music } from './music.ts';
import { RECIPES, SFX_NAMES } from './recipes.ts';
import type { SfxName, SfxParams } from './recipes.ts';
import { createAudioView, createScene, sceneFor } from './scene.ts';
import type { AudioView } from './scene.ts';

const SAMPLE_RATE = 48000;

export interface Rendered {
  /** Post-chain output (what reaches the speakers), L and R. */
  post: [Float32Array, Float32Array];
  /** Pre-compressor master sum, L and R. */
  pre: [Float32Array, Float32Array];
  sampleRate: number;
}

/**
 * Renders `seconds` of audio: `build` schedules sounds on a fresh AudioGraph (default volumes)
 * whose output and pre-compressor master are captured on separate channel pairs.
 */
export async function renderOffline(seconds: number, build: (g: AudioGraph) => void): Promise<Rendered> {
  const length = Math.ceil(seconds * SAMPLE_RATE);
  const ctx = new OfflineAudioContext({ numberOfChannels: 4, length, sampleRate: SAMPLE_RATE });
  const merger = ctx.createChannelMerger(4);
  merger.connect(ctx.destination);
  const capture = (channel: number): AudioNode => {
    // Up-mix mono content the way speakers would before splitting into L/R.
    const stereo = ctx.createGain();
    stereo.channelCount = 2;
    stereo.channelCountMode = 'explicit';
    stereo.channelInterpretation = 'speakers';
    const split = ctx.createChannelSplitter(2);
    stereo.connect(split);
    split.connect(merger, 0, channel);
    split.connect(merger, 1, channel + 1);
    return stereo;
  };
  const g = new AudioGraph(ctx, capture(0));
  g.master.connect(capture(2));
  build(g);
  const buf = await ctx.startRendering();
  return {
    post: [buf.getChannelData(0), buf.getChannelData(1)],
    pre: [buf.getChannelData(2), buf.getChannelData(3)],
    sampleRate: buf.sampleRate,
  };
}

export interface Levels {
  /** Sample peak of the output (dBFS). */
  peakDb: number;
  /** Loudest 100 ms RMS window of the output (dBFS), a rough "momentary loudness". */
  rmsDb: number;
  /** Sample peak before the compressor (dBFS): above ≈ −14 means the compressor is working. */
  preDb: number;
  /** Time until the output last exceeds −60 dBFS (s). */
  lengthS: number;
  /**
   * Peak of the last 10 ms before the output falls silent (dBFS). Far below the peak means the
   * sound faded out; close to it means it was cut off (an audible click).
   */
  tailDb: number;
}

export function toDb(x: number): number {
  return x > 0 ? 20 * Math.log10(x) : -Infinity;
}

export function measure(r: Rendered): Levels {
  const [l, rr] = r.post;
  const n = l.length;
  let peak = 0;
  let pre = 0;
  let last60 = 0;
  let lastAudible = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.max(Math.abs(l[i] as number), Math.abs(rr[i] as number));
    if (a > peak) peak = a;
    if (a > 0.001) last60 = i;
    if (a > 0.00001) lastAudible = i;
    const b = Math.max(Math.abs(r.pre[0][i] as number), Math.abs(r.pre[1][i] as number));
    if (b > pre) pre = b;
  }
  const win = Math.floor(0.1 * r.sampleRate);
  let sum = 0;
  let best = 0;
  for (let i = 0; i < n; i++) {
    const m = ((l[i] as number) + (rr[i] as number)) / 2;
    sum += m * m;
    if (i >= win) {
      const o = ((l[i - win] as number) + (rr[i - win] as number)) / 2;
      sum -= o * o;
    }
    if (i >= win - 1 && sum > best) best = sum;
  }
  let tail = 0;
  for (let i = Math.max(0, lastAudible - Math.floor(0.01 * r.sampleRate)); i <= lastAudible; i++) {
    tail = Math.max(tail, Math.abs(l[i] as number), Math.abs(rr[i] as number));
  }
  return {
    peakDb: toDb(peak),
    rmsDb: toDb(Math.sqrt(Math.max(best, 0) / win)),
    preDb: toDb(pre),
    lengthS: last60 / r.sampleRate,
    tailDb: toDb(tail),
  };
}

// ---------------------------------------------------------------------------------------------
// The level-check programme: every recipe plus the continuous layers and a worst-case pile-up.

export interface LevelCase {
  name: string;
  seconds: number;
  /** One-shots get the tail (cut-off) check; sustained scenes are cut by the render window. */
  oneShot: boolean;
  build: (g: AudioGraph) => void;
}

const T0 = 0.05;
/** Offline renders mimic the live scheduler: wake every TICK s and schedule LOOKAHEAD s ahead. */
const TICK = 0.05;
const LOOKAHEAD = 0.12;

/** Representative parameters for each recipe in the level check. */
const CHECK_PARAMS: Partial<Record<SfxName, SfxParams>> = {
  bell: { degree: 9 },
  multUp: { level: 5 },
  heartbeat: { strong: true },
  flower: { degree: 4 },
};

interface Cue {
  at: number;
  play: (g: AudioGraph, t: number) => void;
}

function viewFor(patch: Partial<AudioView>): AudioView {
  return Object.assign(createAudioView(), patch);
}

/**
 * Plays the score and ambience for a fixed view plus timed one-shots, scheduling just in time
 * (OfflineAudioContext.suspend every TICK) exactly like the live loop, so the voice limiter and
 * lookahead behave as they do in the game.
 */
function simulate(g: AudioGraph, seconds: number, view: AudioView | null, cues: readonly Cue[] = []): void {
  const ctx = g.ctx as OfflineAudioContext;
  const layers = view ? { music: new Music(g), amb: new Ambience(g), scene: sceneFor(view, createScene()) } : null;
  const queue = [...cues].sort((a, b) => a.at - b.at);
  let next = 0;
  const tick = (now: number): void => {
    if (layers) {
      layers.music.applyScene(layers.scene, now);
      layers.amb.applyScene(layers.scene, now);
      layers.music.pump(now, now + LOOKAHEAD);
      layers.amb.pump(now, now + LOOKAHEAD);
    }
    while (next < queue.length && (queue[next] as Cue).at < now + LOOKAHEAD) {
      const c = queue[next++] as Cue;
      c.play(g, Math.max(c.at, now));
    }
  };
  tick(0);
  for (let t = TICK; t < seconds; t += TICK) {
    void ctx.suspend(t).then(() => {
      tick(ctx.currentTime);
      void ctx.resume();
    });
  }
}

function cue(at: number, name: SfxName, params: SfxParams = {}): Cue {
  return { at, play: (g, t) => RECIPES[name](g, t, params) };
}

const NOON_X5: Partial<AudioView> = { screen: 'play', phase: 'day', tDay: 25, dayLength: 50, eps: 48, epsNoon: 48, mult: 5, chill: 100 };

export function levelCases(): LevelCase[] {
  const cases: LevelCase[] = SFX_NAMES.map((name) => ({
    name,
    seconds: name === 'newBest' || name === 'noon' || name === 'nightfall' ? 3.5 : 2,
    oneShot: true,
    build: (g: AudioGraph) => RECIPES[name](g, T0, CHECK_PARAMS[name] ?? {}),
  }));
  const scene = (name: string, seconds: number, patch: Partial<AudioView>): LevelCase => ({
    name,
    seconds,
    oneShot: false,
    build: (g) => simulate(g, seconds, viewFor(patch)),
  });
  cases.push(
    { name: 'bell · degree 0', seconds: 1.5, oneShot: true, build: (g) => RECIPES.bell(g, T0, { degree: 0 }) },
    {
      name: 'heartbeat · 3 beats',
      seconds: 2.5,
      oneShot: true,
      build: (g) => simulate(g, 2.5, null, [0, 0.6, 1.2].map((dt) => cue(T0 + dt, 'heartbeat', { strong: true }))),
    },
    scene('pad · title', 10, {}),
    scene('score · noon ×1', 10, { ...NOON_X5, mult: 1, tDay: 10 }),
    scene('score · noon ×5', 10, { ...NOON_X5, tDay: 10 }),
    scene('night · pad + crickets', 8, { screen: 'play', phase: 'night', eps: 0 }),
    scene('cicadas · noon peak', 6, { ...NOON_X5, mult: 1, chill: 30 }),
    scene('sizzle · f 1.5, glare', 4, { ...NOON_X5, f: 1.5, glareW: 1, chill: 30, mult: 1, tDay: 5 }),
    {
      name: 'mix · worst case',
      seconds: 6,
      oneShot: false,
      build: (g) => {
        // A lit moment at ×5 at noon (arpeggio, sizzle, cicadas) with every loud cue and a run of
        // heartbeats piled on top within half a second.
        const cues: Cue[] = [
          ...Array.from({ length: 6 }, (_, i) => cue(2 + i * 0.09, 'bell', { degree: 9 - i })),
          ...[2, 2.6, 3.2, 3.8].map((t) => cue(t, 'heartbeat', { strong: true })),
          ...Array.from({ length: 8 }, (_, i) => cue(2 + i * 0.05, 'detent', { index: i })),
          cue(2.05, 'glare'),
          cue(2.1, 'phew'),
          cue(2.15, 'multUp', { level: 5 }),
          cue(2.2, 'crystal'),
          cue(2.25, 'catch'),
          cue(2.3, 'cloud'),
          cue(2.4, 'death'),
        ];
        simulate(g, 6, viewFor({ ...NOON_X5, f: 2, glareW: 1, chill: 45 }), cues);
      },
    },
  );
  return cases;
}

// ---------------------------------------------------------------------------------------------
// Drawing.

/** In-place iterative radix-2 FFT (re/im arrays of power-of-two length). */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j] as number, re[i] as number];
      [im[i], im[j]] = [im[j] as number, im[i] as number];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const xr = (re[b] as number) * cr - (im[b] as number) * ci;
        const xi = (re[b] as number) * ci + (im[b] as number) * cr;
        re[b] = (re[a] as number) - xr;
        im[b] = (im[a] as number) - xi;
        re[a] = (re[a] as number) + xr;
        im[a] = (im[a] as number) + xi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

/** Maps 0..1 to a dark-blue → teal → gold → white ramp. */
function heat(v: number): [number, number, number] {
  const stops: readonly (readonly [number, number, number])[] = [
    [20, 18, 40],
    [43, 33, 100],
    [46, 196, 182],
    [255, 194, 61],
    [255, 255, 240],
  ];
  const x = Math.min(0.9999, Math.max(0, v)) * (stops.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  const a = stops[i] as readonly [number, number, number];
  const b = stops[i + 1] as readonly [number, number, number];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

/**
 * Draws the output's waveform (top quarter, with −6 dBFS guide lines) and a log-frequency
 * spectrogram (50 Hz–20 kHz, −100..0 dB) into `canvas`. Clicks show up as vertical stripes.
 */
export function drawAnalysis(canvas: HTMLCanvasElement, r: Rendered, title: string): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  const waveH = Math.floor(h * 0.25);
  const specH = h - waveH;
  const mono = new Float32Array(r.post[0].length);
  for (let i = 0; i < mono.length; i++) mono[i] = ((r.post[0][i] as number) + (r.post[1][i] as number)) / 2;

  ctx.fillStyle = '#141228';
  ctx.fillRect(0, 0, w, h);
  // Waveform: min/max per column.
  const per = mono.length / w;
  ctx.strokeStyle = '#2EC4B6';
  ctx.beginPath();
  for (let x = 0; x < w; x++) {
    let lo = 1;
    let hi = -1;
    const end = Math.min(mono.length, Math.floor((x + 1) * per));
    for (let i = Math.floor(x * per); i < end; i++) {
      const s = mono[i] as number;
      if (s < lo) lo = s;
      if (s > hi) hi = s;
    }
    ctx.moveTo(x + 0.5, waveH / 2 - hi * (waveH / 2));
    ctx.lineTo(x + 0.5, waveH / 2 - lo * (waveH / 2) + 1);
  }
  ctx.stroke();
  const guide = Math.pow(10, -6 / 20) * (waveH / 2);
  ctx.strokeStyle = 'rgba(255,93,93,0.6)';
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(0, waveH / 2 - guide);
  ctx.lineTo(w, waveH / 2 - guide);
  ctx.moveTo(0, waveH / 2 + guide);
  ctx.lineTo(w, waveH / 2 + guide);
  ctx.stroke();
  ctx.setLineDash([]);

  // Spectrogram.
  const N = 2048;
  const hann = new Float64Array(N);
  for (let i = 0; i < N; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
  const img = ctx.createImageData(w, specH);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const fLo = Math.log(50);
  const fHi = Math.log(20000);
  const binHz = r.sampleRate / N;
  const column = new Float64Array(N / 2);
  for (let x = 0; x < w; x++) {
    const centre = Math.floor((x + 0.5) * per);
    for (let i = 0; i < N; i++) {
      const s = centre - N / 2 + i;
      re[i] = s >= 0 && s < mono.length ? (mono[s] as number) * (hann[i] as number) : 0;
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 0; k < N / 2; k++) {
      const mag = Math.hypot(re[k] as number, im[k] as number) / (N / 4);
      column[k] = 20 * Math.log10(mag + 1e-12);
    }
    for (let y = 0; y < specH; y++) {
      const f = Math.exp(fHi - ((fHi - fLo) * y) / (specH - 1));
      const db = column[Math.min(N / 2 - 1, Math.round(f / binHz))] as number;
      const [cr, cg, cb] = heat((db + 100) / 100);
      const o = (y * w + x) * 4;
      img.data[o] = cr;
      img.data[o + 1] = cg;
      img.data[o + 2] = cb;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, waveH);
  // Frequency gridlines and labels.
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,248,238,0.75)';
  ctx.strokeStyle = 'rgba(255,248,238,0.18)';
  for (const f of [100, 300, 1000, 3000, 10000]) {
    const y = waveH + ((fHi - Math.log(f)) / (fHi - fLo)) * (specH - 1);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
    ctx.fillText(f >= 1000 ? `${f / 1000}k` : `${f}`, 4, y - 2);
  }
  const seconds = mono.length / r.sampleRate;
  ctx.fillText(`${title} · ${seconds.toFixed(1)} s`, 4, 12);
}
