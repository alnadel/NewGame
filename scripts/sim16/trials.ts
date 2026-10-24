// Elementals `node scripts/sim.ts --trials` (CORE): proves each Trial winnable on its pinned seed,
// and finds that seed. The module shell of docs/ELEMENTALS_V2.md §6: the per-verb audits, the
// element bots and the v2 gates replace the Nubs-only gates here.
//
//   node scripts/sim.ts --trials [--id 1001,…] [--check] [--pick <id>] [--salts 16] [--workers W]
//
// One row per trial: seed and salt, the audit's margin (G1), the path bot's verdict and lowest
// health (G2), the reactive bot's wins on 8 salts (G3), humanDial's pass rate on --salts salts (G4),
// the anti-trivial gate (G5: idle and the best of 36 constant angles fail) and the Dare's share of
// the G3 and G4 runs (G6). --check exits 1 when any gate fails. --pick <id> searches k = 0..199 for
// the first salt that passes every gate, moving the Dare target 25% toward the band when G6 fails
// on the pick; it prints what to pin in src/config/trials.ts and changes nothing.
//
// The audit (G1) is a read-only, turn-limited survival DP cloned from bake.ts glareFreeLine: 360
// bins on the validator's 6-tick grid from θ0 to the finish line, TUNING.validator.turnBins per step
// (slidingMaxCircular), rows from gatherScene + litMask at the walker's centre, the step delta of
// Nubs' trial rate at lit sum c · 0.1 with min-of-three pessimism (the least of the previous,
// current and next step's deltas), every leg on Nubs' rule (each element's own rule is §6.2's),
// carrying the alive bins across a TAG at the incoming element's start meter (health ≥ 20). The
// Cold Snap, the TAG grace and flakes are left out, so the audit is conservative. The margin
// printed is the highest health threshold a path keeps.

import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import type { LevelDef } from '../../src/config/campaign.ts';
import type { ConceptId } from '../../src/config/concepts.ts';
import type { HeroId } from '../../src/config/heroes.ts';
import { hashString } from '../../src/config/rng.ts';
import { TRIAL_IDS, trialDareValue, trialDef, type TrialDef } from '../../src/config/trials.ts';
import { TUNING } from '../../src/config/tuning.ts';
import { DT, TICK_HZ } from '../../src/core/clock.ts';
import { angleDiff, tanD, wrapDeg } from '../../src/core/dmath.ts';
import { paramsAt, worldElevation, worldYAtDayTick, worldYAtTick } from '../../src/core/gen/plan.ts';
import { gatherScene } from '../../src/core/gen/store.ts';
import { slidingMaxCircular } from '../../src/core/gen/validator.ts';
import { createWorld, ensureGenerated, type World } from '../../src/core/gen/world.ts';
import { BINS, binOf, createMaskScene, litMask } from '../../src/core/intervals.ts';
import { campaignConfig, levelOutcome, levelProgress, minuteStart, resolveLevelConfig } from '../../src/core/level.ts';
import { createBot } from '../../src/core/sim/bots.ts';
import { createRun, type RunBuild } from '../../src/core/sim/create.ts';
import { updateGuide } from '../../src/core/sim/guide.ts';
import { heroStart, tagTick } from '../../src/core/sim/heroes.ts';
import { computeCoverage } from '../../src/core/sim/nubs.ts';
import { step, syncTime } from '../../src/core/sim/step.ts';
import type { InputFrame, SimState } from '../../src/core/sim/types.ts';
import { trailX } from '../../src/core/trail.ts';
import { TaskPool } from './dares.ts';
import type { Sim16Ctx, Sim16Module } from './registry.ts';

const STEP = TUNING.validator.stepTicks;
const TURN = TUNING.validator.turnBins;
const DT_STEP = STEP / TICK_HZ;
const DEAD = -1e9;
const MARGIN = TUNING.nubs.sampleOffset + 1;
/** Health the audit's best path keeps (G1). */
export const AUDIT_HEALTH = 20;
/** The reactive bot's salts (G3) and the wins it needs; humanDial's default salts (G4). */
export const REACTIVE_SALTS = 8;
export const REACTIVE_WINS = 7;
export const HUMAN_SALTS = 16;
/** G4 humanDial pass-rate bands (T1-T4 intros, T5-T7 mixers) and the G6 Dare band. */
const HUMAN_BAND_SOLO: readonly [number, number] = [0.75, 0.95];
const HUMAN_BAND_MIX: readonly [number, number] = [0.45, 0.9];
const DARE_BAND: readonly [number, number] = [0.1, 0.6];
/** --pick: salts tried. */
const PICK_SALTS = 200;

// ---------------------------------------------------------------------------------------------
// Trial variants (calibration) and their runs

/** A trial as calibration tries it: the pinned TrialDef with another salt, drain, start or Dare target (plain data: crosses workers). */
export interface TrialVariant {
  readonly id: number;
  readonly salt: number;
  readonly drain?: number;
  readonly startMinute?: number;
  readonly dareTarget?: number;
  /** Tooling only (sweeps): another concept list. */
  readonly concepts?: readonly ConceptId[];
}

/** The TrialDef of a variant (the pinned one itself when nothing differs). */
export function variantDef(v: TrialVariant): TrialDef {
  const t = trialDef(v.id) as TrialDef;
  const drain = v.drain ?? t.drain;
  const startMinute = v.startMinute ?? t.startMinute;
  const target = v.dareTarget ?? t.dare.target;
  const concepts = v.concepts ?? t.concepts;
  if (v.salt === t.salt && drain === t.drain && startMinute === t.startMinute && target === t.dare.target && concepts === t.concepts) return t;
  return Object.freeze({ ...t, salt: v.salt, seed: hashString(`trial-${t.id}-${v.salt}`), drain, startMinute, concepts, dare: Object.freeze({ kind: t.dare.kind, target }) });
}

/** The LevelDef of a trial variant (config/trials.ts trialLevel's fields). */
function levelOf(t: TrialDef): LevelDef {
  return Object.freeze({
    id: t.id,
    chapter: t.chapter,
    name: t.name,
    seed: t.seed,
    biome: t.biome,
    forecast: t.forecast,
    concepts: t.concepts,
    introduces: null,
    startMinute: t.startMinute,
    lengthMinutes: t.lengthMinutes,
    goal: t.goal,
    stars: Object.freeze({ flakes: 1e9, minChill: t.steady, sunSec: 1e9 }),
    drain: t.drain,
    feats: [],
    flares: [],
  });
}

/** A trial variant's run config (its seed, drain and start) and world. */
function variantBuild(t: TrialDef): RunBuild {
  const start = minuteStart(t.startMinute);
  const cfg = { ...resolveLevelConfig(campaignConfig(t.id)), seed: t.seed, drain: t.drain, startDay: start.day, startT: start.dayTick / TICK_HZ, mods: t.concepts };
  const world = createWorld(cfg, levelOf(t));
  return { cfg, world, targetY: worldYAtDayTick(world, start.day, start.dayTick) + TUNING.world.hardAhead };
}

/**
 * A fresh run of trial `t` (its own world). The pinned trial is campaignConfig's run as the game
 * plays it; a variant is built on its own world and, since createRun resolves the config from the
 * pinned trial, gets its trial, seed, drain and start put back before the first tick.
 */
export function trialRun(t: TrialDef): SimState {
  if (t === trialDef(t.id)) return createRun(campaignConfig(t.id));
  const b = variantBuild(t);
  const s = createRun(b.cfg, b);
  const m = s as { -readonly [K in keyof SimState]: SimState[K] };
  m.trial = t;
  s.cfg.seed = t.seed;
  s.cfg.drain = t.drain;
  const start = minuteStart(t.startMinute);
  if (s.day !== start.day || s.dayTick !== start.dayTick) {
    s.day = start.day;
    s.dayTick = start.dayTick;
    syncTime(s);
    s.nextHistoryY = s.nubs.y;
    ensureGenerated(s.world, s.nubs.y + TUNING.world.hardAhead);
    computeCoverage(s);
  }
  updateGuide(s);
  return s;
}

/** A world of trial `t` generated through its finish line (the audit's). */
export function auditWorld(t: TrialDef): World {
  const w = variantBuild(t).world;
  ensureGenerated(w, w.finishY + TUNING.world.chunkLen);
  return w;
}

// ---------------------------------------------------------------------------------------------
// The audit (G1)

/** The audit of a trial: its margin (the highest health threshold a path keeps) and that path. */
export interface Audit {
  readonly ok: boolean;
  readonly margin: number;
  /** The threshold the gate asks for (AUDIT_HEALTH). */
  readonly need: number;
  /** Step j0 − 1 (θ0) is path[0]; the path runs to the last audited step. */
  readonly j0: number;
  readonly path: Int16Array;
}

/** The walker's element at absolute tick `tick` (cast[0], then each relay from its TAG tick). */
function heroAt(t: TrialDef, tick: number): HeroId {
  let h = t.cast[0] as HeroId;
  for (let i = 0; i < t.relays.length; i++) if (tagTick(t, i) <= tick) h = (t.relays[i] as { to: HeroId }).to;
  return h;
}

export interface Rows {
  readonly j0: number;
  /** Rows j0 − 1 … jEnd + 1 (index j − j0 + 1). */
  readonly n: number;
  readonly jEnd: number;
  readonly lit: Uint8Array;
  readonly hero: HeroId[];
  /** θ0's bin (row 0). */
  readonly theta0: number;
}

const scene = createMaskScene();

/** The audit's rows: per step the lit sums at the walker's centre. */
export function auditRows(t: TrialDef, w: World): Rows {
  const j0 = Math.ceil(w.startTick / STEP) + 1;
  let jEnd = j0;
  while (worldYAtTick(w, jEnd * STEP) < w.finishY) jEnd++;
  const n = jEnd - j0 + 3;
  const lit = new Uint8Array(n * BINS);
  const hero: HeroId[] = [];
  for (let r = 0; r < n; r++) {
    const tick = (j0 - 1 + r) * STEP;
    hero.push(heroAt(t, tick));
    const eps = worldElevation(w, tick);
    const o = r * BINS;
    if (eps <= 0) continue;
    const y = worldYAtTick(w, tick);
    const x = trailX(w.trail, y);
    gatherScene(w, scene, x, y, MARGIN, tick / TICK_HZ, eps, 1 / tanD(eps), false);
    litMask(scene, x, y, false, lit.subarray(o, o + BINS), null);
  }
  return { j0, n, jEnd, lit, hero, theta0: binOf(w.theta0) };
}

/** Nubs' trial rate (per s) at lit sum c = 0..10 (core sim/heroes.ts applyHeroDaylight's expression). */
function rates(D: number, R: number): Float64Array {
  const t = new Float64Array(11);
  for (let c = 0; c <= 10; c++) t[c] = -D * (c / 5) + R * Math.max(0, 1 - c / 5);
  return t;
}

const win = new Float64Array(BINS);
const src = new Float64Array(BINS);

/** One DP pass at health threshold `h`: per step the meter per bin (DEAD when lost). */
interface DpOut {
  readonly ok: boolean;
  readonly last: number;
  readonly tab: Float64Array;
}

function dp(R: Rows, tl: Float64Array, maxC: number, h: number): DpOut {
  const n = R.n;
  const tab = new Float64Array(n * BINS).fill(DEAD);
  // Row 0 (step j0 − 1): θ0 at the first element's start meter.
  tab[R.theta0] = heroStart(R.hero[0] as HeroId, maxC);
  let last = 0;
  for (let r = 1; r < n - 1; r++) {
    const hero = R.hero[r] as HeroId;
    const tag = hero !== R.hero[r - 1];
    const po = (r - 1) * BINS;
    const o = r * BINS;
    // The source row: the previous step's meter, or at a TAG its alive bins at the incoming start.
    for (let b = 0; b < BINS; b++) {
      const v = tab[po + b] as number;
      src[b] = v === DEAD ? DEAD : tag ? heroStart(hero, maxC) : v;
    }
    let any = false;
    slidingMaxCircular(src, TURN, win);
    for (let b = 0; b < BINS; b++) {
      const wv = win[b] as number;
      if (wv === DEAD) continue;
      const d = Math.min(tl[R.lit[po + b] as number] as number, tl[R.lit[o + b] as number] as number, tl[R.lit[o + BINS + b] as number] as number);
      let v = wv + d * DT_STEP;
      if (v > maxC) v = maxC;
      if (v < h) continue;
      tab[o + b] = v;
      any = true;
    }
    if (!any) return { ok: false, last: r, tab };
    last = r;
  }
  return { ok: true, last, tab };
}

/** G1: the audit of trial `t` on its world. */
export function audit(t: TrialDef, w: World = auditWorld(t)): Audit {
  const R = auditRows(t, w);
  const p1 = paramsAt(w, 1);
  const tl = rates(t.drain, p1.regen);
  let lo = -1;
  let hi = 100;
  // The largest threshold (0..100) a path keeps: binary search (a stricter bar only removes paths).
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (dp(R, tl, p1.maxChill, mid).ok) lo = mid;
    else hi = mid;
  }
  const margin = lo;
  if (margin < 0) return { ok: false, margin: -1, need: AUDIT_HEALTH, j0: R.j0, path: new Int16Array(0) };
  const best = dp(R, tl, p1.maxChill, margin);
  return { ok: margin >= AUDIT_HEALTH, margin, need: AUDIT_HEALTH, j0: R.j0, path: backtrack(t, best) };
}

/** The best path of a DP pass: bins per row 0..last, chosen backwards (each row's best meter). */
function backtrack(t: TrialDef, o: DpOut): Int16Array {
  const path = new Int16Array(o.last + 1);
  const L = o.last;
  let b = -1;
  let best = -Infinity;
  for (let bb = 0; bb < BINS; bb++) {
    const v = o.tab[L * BINS + bb] as number;
    if (v !== DEAD && v > best) {
      best = v;
      b = bb;
    }
  }
  path[L] = b;
  for (let r = L; r >= 1; r--) {
    let pb = -1;
    let bestV = DEAD;
    for (let k = -TURN; k <= TURN; k++) {
      const c = (b + k + BINS) % BINS;
      const v = o.tab[(r - 1) * BINS + c] as number;
      if (v !== DEAD && v > bestV) {
        bestV = v;
        pb = c;
      }
    }
    if (pb < 0) throw new Error(`audit backtrack lost the path at row ${r} (trial ${t.id})`);
    b = pb;
    path[r - 1] = b;
  }
  return path;
}

// ---------------------------------------------------------------------------------------------
// Scripted players: the path bot (G2), idle and constant angles (G5)

type Player = (s: SimState) => InputFrame;

function frame(): InputFrame {
  return { dTheta: 0, down: false, downEdge: false, upEdge: false, release: 0, key: 0 };
}

/** Finger held, turning toward `target` (°) at ≤ rate °/s (the first call touches down). */
function steer(f: InputFrame, s: SimState, target: number, rate: number, first: boolean): InputFrame {
  const cur = wrapDeg(s.sun.theta + s.sun.lag);
  const max = rate * DT;
  const d = angleDiff(target, cur);
  f.dTheta = Math.round((d > max ? max : d < -max ? -max : d) * 1024) / 1024;
  f.down = true;
  f.downEdge = first;
  f.upEdge = false;
  f.release = 0;
  f.key = 0;
  f.snap = false;
  return f;
}

/** A constant angle θ, reached during the start beat and held; casts nothing. */
function constant(theta: number): Player {
  const f = frame();
  let first = true;
  return (s) => {
    const out = steer(f, s, theta, 600, first);
    first = false;
    return out;
  };
}

/** The path bot (G2): follows the audit's best θ path and casts nothing. */
function pathBot(a: Audit): Player {
  const f = frame();
  let first = true;
  return (s) => {
    const r = Math.min(a.path.length - 1, Math.max(0, Math.round((s.tickAbs + 1) / STEP) - (a.j0 - 1)));
    const out = steer(f, s, a.path.length ? (a.path[r] as number) : s.sun.theta, 600, first);
    first = false;
    return out;
  };
}

// ---------------------------------------------------------------------------------------------
// Runs (in the worker pool)

/** Who plays a run: a core bot with its salt, or a scripted player. */
export type TrialPlayer = { readonly bot: 'reactive' | 'humanDial' | 'idle'; readonly salt: number } | { readonly bot: 'path' } | { readonly bot: 'const'; readonly theta: number };

export interface TrialRunTask {
  readonly v: TrialVariant;
  readonly p: TrialPlayer;
}

export interface TrialRunOut {
  readonly won: boolean;
  readonly passed: boolean;
  /** The walker's lowest health (stats.minChill) and where the run ended (0..1). */
  readonly health: number;
  readonly progress: number;
  /** The Dare's count, and whether it is met at the finish (star 2). */
  readonly dare: number;
  readonly dareMet: boolean;
  readonly line: string;
}

/** Per worker: the last audit (the path bot's), keyed by variant. */
let auditFor = '';
let auditMemo: Audit | null = null;

export function auditOf(v: TrialVariant): Audit {
  const key = JSON.stringify(v);
  if (key !== auditFor || !auditMemo) {
    auditFor = key;
    auditMemo = audit(variantDef(v));
  }
  return auditMemo;
}

/** Plays one run of a trial variant to its finish line or a failure. */
export function playTrial(task: TrialRunTask): TrialRunOut {
  const t = variantDef(task.v);
  const s = trialRun(t);
  const p = task.p;
  let next: Player;
  if (p.bot === 'path') next = pathBot(auditOf(task.v));
  else if (p.bot === 'const') next = constant(p.theta);
  else {
    const b = createBot(p.bot, p.salt);
    next = (st) => b.next(st);
  }
  while (s.phase !== 'dead' && s.phase !== 'won' && s.tick < 12000) step(s, next(s));
  const o = levelOutcome(s.level as LevelDef, s);
  const dare = trialDareValue(t.dare.kind, s.stats);
  return { won: s.phase === 'won', passed: o.passed, health: s.stats.minChill, progress: levelProgress(s), dare, dareMet: o.passed && dare >= t.dare.target, line: s.death?.line ?? '' };
}

if (!isMainThread && workerData === 'trials') {
  parentPort?.on('message', (task: TrialRunTask | { audit: TrialVariant }) => {
    if ('audit' in task) {
      const a = auditOf(task.audit);
      parentPort?.postMessage({ ok: a.ok, margin: a.margin, need: a.need });
    } else {
      parentPort?.postMessage(playTrial(task));
    }
  });
}

// ---------------------------------------------------------------------------------------------
// Gates

export interface Gates {
  readonly v: TrialVariant;
  readonly g1: { ok: boolean; margin: number; need: number } | null;
  readonly g2: { ok: boolean; out: TrialRunOut } | null;
  readonly g5: { ok: boolean; idle: TrialRunOut; best: TrialRunOut; bestTheta: number } | null;
  readonly g3: { ok: boolean; wins: number; outs: TrialRunOut[] } | null;
  readonly g4: { ok: boolean; passes: number; outs: TrialRunOut[] } | null;
  readonly g6: { ok: boolean; share: number } | null;
  /** The first gate that failed (0: none). */
  readonly failed: number;
}

/** A runner of trial tasks: the worker pool, or this thread (the unit tests). */
export type TrialRunner = (task: TrialRunTask) => Promise<TrialRunOut>;
export const runHere: TrialRunner = (task) => Promise.resolve(playTrial(task));

/** G2 for one run: the path bot passes. */
export function g2Ok(_t: TrialDef, o: TrialRunOut): boolean {
  return o.passed;
}

/** G5: idle and every constant angle (every 10°) fail. */
export async function gateG5(run: TrialRunner, v: TrialVariant): Promise<Gates['g5'] & object> {
  const outs = await Promise.all([run({ v, p: { bot: 'idle', salt: 0 } }), ...Array.from({ length: 36 }, (_, i) => run({ v, p: { bot: 'const', theta: 10 * i } }))]);
  const idle = outs[0] as TrialRunOut;
  let best = 1;
  for (let i = 2; i <= 36; i++) if ((outs[i] as TrialRunOut).progress > (outs[best] as TrialRunOut).progress) best = i;
  return { ok: outs.every((o) => !o.passed), idle, best: outs[best] as TrialRunOut, bestTheta: 10 * (best - 1) };
}

/**
 * Every gate of a trial variant, in order: G1 (the audit, in this thread), G2, G5, G3 with G4, G6.
 * `failed` is the first failing gate. With `stop` the first failure ends the evaluation (the seed
 * search).
 */
export async function gates(run: TrialRunner, v: TrialVariant, humanSalts = HUMAN_SALTS, stop = false): Promise<Gates> {
  const t = variantDef(v);
  let failed = 0;
  const fail = (n: number, ok: boolean): boolean => {
    if (!ok && failed === 0) failed = n;
    return stop && failed !== 0;
  };
  const a = auditOf(v);
  const g1 = { ok: a.ok, margin: a.margin, need: a.need };
  const done = (g: Omit<Gates, 'v' | 'failed'>): Gates => ({ v, ...g, failed });
  if (fail(1, g1.ok)) return done({ g1, g2: null, g5: null, g3: null, g4: null, g6: null });
  const o2 = await run({ v, p: { bot: 'path' } });
  const g2 = { ok: g2Ok(t, o2), out: o2 };
  if (fail(2, g2.ok)) return done({ g1, g2, g5: null, g3: null, g4: null, g6: null });
  const g5 = await gateG5(run, v);
  if (g5 && fail(5, g5.ok)) return done({ g1, g2, g5, g3: null, g4: null, g6: null });
  const [r3, r4] = await Promise.all([
    Promise.all(Array.from({ length: REACTIVE_SALTS }, (_, salt) => run({ v, p: { bot: 'reactive', salt } }))),
    Promise.all(Array.from({ length: humanSalts }, (_, salt) => run({ v, p: { bot: 'humanDial', salt } }))),
  ]);
  const wins = r3.filter((o) => o.passed).length;
  const passes = r4.filter((o) => o.passed).length;
  const band = t.n <= 4 ? HUMAN_BAND_SOLO : HUMAN_BAND_MIX;
  const share = passes / humanSalts;
  const g3 = { ok: wins >= REACTIVE_WINS, wins, outs: r3 };
  const g4 = { ok: share >= band[0] && share <= band[1], passes, outs: r4 };
  if (fail(3, g3.ok) || fail(4, g4.ok)) return done({ g1, g2, g5, g3, g4, g6: null });
  const all = [...r3, ...r4];
  const dareShare = all.filter((o) => o.dareMet).length / all.length;
  const g6 = { ok: dareShare >= DARE_BAND[0] && dareShare <= DARE_BAND[1], share: dareShare };
  fail(6, g6.ok);
  return done({ g1, g2, g5, g3, g4, g6 });
}

const pct = (x: number): string => `${Math.round(100 * x)}%`;
const fx = (x: number): string => (Number.isNaN(x) ? '—' : x.toFixed(0));

/** One report row of a variant's gates. */
function row(g: Gates): string {
  const t = variantDef(g.v);
  const mark = (_n: number, ok: boolean | undefined): string => (ok === undefined ? ' ' : ok ? '✓' : '✗');
  const parts = [
    `T${t.n} ${t.name.padEnd(15)} seed ${String(t.seed).padStart(10)} salt ${String(t.salt).padStart(3)} D${t.drain} @${t.startMinute}`,
    `G1 ${mark(1, g.g1?.ok)} margin ${g.g1 ? fx(g.g1.margin) : '—'}/${g.g1?.need ?? '—'}`,
    `G2 ${mark(2, g.g2?.ok)} ${g.g2 ? `${g.g2.out.passed ? 'pass' : 'fail'} h${fx(g.g2.out.health)}` : '—'}`,
    `G5 ${mark(5, g.g5?.ok)} ${g.g5 ? `idle ${g.g5.idle.passed ? 'PASS' : pct(g.g5.idle.progress)} best θ${g.g5.bestTheta} ${g.g5.best.passed ? 'PASS' : pct(g.g5.best.progress)}` : '—'}`,
    `G3 ${mark(3, g.g3?.ok)} ${g.g3 ? `${g.g3.wins}/${REACTIVE_SALTS} h${fx(Math.min(...g.g3.outs.map((o) => o.health)))}` : '—'}`,
    `G4 ${mark(4, g.g4?.ok)} ${g.g4 ? `${g.g4.passes}/${g.g4.outs.length} ${pct(g.g4.passes / g.g4.outs.length)}` : '—'}`,
    `G6 ${mark(6, g.g6?.ok)} ${g.g6 ? `dare ${pct(g.g6.share)} (${t.dare.kind} ${t.dare.target})` : '—'}`,
  ];
  return parts.join(' | ');
}

// ---------------------------------------------------------------------------------------------
// The mode

function argOf(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? (process.argv[i + 1] as string) : null;
}

/** The Dare target moved 25% of the way that brings its share into the band, rounded to whole counts. */
function nudgeDare(t: TrialDef, share: number): number {
  const unit = 1;
  const up = share > DARE_BAND[1];
  const next = t.dare.target * (up ? 1.25 : 0.75);
  const r = Math.max(unit, Math.round(next / unit) * unit);
  return r === t.dare.target ? t.dare.target + (up ? unit : -unit) : r;
}

/** --pick: the first salt k = 0..199 passing every gate. */
async function pick(run: TrialRunner, id: number, humanSalts: number, from: number, drain0?: number, start0?: number): Promise<void> {
  const base = trialDef(id) as TrialDef;
  const drain = drain0 ?? base.drain;
  const startMinute = start0 ?? base.startMinute;
  console.log(`\n--pick T${base.n}: drain ${drain}, start ${startMinute}`);
  let easy = 0;
  let hard = 0;
  let found: Gates | null = null;
  for (let k = from; k < PICK_SALTS; k++) {
    const v: TrialVariant = { id, salt: k, drain, startMinute };
    const g = await gates(run, v, humanSalts, true);
    if (g.failed === 0 || g.failed === 6) {
      found = g;
      console.log(`  k ${k}: ${row(g)}`);
      break;
    }
    if (g.failed === 5) easy++;
    else hard++;
    console.log(`  k ${k}: G${g.failed} ✗  ${row(g).split(' | ').slice(1).join(' | ')}`);
  }
  if (found) {
    let g = found;
    let target = variantDef(g.v).dare.target;
    for (let i = 0; i < 12 && g.g6 && !g.g6.ok; i++) {
      target = nudgeDare(variantDef(g.v), g.g6.share);
      g = await gates(run, { ...g.v, dareTarget: target }, humanSalts);
      console.log(`  Dare ${variantDef(g.v).dare.kind} → ${target}: ${row(g)}`);
    }
    const t = variantDef(g.v);
    console.log(`\nPIN T${t.n}: salt ${t.salt} (seed ${t.seed}), drain ${t.drain}, start ${t.startMinute}, dare ${t.dare.kind} ${t.dare.target}${g.failed ? `  (still failing G${g.failed})` : ''}`);
    console.log(`  ${row(g)}`);
    return;
  }
  console.log(`\nno salt passes T${base.n} (G5 failed on ${easy}, G1-G4 on ${hard})`);
}

async function trialsMain(ctx: Sim16Ctx): Promise<void> {
  const t0 = performance.now();
  const humanSalts = Number(argOf('salts') ?? HUMAN_SALTS);
  const pool = new TaskPool<TrialRunTask, TrialRunOut>(new URL(import.meta.url), 'trials', ctx.workers);
  const run: TrialRunner = (task) => pool.run(task);
  try {
    const survey = argOf('survey');
    if (survey !== null) {
      // Tooling: every gate on salts 0..N − 1 (no short cut), one row each, to see what calibration can reach.
      const ids = (argOf('id') ?? TRIAL_IDS.join(',')).split(',').map((x) => (Number(x) < 1000 ? 1000 + Number(x) : Number(x)));
      for (const id of ids) {
        const t = trialDef(id) as TrialDef;
        const drain = Number(argOf('drain') ?? t.drain);
        const startMinute = Number(argOf('start') ?? t.startMinute);
        const rows = await Promise.all(Array.from({ length: Number(survey) }, (_, k) => gates(run, { id, salt: k, drain, startMinute }, humanSalts)));
        for (const g of rows) console.log(`${g.failed ? `G${g.failed}` : 'OK'} ${row(g)}`);
      }
      return;
    }
    const pickId = argOf('pick');
    if (pickId !== null) {
      const id = Number(pickId) < 1000 ? 1000 + Number(pickId) : Number(pickId);
      const num = (name: string): number | undefined => (argOf(name) === null ? undefined : Number(argOf(name)));
      await pick(run, id, humanSalts, num('from') ?? 0, num('drain'), num('start'));
      return;
    }
    const ids = (argOf('id') ?? TRIAL_IDS.join(',')).split(',').map((x) => (Number(x) < 1000 ? 1000 + Number(x) : Number(x)));
    console.log(`Elementals Trials: G1 audit, G2 path bot, G5 idle and 36 constant angles, G3 reactive ${REACTIVE_WINS}/${REACTIVE_SALTS}, G4 humanDial on ${humanSalts} salts, G6 Dare share\n`);
    const all = await Promise.all(ids.map((id) => gates(run, { id, salt: (trialDef(id) as TrialDef).salt }, humanSalts)));
    let bad = 0;
    for (const g of all) {
      console.log(row(g));
      if (g.failed) {
        bad++;
        if (ctx.check) ctx.fail(`T${variantDef(g.v).n} G${g.failed}`);
      }
    }
    console.log(`\n${bad === 0 ? 'All trials pass every gate' : `${bad} trial(s) fail a gate`}. (${((performance.now() - t0) / 1000).toFixed(1)} s, ${pool.played} runs)`);
  } finally {
    await pool.close();
  }
}

/** The `--trials` mode (scripts/sim16/registry.ts). */
export const TRIALS_MODULE: Sim16Module = {
  name: 'trials',
  modes: { trials: trialsMain },
};

