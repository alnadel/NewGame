// Headless players for tuning and tests (V1_PLAN §13). Each bot maps the state to one InputFrame per
// tick, holds the "finger" down and steers the sun at a capped turn rate.
//
// - idle: taps to start, then never touches the sun (holds θ0).
// - novice: sees guide.now 200 ms late, turns at 180°/s, heads for the nearest wide safe arc.
// - reactive: sees guide.now and guide.next without lag, turns at 200°/s.
// - oracle: plans with the validator's per-step lit counts (3-step human model) over a 4 s horizon
//   using a backward "Chill needed to survive" DP, and turns at 240°/s.

import { dayParams } from '../../config/days.ts';
import { TUNING } from '../../config/tuning.ts';
import { dayAtTick, dayStartTick, DT, elevation, TICK_HZ } from '../clock.ts';
import { angleDiff, wrapDeg } from '../dmath.ts';
import { chillDeltaTable, slidingMaxCircular, stepLit } from '../gen/validator.ts';
import { BINS, binOf } from '../intervals.ts';
import type { InputFrame, SimState } from './types.ts';

export type BotKind = 'idle' | 'novice' | 'reactive' | 'oracle';
export const BOT_KINDS: readonly BotKind[] = Object.freeze(['idle', 'novice', 'reactive', 'oracle'] as BotKind[]);

export interface Bot {
  readonly kind: BotKind;
  /** Input for the next tick of `s`. The returned frame is reused; copy it to keep it. */
  next(s: SimState): InputFrame;
}

const quantize = (d: number): number => Math.round(d * 1024) / 1024;

function frame(): InputFrame {
  return { dTheta: 0, down: false, downEdge: false, upEdge: false, release: 0, key: 0 };
}

/** Finger held, turning toward `target` (°) at ≤ rate °/s. The first call touches down. */
function steer(f: InputFrame, s: SimState, target: number, rate: number, first: boolean): InputFrame {
  const cur = wrapDeg(s.sun.theta + s.sun.lag);
  const max = rate * DT;
  const d = angleDiff(target, cur);
  f.dTheta = quantize(d > max ? max : d < -max ? -max : d);
  f.down = true;
  f.downEdge = first;
  f.upEdge = false;
  f.release = 0;
  f.key = 0;
  return f;
}

function idleBot(): Bot {
  const f = frame();
  let started = false;
  return {
    kind: 'idle',
    next(): InputFrame {
      // A tap starts the run (catch + release at 0°/s); afterwards the sun is left alone.
      f.downEdge = !started;
      f.upEdge = !started;
      f.down = false;
      started = true;
      return f;
    },
  };
}

/** Picks the bin maximizing blurred safety minus a distance penalty, or −1 if nothing is safe. */
function pickArc(score: Uint8Array | Float64Array, blur: number, penalty: number, from: number): number {
  let best = -1;
  let bestV = 0;
  for (let b = 0; b < BINS; b++) {
    let sum = 0;
    for (let k = -blur; k <= blur; k++) sum += score[(b + k + BINS) % BINS] as number;
    if (sum <= 0 || (score[b] as number) <= 0) continue;
    let d = Math.abs(b - from);
    if (d > 180) d = 360 - d;
    const v = sum - penalty * d;
    if (best < 0 || v > bestV) {
      best = b;
      bestV = v;
    }
  }
  return best;
}

function noviceBot(): Bot {
  const cfg = TUNING.bots.novice;
  const f = frame();
  // Ring of past guide.now masks with the sim tick they were computed on.
  const SLOTS = 8;
  const masks: Uint8Array[] = [];
  const ticks = new Float64Array(SLOTS).fill(-1);
  for (let i = 0; i < SLOTS; i++) masks.push(new Uint8Array(BINS));
  let head = 0;
  let seenGuide = -1;
  let used = -1;
  let target = -1;
  let started = false;
  return {
    kind: 'novice',
    next(s: SimState): InputFrame {
      if (s.guide.tick !== seenGuide) {
        seenGuide = s.guide.tick;
        (masks[head] as Uint8Array).set(s.guide.now);
        ticks[head] = s.guide.tick;
        head = (head + 1) % SLOTS;
      }
      // Newest mask at least lagTicks old.
      let pick = -1;
      for (let i = 0; i < SLOTS; i++) {
        const t = ticks[i] as number;
        if (t >= 0 && t <= s.tick - cfg.lagTicks && (pick < 0 || t > (ticks[pick] as number))) pick = i;
      }
      if (target < 0) target = s.sun.theta;
      if (pick >= 0 && ticks[pick] !== used) {
        used = ticks[pick] as number;
        const b = pickArc(masks[pick] as Uint8Array, cfg.blur, cfg.penalty, binOf(s.sun.theta));
        if (b >= 0) target = b;
      }
      const out = steer(f, s, target, cfg.rate, !started);
      started = true;
      return out;
    },
  };
}

function reactiveBot(): Bot {
  const cfg = TUNING.bots.reactive;
  const f = frame();
  const score = new Float64Array(BINS);
  let seenGuide = -1;
  let target = -1;
  let started = false;
  return {
    kind: 'reactive',
    next(s: SimState): InputFrame {
      if (target < 0) target = s.sun.theta;
      if (s.guide.tick !== seenGuide) {
        seenGuide = s.guide.tick;
        for (let b = 0; b < BINS; b++) score[b] = cfg.nowWeight * (s.guide.now[b] as number) + cfg.nextWeight * (s.guide.next[b] as number);
        const b = pickArc(score, cfg.blur, cfg.penalty, binOf(s.sun.theta));
        if (b >= 0) target = b;
      }
      const out = steer(f, s, target, cfg.rate, !started);
      started = true;
      return out;
    },
  };
}

const INF = 1e9;
const STEP = TUNING.validator.stepTicks;

function oracleBot(): Bot {
  const cfg = TUNING.bots.oracle;
  const H = cfg.horizonSteps;
  const f = frame();
  const lits = new Uint8Array((H + 3) * BINS);
  const row = new Uint8Array(BINS);
  const night = new Uint8Array(H + 3);
  const need = new Float64Array((H + 1) * BINS);
  const tmp = new Float64Array(BINS);
  const win = new Float64Array(BINS);
  const maxC = TUNING.nubs.maxChill;
  const reach = Math.round(cfg.rate * STEP * DT);
  let target = -1;
  let started = false;

  /** Lit count of step j0 + i at bin b with the 3-step human-model max (rows hold j0 − 1 … j0 + H + 1). */
  const litH = (i: number, b: number): number => {
    const a = lits[i * BINS + b] as number;
    const m = lits[(i + 1) * BINS + b] as number;
    const c = lits[(i + 2) * BINS + b] as number;
    return a > m ? (a > c ? a : c) : m > c ? m : c;
  };

  function plan(s: SimState): void {
    const j0 = Math.round(s.tickAbs / STEP);
    for (let h = 0; h < H + 3; h++) {
      const j = j0 - 1 + h;
      stepLit(s.world, j, row);
      lits.set(row, h * BINS);
      const tick = j * STEP;
      const d = dayAtTick(tick);
      night[h] = elevation(dayParams(d, s.cfg.profile), (tick - dayStartTick(d)) / TICK_HZ) > 0 ? 0 : 1;
    }
    const delta = chillDeltaTable(s.params.drain);
    // need[i][b]: least Chill after step j0 + i at bin b that still survives to the horizon.
    need.fill(cfg.margin, H * BINS, (H + 1) * BINS);
    for (let i = H - 1; i >= 0; i--) {
      const o = i * BINS;
      if (night[i + 2] === 1) {
        need.fill(cfg.margin, o, o + BINS); // the next step is night: Chill refills
        continue;
      }
      const on = (i + 1) * BINS;
      for (let b = 0; b < BINS; b++) {
        const nn = need[on + b] as number;
        const req = nn - (delta[litH(i + 1, b)] as number);
        tmp[b] = nn > maxC ? -INF : -(req < cfg.margin ? cfg.margin : req);
      }
      slidingMaxCircular(tmp, cfg.planBins, win);
      for (let b = 0; b < BINS; b++) need[o + b] = -(win[b] as number);
    }
    // Choose the next step's bin within actual reach: most slack (capped), least turning.
    const b0 = binOf(wrapDeg(s.sun.theta + s.sun.lag));
    const c = s.nubs.chill;
    let best = b0;
    let bestV = -Infinity;
    for (let k = -reach; k <= reach; k++) {
      const b = (b0 + k + BINS) % BINS;
      let next = c + (delta[litH(1, b)] as number);
      if (next > maxC) next = maxC;
      const slack = next - (need[BINS + b] as number);
      const v = (slack > cfg.slackCap ? cfg.slackCap : slack) - cfg.penalty * Math.abs(k);
      if (v > bestV) {
        bestV = v;
        best = b;
      }
    }
    target = best;
  }

  return {
    kind: 'oracle',
    next(s: SimState): InputFrame {
      if (target < 0) target = s.sun.theta;
      // Re-plan on the validator's 0.1 s step grid (the tick about to run lands on it).
      if ((s.tickAbs + 1) % STEP === 0 && s.phase !== 'hold') plan(s);
      const out = steer(f, s, target, cfg.rate, !started);
      started = true;
      return out;
    },
  };
}

export function createBot(kind: BotKind): Bot {
  switch (kind) {
    case 'idle':
      return idleBot();
    case 'novice':
      return noviceBot();
    case 'reactive':
      return reactiveBot();
    default:
      return oracleBot();
  }
}
