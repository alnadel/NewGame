// Headless players for tuning and tests (V1_PLAN §13). Each bot maps the state to one InputFrame per
// tick, holds the "finger" down and steers the sun at a capped turn rate.
//
// - idle: taps to start, then never touches the sun (holds θ0).
// - novice: sees guide.now 200 ms late, turns at 180°/s, heads for the nearest wide safe arc.
// - reactive: sees guide.now and guide.next without lag, turns at 200°/s.
// - oracle: plans with the validator's per-step lit counts (3-step human model) over a 4 s horizon
//   using a backward "Chill needed to survive" DP, and turns at 240°/s.
// - human: a seeded model of a new player (tooling only). It perceives the guide masks 250-350 ms
//   late (lag drawn per decision) and acts only when that stale view shows Nubs lit or the sun's
//   current angle unsafe; it aims with Gaussian error and over/undershoot, drags with minimum-jerk
//   motion (120 ms + 0.9 ms/°), lifts at ω = 0 and pauses 120 ms.
// - humanDial: the same player reading the v1.1 dial, perception-limited (A6): on half of its
//   decisions (a seeded coin per decision) it takes the lasting shade (now ∧ next of its stale view,
//   arcs ≥ 20° only) as the target, else the plain `now` arcs. The sim's advisory and career rows use it.
// - humanFeat (v1.6, docs/V1_6_PLAN.md §2.6): humanDial plus a seeded focus on the level's Dare, on
//   its own decision stream. Until CORE-2 fills worldHumanTarget it is the humanDial model on that stream.
//
// v1.6 hooks: the reactive and oracle bots call the economy terms in bots/econ.ts (CORE-1) and the
// world terms in bots/world.ts (CORE-2) at fixed points, with the bot's BotOptions; the contract
// stubs return their input unchanged.

import { TUNING } from '../../config/tuning.ts';
import { dayAtTick, dayStartTick, DT, TICK_HZ } from '../clock.ts';
import { angleDiff, wrapDeg } from '../dmath.ts';
import { worldElevation } from '../gen/plan.ts';
import { slidingMaxCircular, stepLit, stepLitLive } from '../gen/validator.ts';
import { BINS, binOf } from '../intervals.ts';
import { rngFor, type Rng } from '../rng.ts';
import { econOracleBonus, econOracleSnap, econReactiveScore, econReactiveSnap } from './bots/econ.ts';
import { worldHumanTarget, worldOracleBonus, worldOracleDelta, worldOracleSnap, worldReactiveAim, worldReactiveScore } from './bots/world.ts';
import { effectiveDrain } from './nubs.ts';
import { sunLockedAt } from './sun.ts';
import type { InputFrame, SimState } from './types.ts';
import type { DareTerms } from './bots/dares.ts';

export type BotKind = 'idle' | 'novice' | 'reactive' | 'oracle' | 'human' | 'humanDial' | 'humanFeat';
export const BOT_KINDS: readonly BotKind[] = Object.freeze(['idle', 'novice', 'reactive', 'oracle', 'human', 'humanDial', 'humanFeat'] as BotKind[]);

/** v1.6 reactive-bot policies (docs/V1_6_PLAN.md §2.2): today's play, timed greed, greed all day, never gold. */
export type BotPolicy = 'plain' | 'chase' | 'naive' | 'safe';
export const BOT_POLICIES: readonly BotPolicy[] = Object.freeze(['plain', 'chase', 'naive', 'safe'] as BotPolicy[]);

/** v1.6 bot options (`sim --decisions`, `--policy`); unset = today's behaviour. */
export interface BotOptions {
  /** Reactive (mechanics on): what it chases (default 'plain'). CORE-1. */
  policy?: BotPolicy;
  /** Reactive: when it snaps ('panic', the v1.5 rule, by default; 'plan' snaps at a gap's mouth). CORE-1. */
  snap?: 'panic' | 'plan';
  /** Reactive (mechanics on): slide to guide.flare in a warning's last 18 ticks. CORE-2. */
  preAim?: boolean;
  /** Oracle: weights for the level's Dare (the Feat-seeking oracle). CORE-2. */
  feats?: boolean;
  /**
   * v1.6 Journey terms (bots/dares.ts `DARE_TERMS`): with them the oracle plays a level's verb goal
   * (and with `feats` its Dares) and humanFeat aims at its Dare. Tooling passes them; unset, the
   * bots play every level as 'finish' (and humanFeat plays like humanDial). CORE-2.
   */
  dares?: DareTerms;
}

/** What a v1.6 hook (bots/econ.ts, bots/world.ts) knows about the bot calling it. */
export interface BotHookCtx {
  readonly kind: BotKind;
  readonly mech: boolean;
  readonly opts: Readonly<BotOptions>;
  /** The human models' decision stream (createBot's salt; 0 the default). */
  readonly salt: number;
}

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
  f.dTheta = quantize(d > max ? max : d < -max ? -max : d) * (s.mods.has('dazzle') ? -1 : 1);
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

const RING = 8;
/** The last RING guide snapshots (now, next, lit, Nubs lit or not), each with the tick it was computed on. */
interface GuideRing {
  readonly now: Uint8Array[];
  readonly next: Uint8Array[];
  readonly lit: Uint8Array[];
  readonly nubsLit: Uint8Array;
  readonly ticks: Float64Array;
  head: number;
  seen: number;
}

function guideRing(): GuideRing {
  const rows = (): Uint8Array[] => Array.from({ length: RING }, () => new Uint8Array(BINS));
  return { now: rows(), next: rows(), lit: rows(), nubsLit: new Uint8Array(RING), ticks: new Float64Array(RING).fill(-1), head: 0, seen: -1 };
}

/** Stores the guide when it has changed since the last call. */
function remember(r: GuideRing, s: SimState): void {
  if (s.guide.tick === r.seen) return;
  const h = r.head;
  r.seen = s.guide.tick;
  (r.now[h] as Uint8Array).set(s.guide.now);
  (r.next[h] as Uint8Array).set(s.guide.next);
  (r.lit[h] as Uint8Array).set(s.guide.lit);
  r.ticks[h] = s.guide.tick;
  r.nubsLit[h] = s.nubs.f > 0 ? 1 : 0;
  r.head = (h + 1) % RING;
}

/** The slot of the newest snapshot at least `lag` ticks old (what a late player has taken in), or −1. */
function recall(r: GuideRing, tick: number, lag: number): number {
  let pick = -1;
  for (let i = 0; i < RING; i++) {
    const t = r.ticks[i] as number;
    if (t >= 0 && t <= tick - lag && (pick < 0 || t > (r.ticks[pick] as number))) pick = i;
  }
  return pick;
}

function noviceBot(): Bot {
  const cfg = TUNING.bots.novice;
  const f = frame();
  const ring = guideRing();
  let used = -1;
  let target = -1;
  let started = false;
  return {
    kind: 'novice',
    next(s: SimState): InputFrame {
      remember(ring, s);
      const pick = recall(ring, s.tick, cfg.lagTicks);
      if (target < 0) target = s.sun.theta;
      if (pick >= 0 && ring.ticks[pick] !== used) {
        used = ring.ticks[pick] as number;
        const b = pickArc(ring.now[pick] as Uint8Array, cfg.blur, cfg.penalty, binOf(s.sun.theta));
        if (b >= 0) target = b;
      }
      const out = steer(f, s, target, cfg.rate, !started);
      started = true;
      return out;
    },
  };
}

/** True when a Cold Snap can be cast this tick (the meter is full, none is on, the sun is up). */
function snapReady(s: SimState): boolean {
  return s.world.mech.snap && s.nubs.frost >= 1 && s.snapTicks === 0 && s.phase === 'day' && s.sunUp && s.ready === 0;
}

function reactiveBot(ctx: BotHookCtx): Bot {
  const mech = ctx.mech;
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
      const g = s.guide;
      if (g.tick !== seenGuide) {
        seenGuide = g.tick;
        // v1.5: gold (bud) bins count where they are also safe now (the angle that does both), and
        // anywhere while Chill is nearly full (a moment in the sun to plant shade for later).
        const spare = s.nubs.chill >= cfg.budChill;
        for (let b = 0; b < BINS; b++) {
          const now = g.now[b] as number;
          const gold = mech && g.bud[b] === 1 && (now === 1 || spare) ? cfg.budWeight : 0;
          score[b] = cfg.nowWeight * now + cfg.nextWeight * (g.next[b] as number) + gold;
        }
        econReactiveScore(ctx, s, score);
        worldReactiveScore(ctx, s, score);
        const b = pickArc(score, cfg.blur, cfg.penalty, binOf(s.sun.theta));
        if (b >= 0) target = b;
      }
      target = worldReactiveAim(ctx, s, target);
      const out = steer(f, s, target, cfg.rate, !started);
      started = true;
      // v1.5 Cold Snap: lit and low, with no safe angle close by (or nearly melted).
      out.snap = mech && snapReady(s) && s.nubs.f > 0 && (s.nubs.chill < cfg.snapLast || (s.nubs.chill < cfg.snapChill && !safeNear(g.now, s.sun.theta, cfg.snapNearDeg)));
      out.snap = econReactiveSnap(ctx, s, out.snap);
      return out;
    },
  };
}

/** True when some bin within ±deg of θ is set in `mask`. */
function safeNear(mask: Uint8Array, theta: number, deg: number): boolean {
  const b0 = binOf(theta);
  for (let k = -deg; k <= deg; k++) if (mask[(b0 + k + BINS) % BINS] === 1) return true;
  return false;
}

/** out[b] = circular distance (bins) from b to the nearest set bin of `mask` (BINS when none is set). */
function distToSet(mask: Uint8Array, out: Float64Array): boolean {
  let any = false;
  for (let b = 0; b < BINS; b++) {
    out[b] = mask[b] === 1 ? 0 : BINS;
    if (mask[b] === 1) any = true;
  }
  if (!any) return false;
  // Two sweeps each way around the circle settle every distance.
  for (let pass = 0; pass < 2; pass++) {
    for (let b = 0; b < BINS; b++) {
      const p = out[(b + BINS - 1) % BINS] as number;
      if (p + 1 < (out[b] as number)) out[b] = p + 1;
    }
    for (let b = BINS - 1; b >= 0; b--) {
      const n = out[(b + 1) % BINS] as number;
      if (n + 1 < (out[b] as number)) out[b] = n + 1;
    }
  }
  return true;
}

const INF = 1e9;
const STEP = TUNING.validator.stepTicks;
/**
 * The oracle on a campaign level plays for stars as well as survival: it keeps a larger Chill
 * margin and, among bins with similar slack, prefers the shaded ones (the multiplier and the flakes
 * ahead live in shade). Off outside the campaign, so the endless/daily oracle (and its goldens)
 * is unchanged.
 */
const ORACLE_CAMPAIGN = Object.freeze({ margin: 12, shadeWeight: 0.6 });

function oracleBot(ctx: BotHookCtx): Bot {
  const mech = ctx.mech;
  const cfg = TUNING.bots.oracle;
  const gold = new Float64Array(BINS);
  let snapNext = false;
  const H = cfg.horizonSteps;
  const f = frame();
  const lits = new Uint8Array((H + 3) * BINS);
  const row = new Uint8Array(BINS);
  const night = new Uint8Array(H + 3);
  /** 1 where the step falls in a 'lock' window (the sun cannot turn into it). */
  const locked = new Uint8Array(H + 3);
  const need = new Float64Array((H + 1) * BINS);
  /** v1.6: the Chill-delta table of each planned step (rows like `lits`). */
  const deltas: Float64Array[] = new Array<Float64Array>(H + 3);
  const tmp = new Float64Array(BINS);
  const win = new Float64Array(BINS);
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
    const lock = s.mods.has('lock');
    for (let h = 0; h < H + 3; h++) {
      const j = j0 - 1 + h;
      if (mech) stepLitLive(s.world, j, row);
      else stepLit(s.world, j, row);
      lits.set(row, h * BINS);
      const tick = j * STEP;
      const d = dayAtTick(tick);
      const dayTick = tick - dayStartTick(d);
      night[h] = worldElevation(s.world, tick) > 0 ? 0 : 1;
      locked[h] = lock && sunLockedAt(dayTick) ? 1 : 0;
    }
    // v1.6: one Chill-delta table per step (Noon Heat, kept flares' holds; bots/world.ts).
    const drain = effectiveDrain(s);
    for (let h = 0; h < H + 3; h++) deltas[h] = worldOracleDelta(ctx, s, (j0 - 1 + h) * STEP, drain, s.params.regen);
    const maxC = s.nubs.maxChill;
    const campaign = s.level !== null;
    const margin = campaign ? Math.min(ORACLE_CAMPAIGN.margin, maxC / 4) : cfg.margin;
    const shadeW = campaign ? ORACLE_CAMPAIGN.shadeWeight : 0;
    // need[i][b]: least Chill after step j0 + i at bin b that still survives to the horizon.
    need.fill(margin, H * BINS, (H + 1) * BINS);
    for (let i = H - 1; i >= 0; i--) {
      const o = i * BINS;
      if (night[i + 2] === 1) {
        need.fill(margin, o, o + BINS); // the next step is night: Chill refills
        continue;
      }
      const on = (i + 1) * BINS;
      for (let b = 0; b < BINS; b++) {
        const nn = need[on + b] as number;
        const req = nn - ((deltas[i + 2] as Float64Array)[litH(i + 1, b)] as number);
        tmp[b] = nn > maxC ? -INF : -(req < margin ? margin : req);
      }
      // A locked step cannot be turned into: the bin must already be held (CAMPAIGN 'lock').
      slidingMaxCircular(tmp, locked[i + 2] === 1 ? 0 : cfg.planBins, win);
      for (let b = 0; b < BINS; b++) need[o + b] = -(win[b] as number);
    }
    // Choose the next step's bin within actual reach: most slack (capped), least turning; v1.5:
    // plus a bonus toward gold (bud) bins while the slack is comfortable.
    const b0 = binOf(wrapDeg(s.sun.theta + s.sun.lag));
    const c = s.nubs.chill;
    const buds = mech && distToSet(s.guide.bud, gold);
    const flakeGoal = s.level?.goal.kind === 'flakes';
    let best = b0;
    let bestV = -Infinity;
    let bestSlack = 0;
    for (let k = -reach; k <= reach; k++) {
      const b = (b0 + k + BINS) % BINS;
      let next = c + ((deltas[2] as Float64Array)[litH(1, b)] as number);
      if (next > maxC) next = maxC;
      const slack = next - (need[BINS + b] as number);
      let v = (slack > cfg.slackCap ? cfg.slackCap : slack) - cfg.penalty * Math.abs(k) - shadeW * (lits[2 * BINS + b] as number);
      // Gold that is shaded next step is free; gold in the sun only while Chill is nearly full (never
      // on a flake-goal level: lit flakes melt).
      if (buds && slack >= cfg.budSlack && ((lits[2 * BINS + b] as number) === 0 || (c >= cfg.budSpare * maxC && !flakeGoal))) {
        const d = gold[b] as number;
        if (d < cfg.budReachDeg) v += cfg.budBonus * (1 - d / cfg.budReachDeg);
      }
      v += econOracleBonus(ctx, s, b, slack) + worldOracleBonus(ctx, s, b, slack);
      if (v > bestV) {
        bestV = v;
        best = b;
        bestSlack = slack;
      }
    }
    target = best;
    // v1.5 Cold Snap: when the plan is squeezed, or lit and low (campaign: whenever the next step is lit).
    if (mech && snapReady(s)) {
      const litNext = (lits[2 * BINS + best] as number) > 0;
      snapNext = bestSlack < cfg.snapSlack || (litNext && (campaign || (s.nubs.f > 0 && c < cfg.snapChill)));
    }
    snapNext = econOracleSnap(ctx, s, snapNext, bestSlack);
    snapNext = worldOracleSnap(ctx, s, snapNext, bestSlack);
  }

  return {
    kind: 'oracle',
    next(s: SimState): InputFrame {
      if (target < 0) target = s.sun.theta;
      // Re-plan on the validator's 0.1 s step grid (the tick about to run lands on it).
      if ((s.tickAbs + 1) % STEP === 0 && s.phase !== 'hold') plan(s);
      const out = steer(f, s, target, cfg.rate, !started);
      started = true;
      out.snap = snapNext && snapReady(s);
      snapNext = false;
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
/** humanDial casts a ready Cold Snap when lit with Chill below this (v1.5). */
const HUMAN_SNAP_CHILL = 30;
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

/**
 * Fills `out` with the bins of now ∧ next that belong to arcs at least `minArc` bins wide (circular).
 * Returns false when there is none.
 */
function wideLasting(now: Uint8Array, next: Uint8Array, minArc: number, out: Uint8Array): boolean {
  let start = -1;
  for (let b = 0; b < BINS; b++) {
    out[b] = 0;
    if (start < 0 && (now[b] === 0 || next[b] === 0)) start = b;
  }
  if (start < 0) {
    out.fill(1); // shade that lasts all the way round
    return true;
  }
  let any = false;
  let run = 0;
  for (let k = 1; k <= BINS; k++) {
    const b = (start + k) % BINS;
    if (k < BINS && now[b] === 1 && next[b] === 1) {
      run++;
      continue;
    }
    if (run >= minArc) {
      any = true;
      for (let j = 1; j <= run; j++) out[(b - j + BINS) % BINS] = 1;
    }
    run = 0;
  }
  return any;
}

/**
 * The human model; `lastingShare` is the share of decisions that read the lasting shade (0 for
 * 'human', so it draws exactly the v1.0 stream).
 */
function humanBot(kind: 'human' | 'humanDial' | 'humanFeat', lastingShare: number, salt: number, ctx: BotHookCtx): Bot {
  const cfg = TUNING.bots.human;
  const msTicks = (ms: number): number => Math.round((ms * TICK_HZ) / 1000);
  const f = frame();
  const ring = guideRing();
  const lasting = new Uint8Array(BINS);
  let useLasting = false;
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

  // v1.5: humanDial snaps in a panic (the meter glows on the HUD): lit with Chill under HUMAN_SNAP_CHILL.
  const snaps = kind !== 'human';
  const feat = kind === 'humanFeat';
  return {
    kind,
    next(s: SimState): InputFrame {
      const out = decide(s);
      out.snap = snaps && snapReady(s) && s.nubs.f > 0 && s.nubs.chill < HUMAN_SNAP_CHILL;
      return out;
    },
  };

  function decide(s: SimState): InputFrame {
    if (!rng) rng = salt ? rngFor(s.cfg.seed, 'bot', kind, salt) : rngFor(s.cfg.seed, 'bot', kind);
    remember(ring, s);
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
    if (lag < 0) {
      lag = msTicks(rng.range(cfg.lagMinMs, cfg.lagMaxMs));
      if (lastingShare > 0) useLasting = rng.next() < lastingShare;
    }
    const pick = recall(ring, s.tick, lag);
    if (pick < 0) return f;
    // The sun's own position is seen live; the shade state is stale.
    const theta = s.sun.theta;
    const mask =
      useLasting && wideLasting(ring.now[pick] as Uint8Array, ring.next[pick] as Uint8Array, cfg.lastingMinArc, lasting) ? lasting : (ring.now[pick] as Uint8Array);
    // humanFeat (v1.6): a Dare focus (bots/world.ts) may move it even while it is safe.
    const focus = feat ? worldHumanTarget(ctx, s, -1) : -1;
    if (focus < 0 && ring.nubsLit[pick] === 0 && mask[binOf(theta)] === 1) return f;
    const target = focus >= 0 ? focus : humanTarget(mask, ring.lit[pick] as Uint8Array, theta);
    const want = angleDiff(target, theta);
    if (target < 0 || Math.abs(want) < HUMAN_MIN_MOVE) return f;
    // Decide: over/undershoot and aim error, then a fresh lag for the next decision.
    const d = want * (1 + cfg.gainSigma * gaussian(rng)) + cfg.aimSigmaDeg * gaussian(rng);
    lag = -1;
    if (Math.abs(d) < 3) return f;
    moveTicks = Math.max(1, msTicks(cfg.moveBaseMs + cfg.moveMsPerDeg * Math.abs(d)));
    moveT = 0;
    moveDist = s.mods.has('dazzle') ? -d : d; // the Mirror Sun turns against the drag
    sent = 0;
    return moveTick();
  }
}

/**
 * `salt` (human models only) draws another player's decision stream on the same world; 0 is the
 * default stream. `mechanics` false makes the reactive and oracle bots ignore the v1.5 mechanics
 * (no gold, no snaps; the oracle plans without sunflowers) for with/without measurements; idle,
 * novice and the human models never use them. `opts` (v1.6) picks the reactive policy and snap
 * rule, preAim and the Feat-seeking oracle (unset: today's bots).
 */
export function createBot(kind: BotKind, salt = 0, mechanics = true, opts: BotOptions = {}): Bot {
  const ctx: BotHookCtx = { kind, mech: mechanics, opts, salt };
  switch (kind) {
    case 'idle':
      return idleBot();
    case 'novice':
      return noviceBot();
    case 'reactive':
      return reactiveBot(ctx);
    case 'human':
      return humanBot('human', 0, salt, ctx);
    case 'humanDial':
      return humanBot('humanDial', TUNING.bots.human.lastingShare, salt, ctx);
    case 'humanFeat':
      return humanBot('humanFeat', TUNING.bots.human.lastingShare, salt, ctx);
    default:
      return oracleBot(ctx);
  }
}
