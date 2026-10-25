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
  const ctx = new OfflineAudioContext({ numberOfChannels: 4, length: Math.ceil(seconds * SAMPLE_RATE), sampleRate: SAMPLE_RATE });
  const merger = ctx.createChannelMerger(4);
  merger.connect(ctx.destination);
  const capture = (channel: number): AudioNode => {
    // Up-mix mono content the way speakers would before splitting into L/R.
    const stereo = new GainNode(ctx, { channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers' });
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
  return { post: [buf.getChannelData(0), buf.getChannelData(1)], pre: [buf.getChannelData(2), buf.getChannelData(3)], sampleRate: buf.sampleRate };
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
  /** Peak of the last 10 ms before the output falls silent (dBFS): near the peak means a cut-off click. */
  tailDb: number;
}

export function toDb(x: number): number {
  return x > 0 ? 20 * Math.log10(x) : -Infinity;
}

export function measure(r: Rendered): Levels {
  const [l, rr] = r.post;
  const n = l.length;
  const abs = (i: number): number => Math.max(Math.abs(l[i] as number), Math.abs(rr[i] as number));
  let peak = 0;
  let pre = 0;
  let last60 = 0;
  let lastAudible = 0;
  for (let i = 0; i < n; i++) {
    const a = abs(i);
    peak = Math.max(peak, a);
    if (a > 0.001) last60 = i;
    if (a > 0.00001) lastAudible = i;
    pre = Math.max(pre, Math.abs(r.pre[0][i] as number), Math.abs(r.pre[1][i] as number));
  }
  const win = Math.floor(0.1 * r.sampleRate);
  const sq = (i: number): number => (((l[i] as number) + (rr[i] as number)) / 2) ** 2;
  let sum = 0;
  let best = 0;
  for (let i = 0; i < n; i++) {
    sum += sq(i) - (i >= win ? sq(i - win) : 0);
    if (i >= win - 1) best = Math.max(best, sum);
  }
  let tail = 0;
  for (let i = Math.max(0, lastAudible - Math.floor(0.01 * r.sampleRate)); i <= lastAudible; i++) tail = Math.max(tail, abs(i));
  return { peakDb: toDb(peak), rmsDb: toDb(Math.sqrt(Math.max(best, 0) / win)), preDb: toDb(pre), lengthS: last60 / r.sampleRate, tailDb: toDb(tail) };
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
  levelWin: { level: 3 },
  swing: { level: 3 },
  budGrow: { degree: 7 },
};
const LONG: readonly SfxName[] = ['newBest', 'noon', 'nightfall', 'levelWin', 'eclipse', 'rankUp', 'open'];

interface Cue {
  at: number;
  play: (g: AudioGraph, t: number) => void;
}

/**
 * Plays the score and ambience for a fixed view plus timed one-shots, scheduling just in time
 * (OfflineAudioContext.suspend every TICK) exactly like the live loop, so the voice limiter and
 * lookahead behave as they do in the game. Returns the music and ambience (node-count checks).
 */
export function simulate(g: AudioGraph, seconds: number, view: AudioView | null, cues: readonly Cue[] = []): { music: Music; amb: Ambience } | null {
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
  return layers;
}

export function cue(at: number, name: SfxName, params: SfxParams = {}): Cue {
  return { at, play: (g, t) => RECIPES[name](g, t, params) };
}

const NOON_X5: Partial<AudioView> = { screen: 'play', phase: 'day', tDay: 25, dayLength: 50, eps: 48, epsNoon: 48, mult: 5, chill: 100 };

export function levelCases(): LevelCase[] {
  const cases: LevelCase[] = SFX_NAMES.map((name) => ({
    name,
    seconds: LONG.includes(name) ? 3.5 : 2,
    oneShot: true,
    build: (g: AudioGraph) => RECIPES[name](g, T0, CHECK_PARAMS[name] ?? {}),
  }));
  const scene = (name: string, seconds: number, patch: Partial<AudioView>): LevelCase => ({
    name,
    seconds,
    oneShot: false,
    build: (g) => simulate(g, seconds, Object.assign(createAudioView(), patch)),
  });
  const day = { ...NOON_X5, tDay: 10 };
  cases.push(
    { name: 'bell · degree 0', seconds: 1.5, oneShot: true, build: (g) => RECIPES.bell(g, T0, { degree: 0 }) },
    { name: 'levelWin · 1 star', seconds: 3, oneShot: true, build: (g) => RECIPES.levelWin(g, T0, { level: 1 }) },
    scene('title bed', 10, {}),
    scene('score · noon ×1', 10, { ...day, mult: 1 }),
    scene('score · noon ×5', 10, day),
    scene('night · pad + crickets', 8, { screen: 'play', phase: 'night', eps: 0 }),
    scene('cicadas · noon peak', 6, { ...NOON_X5, mult: 1, chill: 30 }),
    scene('sizzle · f 1.5, glare', 4, { ...NOON_X5, f: 1.5, glareW: 1, chill: 30, mult: 1, tDay: 5 }),
    scene('ch 3 Frost · ×3', 10, { ...day, mult: 3, chapter: 3 }),
    scene('ch 10 Clockwork · ×4', 10, { ...day, mult: 4, chapter: 10 }),
    scene('ch 20 Heat Dome · final stretch', 10, { ...day, mult: 2, chapter: 20, progress: 0.9 }),
    scene('moonlit', 8, { ...day, mult: 2, chapter: 12, moonlit: true, eps: 20, epsNoon: 30 }),
    scene('fog', 8, { ...day, mult: 3, chapter: 12, fog: true }),
    scene('eclipse', 8, { ...day, mult: 3, chapter: 14, eclipse: 1 }),
    {
      name: 'mix · worst case',
      seconds: 6,
      oneShot: false,
      build: (g) => {
        // A lit moment at ×5 at noon (arpeggio, groove, sizzle, cicadas) with every loud cue and a
        // run of heartbeats piled on top within half a second, then the win jingle.
        const cues: Cue[] = [
          ...Array.from({ length: 6 }, (_, i) => cue(2 + i * 0.09, 'bell', { degree: 9 - i })),
          ...[2, 2.6, 3.2, 3.8].map((t) => cue(t, 'heartbeat', { strong: true })),
          ...Array.from({ length: 8 }, (_, i) => cue(2 + i * 0.05, 'detent', { index: i })),
          ...(['glare', 'phew', 'crystal', 'cloud', 'gust', 'lock', 'death', 'noon'] as const).map((n, i) => cue(2.05 + i * 0.05, n)),
          cue(2.15, 'multUp', { level: 5 }),
          cue(2.5, 'levelWin', { level: 3 }),
        ];
        simulate(g, 6, Object.assign(createAudioView(), { ...NOON_X5, f: 2, glareW: 1, chill: 45 }), cues);
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
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const cr = Math.cos(ang * k);
        const ci = Math.sin(ang * k);
        const a = i + k;
        const b = a + len / 2;
        const xr = (re[b] as number) * cr - (im[b] as number) * ci;
        const xi = (re[b] as number) * ci + (im[b] as number) * cr;
        re[b] = (re[a] as number) - xr;
        im[b] = (im[a] as number) - xi;
        re[a] = (re[a] as number) + xr;
        im[a] = (im[a] as number) + xi;
      }
    }
  }
}

/**
 * Draws the output's waveform (top quarter, with −6 dBFS guide lines) and a log-frequency
 * spectrogram (50 Hz–20 kHz, −100..0 dB) into `canvas`. Clicks show up as vertical stripes.
 */
export function drawAnalysis(canvas: HTMLCanvasElement, r: Rendered, title: string): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { width: w, height: h } = canvas;
  const waveH = Math.floor(h * 0.25);
  const specH = h - waveH;
  const mono = r.post[0].map((s, i) => (s + (r.post[1][i] as number)) / 2);
  ctx.fillStyle = '#141228';
  ctx.fillRect(0, 0, w, h);
  // Waveform: min/max per column, with the −6 dBFS guides.
  const per = mono.length / w;
  ctx.strokeStyle = '#2EC4B6';
  ctx.beginPath();
  for (let x = 0; x < w; x++) {
    const slice = mono.subarray(Math.floor(x * per), Math.max(Math.floor(x * per) + 1, Math.floor((x + 1) * per)));
    ctx.moveTo(x + 0.5, (waveH / 2) * (1 - Math.max(...slice)));
    ctx.lineTo(x + 0.5, (waveH / 2) * (1 - Math.min(...slice)) + 1);
  }
  ctx.stroke();
  const guide = Math.pow(10, -6 / 20) * (waveH / 2);
  ctx.fillStyle = 'rgba(255,93,93,0.6)';
  ctx.fillRect(0, waveH / 2 - guide, w, 1);
  ctx.fillRect(0, waveH / 2 + guide, w, 1);

  // Spectrogram: a Hann-windowed 2048-point FFT per column, coloured dark blue → teal → white.
  const N = 2048;
  const img = ctx.createImageData(w, specH);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const fLo = Math.log(50);
  const fHi = Math.log(20000);
  const binHz = r.sampleRate / N;
  for (let x = 0; x < w; x++) {
    const centre = Math.floor((x + 0.5) * per);
    for (let i = 0; i < N; i++) {
      const s = mono[centre - N / 2 + i] ?? 0;
      re[i] = s * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
      im[i] = 0;
    }
    fft(re, im);
    for (let y = 0; y < specH; y++) {
      const k = Math.min(N / 2 - 1, Math.round(Math.exp(fHi - ((fHi - fLo) * y) / (specH - 1)) / binHz));
      const db = 20 * Math.log10(Math.hypot(re[k] as number, im[k] as number) / (N / 4) + 1e-12);
      const v = Math.min(1, Math.max(0, (db + 100) / 100));
      const o = (y * w + x) * 4;
      img.data.set([255 * v * v, 40 + 215 * v, 60 + 180 * Math.sqrt(v), 255], o);
    }
  }
  ctx.putImageData(img, 0, waveH);
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,248,238,0.75)';
  for (const f of [100, 300, 1000, 3000, 10000]) {
    const y = waveH + ((fHi - Math.log(f)) / (fHi - fLo)) * (specH - 1);
    ctx.fillRect(0, y, w, 0.5);
    ctx.fillText(f >= 1000 ? `${f / 1000}k` : `${f}`, 4, y - 2);
  }
  ctx.fillText(`${title} · ${(mono.length / r.sampleRate).toFixed(1)} s`, 4, 12);
}
