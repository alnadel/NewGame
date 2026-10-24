// Elementals v2 `node scripts/sim.ts --trials` (CORE; docs/ELEMENTALS_V2.md §6): proves each Trial
// winnable on its pinned seed, and finds that seed.
//
//   node scripts/sim.ts --trials [--id 1001,…] [--check] [--pick <id>] [--salts 16] [--perf] [--workers W]
//
// One block per trial: seed and salt, G0 (placement and authoring), each leg's audit margin (G1, with
// the Drip mask's chosen, worst and best marked bin), the path bot's verdict and lowest steady health
// (G2, also from the worst marked bin), the reactive bot's wins on 8 salts (G3), humanEl's pass rate on
// --salts salts (G4), the anti-trivial runs (G5: idle, each element leg with its verb off, T1's
// tap-on-sight Ember, the spam Gusts; G5b: the plan's verbs at every constant angle, 1° apart), the
// Dare's share of the G3 and G4 runs (G6) and the mixers' interaction runs (G7). --check exits 1 on
// any failed gate. --pick <id> tries salts 0..199 in order and prints the first that passes every gate
// (moving the Dare target 25% toward the band when only G6 fails); it changes nothing. --variant
// '<json>' plays a calibration variant (drain, legStart, costMul, evapMul, moves, add, dareTarget; a
// re-timed trial's startMinute, lengthMinutes, relays and objects, the authoring string). --perf
// adds the µs per tick and per guide refresh against a Nubs run of the same length. The audits, plans
// and players live in elaudit.ts; the bots in src/core/sim/bots (build:single drops all of it).

import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import type { LevelDef } from '../../src/config/campaign.ts';
import type { HeroId } from '../../src/config/heroes.ts';
import { TRIAL_IDS, trialDareValue, trialDef, type TrialDef } from '../../src/config/trials.ts';
import { TUNING } from '../../src/config/tuning.ts';
import { TICK_HZ, tickAtMinute } from '../../src/core/clock.ts';
import { distPointConvex, pointInConvex, segmentsIntersect } from '../../src/core/geom.ts';
import { worldYAtTick } from '../../src/core/gen/plan.ts';
import { campaignConfig, levelOutcome, levelProgress } from '../../src/core/level.ts';
import { EL_GONE, RUNTIME_ID_BASE, type Caster, type ElObj, type ElState } from '../../src/core/objects.ts';
import { createBot } from '../../src/core/sim/bots.ts';
import type { ElPolicyOpts } from '../../src/core/sim/bots/elements.ts';
import { createRun } from '../../src/core/sim/create.ts';
import { laneOf, tagTick } from '../../src/core/sim/elements.ts';
import { updateGuide } from '../../src/core/sim/guide.ts';
import { step } from '../../src/core/sim/step.ts';
import type { InputFrame, SimState } from '../../src/core/sim/types.ts';
import { trailX } from '../../src/core/trail.ts';
import { OBLIQUE } from '../../src/game/camera.ts';
import { TaskPool } from './dares.ts';
import { audit, AUDIT_HEALTH, downwindPlot, legAt, legHero, planPlayer, tickAtY, trialRun, variantDef, type ElMove, type Plan, type ThetaMode, type TrialVariant } from './elaudit.ts';
import type { Sim16Ctx, Sim16Module } from './registry.ts';

export { trialRun, variantDef, type TrialVariant } from './elaudit.ts';

const E = TUNING.elements;
/** The reactive bot's salts (G3) and the wins it needs; humanEl's default salts (G4). */
export const REACTIVE_SALTS = 8;
export const REACTIVE_WINS = 7;
export const HUMAN_SALTS = 16;
/** G4 humanEl pass-rate bands (T1-T4 intros, T5-T7 mixers) and the G6 Dare band. */
const HUMAN_BAND_SOLO: readonly [number, number] = [0.75, 0.95];
const HUMAN_BAND_MIX: readonly [number, number] = [0.45, 0.9];
const DARE_BAND: readonly [number, number] = [0.1, 0.6];
/** G5(c): the tap-on-sight Ember keeps a margin (its lowest Flame) at least this much lower than the path bot's. */
const ON_SIGHT_GAP = 15;
/** G7: a mixer without its interaction keeps a Sprout Sap margin at least this much lower. */
const SAP_GAP = 10;
/**
 * Waivers (§6.5): a G3, G4, G6 or G7 failure a Trial may keep. Every entry below is accepted by the
 * lead (docs/ELEMENTALS_V2.md §13.3, "Lead decisions"), with its reason in one line; G0, G1, G2 and
 * G5/G5b take none. A waived gate still prints its row (marked "waived") and no longer fails --check.
 */
export const WAIVERS: Readonly<Record<string, string>> = {
  // The intros' Dares are "do everything the leg offers", and most finishers do.
  'T1 G6': 'the Dare is every wall the leg offers and most finishers burn them all (96% meet burns ≥ 7)',
  'T2 G6': 'the Dare is every puddle the leg offers and most finishers drink them all (88% meet drinks ≥ 7)',
  'T4 G6': 'the Dare is the ride the leg offers and most finishers take it (83% meet cloudRide ≥ 60, 83% ≥ 75)',
  // T5 is the gentle first mixer.
  'T5 G4': 'the gentle first mixer: humanEl passes 16/16 (100%) with every lever at its bound',
  'T5 G6': 'the gentle first mixer: most finishers drink five puddles (92% meet drinks ≥ 5)',
};
const WAIVABLE: readonly number[] = [3, 4, 6, 7];

/** G5(d): the four spam Gusts. */
const SPAMS: readonly { dir: -1 | 1; every: number }[] = [
  { dir: 1, every: 30 },
  { dir: -1, every: 30 },
  { dir: 1, every: 90 },
  { dir: -1, every: 90 },
];
/** G5b: the constant angles tried, every CONST_STEP° (the 10° grid of the first round missed T7's 325-326° window). */
const CONST_STEP = 1;
/** G0: a canopy's lumps reach this far from its centre, in radii (render/casters.ts `lumps`: 0.42-0.54 r out, 0.48-0.62 r wide). */
const CANOPY_REACH = 1.16;
/** G0: the most of a plot's, puddle's or stone's disc that may be drawn under a generated caster. */
const HIDDEN_MAX = 1 / 2;
/** --pick: salts tried. */
const PICK_SALTS = 200;
const TICK_CAP = 12000;

// ---------------------------------------------------------------------------------------------
// Runs (in the worker pool)
// ---------------------------------------------------------------------------------------------

/** Who plays a run: a core bot with its salt, or the plan of the variant's audit under some change. */
export type TrialPlayer =
  | { readonly bot: 'reactive' | 'humanEl' | 'idle'; readonly salt: number; readonly el?: ElPolicyOpts }
  | {
      readonly bot: 'path';
      /** The plan made from the worst marked bin before each Drip leg (G2). */
      readonly worst?: boolean;
      readonly theta?: ThetaMode;
      readonly off?: readonly number[];
      readonly spam?: { readonly dir: -1 | 1; readonly every: number };
      readonly tapOnSight?: boolean;
    };

export interface TrialRunTask {
  readonly v: TrialVariant;
  readonly p: TrialPlayer;
}

export interface TrialRunOut {
  readonly won: boolean;
  readonly passed: boolean;
  /** The lowest steady health of the run (stats.minChill) and per leg (Sprout: its lowest Sap); where it ended (0..1) and in which leg. */
  readonly health: number;
  readonly legLow: readonly number[];
  /** The lowest raw meter per leg (Ember's Flame itself, spending not added back). */
  readonly meterLow: readonly number[];
  readonly progress: number;
  readonly leg: number;
  /** The Dare's count, and whether it is met at the finish (star 2). */
  readonly dare: number;
  readonly dareMet: boolean;
  readonly trees: number;
  readonly grove: number;
  /** The authored minutes of the plots whose tree stands at the end, and of every plot a tree stood on. */
  readonly standing: readonly number[];
  readonly stood: readonly number[];
  readonly line: string;
  /** No plan for this variant (its audit failed). */
  readonly noPlan?: boolean;
}

/** Per worker: the last audits, keyed by variant and worst flag. */
const audits = new Map<string, Plan>();

export function auditOf(v: TrialVariant, worst = false): Plan {
  const key = JSON.stringify([v, worst]);
  let a = audits.get(key);
  if (!a) {
    if (audits.size > 16) audits.clear();
    a = audit(v, worst);
    audits.set(key, a);
  }
  return a;
}

/** The authored minute of each placed object (createEl's y order, ties in list order). */
function minutesOf(s: SimState, t: TrialDef): number[] {
  const placed = t.objects.map((p, i) => ({ m: p.m, i, y: worldYAtTick(s.world, tickAtMinute(p.m)) }));
  placed.sort((a, b) => a.y - b.y || a.i - b.i);
  return placed.map((p) => p.m);
}

/** Plays one run of a trial variant to its finish line or a failure. */
export function playTrial(task: TrialRunTask): TrialRunOut {
  const t = variantDef(task.v);
  const s = trialRun(t);
  const p = task.p;
  let next: (s: SimState) => InputFrame;
  if (p.bot === 'path') {
    const plan = auditOf(task.v, p.worst === true);
    if (plan.theta === null) return { won: false, passed: false, health: 0, legLow: [], meterLow: [], progress: 0, leg: 0, dare: 0, dareMet: false, trees: 0, grove: 0, standing: [], stood: [], line: plan.why, noPlan: true };
    next = planPlayer(plan, { theta: p.theta ?? { k: 'plan' }, off: p.off, spam: p.spam, tapOnSight: p.tapOnSight });
  } else {
    const b = createBot(p.bot, p.salt, true, { el: p.el });
    next = (st) => b.next(st);
  }
  const low: number[] = [];
  const raw: number[] = [];
  const objs = (s.el as ElState).objs;
  const stoodAt = new Uint8Array(objs.length);
  while (s.phase !== 'dead' && s.phase !== 'won' && s.tick < TICK_CAP) {
    step(s, next(s));
    for (let i = 0; i < objs.length; i++) if ((objs[i] as ElObj).kind === 'plot' && (objs[i] as ElObj).casterId >= 0) stoodAt[i] = 1;
    if (s.ready > 0 || s.phase !== 'day') continue;
    const el = s.el as ElState;
    const h = s.nubs.hero === 'sprout' ? s.nubs.chill : Math.min(100, s.nubs.chill + el.spent);
    const L = s.relayIdx;
    if (low[L] === undefined || h < (low[L] as number)) low[L] = h;
    if (raw[L] === undefined || s.nubs.chill < (raw[L] as number)) raw[L] = s.nubs.chill;
  }
  const o = levelOutcome(s.level as LevelDef, s);
  const dare = trialDareValue(t.dare.kind, s.stats);
  const mins = minutesOf(s, t);
  const standing: number[] = [];
  (s.el as ElState).objs.forEach((ob, i) => {
    if (ob.kind === 'plot' && ob.state !== EL_GONE && ob.casterId >= 0) standing.push(mins[i] as number);
  });
  return {
    won: s.phase === 'won',
    passed: o.passed,
    health: s.stats.minChill,
    legLow: low.map((v) => Math.round(v * 10) / 10),
    meterLow: raw.map((v) => Math.round(v * 10) / 10),
    progress: levelProgress(s),
    leg: s.relayIdx,
    dare,
    dareMet: o.passed && dare >= t.dare.target,
    trees: s.stats.trees ?? 0,
    grove: s.stats.grove ?? 0,
    standing,
    stood: mins.filter((_, i) => stoodAt[i] === 1),
    line: s.death?.line ?? '',
  };
}

// ---------------------------------------------------------------------------------------------
// G0: placement and authoring (§5.0, §6.4)
// ---------------------------------------------------------------------------------------------

export interface G0Out {
  readonly ok: boolean;
  readonly fails: readonly string[];
}

const secs = (ticks: number): number => ticks / TICK_HZ;

export function gateG0(v: TrialVariant): G0Out {
  const t = variantDef(v);
  const s = trialRun(t);
  const w = s.world;
  const el = s.el as ElState;
  const fails: string[] = [];
  const start = s.tickAbs;
  const finish = tickAtY(s, w.finishY);
  const legs = t.relays.length + 1;
  const from = (L: number): number => (L === 0 ? start : tagTick(t, L - 1));
  const to = (L: number): number => (L < t.relays.length ? tagTick(t, L) : finish);
  const mins = minutesOf(s, t);
  // Every authored object placed, inside the run.
  if (el.objs.length !== t.objects.length) fails.push('objects missing');
  for (const o of el.objs) if (o.y <= s.nubs.y || o.y >= w.finishY) fails.push(`object at y ${o.y.toFixed(0)} outside the run`);
  // No plot, puddle or stone within `clearance` of a generated caster's prism part.
  for (let i = 0; i < el.objs.length; i++) {
    const o = el.objs[i] as ElObj;
    if (o.kind !== 'plot' && o.kind !== 'puddle' && o.kind !== 'stone') continue;
    for (const c of w.casters as readonly Caster[]) {
      if (c.id >= RUNTIME_ID_BASE || Math.abs(c.y - o.y) > 200) continue;
      for (const p of c.parts) {
        if (p.t !== 'prism') continue;
        const d = distPointConvex(o.x, o.y, p.pts, p.n) - o.r;
        if (d < E.objects.clearance) fails.push(`${o.kind} m${mins[i]} ${d.toFixed(1)} u from ${c.name}`);
      }
    }
  }
  // Every plot, puddle and stone shows: at least half of its disc is drawn clear of the generated casters.
  for (let i = 0; i < el.objs.length; i++) {
    const o = el.objs[i] as ElObj;
    if (o.kind !== 'plot' && o.kind !== 'puddle' && o.kind !== 'stone') continue;
    const h = hiddenShare(o.x, o.y, o.r, w.casters);
    if (h.share > HIDDEN_MAX + 1e-9) fails.push(`${o.kind} m${mins[i]} ${Math.round(100 * h.share)}% hidden under ${h.by}`);
  }
  // Leg lengths: opening ≥ 6.5 s, element legs ≥ 6.5 s, a closing Nubs leg ≥ 4 s.
  for (let L = 0; L < legs; L++) {
    const len = secs(to(L) - from(L));
    const min = L === legs - 1 && legHero(t, L) === 'nubs' ? 4 : 6.5;
    if (len < min - 1e-9) fails.push(`leg ${L} ${len.toFixed(2)} s < ${min}`);
  }
  // Crossings r 12-18.
  for (const o of el.objs) if ((o.kind === 'gap' || o.kind === 'stream') && (o.r < E.objects.crossMin || o.r > E.objects.crossMax)) fails.push(`crossing r ${o.r}`);
  const edge = (o: ElObj): number => {
    const k = o.kind;
    return k === 'bramble' || k === 'gate' || k === 'ice' ? o.y - E.objects.wallDepth / 2 : k === 'gap' || k === 'stream' ? o.y - o.r : k === 'rain' || k === 'fog' ? o.y : o.y - o.r - E.objects.touch;
  };
  const contact = (o: ElObj): number => tickAtY(s, edge(o));
  const inWindow = (o: ElObj): number => tickAtY(s, edge(o) - E.range);
  // The intro element's first object ≥ 2 s into its leg (where the walker reaches its y, as §5's tables count).
  if (t.intro !== null) {
    const L = t.relays.findIndex((r) => r.to === t.intro) + 1;
    const first = el.objs.map((o) => tickAtY(s, o.y)).filter((c) => c >= from(L) && c < to(L)).sort((a, b) => a - b)[0];
    if (first === undefined || secs(first - from(L)) < 2 - 1e-9) fails.push(`intro's first object ${first === undefined ? 'missing' : `${secs(first - from(L)).toFixed(2)} s`} into its leg`);
  }
  for (let L = 0; L < legs; L++) {
    const hero = legHero(t, L);
    // Sprout: the first crossing ≥ need/grow + 2.5 s after the TAG; every crossing ≥ need/grow + 0.3 s after first holdable + 1 s.
    if (hero === 'sprout') {
      let firstDone = false;
      for (const o of el.objs) {
        if (o.kind !== 'gap' && o.kind !== 'stream') continue;
        const c = contact(o);
        if (c < from(L) || c >= to(L)) continue;
        const grow = (2 * o.r) / E.sprout.grow;
        if (!firstDone && secs(c - from(L)) < grow + 2.5 - 1e-9) fails.push(`Sprout's first crossing ${secs(c - from(L)).toFixed(2)} s < ${(grow + 2.5).toFixed(2)}`);
        firstDone = true;
        const hold = Math.max(from(L), inWindow(o));
        if (secs(c - hold) - 1 < grow + 0.3 - 1e-9) fails.push(`crossing r${o.r} holdable ${secs(hold - from(L)).toFixed(2)} contact ${secs(c - from(L)).toFixed(2)}`);
      }
    }
    // Cross-leg targets: ≥ 1.5 s in the window during the targeting leg.
    if (hero === 'ember' || hero === 'sprout') {
      for (const o of el.objs) {
        const wall = o.kind === 'bramble' || o.kind === 'gate' || o.kind === 'ice';
        if (!(hero === 'ember' ? wall : o.kind === 'plot')) continue;
        const c = contact(o);
        if (c < to(L) || legAt(t, c) !== L + 1) continue;
        const inside = secs(to(L) - Math.max(from(L), inWindow(o)));
        if (inside < 1.5 - 1e-9) fails.push(`${o.kind} past the TAG in the window ${inside.toFixed(2)} s`);
      }
    }
    // Gust: its own weather ≥ 2 s between max(wake, TAG) and arrival; hand-off weather wakes ≥ 4 s before the leg ends.
    if (hero === 'gust') {
      for (const o of el.objs) {
        if (o.kind !== 'rain' && o.kind !== 'fog') continue;
        const arr = tickAtY(s, o.y);
        const wake = Math.max(start, tickAtY(s, o.y - E.weather.wake));
        if (arr >= from(L) && arr < to(L) && secs(arr - Math.max(wake, from(L))) < 2 - 1e-9) fails.push(`weather at Gust ${secs(arr - from(L)).toFixed(1)} s: ${secs(arr - Math.max(wake, from(L))).toFixed(2)} s to push`);
        if (arr >= to(L) && legAt(t, arr) === L + 1 && secs(to(L) - wake) < 4 - 1e-9) fails.push(`hand-off weather wakes ${secs(to(L) - wake).toFixed(2)} s before the TAG`);
      }
    }
  }
  // Left-alone weather arrives at dx + effectiveDrift · min(wake time, seconds from go) ±2 u; Drip's lane ≥ ±12 u.
  const lane = new Float64Array(2);
  const wx = new Float64Array(el.objs.length).fill(NaN);
  const idle = createBot('idle');
  let narrow = 0;
  while (s.phase !== 'dead' && s.phase !== 'won' && s.tick < TICK_CAP) {
    s.nubs.chill = s.nubs.maxChill;
    for (const o of el.objs) if (o.kind === 'gap' || o.kind === 'stream') o.hit = true;
    step(s, idle.next(s));
    for (let i = 0; i < el.objs.length; i++) {
      const o = el.objs[i] as ElObj;
      if ((o.kind === 'rain' || o.kind === 'fog') && Number.isNaN(wx[i] as number) && s.nubs.y >= o.y) wx[i] = o.x - trailX(w.trail, o.y);
    }
    if (s.nubs.hero === 'drip') {
      laneOf(s, lane);
      if ((lane[0] as number) > -12 || (lane[1] as number) < 12) narrow++;
    }
  }
  if (narrow > 0) fails.push(`Drip's lane under ±12 u on ${narrow} ticks`);
  const placed = t.objects.map((p, i) => ({ p, i, y: worldYAtTick(w, tickAtMinute(p.m)) })).sort((a, b) => a.y - b.y || a.i - b.i);
  for (let i = 0; i < el.objs.length; i++) {
    const o = el.objs[i] as ElObj;
    if (o.kind !== 'rain' && o.kind !== 'fog') continue;
    const p = (placed[i] as { p: TrialDef['objects'][number] }).p;
    const eff = (p.drift ?? 0) + (o.kind === 'rain' ? E.gust.rainGain : E.gust.fogGain) * t.breeze;
    const want = p.dx + eff * Math.min(E.weather.wake / 70, secs(tickAtMinute(p.m) - start));
    const got = wx[i] as number;
    if (!(Math.abs(got - want) <= 2)) fails.push(`${o.kind} m${p.m} arrives ${Number.isNaN(got) ? 'never' : got.toFixed(1)} not ${want.toFixed(1)}`);
  }
  return { ok: fails.length === 0, fails };
}

/**
 * The generated caster drawn over ground point (x, y), or null. The renderer draws a point at height z
 * OBLIQUE·z north of its footprint and every caster over the trial's ground objects: a canopy covers
 * its circle moved north by OBLIQUE·z (out to its lumps' reach), a roof slab its footprint swept from
 * OBLIQUE·z0 to OBLIQUE·z1, a solid block its footprint swept up to OBLIQUE·h.
 */
function casterOver(x: number, y: number, casters: readonly Caster[]): Caster | null {
  for (const c of casters) {
    if (c.id >= RUNTIME_ID_BASE || Math.abs(c.y - y) > 200) continue;
    for (const p of c.parts) {
      if (p.t === 'disc') {
        if (Math.hypot(x - p.cx, y - p.cy - OBLIQUE * p.z) < p.r * CANOPY_REACH) return c;
        continue;
      }
      // The vertical segment of ground points drawn at (x, y) meets the footprint.
      const y0 = y - OBLIQUE * (p.t === 'prism' ? p.h : p.z1);
      const y1 = y - (p.t === 'prism' ? 0 : OBLIQUE * p.z0);
      if (pointInConvex(x, y0, p.pts, p.n) || pointInConvex(x, y1, p.pts, p.n)) return c;
      let ax = p.pts[2 * p.n - 2] as number;
      let ay = p.pts[2 * p.n - 1] as number;
      for (let k = 0; k < p.n; k++) {
        const bx = p.pts[2 * k] as number;
        const by = p.pts[2 * k + 1] as number;
        if (segmentsIntersect(x, y0, x, y1, ax, ay, bx, by)) return c;
        ax = bx;
        ay = by;
      }
    }
  }
  return null;
}

/** The share of a ground disc (a 49-point grid at r/4) drawn under generated casters, and the last one found. */
export function hiddenShare(x: number, y: number, r: number, casters: readonly Caster[]): { share: number; by: string } {
  let n = 0;
  let hid = 0;
  let by = '';
  for (let a = -4; a <= 4; a++) {
    for (let b = -4; b <= 4; b++) {
      if (a * a + b * b > 16) continue;
      n++;
      const c = casterOver(x + (a * r) / 4, y + (b * r) / 4, casters);
      if (c !== null) {
        hid++;
        by = c.name;
      }
    }
  }
  return { share: hid / n, by };
}

/**
 * Calibration (§3.2, §6.5): the dx moves (±8 u, smallest first) that clear every authored plot,
 * puddle and stone of a variant off the generated prism parts and out from under the drawn casters
 * (G0), or null when one cannot be cleared.
 */
export function clearanceMoves(v: TrialVariant): ElMove[] | null {
  const t = variantDef(v);
  const unmoved = variantDef({ ...v, moves: [] });
  const s = trialRun(t);
  const w = s.world;
  const moves: ElMove[] = [...(v.moves ?? [])];
  const r0 = { plot: E.objects.plotR, puddle: E.objects.puddleR, stone: E.objects.stoneR } as Record<string, number>;
  const parts: { pts: Float64Array; n: number; y: number }[] = [];
  for (const c of w.casters as readonly Caster[]) {
    if (c.id >= RUNTIME_ID_BASE) continue;
    for (const p of c.parts) if (p.t === 'prism') parts.push({ pts: p.pts, n: p.n, y: c.y });
  }
  const clear = (x: number, y: number, r: number): boolean =>
    parts.every((p) => Math.abs(p.y - y) > 200 || distPointConvex(x, y, p.pts, p.n) - r >= E.objects.clearance) && hiddenShare(x, y, r, w.casters).share <= HIDDEN_MAX + 1e-9;
  for (let i = 0; i < t.objects.length; i++) {
    const o = t.objects[i] as TrialDef['objects'][number];
    const r = r0[o.k];
    if (r === undefined) continue;
    const y = worldYAtTick(w, tickAtMinute(o.m));
    const tx = trailX(w.trail, y);
    if (clear(tx + o.dx, y, r)) continue;
    const base = (unmoved.objects[i] ?? o) as TrialDef['objects'][number];
    let found = false;
    for (let d = 1; d <= 8 && !found; d++) {
      for (const sgn of [-1, 1]) {
        const dx = base.dx + sgn * d;
        if (Math.abs(dx - base.dx) > 8 || !clear(tx + dx, y, r)) continue;
        const k = moves.findIndex((m) => m.i === i);
        if (k >= 0) moves[k] = { ...moves[k], i, dx };
        else moves.push({ i, dx });
        found = true;
        break;
      }
    }
    if (!found) return null;
  }
  return moves;
}

// ---------------------------------------------------------------------------------------------
// The worker
// ---------------------------------------------------------------------------------------------

/** A worker task: a run, an audit summary, G0, or the --perf timing of a trial. */
type Task = TrialRunTask | { readonly audit: TrialVariant; readonly worst?: boolean } | { readonly g0: TrialVariant } | { readonly perf: number };

export interface AuditOut {
  readonly ok: boolean;
  readonly why: string;
  readonly legs: readonly { hero: HeroId; margin: number; note: string }[];
  readonly drip: Plan['drip'];
}

function auditSummary(v: TrialVariant, worst = false): AuditOut {
  const a = auditOf(v, worst);
  return { ok: a.ok, why: a.why, legs: a.legs.map((l) => ({ hero: l.hero, margin: Math.round(l.margin * 10) / 10, note: l.note })), drip: a.drip };
}

if (!isMainThread && workerData === 'trials') {
  parentPort?.on('message', (task: Task) => {
    if ('audit' in task) parentPort?.postMessage(auditSummary(task.audit, task.worst));
    else if ('g0' in task) parentPort?.postMessage(gateG0(task.g0));
    else if ('perf' in task) parentPort?.postMessage(perfOf(task.perf));
    else parentPort?.postMessage(playTrial(task));
  });
}

// ---------------------------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------------------------

/** A runner of worker tasks: the pool, or this thread (the unit tests). */
export interface TrialRunner {
  run(task: TrialRunTask): Promise<TrialRunOut>;
  audit(v: TrialVariant, worst?: boolean): Promise<AuditOut>;
  g0(v: TrialVariant): Promise<G0Out>;
}

export const runHere: TrialRunner = {
  run: (task) => Promise.resolve(playTrial(task)),
  audit: (v, worst) => Promise.resolve(auditSummary(v, worst)),
  g0: (v) => Promise.resolve(gateG0(v)),
};

export interface Gates {
  readonly v: TrialVariant;
  readonly g0: G0Out | null;
  readonly g1: AuditOut | null;
  readonly g2: { ok: boolean; out: TrialRunOut; worst: TrialRunOut | null } | null;
  readonly g5: { ok: boolean; idle: TrialRunOut; offs: TrialRunOut[]; sight: { path: number; sight: number } | null; spams: TrialRunOut[]; constBest: TrialRunOut | null; constTheta: number; why: string } | null;
  readonly g3: { ok: boolean; wins: number; outs: TrialRunOut[] } | null;
  readonly g4: { ok: boolean; passes: number; outs: TrialRunOut[] } | null;
  readonly g6: { ok: boolean; share: number } | null;
  readonly g7: { ok: boolean; what: string } | null;
  /** The first gate that failed (0: none; 0.5 is G0; 5 is G5 or G5b; 7 is G7). */
  readonly failed: number;
  /** Failed gates kept by WAIVERS ("G4: reason"). */
  readonly waived: readonly string[];
}

/** The legs of a trial walked by elements (not Nubs). */
export function elementLegs(t: TrialDef): number[] {
  const out: number[] = [];
  for (let L = 0; L <= t.relays.length; L++) if (legHero(t, L) !== 'nubs') out.push(L);
  return out;
}

/** G5 and G5b: idle; every element leg's verb off; T1's tap-on-sight Ember; the spam Gusts; the plan's verbs at the best constant angle. */
export async function gateG5(run: TrialRunner, v: TrialVariant, path: TrialRunOut, constants = true): Promise<NonNullable<Gates['g5']>> {
  const t = variantDef(v);
  const why: string[] = [];
  const idle = await run.run({ v, p: { bot: 'idle', salt: 0 } });
  if (idle.passed) why.push('idle passes');
  const offs = await Promise.all(elementLegs(t).map((L) => run.run({ v, p: { bot: 'path', off: [L] } })));
  offs.forEach((o, k) => o.passed && why.push(`leg ${elementLegs(t)[k]} with its verb off passes`));
  let sight: { path: number; sight: number } | null = null;
  if (t.id === 1001) {
    // Measured on Flame itself: steady health adds spending back (§1.2), so it cannot tell a
    // tap-on-sight Ember from a just-in-time one unless it runs dry (a recorded deviation).
    const L = elementLegs(t)[0] as number;
    const o = await run.run({ v, p: { bot: 'path', tapOnSight: true } });
    const pathLow = path.meterLow[L] ?? 0;
    const sightLow = o.won || o.leg > L ? (o.meterLow[L] ?? 0) : -1;
    sight = { path: pathLow, sight: sightLow };
    if (sightLow > pathLow - ON_SIGHT_GAP) why.push(`tap on sight keeps ${sightLow.toFixed(0)} vs ${pathLow.toFixed(0)}`);
  }
  const gustLegs = elementLegs(t).filter((L) => legHero(t, L) === 'gust');
  const spams = gustLegs.length > 0 ? await Promise.all(SPAMS.map((sp) => run.run({ v, p: { bot: 'path', spam: sp } }))) : [];
  spams.forEach((o, k) => {
    const sp = SPAMS[k] as { dir: number; every: number };
    if (o.won || !gustLegs.includes(o.leg)) why.push(`spam ${sp.dir > 0 ? 'east' : 'west'}/${sp.every} ${o.won ? 'passes' : `fails in leg ${o.leg}`}`);
  });
  // G5b (skipped when `constants` is false: the unit test's G5 alone): every constant angle, CONST_STEP° apart.
  const consts = constants ? await Promise.all(Array.from({ length: 360 / CONST_STEP }, (_, i) => run.run({ v, p: { bot: 'path', theta: { k: 'const', theta: CONST_STEP * i } } }))) : [];
  let best = 0;
  for (let i = 1; i < consts.length; i++) if ((consts[i] as TrialRunOut).progress > (consts[best] as TrialRunOut).progress) best = i;
  const passing = consts.flatMap((o, i) => (o.passed ? [CONST_STEP * i] : []));
  if (passing.length > 0) why.push(`constant θ${passing.slice(0, 8).join(',')}${passing.length > 8 ? '…' : ''} pass${passing.length === 1 ? 'es' : ''}`);
  return { ok: why.length === 0, idle, offs, sight, spams, constBest: (consts[best] as TrialRunOut | undefined) ?? null, constTheta: CONST_STEP * best, why: why.join('; ') };
}

/** The authored minutes of a variant's plots that a fire on a later wall reaches downwind (§3.4, G7 on T7). */
function downwindMinutes(v: TrialVariant): number[] {
  const t = variantDef(v);
  const s = trialRun(t);
  const el = s.el as ElState;
  const mins = minutesOf(s, t);
  return el.objs.flatMap((o, i) => (o.kind === 'plot' && downwindPlot(s, el, o) ? [mins[i] as number] : []));
}

/** G7, the mixers' interactions (§6.4). */
export async function gateG7(run: TrialRunner, v: TrialVariant, base: AuditOut, path: TrialRunOut): Promise<NonNullable<Gates['g7']>> {
  const t = variantDef(v);
  const sap = (a: AuditOut): number => {
    const l = a.legs.find((x) => x.hero === 'sprout');
    return a.ok && l ? l.margin : -1;
  };
  if (t.id === 1005) {
    const w = { ...v, mod: { keepIce: true } };
    const o = await run.run({ v: w, p: { bot: 'path' } });
    return { ok: !o.passed, what: `no melt for Drip: ${o.noPlan ? 'no plan' : o.passed ? 'PASSES' : `fails leg ${o.leg}`}` };
  }
  if (t.id === 1006) {
    const w = { ...v, mod: { noHandoff: true } };
    const a = await run.audit(w);
    const o = await run.run({ v: w, p: { bot: 'path' } });
    const lower = sap(a) <= sap(base) - SAP_GAP;
    const fewer = !o.passed || o.trees < 3;
    return { ok: lower && fewer, what: `no hand-off swipes: Sap ${sap(a).toFixed(0)} vs ${sap(base).toFixed(0)}, trees ${o.trees} (path ${path.trees})` };
  }
  if (t.id === 1007) {
    // The plots a fire on an Ember-stretch wall reaches downwind (the breeze's side): the path with
    // the downwind mod plants them (it grows more trees than the plan) and ends with them gone.
    const down = downwindMinutes(v);
    const burn = await run.run({ v: { ...v, mod: { downwind: true } }, p: { bot: 'path' } });
    const planted = down.length > 0 && down.every((m) => burn.stood.includes(m));
    const gone = down.length > 0 && planted && down.every((m) => !burn.standing.includes(m));
    const w = { ...v, mod: { noHandoff: true } };
    const a = await run.audit(w);
    const lower = sap(a) <= sap(base) - SAP_GAP;
    return { ok: gone && lower, what: `plot ${down.join(',') || 'none downwind'} ${gone ? 'burnt' : planted ? 'STANDS' : 'never planted'}; no hand-off swipes: Sap ${sap(a).toFixed(0)} vs ${sap(base).toFixed(0)}` };
  }
  return { ok: true, what: '' };
}

/**
 * Every gate of a trial variant, in order: G0, G1, G2, G5 and G5b, G3 with G4, G6, G7. `failed` is the
 * first failing gate; with `stop` the first failure ends the evaluation (the seed search). `only`
 * limits the optional gates (0, 3/4/6, 5, 7) to those listed (G1 and G2 always run).
 */
/**
 * Every gate of a variant, in G0, G1, G2, G5, G3/G4, G6, G7 order. `stop` returns at the first
 * failure; `only` limits the run to those gates (G1 and G2 always run; 5.5 adds G5b's constant
 * angles to G5, which `only` null includes).
 */
export async function gates(run: TrialRunner, v: TrialVariant, humanSalts = HUMAN_SALTS, stop = false, only: readonly number[] | null = null): Promise<Gates> {
  const t = variantDef(v);
  let failed = 0;
  const waived: string[] = [];
  const fail = (n: number, ok: boolean): boolean => {
    const why = WAIVERS[`T${t.n} G${n}`];
    if (!ok && why !== undefined && WAIVABLE.includes(n)) waived.push(`G${n}: ${why}`);
    else if (!ok && failed === 0) failed = n;
    return stop && failed !== 0;
  };
  const want = (n: number): boolean => only === null || only.includes(n);
  const g: { -readonly [K in keyof Gates]: Gates[K] } = { v, g0: null, g1: null, g2: null, g5: null, g3: null, g4: null, g6: null, g7: null, failed: 0, waived };
  const done = (): Gates => ({ ...g, failed });
  if (want(0)) {
    g.g0 = await run.g0(v);
    if (fail(0.5, g.g0.ok)) return done();
  }
  g.g1 = await run.audit(v);
  if (fail(1, g.g1.ok)) return done();
  const path = await run.run({ v, p: { bot: 'path' } });
  const worst = t.cast.includes('drip') ? await run.run({ v, p: { bot: 'path', worst: true } }) : null;
  g.g2 = { ok: path.passed && path.health >= AUDIT_HEALTH && (worst === null || worst.passed), out: path, worst };
  if (fail(2, g.g2.ok)) return done();
  if (want(5)) {
    g.g5 = await gateG5(run, v, path, want(5.5));
    if (fail(5, g.g5.ok)) return done();
  }
  if (want(3) || want(4) || want(6)) {
    const [r3, r4] = await Promise.all([
      Promise.all(Array.from({ length: REACTIVE_SALTS }, (_, salt) => run.run({ v, p: { bot: 'reactive', salt } }))),
      Promise.all(Array.from({ length: humanSalts }, (_, salt) => run.run({ v, p: { bot: 'humanEl', salt } }))),
    ]);
    const wins = r3.filter((o) => o.passed).length;
    const passes = r4.filter((o) => o.passed).length;
    const band = t.n <= 4 ? HUMAN_BAND_SOLO : HUMAN_BAND_MIX;
    const share = passes / humanSalts;
    g.g3 = { ok: wins >= REACTIVE_WINS, wins, outs: r3 };
    g.g4 = { ok: share >= (band[0] as number) - 1e-9 && share <= (band[1] as number) + 1e-9, passes, outs: r4 };
    if (fail(3, g.g3.ok) || fail(4, g.g4.ok)) return done();
    const all = [...r3, ...r4];
    const dareShare = all.filter((o) => o.dareMet).length / all.length;
    g.g6 = { ok: dareShare >= DARE_BAND[0] && dareShare <= DARE_BAND[1], share: dareShare };
    if (fail(6, g.g6.ok)) return done();
  }
  if (want(7) && t.n >= 5) {
    g.g7 = await gateG7(run, v, g.g1, path);
    fail(7, g.g7.ok);
  }
  return done();
}

const pct = (x: number): string => `${Math.round(100 * x)}%`;
const f0 = (x: number): string => (Number.isFinite(x) ? x.toFixed(0) : '—');
const mark = (ok: boolean | undefined): string => (ok === undefined ? ' ' : ok ? '✓' : '✗');

/** One report block of a variant's gates. */
export function report(g: Gates): string {
  const t = variantDef(g.v);
  const head = `T${t.n} ${t.name.padEnd(13)} seed ${String(t.seed).padStart(10)} salt ${String(t.salt).padStart(3)} D${t.drain}${g.failed ? `  FAILS G${g.failed === 0.5 ? 0 : g.failed}` : g.waived.length ? `  passes (${g.waived.map((w) => w.split(':')[0]).join(', ')} waived)` : '  all gates pass'}`;
  const lines = [head];
  if (g.g0) lines.push(`  G0 ${mark(g.g0.ok)} ${g.g0.ok ? 'placement and authoring' : g.g0.fails.slice(0, 6).join('; ')}`);
  if (g.g1) {
    const legs = g.g1.legs.map((l, i) => `${i}:${l.hero} ${l.hero === 'gust' ? 'bots' : f0(l.margin)}${l.note ? ` (${l.note.trim()})` : ''}`).join(' | ');
    const drip = g.g1.drip.map((d) => ` Drip leg ${d.leg}: chosen ${d.chosen}° (${d.margins[d.marks.indexOf(d.chosen)]}), worst ${d.worst}° (${Math.min(...d.margins)}), best ${Math.max(...d.margins)}`).join(';');
    lines.push(`  G1 ${mark(g.g1.ok)} ${legs}${drip}${g.g1.ok ? '' : `  [${g.g1.why}]`}`);
  }
  if (g.g2) lines.push(`  G2 ${mark(g.g2.ok)} path ${g.g2.out.passed ? 'pass' : `FAIL leg ${g.g2.out.leg}`} low ${f0(g.g2.out.health)} legs ${g.g2.out.legLow.map(f0).join('/')}${g.g2.worst ? `; worst bin ${g.g2.worst.passed ? 'pass' : 'FAIL'} low ${f0(g.g2.worst.health)}` : ''}${g.g2.out.line ? ` (${g.g2.out.line})` : ''}`);
  if (g.g5) {
    const offs = g.g5.offs.map((o) => (o.passed ? 'PASS' : `L${o.leg}`)).join(',');
    const spams = g.g5.spams.map((o) => (o.won ? 'PASS' : `L${o.leg}`)).join(',');
    const cb = g.g5.constBest;
    lines.push(`  G5 ${mark(g.g5.ok)} idle ${g.g5.idle.passed ? 'PASS' : pct(g.g5.idle.progress)}; verb off ${offs}${g.g5.sight ? `; on sight ${f0(g.g5.sight.sight)} vs ${f0(g.g5.sight.path)}` : ''}${spams ? `; spam ${spams}` : ''}${cb ? `; G5b best θ${g.g5.constTheta} ${cb.passed ? 'PASS' : pct(cb.progress)}` : ''}${g.g5.why ? `  [${g.g5.why}]` : ''}`);
  }
  if (g.g3) lines.push(`  G3 ${mark(g.g3.ok)} reactive ${g.g3.wins}/${REACTIVE_SALTS} low ${f0(Math.min(...g.g3.outs.map((o) => o.health)))}`);
  if (g.g4) lines.push(`  G4 ${mark(g.g4.ok)} humanEl ${g.g4.passes}/${g.g4.outs.length} ${pct(g.g4.passes / g.g4.outs.length)}  deaths: ${deaths(g.g4.outs)}`);
  if (g.g6) lines.push(`  G6 ${mark(g.g6.ok)} dare ${t.dare.kind} ≥ ${t.dare.target}: ${pct(g.g6.share)}`);
  if (g.g7) lines.push(`  G7 ${mark(g.g7.ok)} ${g.g7.what}`);
  for (const w of g.waived) lines.push(`  waived ${w} (accepted by the lead)`);
  return lines.join('\n');
}

/** One line of a variant's gates (the survey). */
function compact(g: Gates): string {
  const t = variantDef(g.v);
  const parts = [`T${t.n} s${String(t.salt).padStart(3)} ${g.failed ? `G${g.failed === 0.5 ? 0 : g.failed}` : 'OK'}`];
  if (g.g0) parts.push(`G0${mark(g.g0.ok)}${g.g0.ok ? '' : g.g0.fails.length}`);
  if (g.g1) parts.push(`G1${mark(g.g1.ok)} ${g.g1.legs.map((l) => (l.hero === 'gust' ? 'g' : f0(l.margin))).join('/')}`);
  if (g.g2) parts.push(`G2${mark(g.g2.ok)} ${f0(g.g2.out.health)}${g.g2.worst ? `,${g.g2.worst.passed ? f0(g.g2.worst.health) : 'X'}` : ''}`);
  if (g.g5) parts.push(`G5${mark(g.g5.ok)} off ${g.g5.offs.map((o) => (o.passed ? 'P' : '.')).join('')}${g.g5.sight ? ` sight ${f0(g.g5.sight.sight)}/${f0(g.g5.sight.path)}` : ''}${g.g5.spams.length ? ` spam ${g.g5.spams.map((o) => (o.won ? 'P' : '.')).join('')}` : ''} const ${g.g5.constBest === null ? '-' : g.g5.constBest.passed ? 'P' : '.'}`);
  if (g.g3) parts.push(`G3 ${g.g3.wins}`);
  if (g.g4) parts.push(`G4 ${g.g4.passes}`);
  if (g.g6) parts.push(`G6 ${pct(g.g6.share)}`);
  if (g.g7) parts.push(`G7${mark(g.g7.ok)}`);
  return parts.join(' | ');
}

/** How the failed runs ended (leg and the death line's first words), counted. */
function deaths(outs: readonly TrialRunOut[]): string {
  const m = new Map<string, number>();
  for (const o of outs) {
    if (o.passed) continue;
    const k = `L${o.leg} ${o.line.replace(/ at .*$/, '')}`;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m].map(([k, n]) => `${n}× ${k}`).join(', ') || 'none';
}

// ---------------------------------------------------------------------------------------------
// --perf: µs per tick and per guide refresh against a Nubs run of the same length
// ---------------------------------------------------------------------------------------------

function perfOf(id: number): { trialTick: number; nubsTick: number; trialGuide: number; nubsGuide: number } {
  // µs per tick (mean) and per guide refresh (median: a lone GC pause would swamp a mean of a few
  // dozen refreshes), each the least of the timed reps.
  const time = (s: SimState, n: number, next: (s: SimState) => InputFrame): [number, number] => {
    let tick = 0;
    let k = 0;
    const g: number[] = [];
    for (let i = 0; i < n && s.phase !== 'dead' && s.phase !== 'won'; i++) {
      const f = next(s);
      const a = performance.now();
      step(s, f);
      tick += performance.now() - a;
      k++;
      if (i % 30 === 0) {
        const b = performance.now();
        updateGuide(s);
        g.push(performance.now() - b);
      }
    }
    g.sort((x, y) => x - y);
    return [(1000 * tick) / Math.max(1, k), 1000 * (g[g.length >> 1] ?? 0)];
  };
  const t = trialDef(id) as TrialDef;
  const ticks = Math.round((t.lengthMinutes / 14.4) * TICK_HZ);
  // Four reps each, alternating; the first warms the JIT and is not counted.
  let tt = Infinity;
  let tg = Infinity;
  let nt = Infinity;
  let ng = Infinity;
  for (let rep = 0; rep < 4; rep++) {
    const s = createRun(campaignConfig(id));
    const b = createBot('reactive');
    const [a, c] = time(s, ticks, (st) => b.next(st));
    const n = createRun(campaignConfig(12));
    const bn = createBot('reactive');
    const [d, e] = time(n, ticks, (st) => bn.next(st));
    if (rep === 0) continue;
    tt = Math.min(tt, a);
    tg = Math.min(tg, c);
    nt = Math.min(nt, d);
    ng = Math.min(ng, e);
  }
  return { trialTick: tt, nubsTick: nt, trialGuide: tg, nubsGuide: ng };
}

// ---------------------------------------------------------------------------------------------
// The mode
// ---------------------------------------------------------------------------------------------

function argOf(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? (process.argv[i + 1] as string) : null;
}

/** The Dare target moved 25% of the way that brings its share into the band, rounded to whole counts. */
function nudgeDare(t: TrialDef, share: number): number {
  const up = share > DARE_BAND[1];
  const next = Math.round(t.dare.target * (up ? 1.25 : 0.75));
  return next === t.dare.target ? t.dare.target + (up ? 1 : -1) : Math.max(1, next);
}

/**
 * --pick: the first salt k = from..199 passing every gate (then the Dare nudged into its band). With
 * --sets '[{…}, …]' each salt tries those lever sets (§6.5) in order after `base`; a salt whose G0
 * fails is skipped for all of them. --to N searches salts up to N − 1 instead of 199 (T3, T6 and T7:
 * their plots at ±44 u clear the generated casters on only 3-7% of salts, so 0..199 holds too few).
 */
async function pick(run: TrialRunner, id: number, humanSalts: number, from: number, base: Partial<TrialVariant>, sets: readonly Partial<TrialVariant>[] = [{}], to = PICK_SALTS): Promise<void> {
  const t0 = trialDef(id) as TrialDef;
  console.log(`\n--pick T${t0.n} from salt ${from}${Object.keys(base).length ? ` with ${JSON.stringify(base)}` : ''}${sets.length > 1 ? ` × ${sets.length} lever sets` : ''}`);
  for (let k = from; k < to; k++) {
    let v0: TrialVariant = { ...base, id, salt: k };
    // A plot, puddle or stone on a generated caster moves its dx first (±8 u), if that clears it.
    const moves = clearanceMoves(v0);
    if (moves !== null && moves.length > 0) v0 = { ...v0, moves };
    const g0 = await run.g0(v0);
    if (!g0.ok) {
      if (sets.length === 1) console.log(`  salt ${k}: G0  ${g0.fails.slice(0, 3).join('; ')}`);
      continue;
    }
    // The sets run from hardest to easiest: one that is still too easy (G5/G5b, or humanEl above its
    // band) ends the salt, since every later set is easier still.
    let g: Gates | null = null;
    for (const set of sets) {
      const v = { ...v0, ...set };
      g = await gates(run, v, humanSalts, true);
      const fails = report(g).split('\n').slice(1).filter((l) => l.includes('✗')).join(' ');
      console.log(`  salt ${k}${sets.length > 1 ? ` ${JSON.stringify(set)}` : ''}: ${g.failed === 0 ? 'PASS' : `G${g.failed === 0.5 ? 0 : g.failed}`}  ${fails.slice(0, 200)}`);
      if (g.failed === 0 || g.failed === 6) break;
      const band = t0.n <= 4 ? HUMAN_BAND_SOLO : HUMAN_BAND_MIX;
      if (g.failed === 5 || (g.failed === 4 && g.g4 !== null && g.g4.passes / humanSalts > (band[1] as number))) break;
    }
    if (g === null || (g.failed !== 0 && g.failed !== 6)) continue;
    let cur = g;
    for (let i = 0; i < 12 && cur.g6 && !cur.g6.ok; i++) {
      const target = nudgeDare(variantDef(cur.v), cur.g6.share);
      cur = await gates(run, { ...cur.v, dareTarget: target }, humanSalts);
      console.log(`  Dare → ${target}: ${cur.g6 ? pct(cur.g6.share) : '—'}`);
    }
    console.log(`\n${report(cur)}\nPIN T${t0.n}: ${JSON.stringify({ ...cur.v, id: undefined })}`);
    return;
  }
  console.log(`\nno salt in ${from}..${to - 1} passes T${t0.n}`);
}

async function trialsMain(ctx: Sim16Ctx): Promise<void> {
  const t0 = performance.now();
  const humanSalts = Number(argOf('salts') ?? HUMAN_SALTS);
  const pool = new TaskPool<Task, unknown>(new URL(import.meta.url), 'trials', ctx.workers);
  const run: TrialRunner = {
    run: (task) => pool.run(task) as Promise<TrialRunOut>,
    audit: (v, worst) => pool.run({ audit: v, worst }) as Promise<AuditOut>,
    g0: (v) => pool.run({ g0: v }) as Promise<G0Out>,
  };
  const ids = (argOf('id') ?? TRIAL_IDS.join(',')).split(',').map((x) => (Number(x) < 1000 ? 1000 + Number(x) : Number(x)));
  try {
    const base = JSON.parse(argOf('variant') ?? '{}') as Partial<TrialVariant>;
    const pickId = argOf('pick');
    if (pickId !== null) {
      const id = Number(pickId) < 1000 ? 1000 + Number(pickId) : Number(pickId);
      await pick(run, id, humanSalts, Number(argOf('from') ?? 0), base, JSON.parse(argOf('sets') ?? '[{}]') as Partial<TrialVariant>[], Number(argOf('to') ?? PICK_SALTS));
      return;
    }
    const survey = argOf('survey');
    if (survey !== null) {
      // Tooling: every gate on salts --from..--from + N − 1 (no short cut), one compact line each.
      const from = Number(argOf('from') ?? 0);
      for (const id of ids) {
        const rows = await Promise.all(
          Array.from({ length: Number(survey) }, (_, k) => {
            const v: TrialVariant = { ...base, id, salt: from + k };
            const moves = clearanceMoves(v);
            return gates(run, moves !== null && moves.length > 0 ? { ...v, moves } : v, humanSalts);
          }),
        );
        for (const g of rows) console.log(compact(g));
      }
      return;
    }
    const only = argOf('gates')?.split(',').map(Number) ?? null;
    console.log(`Elementals Trials: G0 authoring, G1 audits, G2 path bot, G5/G5b anti-trivial, G3 reactive ${REACTIVE_WINS}/${REACTIVE_SALTS}, G4 humanEl on ${humanSalts} salts, G6 Dare share, G7 mixers\n`);
    const all = await Promise.all(ids.map((id) => gates(run, { ...base, id, salt: base.salt ?? (trialDef(id) as TrialDef).salt }, humanSalts, false, only)));
    let bad = 0;
    for (const g of all) {
      console.log(report(g));
      if (g.failed) {
        bad++;
        if (ctx.check) ctx.fail(`T${variantDef(g.v).n} G${g.failed === 0.5 ? 0 : g.failed}`);
      }
    }
    if (process.argv.includes('--perf')) {
      console.log('\n--perf (µs): trial tick vs Nubs tick, trial guide vs Nubs guide');
      for (const id of ids) {
        const p = (await pool.run({ perf: id })) as ReturnType<typeof perfOf>;
        console.log(`  T${id - 1000}: tick ${p.trialTick.toFixed(1)} vs ${p.nubsTick.toFixed(1)} (×${(p.trialTick / p.nubsTick).toFixed(2)}), guide ${p.trialGuide.toFixed(1)} vs ${p.nubsGuide.toFixed(1)} (×${(p.trialGuide / p.nubsGuide).toFixed(2)})`);
      }
    }
    console.log(`\n${bad === 0 ? 'All trials pass every gate' : `${bad} trial(s) fail a gate`}. (${((performance.now() - t0) / 1000).toFixed(1)} s, ${pool.played} tasks)`);
  } finally {
    await pool.close();
  }
}

/** The `--trials` mode (scripts/sim16/registry.ts). */
export const TRIALS_MODULE: Sim16Module = {
  name: 'trials',
  modes: { trials: trialsMain },
};

export { audit, legAt, planPlayer };
