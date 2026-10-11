// Headless players for tuning and tests (V1_PLAN §13). Each bot maps the state to one InputFrame per
// tick, holds the "finger" down and steers the sun at a capped turn rate.
//
// - idle: taps to start, then never touches the sun (holds θ0).
// - novice: sees guide.now 200 ms late, turns at 180°/s, heads for the nearest wide safe arc.
// - reactive: sees guide.now and guide.next without lag, turns at 200°/s.
// - oracle: plans with the validator's per-step lit counts (3-step human model) over a 4 s horizon
//   using a backward "Chill needed to survive" DP, and turns at 240°/s.
// - human: a seeded model of a new player (tooling only: the sim's advisory rows). It perceives the
//   guide masks 250-350 ms late (lag drawn per decision) and acts only when that stale view shows
//   Nubs lit or the sun's current angle unsafe; it aims with Gaussian error and over/undershoot,
//   drags with minimum-jerk motion (120 ms + 0.9 ms/°), lifts at ω = 0 and pauses 120 ms.

import { dayParams } from '../../config/days.ts';
import { TUNING } from '../../config/tuning.ts';
import { dayAtTick, dayStartTick, DT, elevation, TICK_HZ } from '../clock.ts';
import { angleDiff, wrapDeg } from '../dmath.ts';
import { chillDeltaTable, slidingMaxCircular, stepLit } from '../gen/validator.ts';
import { BINS, binOf } from '../intervals.ts';
import { rngFor, type Rng } from '../rng.ts';
import { effectiveDrain } from './nubs.ts';
import type { InputFrame, SimState } from './types.ts';

export type BotKind = 'idle' | 'novice' | 'reactive' | 'oracle' | 'human';
export const BOT_KINDS: readonly BotKind[] = Object.freeze(['idle', 'novice', 'reactive', 'oracle', 'human'] as BotKind[]);

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
    const delta = chillDeltaTable(effectiveDrain(s));
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

/** Standard normal sample (Irwin-Hall: 12 uniforms − 6; |x| ≤ 6). Plain arithmetic, deterministic. */
function gaussian(r: Rng): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += r.next();
  return sum - 6;
}

/** Minimum-jerk position profile 10x³ − 15x⁴ + 6x⁵ for x ∈ [0, 1]. */
function minJerk(x: number): number {
  const x3 = x * x * x;
  return x3 * (10 + x * (-15 + 6 * x));
}

// Human target choice: a safe arc at least HUMAN_MIN_ARC° wide wins (wider is better up to 30°),
// otherwise the least-lit angle; both pay 0.35 per degree of turning.
const HUMAN_MIN_ARC = 6;
const HUMAN_TURN_COST = 0.35;
/** Corrections smaller than this are not worth a drag (°). */
const HUMAN_MIN_MOVE = 4;

function humanTarget(now: Uint8Array, lit: Uint8Array, theta: number): number {
  let best = -1;
  let bestV = -Infinity;
  for (let b = 0; b < BINS; b++) {
    const d = Math.abs(angleDiff(b, theta));
    let w = 0;
    if (now[b] === 1) {
      let l = 0;
      while (l < 60 && now[(b - l - 1 + BINS) % BINS] === 1) l++;
      let r = 0;
      while (r < 60 && now[(b + r + 1) % BINS] === 1) r++;
      if (l + r + 1 >= HUMAN_MIN_ARC) w = 2 * (l < r ? l : r) + 1;
    }
    const v = w > 0 ? 100 + 1.5 * (w < 30 ? w : 30) - HUMAN_TURN_COST * d : 40 - 6 * (lit[b] as number) - HUMAN_TURN_COST * d;
    if (v > bestV) {
      bestV = v;
      best = b;
    }
  }
  return best;
}

function humanBot(): Bot {
  const cfg = TUNING.bots.human;
  const msTicks = (ms: number): number => Math.round((ms * TICK_HZ) / 1000);
  const f = frame();
  // Ring of past guide snapshots (now, lit, and whether Nubs was lit) with their sim tick.
  const SLOTS = 8;
  const now: Uint8Array[] = [];
  const lit: Uint8Array[] = [];
  for (let i = 0; i < SLOTS; i++) {
    now.push(new Uint8Array(BINS));
    lit.push(new Uint8Array(BINS));
  }
  const ticks = new Float64Array(SLOTS).fill(-1);
  const nubsLit = new Uint8Array(SLOTS);
  let head = 0;
  let seenGuide = -1;
  let rng: Rng | null = null;
  let started = false;
  let lag = -1; // reaction lag (ticks) of the next decision; drawn when the bot starts looking
  let cooldown = 0;
  // Current drag: total ticks (0 = none), ticks done, signed distance, degrees sent so far.
  let moveTicks = 0;
  let moveT = 0;
  let moveDist = 0;
  let sent = 0;

  function moveTick(): InputFrame {
    moveT++;
    const step = quantize(moveDist * minJerk(moveT / moveTicks) - sent);
    sent += step;
    f.dTheta = step;
    f.downEdge = moveT === 1;
    f.down = true;
    if (moveT >= moveTicks) {
      // The finger stops and lifts: release at ω = 0, then a short pause before looking again.
      f.down = false;
      f.upEdge = true;
      f.release = 0;
      moveTicks = 0;
      cooldown = msTicks(cfg.settleMs);
    }
    return f;
  }

  return {
    kind: 'human',
    next(s: SimState): InputFrame {
      if (!rng) rng = rngFor(s.cfg.seed, 'bot', 'human');
      if (s.guide.tick !== seenGuide) {
        seenGuide = s.guide.tick;
        (now[head] as Uint8Array).set(s.guide.now);
        (lit[head] as Uint8Array).set(s.guide.lit);
        ticks[head] = s.guide.tick;
        nubsLit[head] = s.nubs.f > 0 ? 1 : 0;
        head = (head + 1) % SLOTS;
      }
      f.dTheta = 0;
      f.down = false;
      f.downEdge = false;
      f.upEdge = false;
      f.release = 0;
      f.key = 0;
      if (!started) {
        // A tap starts the run (catch + release at 0°/s), like the idle bot.
        started = true;
        f.downEdge = true;
        f.upEdge = true;
        return f;
      }
      if (moveTicks > 0) return moveTick();
      if (cooldown > 0) {
        cooldown--;
        return f;
      }
      if (s.phase !== 'day' || !s.sunUp) return f;
      if (lag < 0) lag = msTicks(rng.range(cfg.lagMinMs, cfg.lagMaxMs));
      // Newest snapshot at least `lag` ticks old: what the player has taken in by now.
      let pick = -1;
      for (let i = 0; i < SLOTS; i++) {
        const t = ticks[i] as number;
        if (t >= 0 && t <= s.tick - lag && (pick < 0 || t > (ticks[pick] as number))) pick = i;
      }
      if (pick < 0) return f;
      // The sun's own position is seen live; the shade state is stale.
      const theta = s.sun.theta;
      const mask = now[pick] as Uint8Array;
      if (nubsLit[pick] === 0 && mask[binOf(theta)] === 1) return f;
      const target = humanTarget(mask, lit[pick] as Uint8Array, theta);
      const want = angleDiff(target, theta);
      if (target < 0 || Math.abs(want) < HUMAN_MIN_MOVE) return f;
      // Decide: over/undershoot and aim error, then a fresh lag for the next decision.
      const d = want * (1 + cfg.gainSigma * gaussian(rng)) + cfg.aimSigmaDeg * gaussian(rng);
      lag = -1;
      if (Math.abs(d) < 3) return f;
      moveTicks = Math.max(1, msTicks(cfg.moveBaseMs + cfg.moveMsPerDeg * Math.abs(d)));
      moveT = 0;
      moveDist = d;
      sent = 0;
      return moveTick();
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
    case 'human':
      return humanBot();
    default:
      return oracleBot();
  }
}
