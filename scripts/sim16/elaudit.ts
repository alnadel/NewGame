// Elementals v2 proof (docs/ELEMENTALS_V2.md §6.2): the per-leg audits, the plan they make and the
// players that follow it. CORE, tooling only (scripts/ never ships).
//
// The audit walks the legs in order. Each leg's verb schedule is fixed first (θ-free: Ember's taps,
// Sprout's pours), from a probe replay of the trial up to and through that leg; then a second replay
// with the schedule records the leg's rows: per 6-tick step the walker's lit sums per bin (gatherScene +
// litMask, trees and rain proxies included), its water, and the meter its contacts move. Every replay
// starts from go and plays the schedules fixed so far with the sun left alone, the Gust policy on Gust
// legs and the walker's meter held full on the others (so a tap never fizzles and nothing dies: the
// world a replay builds does not depend on θ), except plants: a lit site grows ×2, so each replay pins
// every plant to a bound that can only make the leg harder — for shade-seeking legs (Nubs, Drip) a
// tree stands only from its latest stand tick (×1 growth), for Ember from its earliest (×3); bridges
// always complete at their latest.
//
// The θ DP then runs leg by leg: Nubs and Ember legs are v1's turn-limited survival DP (360 bins,
// slidingMaxCircular, min-of-three pessimism) on their own rate tables, with every tap's and pour's
// steps held still (the finger is off the sun); a Sprout leg passes on every bin it can reach; a held
// leg (Drip, Gust) freezes θ. Before a held leg the DP commits to the alive end bin on a 5° grid that
// maximizes min(held-leg margin, next leg's margin), among the guide's marked bins before Drip. Drip's
// own audit is a lane DP for each held bin (lanes every 2 u, ≤ slide · 0.1 u a step, puddles and stones
// as consumed bits). Sprout's is a Sap ledger. Gust has none (the bots prove it).

import type { HeroId } from '../../src/config/heroes.ts';
import { hashString } from '../../src/config/rng.ts';
import { trialDef, type ElPlace, type TrialDef } from '../../src/config/trials.ts';
import { TUNING } from '../../src/config/tuning.ts';
import { DT, TICK_HZ } from '../../src/core/clock.ts';
import { angleDiff, wrapDeg } from '../../src/core/dmath.ts';
import { worldYAtDayTick, worldYAtTick } from '../../src/core/gen/plan.ts';
import { gatherScene, removeCaster } from '../../src/core/gen/store.ts';
import { slidingMaxCircular } from '../../src/core/gen/validator.ts';
import { createWorld } from '../../src/core/gen/world.ts';
import { BINS, binOf, createMaskScene, litMask } from '../../src/core/intervals.ts';
import { campaignConfig, minuteStart, resolveLevelConfig } from '../../src/core/level.ts';
import { EL_GONE, EL_ID_BASE, SNAP_ID_BASE, TREE_ID_BASE, type Cloud, type ElObj, type ElState } from '../../src/core/objects.ts';
import { createDriver, type DriveControl, type Driver } from '../../src/core/drive/driver.ts';
import { createElPolicy, createHand, handCut, handFrame, handPress, handRelease, HOLD_PRESS, REGRAB, TAP_PRESS, type ElPolicy } from '../../src/core/sim/bots/elements.ts';
import { createRun, type RunBuild } from '../../src/core/sim/create.ts';
import { burnTarget, createEl, elStart, growTarget, heroStart, inWeather, laneOf, needOf, standTree, tagTick } from '../../src/core/sim/elements.ts';
import { elTagMarks, updateGuide } from '../../src/core/sim/guide.ts';
import { computeCoverage } from '../../src/core/sim/nubs.ts';
import { step, syncTime } from '../../src/core/sim/step.ts';
import { VERB_HOLD, VERB_TAP, type InputFrame, type SimState } from '../../src/core/sim/types.ts';
import { trailX } from '../../src/core/trail.ts';

const E = TUNING.elements;
const EM = E.ember;
const SP = E.sprout;
const DR = E.drip;
const O = E.objects;
const STEP = TUNING.validator.stepTicks;
const TURN = TUNING.validator.turnBins;
const DT_STEP = STEP / TICK_HZ;
const DEAD = -1e9;
const MARGIN = TUNING.nubs.sampleOffset + 1;
/** Health each audited leg keeps (G1). */
export const AUDIT_HEALTH = 20;
/** Held-leg end bins are chosen on this grid (°). */
const GRID = 5;
/** Ticks the finger is off the sun after a verb frame before the re-grab touches down. */
const REGRAB_TICKS = REGRAB + 1;
/** Ember dries a puddle on its path this many ticks before it (§6.2). */
const DRY_AT = 60;
/** Bridges complete this long before their contact (0.3 s). */
const BRIDGE_SPARE = 18;
/** The path bot's plots keep this much Sap spare in the ledger (play differs from the probe by a few ticks of pour). */
const PLOT_RESERVE = 10;

// ---------------------------------------------------------------------------------------------
// Variants: a trial as calibration tries it (plain data: crosses workers)
// ---------------------------------------------------------------------------------------------

/** One authored object moved by calibration (§6.5): its index in TrialDef.objects and the new values. */
export interface ElMove {
  readonly i: number;
  readonly m?: number;
  readonly dx?: number;
  readonly drift?: number;
}

/** What a plan leaves out or adds (G5, G7): a leg's verb off, Gust's late swipes, the downwind plots, ice left standing. */
export interface PlanMod {
  /** G7: no Gust swipes once the hand-off weather (the next stretch's) has woken. */
  readonly noHandoff?: boolean;
  /** G7 (T7): Sprout plants the downwind plots too. */
  readonly downwind?: boolean;
  /** G7 (T5): Ember leaves the ice walls in Drip's stretch standing. */
  readonly keepIce?: boolean;
}

export interface TrialVariant {
  readonly id: number;
  readonly salt: number;
  readonly drain?: number;
  readonly dareTarget?: number;
  readonly legStart?: readonly number[];
  readonly costMul?: number;
  readonly evapMul?: number;
  readonly moves?: readonly ElMove[];
  /** Calibration (§6.5): objects added to the trial's list (one per leg at most), after the authored ones. */
  readonly add?: readonly ElPlace[];
  readonly mod?: PlanMod;
  /**
   * Re-timing (the lead's T6/T7 decision, §13.3): the start minute, the length, every relay's minute
   * (heroes unchanged) and the whole object list in the authoring string of `TRIALS` (moves and adds
   * apply on top of it).
   */
  readonly startMinute?: number;
  readonly lengthMinutes?: number;
  readonly relays?: readonly number[];
  readonly objects?: string;
}

const CODE: Readonly<Record<string, ElPlace['k']>> = { b: 'bramble', g: 'gate', i: 'ice', x: 'gap', s: 'stream', p: 'plot', u: 'puddle', t: 'stone', r: 'rain', f: 'fog' };

/** An authoring string (`<code><m>[:dx[:r[:drift]]]`, as in config/trials.ts) as objects. */
export function parseObjects(src: string): ElPlace[] {
  return src
    .trim()
    .split(/\s+/)
    .map((e) => {
      const [m, dx, r, drift] = e.slice(1).split(':').map(Number) as [number, number?, number?, number?];
      const o: { k: ElPlace['k']; m: number; dx: number; r?: number; drift?: number } = { k: CODE[e[0] as string] as ElPlace['k'], m, dx: dx ?? 0 };
      if (r !== undefined) o.r = r;
      if (drift !== undefined) o.drift = drift;
      return o;
    });
}

/** The TrialDef of a variant (the pinned one itself when nothing differs). */
export function variantDef(v: TrialVariant): TrialDef {
  const t = trialDef(v.id) as TrialDef;
  const same =
    v.salt === t.salt &&
    (v.drain ?? t.drain) === t.drain &&
    (v.dareTarget ?? t.dare.target) === t.dare.target &&
    v.legStart === undefined &&
    v.costMul === undefined &&
    v.evapMul === undefined &&
    (v.moves?.length ?? 0) === 0 &&
    (v.add?.length ?? 0) === 0 &&
    v.startMinute === undefined &&
    v.lengthMinutes === undefined &&
    v.relays === undefined &&
    v.objects === undefined;
  if (same) return t;
  const objects: ElPlace[] = [...(v.objects !== undefined ? parseObjects(v.objects) : t.objects), ...(v.add ?? [])].map((o) => ({ ...o }));
  for (const mv of v.moves ?? []) {
    const o = objects[mv.i] as { m: number; dx: number; drift?: number };
    if (mv.m !== undefined) o.m = mv.m;
    if (mv.dx !== undefined) o.dx = mv.dx;
    if (mv.drift !== undefined) o.drift = mv.drift;
  }
  return Object.freeze({
    ...t,
    salt: v.salt,
    seed: hashString(`trial-${t.id}-${v.salt}`),
    startMinute: v.startMinute ?? t.startMinute,
    lengthMinutes: v.lengthMinutes ?? t.lengthMinutes,
    relays: v.relays ? Object.freeze(t.relays.map((r, i) => Object.freeze({ minute: v.relays?.[i] ?? r.minute, to: r.to }))) : t.relays,
    drain: v.drain ?? t.drain,
    dare: Object.freeze({ kind: t.dare.kind, target: v.dareTarget ?? t.dare.target }),
    objects: Object.freeze(objects),
    tune: Object.freeze({ legStart: v.legStart ?? t.tune.legStart, costMul: v.costMul ?? t.tune.costMul, evapMul: v.evapMul ?? t.tune.evapMul }),
  });
}

/**
 * A fresh run of trial `t`. The pinned trial is campaignConfig's run as the game plays it; a variant
 * is built on its own world (its seed and drain), then gets its trial, objects and start meter put
 * back before the first tick (createRun placed the pinned trial's).
 */
export function trialRun(t: TrialDef): SimState {
  if (t === trialDef(t.id)) return createRun(campaignConfig(t.id));
  const start = minuteStart(t.startMinute);
  const cfg = { ...resolveLevelConfig(campaignConfig(t.id)), seed: t.seed, drain: t.drain, startDay: start.day, startT: start.dayTick / TICK_HZ };
  const level = { id: t.id, chapter: t.chapter, name: t.name, seed: t.seed, biome: t.biome, forecast: t.forecast, concepts: t.concepts, introduces: null, startMinute: t.startMinute, lengthMinutes: t.lengthMinutes, goal: t.goal, stars: { flakes: 1e9, minChill: t.steady, sunSec: 1e9 }, drain: t.drain, feats: [], flares: [] };
  const world = createWorld(cfg, level as never);
  const b: RunBuild = { cfg, world, targetY: worldYAtDayTick(world, start.day, start.dayTick) + TUNING.world.hardAhead };
  const s = createRun(cfg, b);
  const m = s as { -readonly [K in keyof SimState]: SimState[K] };
  m.trial = t;
  s.cfg.seed = t.seed;
  s.cfg.drain = t.drain;
  // createRun resolved the start time from the pinned trial: a re-timed variant starts at its own.
  m.day = start.day;
  m.dayTick = start.dayTick;
  s.cfg.startDay = start.day;
  s.cfg.startT = start.dayTick / TICK_HZ;
  const cl = s.world.clouds as Cloud[];
  for (let i = cl.length - 1; i >= 0; i--) if ((cl[i] as Cloud).id >= EL_ID_BASE && (cl[i] as Cloud).id < TREE_ID_BASE) cl.splice(i, 1);
  m.el = createEl(s);
  s.nubs.chill = elStart(t);
  syncTime(s);
  computeCoverage(s);
  updateGuide(s);
  return s;
}

// ---------------------------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------------------------

export interface Tap {
  /** The tick (s.tickAbs before the step) whose frame carries the verb. */
  readonly tick: number;
  readonly obj: number;
  readonly x: number;
  readonly y: number;
}

export interface Hold extends Tap {
  /** The tick whose frame carries the release. */
  readonly end: number;
  readonly goal: number;
}

export interface LegPlan {
  readonly hero: HeroId;
  /** Absolute ticks: the leg's first tick (its TAG, or go) and the next TAG (or the finish). */
  readonly from: number;
  readonly to: number;
  readonly taps: Tap[];
  readonly holds: Hold[];
  /** Drip: the lane (u) per step of the leg (row from the leg's first row), or null. */
  lanes: Float64Array | null;
  /** The leg's audit margin (−1 failed) and what it printed. */
  margin: number;
  note: string;
}

export interface Plan {
  readonly t: TrialDef;
  readonly mod: PlanMod;
  readonly legs: LegPlan[];
  /** Rows (6-tick steps) from j0 − 1: row r is tick (j0 − 1 + r) · STEP. */
  readonly j0: number;
  readonly n: number;
  /** The θ path (bins) per row, or null when the audit found none. */
  theta: Int16Array | null;
  /** Drip legs: the bins the guide marks at the TAG (5° grid), each with its Drip margin; and the chosen and worst bins. */
  readonly drip: { leg: number; marks: number[]; margins: number[]; chosen: number; worst: number }[];
  ok: boolean;
  /** Why the audit failed (empty when ok). */
  why: string;
}

/** Leg index of an absolute tick (0 from go, +1 at each relay's TAG tick). */
export function legAt(t: TrialDef, tick: number): number {
  let leg = 0;
  for (let i = 0; i < t.relays.length; i++) if (tagTick(t, i) <= tick) leg = i + 1;
  return leg;
}

export function legHero(t: TrialDef, leg: number): HeroId {
  return leg === 0 ? (t.cast[0] as HeroId) : (t.relays[leg - 1] as { to: HeroId }).to;
}

export function legStartOf(t: TrialDef, leg: number): number {
  return t.tune.legStart[leg] || heroStart(legHero(t, leg));
}

// ---------------------------------------------------------------------------------------------
// The player: a plan's θ path and verbs under the bot input contract
// ---------------------------------------------------------------------------------------------

/** How a player turns the sun: the plan's path, nothing (replays), or one constant angle (G5b). */
export type ThetaMode = { readonly k: 'plan' } | { readonly k: 'still' } | { readonly k: 'const'; readonly theta: number };

export interface PlayerOpts {
  readonly theta: ThetaMode;
  /** Legs played with their verb off (G5b): no taps, holds, steers or swipes there. */
  readonly off?: readonly number[];
  /** Gust legs played by a spam bot instead of the Gust policy (G5d). */
  readonly spam?: { readonly dir: -1 | 1; readonly every: number };
  /** Ember legs played by the tap-on-sight policy instead of the schedule (G5c). */
  readonly tapOnSight?: boolean;
  /** Up to this leg only the schedules are known (a replay ignores later legs). */
  readonly upTo?: number;
  /**
   * Controls v3 G5e (docs/CONTROLS_V3.md §10.3): Gust legs play this vane notch, held from the leg's
   * first tick through a driver (its governor and auto-calm, no Calm press), instead of the Gust policy.
   */
  readonly vane?: number;
}

export type Player = (s: SimState) => InputFrame;

const q8 = (v: number): number => Math.round(v * 8) / 8;
const q64 = (v: number): number => Math.round(v * 64) / 64;

/** The tick at which a hand-off weather object wakes (the walker within `wake` of it), or −1. */
function wakeTick(s: SimState, o: ElObj): number {
  const w = s.world;
  const y = o.y - E.weather.wake;
  let lo = w.startTick;
  let hi = w.startTick + 60 * 60 * 3;
  if (worldYAtTick(w, lo) >= y) return lo;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (worldYAtTick(w, mid) >= y) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** The first tick at which the walker's y reaches `y` (binary search on the schedule). */
export function tickAtY(s: SimState, y: number): number {
  const w = s.world;
  let lo = w.startTick;
  let hi = w.startTick + 60 * 60 * 6;
  if (worldYAtTick(w, lo) >= y) return lo;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (worldYAtTick(w, mid) >= y) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** The plan's player. */
export function planPlayer(plan: Plan, o: PlayerOpts): Player {
  const f: InputFrame = { dTheta: 0, down: false, downEdge: false, upEdge: false, release: 0, key: 0 };
  const hand = createHand();
  let gust: ElPolicy | null = null;
  let onSight: ElPolicy | null = null;
  let first = true;
  let relay = 0;
  let handoff = -1;
  // G5e: the driver that holds the vane (begun on its first Gust tick, filled on Gust legs only).
  const vctl: DriveControl = { act: 0, vane: 0, vaneUp: false, rest: false };
  let drv: Driver | null = null;
  let vaneLeg = -1;
  return (s) => {
    f.verb = 0;
    f.vx = 0;
    f.vy = 0;
    f.steer = 0;
    f.snap = false;
    f.key = 0;
    f.release = 0;
    f.upEdge = false;
    if (first) {
      handoff = handoffWake(s);
      gust = createElPolicy(o.spam ? { spam: o.spam } : {});
      if (o.tapOnSight) onSight = createElPolicy({ tapOnSight: true });
    }
    // The sun: the plan's path (600 °/s, the finger held), or still.
    const th = o.theta;
    if (th.k === 'still') {
      f.dTheta = 0;
      f.down = false;
      f.downEdge = first;
      f.upEdge = first;
    } else {
      const r = Math.min(plan.n - 1, Math.max(0, Math.round((s.tickAbs + 1) / STEP) - (plan.j0 - 1)));
      const target = th.k === 'const' ? th.theta : plan.theta ? (plan.theta[r] as number) : s.sun.theta;
      const cur = wrapDeg(s.sun.theta + s.sun.lag);
      const d = angleDiff(target, cur);
      const max = 600 * DT;
      f.dTheta = Math.round((d > max ? max : d < -max ? -max : d) * 1024) / 1024;
      f.down = true;
      f.downEdge = first;
    }
    first = false;
    if (s.relayIdx !== relay) {
      relay = s.relayIdx;
      handCut(hand);
    }
    const leg = s.relayIdx;
    const lp = plan.legs[leg];
    const on = lp !== undefined && s.phase === 'day' && s.ready === 0 && !(o.off?.includes(leg) ?? false) && (o.upTo === undefined || leg <= o.upTo);
    const hero = s.nubs.hero;
    if (on && lp) {
      if (hero === 'ember' && onSight !== null) {
        handFrame(hand, f);
        onSight.fill(s, f);
        return f;
      }
      // A press may start while the finger waits to re-grab the sun (it is off the sun anyway).
      const free = hand.mode === 0 || hand.mode === 3;
      for (const tp of lp.taps) if (s.tickAbs === tp.tick - TAP_PRESS && free) handPress(hand, VERB_TAP, tp.x, tp.y, tp.obj, TAP_PRESS);
      for (const h of lp.holds) {
        if (s.tickAbs === h.tick - HOLD_PRESS && free) handPress(hand, VERB_HOLD, h.x, h.y, h.obj, HOLD_PRESS);
        if (s.tickAbs === h.end && hand.mode === 2 && hand.obj === h.obj) handRelease(hand);
      }
      if (hero === 'drip') {
        f.dTheta = 0;
        const el = s.el as ElState;
        const lanes = lp.lanes;
        if (lanes !== null && s.tickAbs % STEP === 0) {
          const k = Math.round((s.tickAbs - lp.from) / STEP) + 1;
          const L = lanes[Math.min(lanes.length - 1, Math.max(0, k))] as number;
          f.steer = q64(L - el.dxTarget);
        }
      } else if (hero === 'gust' && o.vane !== undefined) {
        f.dTheta = 0;
        if (drv === null) {
          drv = createDriver();
          drv.begin(s, { aimDeg: 0, track: false, nowOnly: false, autoSnap: false, autoAct: false, reducedMotion: false });
        }
        // Set once on the leg's first tick and never touched again: the governor's rules (its
        // auto-calm at the policy floor included) and no Calm press.
        vctl.vane = s.relayIdx !== vaneLeg ? o.vane : 0;
        vctl.vaneUp = vctl.vane !== 0;
        vaneLeg = s.relayIdx;
        drv.fill(s, f, vctl);
      } else if (hero === 'gust') {
        f.dTheta = 0;
        const g = gust as ElPolicy;
        g.fill(s, f);
        if (plan.mod.noHandoff && handoff >= 0 && s.tickAbs >= handoff) f.verb = 0;
      }
    }
    if (hero === 'drip' || hero === 'gust') f.dTheta = 0;
    handFrame(hand, f);
    return f;
  };
}

/** The tick the first weather object of the stretch after a Gust leg wakes (its hand-off weather), or −1. */
function handoffWake(s: SimState): number {
  const t = s.trial as TrialDef;
  const el = s.el as ElState;
  let best = -1;
  for (let i = 0; i < t.relays.length; i++) {
    if ((t.relays[i] as { to: HeroId }).to !== 'gust') continue;
    const end = i + 1 < t.relays.length ? tagTick(t, i + 1) : Infinity;
    for (const o of el.objs) {
      if (o.kind !== 'rain' && o.kind !== 'fog') continue;
      if (tickAtY(s, o.y) < end) continue;
      const w = wakeTick(s, o);
      if (w < end && (best < 0 || w < best)) best = w;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------------------------
// Replays
// ---------------------------------------------------------------------------------------------

/** How a replay pins the plants: their latest stand (×1), their earliest (×3; bridges still ×1), or real growth. */
type Bound = 'latest' | 'earliest' | 'real';

interface ReplayOpts {
  readonly bound: Bound;
  /** Called after every step, with the leg of the walker. */
  readonly tick?: (s: SimState) => void;
  /** Stop after the step that reaches this absolute tick. */
  readonly until: number;
}

/**
 * Replays the plan's schedules (legs ≤ upTo) with the sun left alone from go, the meter held full on
 * every leg but Gust's, and the plants pinned to `bound`. Returns the state at the end, or null when
 * the run ended (a fall, or Gust lost).
 */
function replay(plan: Plan, upTo: number, ro: ReplayOpts): SimState | null {
  const s = trialRun(plan.t);
  const play = planPlayer(plan, { theta: { k: 'still' }, upTo });
  const n = (s.el as ElState).objs.length;
  const gb = new Float64Array(n);
  while (s.phase !== 'dead' && s.phase !== 'won' && s.tickAbs < ro.until) {
    if (s.nubs.hero !== 'gust') {
      s.nubs.chill = s.nubs.maxChill;
      (s.el as ElState).spent = 0;
    }
    step(s, play(s));
    if (ro.bound !== 'real') pin(s, gb, ro.bound);
    ro.tick?.(s);
  }
  return s.phase === 'dead' ? null : s;
}

/** Pins every planted site's growth to the bound after a step (§6.2). */
function pin(s: SimState, gb: Float64Array, bound: Bound): void {
  const el = s.el as ElState;
  const g = SP.grow * DT;
  for (let i = 0; i < el.objs.length; i++) {
    const o = el.objs[i] as ElObj;
    if (o.state === EL_GONE || o.size <= 0) continue;
    const plot = o.kind === 'plot';
    if (!plot && o.kind !== 'gap' && o.kind !== 'stream') continue;
    const v = Math.min(o.size, (gb[i] as number) + (plot && bound === 'earliest' ? 3 * g : g));
    gb[i] = v;
    o.grown = v;
    if (!plot) continue;
    if (o.casterId >= 0 && v < o.size) {
      removeCaster(s.world, o.casterId);
      o.casterId = -1;
      s.stats.trees = (s.stats.trees as number) - 1;
    } else if (bound === 'earliest' && o.casterId < 0 && v >= o.size && o.size >= SP.treeMin && el.hold !== i) {
      standTree(s, i);
      s.stats.trees = (s.stats.trees as number) + 1;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Leg schedules (θ-free, fixed before the DP)
// ---------------------------------------------------------------------------------------------

/** What a probe replay saw per tick of a leg: who is a target and where the rain falls. */
interface Probe {
  readonly from: number;
  readonly to: number;
  /** Per object, per tick of the leg: 1 when a tap/hold at its point targets it now. */
  readonly target: Uint8Array[];
  /** Per object, per tick: 1 when rain covers its centre. */
  readonly rained: Uint8Array[];
  /** Per tick: rain on the walker (Sprout's ledger). */
  readonly wet: Uint8Array;
  /** The walker's contact tick per object (−1 none in range). */
  readonly contact: Int32Array;
}

/** A tap or hold point on object o: walls and crossings on the trail line, the rest at their centre. */
function pointOf(s: SimState, o: ElObj): [number, number] {
  const k = o.kind;
  return k === 'puddle' || k === 'plot' ? [q8(o.x), q8(o.y)] : [q8(trailX(s.world.trail, o.y)), q8(o.y)];
}

/** The contact edge of o (§0.2). */
function edgeOf(o: ElObj): number {
  const k = o.kind;
  if (k === 'bramble' || k === 'gate' || k === 'ice') return o.y - O.wallDepth / 2;
  if (k === 'gap' || k === 'stream') return o.y - o.r;
  return o.y - o.r - O.touch;
}

function probe(plan: Plan, leg: number, bound: Bound): Probe | null {
  const lp = plan.legs[leg] as LegPlan;
  const len = lp.to - lp.from + 1;
  let target: Uint8Array[] = [];
  let rained: Uint8Array[] = [];
  const wet = new Uint8Array(len);
  let contact = new Int32Array(0);
  const hero = lp.hero;
  const s = replay(plan, leg - 1, {
    bound,
    until: lp.to,
    tick: (st) => {
      if (st.tickAbs < lp.from) return;
      const el = st.el as ElState;
      if (target.length === 0) {
        // The probe pours nothing: its walker must not fall at the leg's crossings.
        for (const o of el.objs) if (o.kind === 'gap' || o.kind === 'stream') o.hit = true;
        target = el.objs.map(() => new Uint8Array(len));
        rained = el.objs.map(() => new Uint8Array(len));
        contact = new Int32Array(el.objs.length).map((_, i) => tickAtY(st, edgeOf(el.objs[i] as ElObj)));
      }
      const k = st.tickAbs - lp.from;
      if (k >= len) return;
      for (let i = 0; i < el.objs.length; i++) {
        const o = el.objs[i] as ElObj;
        if (o.state === EL_GONE) continue;
        const [x, y] = pointOf(st, o);
        if (hero === 'ember' && burnTarget(st, x, y) === i) (target[i] as Uint8Array)[k] = 1;
        else if (hero === 'sprout' && growTarget(st, x, y) === i) (target[i] as Uint8Array)[k] = 1;
        if (inWeather(el, 'rain', o.x, o.y)) (rained[i] as Uint8Array)[k] = 1;
      }
      if (inWeather(el, 'rain', st.nubs.x, st.nubs.y)) wet[k] = 1;
    },
  });
  if (s === null || target.length === 0) return null;
  return { from: lp.from, to: lp.to, target, rained, wet, contact };
}

/** No rain on object i over ticks (a, b] of the probe. */
function dry(p: Probe, i: number, a: number, b: number): boolean {
  const r = p.rained[i] as Uint8Array;
  for (let t = Math.max(a + 1, p.from); t <= Math.min(b, p.to); t++) if (r[t - p.from] === 1) return false;
  return true;
}

function targetAt(p: Probe, i: number, tick: number): boolean {
  return tick >= p.from && tick <= p.to && (p.target[i] as Uint8Array)[tick - p.from] === 1;
}

/** Ember's schedule (§6.2): own walls mid sweet window after any shower; ice and walls past the TAG at the latest burn-out; puddles on its path dried 60 ticks before them; ice on its own path melted early enough to dry its puddle. */
function emberSchedule(plan: Plan, leg: number, p: Probe, s0: SimState): Tap[] {
  const lp = plan.legs[leg] as LegPlan;
  const el = s0.el as ElState;
  const taps: Tap[] = [];
  const pace = 70 / TICK_HZ;
  const busy = (tick: number): boolean => taps.some((tp) => Math.abs(tp.tick - tick) < TAP_PRESS + REGRAB_TICKS);
  const add = (i: number, tick: number): boolean => {
    if (!targetAt(p, i, tick) || busy(tick) || tick >= lp.to) return false;
    const [x, y] = pointOf(s0, el.objs[i] as ElObj);
    taps.push({ tick, obj: i, x, y });
    return true;
  };
  for (let i = 0; i < el.objs.length; i++) {
    const o = el.objs[i] as ElObj;
    const k = o.kind;
    const C = p.contact[i] as number;
    const tgt = p.target[i] as Uint8Array;
    if (!tgt.some((v) => v === 1)) continue;
    const bt = (EM.burnTicks as Record<string, number>)[k] ?? 0;
    const own = C <= lp.to;
    if ((k === 'bramble' || k === 'gate') && own) {
      // The sweet window: from bt of walking before contact down to `near`.
      const open = C - bt;
      const close = C - Math.ceil(E.near / pace);
      let t = Math.round((open + close) / 2);
      while (t <= close && !dry(p, i, t, C)) t++;
      for (; t <= close; t++) if (add(i, t)) break;
    } else if (k === 'ice' && !(plan.mod.keepIce && !own)) {
      if (own) {
        // Melt it early enough that its puddle is dried 60 ticks before Ember reaches it.
        const Cp = tickAtY(s0, o.y - O.puddleR - O.touch);
        const tDry = Cp - DRY_AT;
        let t = tDry - bt - 2;
        while (t > lp.from && !(dry(p, i, t, t + bt) && targetAt(p, i, t) && !busy(t))) t--;
        if (t > lp.from && add(i, t)) {
          // The dry tap lands on the puddle the melt leaves (a target only once it exists: checked in the row replay).
          taps.push({ tick: tDry, obj: i, x: q8(trailX(s0.world.trail, o.y)), y: q8(o.y) });
        }
      } else {
        let t = Math.min(C - bt - 6, lp.to - 6);
        while (t > lp.from && !(dry(p, i, t, t + bt) && targetAt(p, i, t) && !busy(t))) t--;
        if (t > lp.from) add(i, t);
      }
    } else if ((k === 'bramble' || k === 'gate') && !own) {
      let t = Math.min(C - bt - 6, lp.to - 6);
      while (t > lp.from && !(dry(p, i, t, t + bt) && targetAt(p, i, t) && !busy(t))) t--;
      if (t > lp.from) add(i, t);
    } else if (k === 'puddle' && own) {
      let t = C - DRY_AT;
      while (t > lp.from && !(dry(p, i, t, t + bt) && targetAt(p, i, t) && !busy(t))) t--;
      if (t > lp.from) add(i, t);
    }
  }
  taps.sort((a, b) => a.tick - b.tick);
  return taps;
}

/**
 * Sprout's schedule (§6.2): each crossing poured its need at the latest tick that completes it at ×1
 * growth with 0.3 s to spare, one hold at a time (each verb 13 ticks of press after the last release),
 * the first no earlier than TAG + 13; then plots in arrival order where a hold fits, treeMin Sap each
 * while the ledger keeps PLOT_RESERVE, skipping plots a later fire would reach downwind unless the mod
 * asks. Returns the holds, or null when a crossing cannot be scheduled.
 */
function sproutSchedule(plan: Plan, leg: number, p: Probe, s0: SimState): { holds: Hold[]; margin: number; ledger: number } | null {
  const lp = plan.legs[leg] as LegPlan;
  const el = s0.el as ElState;
  const g = SP.grow * DT;
  const rate = SP.invest * DT;
  const cross: number[] = [];
  for (let i = 0; i < el.objs.length; i++) {
    const o = el.objs[i] as ElObj;
    if ((o.kind === 'gap' || o.kind === 'stream') && o.state !== EL_GONE && (p.contact[i] as number) > lp.from && (p.contact[i] as number) <= lp.to) cross.push(i);
  }
  const holds: Hold[] = [];
  let next = Infinity;
  for (let k = cross.length - 1; k >= 0; k--) {
    const i = cross[k] as number;
    const o = el.objs[i] as ElObj;
    const need = needOf(o) - o.size;
    const grow = Math.ceil((needOf(o) - o.grown) / g);
    const pour = Math.ceil(need / rate) + 1;
    let t = Math.min((p.contact[i] as number) - BRIDGE_SPARE - grow, next - HOLD_PRESS - 1 - pour);
    while (t >= lp.from + HOLD_PRESS && !targetAt(p, i, t)) t--;
    if (t < lp.from + HOLD_PRESS) return null;
    const [x, y] = pointOf(s0, o);
    holds.push({ tick: t, end: t + pour, obj: i, x, y, goal: needOf(o) });
    next = t;
  }
  holds.reverse();
  // The Sap ledger with the crossings alone (the leg's margin, §6.2), then plots fitted into the gaps
  // while it stays ≥ 0 (the path bot's trees).
  const start = legStartOf(plan.t, leg);
  const margin = ledger(holds, p, start, el);
  const plots: number[] = [];
  for (let i = 0; i < el.objs.length; i++) {
    const o = el.objs[i] as ElObj;
    if (o.kind !== 'plot' || o.state === EL_GONE || o.casterId >= 0) continue;
    if (!(p.target[i] as Uint8Array).some((v) => v === 1)) continue;
    if (!plan.mod.downwind && downwindPlot(s0, el, o)) continue;
    plots.push(i);
  }
  for (const i of plots) {
    const o = el.objs[i] as ElObj;
    // Each plot the least Sap that stands a tree (as many trees as the ledger allows).
    for (let amt = SP.treeMin; amt <= SP.treeMin; amt += 5) {
      const pour = Math.ceil((amt - o.size) / rate) + 1;
      let placed = false;
      for (let t = lp.from + HOLD_PRESS; t + pour < lp.to - 1; t++) {
        if (!targetAt(p, i, t) || !targetAt(p, i, t + pour - 1)) continue;
        if (holds.some((h) => t + pour + HOLD_PRESS + 1 > h.tick && t < h.end + HOLD_PRESS + 1)) continue;
        const [x, y] = pointOf(s0, o);
        const cand: Hold = { tick: t, end: t + pour, obj: i, x, y, goal: amt };
        const all = [...holds, cand].sort((a, b) => a.tick - b.tick);
        if (ledger(all, p, start, el) >= PLOT_RESERVE) {
          holds.push(cand);
          holds.sort((a, b) => a.tick - b.tick);
          placed = true;
        }
        break;
      }
      if (placed) break;
    }
  }
  return { holds, margin, ledger: ledger(holds, p, start, el) };
}

/** Sap's lowest point over the leg with these holds (−1 when a pour would be short). */
function ledger(holds: readonly Hold[], p: Probe, start: number, el: ElState): number {
  let sap = start;
  let low = start;
  const size = new Float64Array(el.objs.length);
  for (let i = 0; i < el.objs.length; i++) size[i] = (el.objs[i] as ElObj).size;
  let h = 0;
  for (let t = p.from + 1; t <= p.to; t++) {
    while (h < holds.length && (holds[h] as Hold).end < t) h++;
    const cur = holds[h];
    if (cur !== undefined && t > cur.tick && t <= cur.end) {
      const want = Math.min(SP.invest * DT, cur.goal - (size[cur.obj] as number));
      if (want > 0) {
        if (sap < want - 1e-9) return -1;
        sap -= want;
        size[cur.obj] = (size[cur.obj] as number) + want;
      }
    }
    sap = Math.min(100, sap + (SP.root + (p.wet[t - p.from] === 1 ? SP.rain : 0)) * DT);
    if (sap < low) low = sap;
  }
  return low;
}

/** A plot a fire on a later wall in an Ember stretch would reach while the breeze spreads fire (§3.4). */
export function downwindPlot(s: SimState, el: ElState, p: ElObj): boolean {
  const b = (s.trial as TrialDef).breeze;
  const F = E.fire;
  if (b < F.spreadAt && b > -F.spreadAt) return false;
  for (const o of el.objs) {
    if ((o.kind !== 'bramble' && o.kind !== 'gate') || o.state === EL_GONE) continue;
    const dx = p.x - o.x;
    if (Math.abs(p.y - o.y) <= F.reachY && Math.abs(dx) <= F.reach && (b < 0 ? -dx : dx) >= -F.upwind) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------------------------

/** Per-row data of the θ DP (the whole trial). */
interface Rows {
  readonly j0: number;
  readonly n: number;
  /** Lit sums per row × bin (0..10). */
  readonly lit: Uint8Array;
  /** Per row: the leg, the instant meter change (bumps, feeds, stones, tap costs) and the water drain of the step. */
  readonly leg: Int16Array;
  readonly instant: Float64Array;
  readonly drain: Float64Array;
  /** Per row: Ember's spending so far this leg (steady health adds it back), and the cost of a tap in the step (the meter must exceed it). */
  readonly spent: Float64Array;
  readonly tapNeed: Float64Array;
  /** Per row: the finger is off the sun during some tick of the step (no turn). */
  readonly still: Uint8Array;
}

const scene = createMaskScene();

function rowsFor(j0: number, n: number): Rows {
  return { j0, n, lit: new Uint8Array(n * BINS), leg: new Int16Array(n).fill(-1), instant: new Float64Array(n), drain: new Float64Array(n), spent: new Float64Array(n), tapNeed: new Float64Array(n), still: new Uint8Array(n) };
}

/** The row of an absolute tick (the step that ends at or after it). */
function rowOf(R: { j0: number }, tick: number): number {
  return Math.ceil(tick / STEP) - (R.j0 - 1);
}

/** Lit sums at (x, y) now, into out (gatherScene + litMask, runtime casters and rain proxies, no snap cloud). */
function litAt(s: SimState, x: number, y: number, out: Uint8Array): void {
  gatherScene(s.world, scene, x, y, MARGIN, s.tAbs, s.eps, s.cot, true, SNAP_ID_BASE);
  litMask(scene, x, y, false, out, null);
}

/** Records leg `leg`'s rows from a replay with its schedule (Nubs: lit; Ember: lit, water, instants). */
function legRows(plan: Plan, leg: number, R: Rows, bound: Bound): string {
  const lp = plan.legs[leg] as LegPlan;
  const hero = lp.hero;
  let spent = 0;
  let err = '';
  let burnt = 0;
  const s = replay(plan, leg, {
    bound,
    until: lp.to,
    tick: (st) => {
      if (st.tickAbs <= lp.from || st.tickAbs > lp.to) return;
      const r = rowOf(R, st.tickAbs);
      if (r < 0 || r >= R.n) return;
      const el = st.el as ElState;
      for (const e of st.events) {
        if (e.e === 'burn' && !e.spread) {
          burnt++;
          spent += e.cost;
          R.instant[r] = (R.instant[r] as number) - e.cost;
          R.tapNeed[r] = Math.max(R.tapNeed[r] as number, e.cost);
        } else if (e.e === 'feed') {
          spent -= e.delta;
          R.instant[r] = (R.instant[r] as number) + e.delta;
        } else if (e.e === 'bump') R.instant[r] = (R.instant[r] as number) + e.delta;
        else if (e.e === 'sizzle') R.instant[r] = (R.instant[r] as number) + e.delta;
        else if (e.e === 'fizz') err = `fizz at ${st.tickAbs}`;
      }
      if (hero === 'ember') {
        const touch = el.touch;
        R.drain[r] = (R.drain[r] as number) + (((touch & 1) !== 0 ? EM.douse : 0) + ((touch & 2) !== 0 ? EM.rain : 0)) * DT;
      }
      R.spent[r] = spent;
      if (st.tickAbs % STEP === 0) {
        R.leg[r] = leg;
        litAt(st, st.nubs.x, st.nubs.y, R.lit.subarray(r * BINS, (r + 1) * BINS));
      }
    },
  });
  if (s === null) return `the walker fell in leg ${leg}`;
  // A scheduled tap that found no target (a dry tap on a melt that left no puddle in time) costs nothing: noted.
  if (burnt < lp.taps.length) lp.note += ` ${lp.taps.length - burnt} tap(s) missed`;
  return err;
}

// ---------------------------------------------------------------------------------------------
// The θ DP
// ---------------------------------------------------------------------------------------------

/** Rate tables by lit sum 0..10 (per s): Nubs' trial rule, Ember's light (glare counts as full light). */
function nubsRates(D: number, Rg: number): Float64Array {
  const t = new Float64Array(11);
  for (let c = 0; c <= 10; c++) t[c] = -D * (c / 5) + Rg * Math.max(0, 1 - c / 5);
  return t;
}

function emberRates(): Float64Array {
  const t = new Float64Array(11);
  for (let c = 0; c <= 10; c++) {
    const fs = Math.min(c, 5) / 5;
    t[c] = EM.refill * fs - EM.fade * (1 - fs);
  }
  return t;
}

const win = new Float64Array(BINS);
const src = new Float64Array(BINS);

/**
 * One leg's DP over rows a..b (inclusive): from `start` (meter per bin, DEAD where not alive), the
 * best meter per bin per row with the steady health (meter + spent) kept ≥ h and every tap afforded.
 * `table` gets rows a..b. Sprout and held legs pass alive bins through (Sprout turning between pours).
 * Returns the last row that had a live bin (b when it got through).
 */
function legDp(R: Rows, hero: HeroId, rates: Float64Array | null, a: number, b: number, start: Float64Array, h: number, table: Float64Array): number {
  const maxC = 100;
  table.fill(DEAD, a * BINS, (b + 1) * BINS);
  for (let k = 0; k < BINS; k++) table[a * BINS + k] = start[k] as number;
  const held = hero === 'drip' || hero === 'gust';
  for (let r = a + 1; r <= b; r++) {
    const po = (r - 1) * BINS;
    const o = r * BINS;
    for (let k = 0; k < BINS; k++) src[k] = table[po + k] as number;
    const turn = held || R.still[r] === 1 ? 0 : TURN;
    if (turn > 0) slidingMaxCircular(src, turn, win);
    else win.set(src);
    let any = false;
    for (let k = 0; k < BINS; k++) {
      const wv = win[k] as number;
      if (wv === DEAD) continue;
      if (rates === null) {
        table[o + k] = 0;
        any = true;
        continue;
      }
      const l0 = R.lit[po + k] as number;
      const l1 = R.lit[o + k] as number;
      const l2 = r + 1 < R.n && R.leg[r + 1] === R.leg[r] ? (R.lit[o + BINS + k] as number) : l1;
      const d = Math.min(rates[l0] as number, rates[l1] as number, rates[l2] as number);
      if (wv <= (R.tapNeed[r] as number)) continue;
      let v = wv + d * DT_STEP - (R.drain[r] as number) + (R.instant[r] as number);
      if (v > maxC) v = maxC;
      if (v <= 0 || v + (R.spent[r] as number) < h) continue;
      table[o + k] = v;
      any = true;
    }
    if (!any) return r - 1;
  }
  return b;
}

/** The highest threshold (0..100) at which leg rows a..b keep a live bin (−1 none), with an optional required end bin. */
function legMargin(R: Rows, hero: HeroId, rates: Float64Array | null, a: number, b: number, start: Float64Array, table: Float64Array, end = -1): number {
  const ok = (h: number): boolean => legDp(R, hero, rates, a, b, start, h, table) === b && (end < 0 || (table[b * BINS + end] as number) !== DEAD);
  if (!ok(0)) return -1;
  if (rates === null) return 100;
  let lo = 0;
  let hi = 101;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (ok(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Backtracks leg rows a..b from end bin `e` into path (bins per row). */
function backtrack(R: Rows, hero: HeroId, a: number, b: number, e: number, table: Float64Array, path: Int16Array): boolean {
  let k = e;
  path[b] = k;
  const held = hero === 'drip' || hero === 'gust';
  for (let r = b; r > a; r--) {
    const turn = held || R.still[r] === 1 ? 0 : TURN;
    let pb = -1;
    let bestV = DEAD;
    for (let d = -turn; d <= turn; d++) {
      const c = (k + d + BINS) % BINS;
      const v = table[(r - 1) * BINS + c] as number;
      if (v !== DEAD && (pb < 0 || v > bestV || (v === bestV && Math.abs(d) < Math.abs(angleDiff(pb, k))))) {
        bestV = v;
        pb = c;
      }
    }
    if (pb < 0) return false;
    k = pb;
    path[r - 1] = k;
  }
  return true;
}

// ---------------------------------------------------------------------------------------------
// Drip's lane DP
// ---------------------------------------------------------------------------------------------

/** Drip's rows: per step of its leg, per lane (2 u apart over ±range), lit sums per bin, rain, lane bounds; its puddles and stones. */
interface DripRows {
  readonly n: number;
  readonly lit: Uint8Array;
  readonly rain: Uint8Array;
  readonly lo: Float64Array;
  readonly hi: Float64Array;
  /** The walker's y and the trail's x at it, per step. */
  readonly y: Float64Array;
  readonly tx: Float64Array;
  /** Puddles and stones (world x and y, reach r + touch, +30 or −20). */
  readonly objs: { x: number; y: number; r: number; d: number }[];
  readonly start: number;
}

const LANES = 2 * DR.range / 2 + 1;
const laneU = (l: number): number => -DR.range + 2 * l;

function dripRows(plan: Plan, leg: number): DripRows | null {
  const lp = plan.legs[leg] as LegPlan;
  const n = Math.floor((lp.to - lp.from) / STEP) + 1;
  const lit = new Uint8Array(n * LANES * BINS);
  const rain = new Uint8Array(n * LANES);
  const lo = new Float64Array(n);
  const hi = new Float64Array(n);
  const ys = new Float64Array(n);
  const txs = new Float64Array(n);
  const lane = new Float64Array(2);
  const tmp = new Uint8Array(BINS);
  let objs: DripRows['objs'] = [];
  const s = replay(plan, leg, {
    bound: 'latest',
    until: lp.to,
    tick: (st) => {
      if (st.tickAbs < lp.from || (st.tickAbs - lp.from) % STEP !== 0) return;
      const k = (st.tickAbs - lp.from) / STEP;
      if (k >= n) return;
      const el = st.el as ElState;
      if (k === 0) {
        objs = [];
        for (const o of el.objs) {
          if ((o.kind !== 'puddle' && o.kind !== 'stone') || o.state === EL_GONE || o.hit) continue;
          if (o.y < st.nubs.y || o.y > worldYAtTick(st.world, lp.to) + 20) continue;
          // Conservative by a unit: a puddle counts only when the path is clearly on it, a stone whenever it might graze it.
          objs.push({ x: o.x, y: o.y, r: o.r + O.touch + (o.kind === 'puddle' ? -1 : 1), d: o.kind === 'puddle' ? DR.puddle : -DR.stone });
        }
      }
      const y = st.nubs.y;
      ys[k] = y;
      laneOf(st, lane);
      lo[k] = lane[0] as number;
      hi[k] = lane[1] as number;
      const tx = trailX(st.world.trail, y);
      txs[k] = tx;
      for (let l = 0; l < LANES; l++) {
        const x = tx + laneU(l);
        litAt(st, x, y, tmp);
        lit.set(tmp, (k * LANES + l) * BINS);
        rain[k * LANES + l] = inWeather(el, 'rain', x, y) ? 1 : 0;
      }
    },
  });
  if (s === null) return null;
  return { n, lit, rain, lo, hi, y: ys, tx: txs, objs, start: legStartOf(plan.t, leg) };
}

/** Distance from (px, py) to the segment (ax, ay)–(bx, by). */
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax;
  const vy = by - ay;
  const L = vx * vx + vy * vy;
  let u = L > 0 ? ((px - ax) * vx + (py - ay) * vy) / L : 0;
  u = u < 0 ? 0 : u > 1 ? 1 : u;
  const dx = px - (ax + u * vx);
  const dy = py - (ay + u * vy);
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Drip's lane DP for held bin `b` at threshold h: the best Size per (step, lane, consumed bits),
 * lanes inside the lane bounds, moves ≤ slide · 0.1 u a step, puddles (+30) and stones (−20) once
 * each along the segment between steps. Returns true when a lane path keeps Size ≥ h; with `path`,
 * the lanes of the best one.
 */
function dripDp(D: DripRows, b: number, h: number, path: Float64Array | null, evapMul: number): boolean {
  const n = D.n;
  const NB = 8;
  const val = new Float64Array(n * LANES * NB).fill(DEAD);
  const from = path ? new Int32Array(n * LANES * NB).fill(-1) : null;
  const l0 = (LANES - 1) / 2;
  val[(0 * LANES + l0) * NB] = D.start;
  const maxMove = Math.floor((DR.slide * DT_STEP) / 2 + 1e-9);
  const rates = new Float64Array(11);
  for (let c = 0; c <= 10; c++) rates[c] = DR.grow * Math.max(0, 1 - c / 5) - (DR.evap * evapMul * c) / 5;
  // The objects a step can touch (at most 3 at a time, one bit each).
  for (let k = 1; k < n; k++) {
    const y0 = D.y[k - 1] as number;
    const y1 = D.y[k] as number;
    const act: number[] = [];
    for (let i = 0; i < D.objs.length && act.length < 3; i++) {
      const o = D.objs[i] as DripRows['objs'][number];
      if (o.y + o.r >= y0 && o.y - o.r <= y1) act.push(i);
    }
    // Bits are per step-local object list; carry them across steps by object identity.
    const prevAct: number[] = [];
    if (k > 1) {
      const py0 = D.y[k - 2] as number;
      for (let i = 0; i < D.objs.length && prevAct.length < 3; i++) {
        const o = D.objs[i] as DripRows['objs'][number];
        if (o.y + o.r >= py0 && o.y - o.r <= y0) prevAct.push(i);
      }
    }
    for (let l = 0; l < LANES; l++) {
      const L = laneU(l);
      if (L < (D.lo[k] as number) - 1e-9 || L > (D.hi[k] as number) + 1e-9) continue;
      const c1 = D.lit[(k * LANES + l) * BINS + b] as number;
      for (let pl = Math.max(0, l - maxMove); pl <= Math.min(LANES - 1, l + maxMove); pl++) {
        const c0 = D.lit[((k - 1) * LANES + pl) * BINS + b] as number;
        const c2 = k + 1 < n ? (D.lit[((k + 1) * LANES + l) * BINS + b] as number) : c1;
        const d = Math.min(rates[c0] as number, rates[c1] as number, rates[c2] as number) + (D.rain[k * LANES + l] === 1 ? DR.rain : 0);
        const PL = laneU(pl);
        for (let pb = 0; pb < NB; pb++) {
          const pv = val[((k - 1) * LANES + pl) * NB + pb] as number;
          if (pv === DEAD) continue;
          // Map the previous step's bits onto this step's objects.
          let bits = 0;
          for (let a = 0; a < act.length; a++) {
            const pi = prevAct.indexOf(act[a] as number);
            if (pi >= 0 && (pb & (1 << pi)) !== 0) bits |= 1 << a;
          }
          let v = pv + d * DT_STEP;
          for (let a = 0; a < act.length; a++) {
            if ((bits & (1 << a)) !== 0) continue;
            const o = D.objs[act[a] as number] as DripRows['objs'][number];
            if (segDist(o.x, o.y, (D.tx[k - 1] as number) + PL, y0, (D.tx[k] as number) + L, y1) <= o.r) {
              v += o.d;
              bits |= 1 << a;
            }
          }
          if (v > 100) v = 100;
          if (v < h || v <= 0) continue;
          const idx = (k * LANES + l) * NB + bits;
          if (v > (val[idx] as number)) {
            val[idx] = v;
            if (from) from[idx] = ((k - 1) * LANES + pl) * NB + pb;
          }
        }
      }
    }
  }
  let best = -1;
  for (let i = (n - 1) * LANES * NB; i < n * LANES * NB; i++) if ((val[i] as number) !== DEAD && (best < 0 || (val[i] as number) > (val[best] as number))) best = i;
  if (best < 0) return false;
  if (path && from) {
    let i = best;
    for (let k = n - 1; k >= 0; k--) {
      path[k] = laneU(Math.floor(i / NB) % LANES);
      if (dbgVals) dbgVals[k] = val[i] as number;
      i = from[i] as number;
      if (i < 0 && k > 0) {
        for (let kk = k - 1; kk >= 0; kk--) path[kk] = 0;
        break;
      }
    }
  }
  return true;
}

/** Tooling: the best lane path's Size per step (set to an array to receive it). */
export let dbgVals: Float64Array | null = null;
export function setDbgVals(a: Float64Array | null): void {
  dbgVals = a;
}

function dripMargin(D: DripRows, b: number, evapMul: number): number {
  if (!dripDp(D, b, 0, null, evapMul)) return -1;
  let lo = 0;
  let hi = 101;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (dripDp(D, b, mid, null, evapMul)) lo = mid;
    else hi = mid;
  }
  return lo;
}

// ---------------------------------------------------------------------------------------------
// The audit
// ---------------------------------------------------------------------------------------------

/** The Drip mask's marks at a TAG (from a replay up to its last tick before). */
function marksAt(plan: Plan, leg: number): number[] {
  const lp = plan.legs[leg] as LegPlan;
  const out = new Uint8Array(BINS);
  const s = replay(plan, leg - 1, { bound: 'latest', until: lp.from - 1 });
  if (s === null) return [];
  elTagMarks(s, out);
  const marks: number[] = [];
  for (let b = 0; b < BINS; b++) if (out[b] === 1) marks.push(b);
  const grid = marks.filter((b) => b % GRID === 0);
  return grid.length > 0 ? grid : marks;
}

/**
 * The audit of a trial variant (G1): every leg's margin and the plan the path bot follows. With
 * `worst` the leg before each Drip leg ends at the worst marked bin instead (G2's second run).
 */
export function audit(v: TrialVariant, worst = false): Plan {
  const t = variantDef(v);
  const s0 = trialRun(t);
  const w = s0.world;
  const start = s0.tickAbs;
  const finish = tickAtY(s0, w.finishY);
  const j0 = Math.ceil(start / STEP) + 1;
  const n = Math.ceil(finish / STEP) - (j0 - 1) + 2;
  const legs: LegPlan[] = [];
  for (let L = 0; L <= t.relays.length; L++) {
    const from = L === 0 ? start : tagTick(t, L - 1);
    const to = L < t.relays.length ? tagTick(t, L) : finish;
    legs.push({ hero: legHero(t, L), from, to, taps: [], holds: [], lanes: null, margin: -1, note: '' });
  }
  const plan: Plan = { t, mod: v.mod ?? {}, legs, j0, n, theta: null, drip: [], ok: false, why: '' };
  const R = rowsFor(j0, n);
  const table = new Float64Array(n * BINS);
  const nubsT = nubsRates(t.drain, s0.params.regen);
  const emberT = emberRates();
  const ratesOf = (h: HeroId): Float64Array | null => (h === 'nubs' ? nubsT : h === 'ember' ? emberT : null);
  const rowA = (L: number): number => Math.max(0, rowOf(R, (legs[L] as LegPlan).from));
  const rowB = (L: number): number => Math.min(n - 1, L + 1 < legs.length ? rowOf(R, (legs[L + 1] as LegPlan).from) : rowOf(R, finish));
  // Schedules and rows, leg by leg.
  for (let L = 0; L < legs.length; L++) {
    const lp = legs[L] as LegPlan;
    if (lp.hero === 'ember' || lp.hero === 'sprout') {
      const bound: Bound = lp.hero === 'ember' ? 'earliest' : 'latest';
      const p = probe(plan, L, bound);
      if (p === null) return fail(plan, `leg ${L} (${lp.hero}): the probe replay ended`);
      const st = replay(plan, L - 1, { bound, until: lp.from });
      if (st === null) return fail(plan, `leg ${L}: the walker fell before it`);
      if (lp.hero === 'ember') lp.taps.push(...emberSchedule(plan, L, p, st));
      else {
        const sch = sproutSchedule(plan, L, p, st);
        if (sch === null) return fail(plan, `leg ${L} (sprout): a crossing cannot be scheduled`);
        lp.holds.push(...sch.holds);
        lp.margin = sch.margin;
        lp.note = `Sap low ${sch.margin < 0 ? 'SHORT' : sch.margin.toFixed(0)}, ${sch.ledger < 0 ? 'SHORT' : sch.ledger.toFixed(0)} with ${sch.holds.filter((h) => (st.el as ElState).objs[h.obj]?.kind === 'plot').length} plots`;
        if (sch.margin < 0 || sch.ledger < 0) return fail(plan, `leg ${L} (sprout): Sap short at a pour`);
      }
    }
    if (lp.hero === 'nubs' || lp.hero === 'ember' || lp.hero === 'sprout') {
      // Sprout's rows are not used, but its replay proves every bridge completes at its latest.
      const err = legRows(plan, L, R, lp.hero === 'ember' ? 'earliest' : 'latest');
      if (err) return fail(plan, `leg ${L} (${lp.hero}): ${err}`);
    }
    // Drip's rows are recorded by its own lane DP below; Gust has none (θ is held, the bots prove it).
    for (const h of lp.holds) for (let tk = h.tick - HOLD_PRESS; tk <= h.end + REGRAB_TICKS; tk++) R.still[Math.max(0, Math.min(n - 1, rowOf(R, tk)))] = 1;
    for (const tp of lp.taps) for (let tk = tp.tick - TAP_PRESS; tk <= tp.tick + REGRAB_TICKS; tk++) R.still[Math.max(0, Math.min(n - 1, rowOf(R, tk)))] = 1;
  }
  // The θ DP, leg by leg, committing before held legs.
  const startSet = new Float64Array(BINS).fill(DEAD);
  startSet[binOf(w.theta0)] = legStartOf(t, 0);
  const ends: Float64Array[] = [];
  const committed: number[] = legs.map(() => -1);
  const drips = new Map<number, DripRows>();
  let set = startSet;
  for (let L = 0; L < legs.length; L++) {
    const lp = legs[L] as LegPlan;
    const a = rowA(L);
    const b = rowB(L);
    const rates = ratesOf(lp.hero);
    const got = legDp(R, lp.hero, rates, a, b, set, AUDIT_HEALTH, table);
    if (got !== b) return fail(plan, `leg ${L} (${lp.hero}): no path keeps ${AUDIT_HEALTH} (lost at row ${got})`);
    const end = new Float64Array(BINS);
    for (let k = 0; k < BINS; k++) end[k] = table[b * BINS + k] as number;
    ends.push(end);
    if (rates !== null) lp.margin = legMargin(R, lp.hero, rates, a, b, set, table);
    const next = legs[L + 1];
    if (next === undefined) break;
    const nextStart = legStartOf(t, L + 1);
    let cand: number[] = [];
    for (let k = 0; k < BINS; k++) if ((end[k] as number) !== DEAD) cand.push(k);
    if (next.hero === 'drip' || next.hero === 'gust') {
      if (next.hero === 'drip') {
        const D = dripRows(plan, L + 1);
        if (D === null) return fail(plan, `leg ${L + 1} (drip): the replay ended`);
        drips.set(L + 1, D);
        const marks = marksAt(plan, L + 1);
        if (marks.length === 0) return fail(plan, `leg ${L + 1} (drip): the guide marks no bin`);
        const margins = marks.map((mb) => dripMargin(D, mb, t.tune.evapMul));
        plan.drip.push({ leg: L + 1, marks, margins, chosen: -1, worst: -1 });
        next.margin = Math.min(...margins);
        next.note = `marks ${marks.length} best ${Math.max(...margins)} worst ${next.margin}`;
        cand = cand.filter((k) => marks.includes(k));
      } else cand = cand.filter((k) => k % GRID === 0);
      if (cand.length === 0) return fail(plan, `leg ${L}: no alive end bin for the held leg ${L + 1}`);
      // The end bin that maximizes min(held margin, the next θ leg's margin from it).
      let bestK = -1;
      let bestV = -Infinity;
      let worstK = -1;
      let worstV = Infinity;
      const dr = plan.drip.at(-1);
      for (const k of cand) {
        const held = next.hero === 'drip' && dr ? (dr.margins[dr.marks.indexOf(k)] as number) : 100;
        const after = nextMargin(L + 2, k);
        const val = Math.min(held, after);
        if (val > bestV) {
          bestV = val;
          bestK = k;
        }
        if (next.hero === 'drip' && held < worstV) {
          worstV = held;
          worstK = k;
        }
      }
      committed[L] = worst && worstK >= 0 ? worstK : bestK;
      if (dr) {
        dr.chosen = committed[L] as number;
        dr.worst = worstK;
      }
      set = new Float64Array(BINS).fill(DEAD);
      set[bestK] = nextStart;
    } else {
      set = new Float64Array(BINS).fill(DEAD);
      for (let k = 0; k < BINS; k++) if ((end[k] as number) !== DEAD) set[k] = rates === null && lp.hero !== 'sprout' ? (end[k] as number) : nextStart;
    }
    if (lp.hero === 'drip' || lp.hero === 'gust') {
      // A held leg hands its bin straight on.
      set = new Float64Array(BINS).fill(DEAD);
      set[committed[L - 1] as number] = nextStart;
    }
  }
  // The path: backwards, each leg at its highest threshold that still reaches the bin the next leg starts from.
  const theta = new Int16Array(n);
  let need = -1;
  for (let L = legs.length - 1; L >= 0; L--) {
    const lp = legs[L] as LegPlan;
    const a = rowA(L);
    const b = rowB(L);
    const rates = ratesOf(lp.hero);
    const prevEnd = L > 0 ? ends[L - 1] : null;
    const st = new Float64Array(BINS).fill(DEAD);
    const startMeter = legStartOf(t, L);
    if (L === 0) st.set(startSet);
    else if (committed[L - 1] as number >= 0) st[committed[L - 1] as number] = startMeter;
    else if (prevEnd) for (let k = 0; k < BINS; k++) if ((prevEnd[k] as number) !== DEAD) st[k] = startMeter;
    if (lp.hero === 'drip' || lp.hero === 'gust') {
      const k = committed[L - 1] as number;
      for (let r = a; r <= b; r++) theta[r] = k;
      need = k;
      continue;
    }
    const endBin = committed[L] >= 0 ? (committed[L] as number) : need;
    let h = rates === null ? 0 : legMargin(R, lp.hero, rates, a, b, st, table, endBin);
    if (h < 0) return fail(plan, `leg ${L}: the path lost its end bin`);
    if (rates !== null && h > lp.margin) h = lp.margin;
    legDp(R, lp.hero, rates, a, b, st, h, table);
    let e = endBin;
    if (e < 0) {
      let bv = DEAD;
      for (let k = 0; k < BINS; k++) if ((table[b * BINS + k] as number) > bv) {
        bv = table[b * BINS + k] as number;
        e = k;
      }
    }
    if (!backtrack(R, lp.hero, a, b, e, table, theta)) return fail(plan, `leg ${L}: backtrack lost the path`);
    need = theta[a] as number;
  }
  for (let r = rowB(legs.length - 1) + 1; r < n; r++) theta[r] = theta[r - 1] as number;
  plan.theta = theta;
  // Drip's lanes for the chosen bin.
  for (const d of plan.drip) {
    const D = drips.get(d.leg) as DripRows;
    const lanes = new Float64Array(D.n);
    dripDp(D, d.chosen, Math.max(0, d.margins[d.marks.indexOf(d.chosen)] as number), lanes, t.tune.evapMul);
    (legs[d.leg] as LegPlan).lanes = lanes;
  }
  plan.ok = legs.every((lp) => lp.hero === 'gust' || lp.margin >= (lp.hero === 'sprout' ? 0 : AUDIT_HEALTH));
  if (!plan.ok) plan.why = legs.map((lp, i) => (lp.hero !== 'gust' && lp.margin < (lp.hero === 'sprout' ? 0 : AUDIT_HEALTH) ? `leg ${i} ${lp.hero} ${lp.margin}` : '')).filter(Boolean).join(', ');
  return plan;

  /** The margin of the first θ-turning life leg from leg L on, starting at bin k (100 when there is none). */
  function nextMargin(L: number, k: number): number {
    let s2 = new Float64Array(BINS).fill(DEAD);
    s2[k] = legStartOf(t, L);
    for (let M = L; M < legs.length; M++) {
      const lp = legs[M] as LegPlan;
      const rates = ratesOf(lp.hero);
      if (lp.hero === 'drip' || lp.hero === 'gust') return 100;
      const a = rowA(M);
      const b = rowB(M);
      if (rates !== null) return legMargin(R, lp.hero, rates, a, b, s2, table);
      if (legDp(R, lp.hero, null, a, b, s2, 0, table) !== b) return -1;
      const s3 = new Float64Array(BINS).fill(DEAD);
      for (let q = 0; q < BINS; q++) if ((table[b * BINS + q] as number) !== DEAD) s3[q] = legStartOf(t, M + 1);
      s2 = s3;
    }
    return 100;
  }
}

function fail(plan: Plan, why: string): Plan {
  plan.ok = false;
  plan.why = why;
  return plan;
}

/** The tick a variant's hand-off weather wakes (G7 tooling), or −1. */
export function handoffTick(t: TrialDef): number {
  return handoffWake(trialRun(t));
}

