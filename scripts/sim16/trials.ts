// Elementals `node scripts/sim.ts --trials` (docs/ELEMENTALS.md §3.9-§3.10; CORE): proves each
// Trial winnable on its pinned seed, and finds that seed.
//
//   node scripts/sim.ts --trials [--id 1001,…] [--check] [--pick <id>] [--salts 16] [--workers W]
//
// One row per trial: seed and salt, the audit's margin (G1), the path bot's (or Volt's striker's)
// verdict and lowest health (G2), the reactive bot's wins on 8 salts (G3), humanDial's pass rate on
// --salts salts (G4), the anti-trivial gate (G5: idle and the best of 36 constant angles fail) and
// the Dare's share of the G3 and G4 runs (G6). --check exits 1 when any gate fails. --pick <id>
// searches k = 0..199 for the first salt that passes every gate (§3.9 "Seed search"), with the
// fallbacks of §3.10 (start +30 minutes when G5 fails everywhere, drain −2 when G1-G4 fail
// everywhere, the Dare target 25% toward the band when G6 fails on the pick); it prints what to pin
// in src/config/trials.ts and changes nothing.
//
// The audit (G1) is a read-only, turn-limited survival DP cloned from bake.ts glareFreeLine: 360
// bins on the validator's 6-tick grid from θ0 to the finish line, TUNING.validator.turnBins per step
// (slidingMaxCircular), rows from gatherScene + litMask at each body's centre (Drip: its centre
// sample's shadeMask + glareMask), the step delta heroRates(hero, D, R)[c] · 0.1 with min-of-three
// pessimism (the least of the previous, current and next step's deltas). Table heroes and relays
// carry the alive bins across a TAG at the incoming hero's start meter (health ≥ 20); a duo runs one
// conservative meter on min(dLead, dMate) (health ≥ 15); Drip runs T in 1-unit buckets (a step is
// allowed while T + Δmin − 1 > 10 and T + Δmax + 1 < 90, landing in round(T + Δcur)); Volt's rule
// depends on history, so a Volt leg is left to the bots. Abilities, the green thumb, Harmony, the
// TAG grace and flakes are left out, so the audit is conservative. The margin printed is the highest
// health threshold (Drip: the band h/2 < T < 100 − h/2) a path keeps.

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
import { BINS, binOf, createMaskScene, glareMask, litMask, shadeMask } from '../../src/core/intervals.ts';
import { campaignConfig, levelOutcome, levelProgress, minuteStart, resolveLevelConfig } from '../../src/core/level.ts';
import { createBot } from '../../src/core/sim/bots.ts';
import { createRun, type RunBuild } from '../../src/core/sim/create.ts';
import { updateGuide } from '../../src/core/sim/guide.ts';
import { heroRates, heroStart, tagTick } from '../../src/core/sim/heroes.ts';
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
const DUO_DX = TUNING.heroes.duoDx;
const MARGIN = TUNING.nubs.sampleOffset + 1;
const DR = TUNING.heroes.drip;
/** Health the audit's best path keeps (G1): table heroes, relays and Drip; a duo's conservative meter. */
export const AUDIT_HEALTH = 20;
export const AUDIT_DUO_HEALTH = 15;
/** The reactive bot's salts (G3) and the wins it needs; humanDial's default salts (G4). */
export const REACTIVE_SALTS = 8;
export const REACTIVE_WINS = 7;
export const HUMAN_SALTS = 16;
/** G4 humanDial pass-rate bands (T1-T4 solo, T5-T8 relays and duos) and the G6 Dare band. */
const HUMAN_BAND_SOLO: readonly [number, number] = [0.55, 0.9];
const HUMAN_BAND_MIX: readonly [number, number] = [0.45, 0.9];
const DARE_BAND: readonly [number, number] = [0.1, 0.6];
/** G2: the striker's lowest health on a Volt trial. */
const STRIKER_HEALTH = 20;
/** --pick: salts tried, start steps (+30 minutes, at most 3), the drain floor. */
const PICK_SALTS = 200;
const START_STEPS = 3;
const DRAIN_FLOOR = 16;

// ---------------------------------------------------------------------------------------------
// Trial variants (calibration, §3.10) and their runs

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
    if (s.mate !== null) computeCoverage(s, s.mate);
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

/** The audit of a trial: its margin (the highest health threshold a path keeps; NaN with nothing to audit) and that path. */
export interface Audit {
  readonly ok: boolean;
  readonly margin: number;
  /** The threshold the gate asks for (AUDIT_HEALTH, a duo AUDIT_DUO_HEALTH). */
  readonly need: number;
  /** Step j0 − 1 (θ0) is path[0]; the path runs to the last audited step (a Volt leg is not). */
  readonly j0: number;
  readonly path: Int16Array;
  /** Drip legs: the rows and the backward table the path bot steers by (null without Drip). */
  readonly drip: DripPolicy | null;
}

/**
 * The path bot's Drip leg (closed loop): ok[(r·nt + i)·360 + b] = 1 when (row r, bucket i, bin b)
 * still has a path within the gate's band to the end of its Drip leg. An open-loop bin path drifts
 * on a two-sided meter (the sun's moves between bins inside a step cost T the DP does not see), so
 * the bot re-reads its real T each step and takes a reachable bin that keeps such a path.
 */
export interface DripPolicy {
  readonly R: Rows;
  readonly ok: Uint8Array;
  readonly lo: number;
  readonly hi: number;
}

/** The backward table of the Drip legs at health threshold h (the band h/2 < T < 100 − h/2). */
function dripPolicy(R: Rows, h: number): DripPolicy {
  const n = R.n;
  const NT = R.nt;
  const lo = h / 2;
  const hi = 100 - h / 2;
  const ok = new Uint8Array(n * NT * BINS);
  const row = new Float64Array(BINS);
  const out = new Float64Array(BINS);
  for (let r = n - 2; r >= 0; r--) {
    if (R.hero[r] !== 'drip') continue;
    const legEnd = r + 1 >= n - 1 || R.hero[r + 1] !== 'drip';
    for (let i = 0; i < NT; i++) {
      const o = (r * NT + i) * BINS;
      if (legEnd) {
        // The leg's last row: every state in the band will do (a TAG resets the meter; the finish ends it).
        const T = DR.start + (i - R.dM) * R.dA;
        if (T > lo && T < hi) ok.fill(1, o, o + BINS);
        continue;
      }
      for (let b = 0; b < BINS; b++) {
        const L = dripLand(R, r + 1, b, i, lo, hi);
        row[b] = L >= 0 && ok[((r + 1) * NT + L) * BINS + b] === 1 ? 1 : 0;
      }
      slidingMaxCircular(row, TURN, out);
      for (let b = 0; b < BINS; b++) ok[o + b] = out[b] === 1 ? 1 : 0;
    }
  }
  return { R, ok, lo, hi };
}

/** The Drip leg's next bin from (row r, real T, bin b): a reachable bin that keeps a path, landing nearest T 50; else the side T needs. */
function dripNext(p: DripPolicy, r: number, T: number, b: number): number {
  const R = p.R;
  if (r + 1 >= R.n - 1) return b;
  const i = Math.max(0, Math.min(R.nt - 1, Math.round((T - DR.start) / R.dA) + R.dM));
  let best = -1;
  let bestV = Infinity;
  for (let k = -TURN; k <= TURN; k++) {
    const c = (b + k + BINS) % BINS;
    const L = dripLand(R, r + 1, c, i, p.lo, p.hi);
    const alive = L >= 0 && (R.hero[r + 1] !== 'drip' || r + 2 >= R.n - 1 || p.ok[((r + 1) * R.nt + L) * BINS + c] === 1);
    // Alive first, then landing nearest 50, then the least turn.
    const v = (alive ? 0 : 1e6) + (L >= 0 ? Math.abs(L - R.dM) * 100 : 1e5 + Math.abs((T > DR.start ? 0 : 1) - (R.w0[(r + 1) * BINS + c] === 1 ? 1 : 0)) * 100) + Math.abs(k);
    if (v < bestV) {
      bestV = v;
      best = c;
    }
  }
  return best;
}

/** The lead's hero at absolute tick `tick` (cast[0], then each relay from its TAG tick). */
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
  readonly lead: Uint8Array;
  readonly mate: Uint8Array | null;
  readonly w0: Uint8Array;
  readonly hero: HeroId[];
  /** θ0's bin (row 0). */
  readonly theta0: number;
  /** The meter change of the flakes and crystals the lead takes on each row, for a hero they hurt (Ember's hiss, Drip's ice cubes; 0 otherwise). */
  readonly flake: Float64Array;
  /**
   * Drip's grid: buckets of one step's change dA = k·D·0.1 (so a step in shade, sun or glare moves
   * exactly −1, +1 or +glareMul buckets), nt of them, bucket dM at the start (T 50).
   */
  readonly dA: number;
  readonly dM: number;
  readonly nt: number;
}

const scene = createMaskScene();
const shade = new Uint8Array(BINS);
const glare = new Uint8Array(BINS);

/** The audit's rows: per step the lit sums at the lead's centre (and the mate's), and the lead's centre-sample weight. */
export function auditRows(t: TrialDef, w: World): Rows {
  const j0 = Math.ceil(w.startTick / STEP) + 1;
  let jEnd = j0;
  while (worldYAtTick(w, jEnd * STEP) < w.finishY) jEnd++;
  const n = jEnd - j0 + 3;
  const duo = t.duo !== null;
  const lead = new Uint8Array(n * BINS);
  const mate = duo ? new Uint8Array(n * BINS) : null;
  const w0 = new Uint8Array(n * BINS);
  const hero: HeroId[] = [];
  for (let r = 0; r < n; r++) {
    const tick = (j0 - 1 + r) * STEP;
    hero.push(heroAt(t, tick));
    const eps = worldElevation(w, tick);
    const o = r * BINS;
    if (eps <= 0) continue;
    const y = worldYAtTick(w, tick);
    const x = trailX(w.trail, y);
    const xl = duo ? x - DUO_DX : x;
    gatherScene(w, scene, x, y, duo ? MARGIN + DUO_DX : MARGIN, tick / TICK_HZ, eps, 1 / tanD(eps), false);
    litMask(scene, xl, y, false, lead.subarray(o, o + BINS), null);
    if (mate) litMask(scene, x + DUO_DX, y, false, mate.subarray(o, o + BINS), null);
    shadeMask(scene, xl, y, false, shade);
    glareMask(scene, xl, y, glare);
    for (let b = 0; b < BINS; b++) w0[o + b] = glare[b] === 1 ? 2 : shade[b] === 1 ? 0 : 1;
  }
  const dA = t.drain * DR.k * DT_STEP;
  const dM = Math.ceil(DR.start / dA);
  return { j0, n, jEnd, lead, mate, w0, hero, theta0: binOf(w.theta0), flake: flakeRows(t, w, j0, n, hero), dA, dM, nt: 2 * dM + 1 };
}

const COLLECT2 = TUNING.nubs.collectRadius * TUNING.nubs.collectRadius;

/**
 * Per row, the meter change of the pickups the lead walks over on it, charged to a hero they hurt:
 * every flake (a crystal twice) the sim would collect if it never melted, at Ember's hiss or Drip's
 * ice cube; nothing for Nubs, Sprout or Volt (theirs help or do nothing, and the audit leaves out
 * what helps). Melting is ignored, so the audit stays conservative for the heroes flakes hurt.
 */
function flakeRows(t: TrialDef, w: World, j0: number, n: number, hero: HeroId[]): Float64Array {
  const out = new Float64Array(n);
  const dx = t.duo !== null ? -DUO_DX : 0;
  // From the first running tick (a pickup taken before row 1 is charged on row 1).
  const t0 = w.startTick;
  const t1 = (j0 - 1 + n) * STEP;
  for (const p of w.pickups) {
    if (p.kind === 'flower' || p.y < w.startY - 20 || p.y > w.finishY + 20) continue;
    for (let k = t0; k < t1; k++) {
      const y = worldYAtTick(w, k);
      if (y < p.y - 20) continue;
      if (y > p.y + 20) break;
      const ex = trailX(w.trail, y) + dx - p.x;
      if (ex * ex + (y - p.y) * (y - p.y) > COLLECT2) continue;
      const r = Math.max(1, Math.min(n - 2, Math.round(k / STEP) - (j0 - 1)));
      const h = hero[r] as HeroId;
      const per = h === 'ember' ? TUNING.heroes.ember.flake : h === 'drip' ? DR.flake : 0;
      out[r] = (out[r] as number) + per * (p.kind === 'crystal' ? 2 : 1);
      break;
    }
  }
  return out;
}

/** Drip's per-step change in buckets at centre weight `w` (0 shade, 1 lit, 2 glare). */
function dripSteps(w: number): number {
  return w === 0 ? -1 : w === 1 ? 1 : DR.glareMul;
}

const win = new Float64Array(BINS);
const src = new Float64Array(BINS);

/** One DP pass at health threshold `h`: per step the table meter per bin (DEAD when lost) or Drip's reachable (T, bin); null when every bin is lost. */
interface DpOut {
  readonly ok: boolean;
  /** Last audited row (the step before a Volt leg, or jEnd's). */
  readonly last: number;
  readonly tab: Float64Array;
  readonly drip: Uint8Array | null;
}

function dp(t: TrialDef, R: Rows, D: number, regen: number, maxC: number, h: number): DpOut {
  const n = R.n;
  const tab = new Float64Array(n * BINS).fill(DEAD);
  const anyDrip = R.hero.includes('drip');
  const NT = R.nt;
  const drip = anyDrip ? new Uint8Array(n * NT * BINS) : null;
  const lo = h / 2;
  const hi = 100 - h / 2;
  // Row 0 (step j0 − 1): θ0 at the first hero's start meter.
  const b0 = R.theta0;
  const first = R.hero[0] as HeroId;
  if (first === 'drip') (drip as Uint8Array)[R.dM * BINS + b0] = 1;
  else tab[b0] = heroStart(first, maxC);
  let last = 0;
  for (let r = 1; r < n - 1; r++) {
    const hero = R.hero[r] as HeroId;
    if (hero === 'volt') break;
    const prevHero = R.hero[r - 1] as HeroId;
    const tag = hero !== prevHero;
    const po = (r - 1) * BINS;
    const o = r * BINS;
    // The source row: the previous step's meter, or at a TAG its alive bins at the incoming start.
    if (prevHero === 'drip') {
      for (let b = 0; b < BINS; b++) {
        let alive = false;
        for (let T = 0; T < NT && !alive; T++) if ((drip as Uint8Array)[(r - 1) * NT * BINS + T * BINS + b] === 1) alive = true;
        src[b] = alive ? (tag ? heroStart(hero, maxC) : 0) : DEAD;
      }
    } else {
      for (let b = 0; b < BINS; b++) {
        const v = tab[po + b] as number;
        src[b] = v === DEAD ? DEAD : tag ? heroStart(hero, maxC) : v;
      }
    }
    let any = false;
    if (hero === 'drip') {
      const dr = drip as Uint8Array;
      const ro = r * NT * BINS;
      if (!tag && prevHero === 'drip') {
        // Drip to Drip: each bucket's bins spread by the turn limit.
        const po2 = (r - 1) * NT * BINS;
        for (let T = 0; T < NT; T++) {
          let has = false;
          for (let b = 0; b < BINS; b++) {
            const v = dr[po2 + T * BINS + b] as number;
            src[b] = v === 1 ? 1 : DEAD;
            if (v === 1) has = true;
          }
          if (!has) continue;
          slidingMaxCircular(src, TURN, win);
          for (let b = 0; b < BINS; b++) {
            if ((win[b] as number) !== 1) continue;
            const L = dripLand(R, r, b, T, lo, hi);
            if (L >= 0) {
              dr[ro + L * BINS + b] = 1;
              any = true;
            }
          }
        }
      } else {
        // A TAG into Drip: the alive bins at T = start.
        slidingMaxCircular(src, TURN, win);
        for (let b = 0; b < BINS; b++) {
          if ((win[b] as number) === DEAD) continue;
          const L = dripLand(R, r, b, R.dM, lo, hi);
          if (L >= 0) {
            dr[ro + L * BINS + b] = 1;
            any = true;
          }
        }
      }
    } else {
      slidingMaxCircular(src, TURN, win);
      const tl = heroRates(hero, D, regen) as Float64Array;
      const tm = R.mate ? (heroRates((t.duo as NonNullable<TrialDef['duo']>).right, D, regen) as Float64Array) : null;
      for (let b = 0; b < BINS; b++) {
        const wv = win[b] as number;
        if (wv === DEAD) continue;
        let d = Math.min(tl[R.lead[po + b] as number] as number, tl[R.lead[o + b] as number] as number, tl[R.lead[o + BINS + b] as number] as number);
        if (tm && R.mate) d = Math.min(d, tm[R.mate[po + b] as number] as number, tm[R.mate[o + b] as number] as number, tm[R.mate[o + BINS + b] as number] as number);
        let v = wv + d * DT_STEP;
        if (v > maxC) v = maxC;
        v += R.flake[r] as number;
        if (v < h) continue;
        tab[o + b] = v;
        any = true;
      }
    }
    if (!any) return { ok: false, last: r, tab, drip };
    last = r;
  }
  return { ok: true, last, tab, drip };
}

/**
 * Drip's landing bucket from bucket `i` at bin b on row r, or −1 when the step leaves the band:
 * T + Δmin − 1 > lo and T + Δmax + 1 < hi over the three steps' centre weights (an ice cube taken on
 * the row counts in Δmin), landing on the current step's change (the ice cube rounded down a bucket).
 */
export function dripLand(R: Rows, r: number, b: number, i: number, lo: number, hi: number): number {
  const a = dripSteps(R.w0[(r - 1) * BINS + b] as number);
  const c = dripSteps(R.w0[r * BINS + b] as number);
  const e = dripSteps(R.w0[(r + 1) * BINS + b] as number);
  const fl = Math.floor((R.flake[r] as number) / R.dA);
  const T = DR.start + (i - R.dM) * R.dA;
  if (!(T + (Math.min(a, c, e) + fl) * R.dA - 1 > lo && T + Math.max(a, c, e) * R.dA + 1 < hi)) return -1;
  const L = i + c + fl;
  return L < 0 || L >= R.nt ? -1 : L;
}

/** G1: the audit of trial `t` on its world (NaN margin and ok when nothing is audited: a Volt trial). */
export function audit(t: TrialDef, w: World = auditWorld(t)): Audit {
  const R = auditRows(t, w);
  const need = t.duo !== null ? AUDIT_DUO_HEALTH : AUDIT_HEALTH;
  const p1 = paramsAt(w, 1);
  const D = t.drain;
  const audited = R.hero[0] !== 'volt';
  if (!audited) return { ok: true, margin: NaN, need, j0: R.j0, path: new Int16Array(0), drip: null };
  let lo = -1;
  let hi = 100;
  // The largest threshold (0..100) a path keeps: binary search (a stricter bar only removes paths).
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (dp(t, R, D, p1.regen, p1.maxChill, mid).ok) lo = mid;
    else hi = mid;
  }
  const margin = lo;
  if (margin < 0) return { ok: false, margin: -1, need, j0: R.j0, path: new Int16Array(0), drip: null };
  const best = dp(t, R, D, p1.regen, p1.maxChill, margin);
  // The Drip policy keeps the gate's band (the path bot needs a win, not the audit's best margin).
  const drip = R.hero.includes('drip') ? dripPolicy(R, Math.min(margin, need)) : null;
  return { ok: margin >= need, margin, need, j0: R.j0, path: backtrack(t, R, margin, best), drip };
}

/** The best path of a DP pass: bins per row 0..last, chosen backwards (a table row's best meter; Drip's T nearest 50). */
function backtrack(t: TrialDef, R: Rows, h: number, o: DpOut): Int16Array {
  const path = new Int16Array(o.last + 1);
  const lo = h / 2;
  const hi = 100 - h / 2;
  const dr = o.drip as Uint8Array;
  const isDrip = (r: number): boolean => R.hero[r] === 'drip';
  const NT = R.nt;
  const reach = (r: number, T: number, b: number): boolean => dr[r * NT * BINS + T * BINS + b] === 1;
  // The final state: the best meter, or Drip's reachable T nearest 50.
  const L = o.last;
  let b = -1;
  let T = -1;
  let best = Infinity;
  for (let bb = 0; bb < BINS; bb++) {
    if (isDrip(L)) {
      for (let tt = 0; tt < NT; tt++) {
        if (reach(L, tt, bb) && Math.abs(tt - R.dM) < best) {
          best = Math.abs(tt - R.dM);
          b = bb;
          T = tt;
        }
      }
    } else if ((o.tab[L * BINS + bb] as number) !== DEAD && -(o.tab[L * BINS + bb] as number) < best) {
      best = -(o.tab[L * BINS + bb] as number);
      b = bb;
    }
  }
  path[L] = b;
  for (let r = L; r >= 1; r--) {
    const tag = R.hero[r] !== R.hero[r - 1];
    let pb = -1;
    let pT = -1;
    let bestV = DEAD;
    for (let k = -TURN; k <= TURN && pT < 0; k++) {
      const c = (b + k + BINS) % BINS;
      if (isDrip(r - 1)) {
        // From Drip: a Drip step must land on T; across a TAG any reachable state will do.
        for (let tt = 0; tt < NT; tt++) {
          if (!reach(r - 1, tt, c)) continue;
          if (isDrip(r) && !tag && dripLand(R, r, b, tt, lo, hi) !== T) continue;
          pb = c;
          pT = tt;
          break;
        }
        continue;
      }
      const v = o.tab[(r - 1) * BINS + c] as number;
      if (v === DEAD) continue;
      // From a table hero into Drip (a TAG): the start T must land on T.
      if (isDrip(r) && dripLand(R, r, b, R.dM, lo, hi) !== T) continue;
      if (v > bestV) {
        bestV = v;
        pb = c;
      }
    }
    if (pb < 0) throw new Error(`audit backtrack lost the path at row ${r} (trial ${t.id})`);
    b = pb;
    T = pT;
    path[r - 1] = b;
  }
  return path;
}

// ---------------------------------------------------------------------------------------------
// Scripted players: the path bot (G2), Volt's striker (G2), idle and constant angles (G5)

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

/** Striker's turn rates (°/s): seeking new shade, and turning on through a shadow once struck. */
const SEEK_RATE = 240;
const THROUGH_RATE = 90;
/** Striker: THUNDERCLAP below this Spark with no live bin within THUNDER_NEAR°. */
const THUNDER_SPARK = 25;
const THUNDER_NEAR = 60;

/**
 * Volt's striker (§3.9 G2): aims at the nearest live bin (guide.now: fresh shade outside the dead
 * zone); once shaded it keeps turning the same way through the shadow and out of its far end, then
 * comes back in (the nearest live bin again). THUNDERCLAP when Spark < 25 with no live bin within 60°.
 */
function striker(): Player {
  const f = frame();
  let first = true;
  let dir = 1;
  return (s) => {
    const g = s.guide;
    const theta = s.sun.theta;
    const b0 = binOf(theta);
    let near = -1;
    for (let k = 0; k <= 180 && near < 0; k++) {
      if (g.now[(b0 + k) % BINS] === 1) {
        near = k;
        if (k > 0) dir = 1;
      } else if (g.now[(b0 - k + BINS) % BINS] === 1) {
        near = k;
        dir = -1;
      }
    }
    const out = s.voltLit && near >= 0 ? steer(f, s, wrapDeg(theta + dir * near), SEEK_RATE, first) : steer(f, s, wrapDeg(theta + dir * 30), s.voltLit ? SEEK_RATE : THROUGH_RATE, first);
    first = false;
    out.snap = s.nubs.hero === 'volt' && s.nubs.chill < THUNDER_SPARK && (near < 0 || near > THUNDER_NEAR);
    return out;
  };
}

/**
 * The path bot (§3.9 G2): follows the audit's best θ path and casts nothing; a Drip leg steers by the
 * audit's backward table from its real T (closed loop, DripPolicy); a Volt leg is the striker's.
 */
function pathBot(a: Audit): Player {
  const f = frame();
  const strike = striker();
  let first = true;
  let dripRow = -1;
  let dripBin = 0;
  return (s) => {
    if (s.nubs.hero === 'volt' || a.path.length === 0) return strike(s);
    const r = Math.min(a.path.length - 1, Math.max(0, Math.round((s.tickAbs + 1) / STEP) - (a.j0 - 1)));
    let target = a.path[r] as number;
    if (s.nubs.hero === 'drip' && a.drip !== null) {
      // One decision per step, from the state at its start.
      if (r !== dripRow) {
        dripRow = r;
        dripBin = dripNext(a.drip, Math.max(0, r - 1), s.nubs.chill, binOf(s.sun.theta));
      }
      target = dripBin;
    }
    const out = steer(f, s, target, 600, first);
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
  /** The lowest health of any body (stats.minChill) and where the run ended (0..1). */
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

/** G2 for one run: the path bot (or the striker) passes; on the Volt trial with lowest health ≥ 20. */
export function g2Ok(t: TrialDef, o: TrialRunOut): boolean {
  return o.passed && (t.cast[0] !== 'volt' || o.health >= STRIKER_HEALTH);
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
 * Gates a pinned trial ships without, by trial id: §3.10's levers cannot reach them on any salt (the
 * measured numbers are in src/config/trials.ts beside the trial). --check prints them WAIVED with
 * their value; every other gate must pass.
 */
export const GATE_WAIVERS: Readonly<Record<number, readonly number[]>> = Object.freeze({
  // T3: humanDial passes Volt 16/16 at every drain tried (26-52): it strikes fresh shade as it goes.
  1003: [4],
  // T5: the Dare is "2 clean TAGs" and the trial has two TAGs: met on 63-100% of runs, and no target
  // above 2 is reachable.
  1005: [6],
});

/** True when gate `n` (1..6) of trial `id` is waived. */
export function waived(id: number, n: number): boolean {
  return (GATE_WAIVERS[id] ?? []).includes(n);
}

/**
 * Every gate of a trial variant, in order: G1 (the audit, in this thread), G2, G5, G3 with G4, G6.
 * `failed` is the first failing gate that is not waived. With `stop` the first failure ends the
 * evaluation and a waived G5 is not played (the seed search).
 */
export async function gates(run: TrialRunner, v: TrialVariant, humanSalts = HUMAN_SALTS, stop = false): Promise<Gates> {
  const t = variantDef(v);
  let failed = 0;
  const fail = (n: number, ok: boolean): boolean => {
    if (!ok && failed === 0 && !waived(t.id, n)) failed = n;
    return stop && failed !== 0;
  };
  const a = auditOf(v);
  const g1 = { ok: a.ok, margin: a.margin, need: a.need };
  const done = (g: Omit<Gates, 'v' | 'failed'>): Gates => ({ v, ...g, failed });
  if (fail(1, g1.ok)) return done({ g1, g2: null, g5: null, g3: null, g4: null, g6: null });
  const o2 = await run({ v, p: { bot: 'path' } });
  const g2 = { ok: g2Ok(t, o2), out: o2 };
  if (fail(2, g2.ok)) return done({ g1, g2, g5: null, g3: null, g4: null, g6: null });
  const g5 = stop && waived(t.id, 5) ? null : await gateG5(run, v);
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
  const mark = (n: number, ok: boolean | undefined): string => (ok === undefined ? ' ' : ok ? '✓' : waived(t.id, n) ? 'WAIVED' : '✗');
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

/** The Dare target moved 25% of the way that brings its share into the band, rounded to whole seconds (tick Dares) or counts. */
function nudgeDare(t: TrialDef, share: number): number {
  const ticks = t.dare.kind === 'blazeSave' || t.dare.kind === 'calm' || t.dare.kind === 'harmony';
  const unit = ticks ? TICK_HZ : 1;
  const up = share > DARE_BAND[1];
  const next = t.dare.target * (up ? 1.25 : 0.75);
  const r = Math.max(unit, Math.round(next / unit) * unit);
  return r === t.dare.target ? t.dare.target + (up ? unit : -unit) : r;
}

/** --pick: the first salt k = 0..199 passing every gate, with the §3.10 fallbacks. */
async function pick(run: TrialRunner, id: number, humanSalts: number, from: number, drain0?: number, start0?: number): Promise<void> {
  const base = trialDef(id) as TrialDef;
  let drain = drain0 ?? base.drain;
  let startMinute = start0 ?? base.startMinute;
  let starts = 0;
  for (;;) {
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
    if (easy === PICK_SALTS && starts < START_STEPS) {
      starts++;
      startMinute += 30;
      console.log(`  G5 failed on every salt (too easy): start +30 minutes`);
      continue;
    }
    if (hard > 0 && drain - 2 >= DRAIN_FLOOR && easy === 0) {
      drain -= 2;
      console.log(`  G1-G4 failed on every salt (too hard): drain −2`);
      continue;
    }
    console.log(`\nno salt passes T${base.n} (G5 failed on ${easy}, G1-G4 on ${hard}); nothing left to move`);
    return;
  }
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
    console.log(`Elementals Trials (docs/ELEMENTALS.md §3.9): G1 audit, G2 path bot / striker, G5 idle and 36 constant angles, G3 reactive ${REACTIVE_WINS}/${REACTIVE_SALTS}, G4 humanDial on ${humanSalts} salts, G6 Dare share\n`);
    const all = await Promise.all(ids.map((id) => gates(run, { id, salt: (trialDef(id) as TrialDef).salt }, humanSalts)));
    let bad = 0;
    for (const g of all) {
      console.log(row(g));
      if (g.failed) {
        bad++;
        if (ctx.check) ctx.fail(`T${variantDef(g.v).n} G${g.failed}`);
      }
    }
    const w = Object.entries(GATE_WAIVERS).map(([id, gs]) => `T${Number(id) - 1000} G${gs.join(',G')}`).join(', ');
    console.log(`\n${bad === 0 ? 'All trials pass every gate' : `${bad} trial(s) fail a gate`}${w ? ` (waived: ${w})` : ''}. (${((performance.now() - t0) / 1000).toFixed(1)} s, ${pool.played} runs)`);
  } finally {
    await pool.close();
  }
}

/** The `--trials` mode (scripts/sim16/registry.ts). */
export const TRIALS_MODULE: Sim16Module = {
  name: 'trials',
  modes: { trials: trialsMain },
};

