// v1.6 `node scripts/sim.ts --bake` (docs/V1_6_PLAN.md §2.5, §2.6; CORE-2): what every Journey level
// offers on its fixed seed, written to src/config/levelBake.gen.ts.
//
// For each level, the world is built from its definition with its nominal flares (the Solar Flare's
// level and the boss finales: campaign.ts nominalFlares), pending, so the validator's keep test
// keeps, shifts (in 0.5 s steps) or drops each one exactly as it would in play; the kept flares'
// final rises become the level's baked flares. A second world, built with those flares, gives the
// offers the Dare targets are sized from: sunflower buds between the start and the finish, gazing
// balls with a glare-free line (a turn-limited path that survives the level on the validator's
// rows without ever touching that ball's glare), glass clusters, and lock and gust windows. Each
// entry carries levelBakeKey of the level's inputs, so a stale entry is ignored and the vitest
// (tests/unit/levelBake.test.ts) can tell the file is current.

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BOSS_PHASES, bakeRunEntry, CAMPAIGN_LEVELS, isBossFinale, levelBakeKey, levelDef, nominalFlares, type LevelBake, type LevelDef, type LevelFlare } from '../../src/config/campaign.ts';
import { TUNING } from '../../src/config/tuning.ts';
import { dayAtTick, dayStartTick, dayTicks, tickAtMinute, TICK_HZ } from '../../src/core/clock.ts';
import { tanD } from '../../src/core/dmath.ts';
import { paramsAt, worldElevation, worldYAtTick } from '../../src/core/gen/plan.ts';
import { chillDeltaTable, keepRows, keepVerdict, slidingMaxCircular, stepLit, validatorDrain } from '../../src/core/gen/validator.ts';
import { createWorld, ensureGenerated, type World } from '../../src/core/gen/world.ts';
import { gatherScene } from '../../src/core/gen/store.ts';
import { BINS, binOf, createMaskScene, glareMask, markCaster, markEllipse, SAMPLE_DX, SAMPLE_DY, SAMPLES, sceneAddBall, sceneBegin } from '../../src/core/intervals.ts';
import { FLARE_KEPT, SNAP_ID_BASE, type Caster, type Flare, type GazingBall } from '../../src/core/objects.ts';
import { glareOffset } from '../../src/core/shadows.ts';
import { campaignConfig } from '../../src/core/level.ts';
import { sunGustAt, sunLockedAt } from '../../src/core/sim/sun.ts';
import { trailX } from '../../src/core/trail.ts';
import type { Sim16Ctx } from './registry.ts';

const STEP = TUNING.validator.stepTicks;
const TURN = TUNING.validator.turnBins;
const DEAD = -1e9;
const LOCK_TICKS = Math.round(1.2 * TICK_HZ);
const GUST_TICKS = 2 * TICK_HZ;

/** The in-game minute (after Day 1 6:00 AM) of absolute tick `tick`, exact enough for tickAtMinute to give the tick back. */
export function minuteOfTick(tick: number): number {
  const day = dayAtTick(tick);
  return (day - 1) * 720 + (720 * (tick - dayStartTick(day))) / dayTicks(day);
}

/** The level as baked from: its definition with its nominal flares (whatever the bake file says). */
function nominalLevel(l: LevelDef): LevelDef {
  return Object.freeze({ ...l, flares: nominalFlares(l.id, l.startMinute, l.lengthMinutes) });
}

/** A level's world built from `def` (its seed, concepts, drain, …; the level's own RunConfig), generated through its finish. */
function levelWorld(def: LevelDef): World {
  const w = createWorld(campaignConfig(def.id), def);
  ensureGenerated(w, w.finishY + TUNING.world.chunkLen);
  return w;
}

const scene = createMaskScene();
const glare = new Uint8Array(BINS);
const lit = new Uint8Array(BINS);
const rowA = new Float64Array(BINS);
const rowB = new Float64Array(BINS);
const win = new Float64Array(BINS);

/**
 * True when ball `b` has a glare-free line on the level: the validator's DP (its rows, the
 * 3-step rule, the level's drain and regen) from the start (θ0) to the finish keeps Chill above 0
 * with every bin that puts a sample in this ball's glare forbidden.
 */
function glareFreeLine(w: World, b: GazingBall): boolean {
  const j0 = Math.ceil(w.startTick / STEP) + 1;
  let j1 = j0;
  while (worldYAtTick(w, j1 * STEP) < w.finishY) j1++;
  const p1 = paramsAt(w, 1);
  const delta = chillDeltaTable(validatorDrain(w), p1.regen);
  const maxC = p1.maxChill;
  let cur = rowA;
  let nxt = rowB;
  cur.fill(DEAD);
  cur[binOf(w.theta0)] = maxC;
  const rows = [new Uint8Array(BINS), new Uint8Array(BINS), new Uint8Array(BINS)];
  stepLit(w, j0 - 1, rows[0] as Uint8Array);
  stepLit(w, j0, rows[1] as Uint8Array);
  for (let j = j0; j <= j1; j++) {
    const prev = rows[(j - j0) % 3] as Uint8Array;
    const now = rows[(j - j0 + 1) % 3] as Uint8Array;
    const ahead = rows[(j - j0 + 2) % 3] as Uint8Array;
    stepLit(w, j + 1, ahead);
    const tick = j * STEP;
    const eps = worldElevation(w, tick);
    if (eps <= 0) {
      cur.fill(maxC);
      continue;
    }
    // This ball's glare at the step (any sample), if it can reach Nubs at all.
    glare.fill(0);
    const y = worldYAtTick(w, tick);
    const x = trailX(w.trail, y);
    if (eps >= TUNING.glare.minEps) {
      const cot = 1 / tanD(eps);
      const g = glareOffset(cot);
      const d = Math.sqrt((b.x - x) * (b.x - x) + (b.y - y) * (b.y - y));
      if (Math.abs(d - g) <= TUNING.glare.radius + 2 * TUNING.nubs.sampleOffset) {
        sceneBegin(scene, eps, cot);
        sceneAddBall(scene, b.x, b.y, b.id);
        for (let k = 0; k < SAMPLES; k++) {
          glareMask(scene, x + (SAMPLE_DX[k] as number), y + (SAMPLE_DY[k] as number), lit);
          for (let i = 0; i < BINS; i++) if (lit[i] === 1) glare[i] = 1;
        }
      }
    }
    slidingMaxCircular(cur, TURN, win);
    let best = DEAD;
    for (let i = 0; i < BINS; i++) {
      const lh = Math.max(prev[i] as number, now[i] as number, ahead[i] as number);
      let v = (win[i] as number) + (delta[lh] as number);
      if (v > maxC) v = maxC;
      if (v <= 0 || glare[i] === 1) v = DEAD;
      nxt[i] = v;
      if (v > best) best = v;
    }
    if (best <= 0) return false;
    const t = cur;
    cur = nxt;
    nxt = t;
  }
  return true;
}

const src = new Uint8Array(BINS);
const one = new Uint8Array(BINS);
const cover = new Uint8Array(BINS);
/** A cloud ride the bake counts toward the ride Dare's offer: at least this long (ticks). */
const RIDE_OFFER_TICKS = TICK_HZ;
/** A SWING hand-off the bake counts: a lit gap of 38° + 4 … 60° between two different sources' full shade. */
const SWING_GAP_MIN = TUNING.swing.minDeg + 4;
const SWING_GAP_MAX = 60;
/** SWING offers closer than this (ticks) count once (the bots' 2 s between SWINGs). */
const SWING_OFFER_GAP = 2 * TICK_HZ;
const sid = new Int32Array(BINS);
const sdist = new Float64Array(BINS);
const reach = new Float64Array(BINS);
const reachW = new Float64Array(BINS);

/** True when the row offers a SWING hand-off: a lit run of SWING_GAP_MIN…MAX bins between full shade of two different sources. */
function swingOffer(): boolean {
  let start = -1;
  for (let b = 0; b < BINS; b++) if (lit[b] === 0) start = b;
  if (start < 0) return false;
  // Walk once around from a shaded bin: each lit run with its two shaded ends.
  let k = 1;
  while (k <= BINS) {
    const b = (start + k) % BINS;
    if (lit[b] === 0) {
      k++;
      continue;
    }
    const a = (start + k - 1) % BINS;
    let len = 0;
    while (k <= BINS && lit[(start + k) % BINS] !== 0) {
      len++;
      k++;
    }
    const e = (start + k) % BINS;
    if (len >= SWING_GAP_MIN && len <= SWING_GAP_MAX && (sid[a] as number) >= 0 && (sid[e] as number) >= 0 && sid[a] !== sid[e]) return true;
  }
  return false;
}

/**
 * What the level offers the deep and ride Dares, on the validator's step grid along the trail (Nubs'
 * position at each 0.1 s step of the level's daylight): `deep` the ticks with a bin in deep shade
 * (fully shaded on the validator's row, two sources over the center sample); `rideBest` the longest
 * stretch (s) one cloud can cover all five samples from some bin, `rides` the clouds that can for
 * at least RIDE_OFFER_TICKS.
 */
function offersOf(w: World): { deep: number; rideBest: number; rides: number; swings: number; shadeRun: number } {
  const j0 = Math.ceil(w.startTick / STEP);
  let deep = 0;
  let swings = 0;
  let lastSwing = -Infinity;
  let streak = 0;
  let shadeRun = 0;
  reach.fill(0);
  const run = new Map<number, number>();
  const best = new Map<number, number>();
  for (let j = j0; worldYAtTick(w, j * STEP) < w.finishY; j++) {
    const tick = j * STEP;
    const eps = worldElevation(w, tick);
    if (eps <= 0) continue;
    const cot = 1 / tanD(eps);
    const y = worldYAtTick(w, tick);
    const x = trailX(w.trail, y);
    stepLit(w, j, lit);
    gatherScene(w, scene, x, y, TUNING.nubs.sampleOffset + 1, tick / TICK_HZ, eps, cot, false);
    src.fill(0);
    sid.fill(-1);
    sdist.fill(Infinity);
    for (let i = 0; i < scene.nCasters; i++) {
      const c = scene.casters[i] as Caster;
      one.fill(0);
      markCaster(one, c, x, y, cot);
      const d = (c.x - x) * (c.x - x) + (c.y - y) * (c.y - y);
      for (let b = 0; b < BINS; b++) {
        if (one[b] !== 1) continue;
        src[b] = (src[b] as number) + 1;
        if (d < (sdist[b] as number)) {
          sdist[b] = d;
          sid[b] = c.id;
        }
      }
    }
    const cl = scene.clouds;
    const seen = new Set<number>();
    for (let i = 0; i < scene.nClouds; i++) {
      const o = i * 6;
      const id = cl[o + 4] as number;
      if (id >= SNAP_ID_BASE) continue;
      one.fill(0);
      markEllipse(one, x, y, cl[o + 5] as number, cl[o] as number, cl[o + 1] as number, cl[o + 2] as number, cl[o + 3] as number);
      for (let b = 0; b < BINS; b++) {
        if (one[b] !== 1) continue;
        src[b] = (src[b] as number) + 1;
        sid[b] = id;
        sdist[b] = -1;
      }
      cover.fill(0);
      for (let k = 0; k < SAMPLES; k++) {
        one.fill(0);
        markEllipse(one, x + (SAMPLE_DX[k] as number), y + (SAMPLE_DY[k] as number), cl[o + 5] as number, cl[o] as number, cl[o + 1] as number, cl[o + 2] as number, cl[o + 3] as number);
        for (let b = 0; b < BINS; b++) cover[b] = (cover[b] as number) + (one[b] as number);
      }
      let full = false;
      for (let b = 0; b < BINS && !full; b++) if (cover[b] === SAMPLES) full = true;
      if (full) {
        seen.add(id);
        const r = (run.get(id) ?? 0) + STEP;
        run.set(id, r);
        if (r > (best.get(id) ?? 0)) best.set(id, r);
      }
    }
    for (const id of run.keys()) if (!seen.has(id)) run.set(id, 0);
    let any = false;
    for (let b = 0; b < BINS && !any; b++) if (lit[b] === 0 && (src[b] as number) >= 2) any = true;
    if (any) deep += STEP;
    if (tick - lastSwing >= SWING_OFFER_GAP && swingOffer()) {
      swings++;
      lastSwing = tick;
    }
    // The longest stretch a turn-limited path stays fully shaded (the ring's need).
    slidingMaxCircular(reach, TURN, reachW);
    let alive = false;
    for (let b = 0; b < BINS; b++) {
      const v = lit[b] === 0 && (reachW[b] as number) > 0 ? 1 : 0;
      reach[b] = v;
      if (v === 1) alive = true;
    }
    if (alive) streak += STEP;
    else {
      streak = 0;
      for (let b = 0; b < BINS; b++) reach[b] = lit[b] === 0 ? 1 : 0;
    }
    if (streak > shadeRun) shadeRun = streak;
  }
  let rideBest = 0;
  let rides = 0;
  for (const r of best.values()) {
    if (r > rideBest) rideBest = r;
    if (r >= RIDE_OFFER_TICKS) rides++;
  }
  return { deep, rideBest: Math.round((10 * rideBest) / TICK_HZ) / 10, rides, swings, shadeRun };
}

/** A gust window counts as holdable when its shade is this many degrees wider each side (the wind's drift, countered late). */
const GUST_EDGE = 4;
const held = new Uint8Array(BINS);

/** True when some bin is fully shaded on every validator row of ticks [t0, t1) (eroded by `edge` bins). */
function holdable(w: World, t0: number, t1: number, edge: number): boolean {
  held.fill(1);
  for (let j = Math.floor(t0 / STEP); j <= Math.ceil(t1 / STEP); j++) {
    stepLit(w, j, lit);
    for (let b = 0; b < BINS; b++) if (lit[b] !== 0) held[b] = 0;
  }
  for (let b = 0; b < BINS; b++) {
    if (held[b] !== 1) continue;
    let ok = true;
    for (let k = -edge; k <= edge && ok; k++) if (held[(b + k + BINS) % BINS] === 0 && lit[(b + k + BINS) % BINS] !== 0) ok = false;
    if (ok) return true;
  }
  return false;
}

/**
 * Lock and gust windows wholly inside the level's daylight ticks [a, b) of its day: all of them, and
 * the holdable ones (some bin fully shaded through the whole window on the validator's rows).
 */
function windowsOf(w: World, l: LevelDef): { windows: number; holdable: number } {
  if (!l.concepts.includes('lock') && !l.concepts.includes('gusts')) return { windows: 0, holdable: 0 };
  const a = w.startTick;
  const end = tickAtMinute(l.startMinute + l.lengthMinutes);
  let n = 0;
  let h = 0;
  for (let t = a; t < end; t++) {
    const day = dayAtTick(t);
    const d = t - dayStartTick(day);
    if (d >= dayTicks(day)) continue;
    if (l.concepts.includes('lock') && sunLockedAt(d) && !sunLockedAt(d - 1) && t + LOCK_TICKS <= end) {
      n++;
      if (holdable(w, t, t + LOCK_TICKS, 0)) h++;
    }
    if (l.concepts.includes('gusts') && sunGustAt(d) >= 0 && sunGustAt(d - 1) < 0 && t + GUST_TICKS <= end) {
      n++;
      if (holdable(w, t, t + GUST_TICKS, GUST_EDGE)) h++;
    }
  }
  return { windows: n, holdable: h };
}

/** Hold steps a single fixed angle must shade (3-step rule) for a flare to count as statically parryable: 6 of 7. */
const STILL_STEPS = Math.ceil(0.85 * Math.round(TUNING.flare.holdTicks / STEP) - 1e-9);
/**
 * How far (s, nearest first) the bake moves a nominal flare in data looking for a place it is kept:
 * in 0.5 s steps on a boss finale, in 0.1 s steps (the validator's grid) on the teaching level, whose
 * three flares and their beats must fit together.
 */
const BAKE_SHIFT_SEC = 6;
function shiftsOf(stepTicks: number): readonly number[] {
  const out = [0];
  for (let k = 1; k * stepTicks <= BAKE_SHIFT_SEC * TICK_HZ; k++) out.push(k * stepTicks, -k * stepTicks);
  return out;
}
const BOSS_SHIFTS = shiftsOf(TICK_HZ / 2);
const TEACH_SHIFTS = shiftsOf(STEP);

/** True when a fixed angle shades the kept flare f on ≥ STILL_STEPS of its hold steps (the parry a telegraph can name). */
export function stillParryable(w: World, f: Flare): boolean {
  return keepVerdict(keepRows(w, f)).still >= STILL_STEPS;
}

/**
 * Where nominal flare i of level l may be kept (absolute ticks of its rise): a boss finale's flare
 * inside its phase (BOSS_PHASES, as shares of the level), the Solar Flare's within BAKE_SHIFT_SEC of
 * its nominal rise.
 */
function riseBounds(l: LevelDef, f: LevelFlare): readonly [number, number] {
  const t = tickAtMinute(f.minute);
  if (!isBossFinale(l.id)) return [t - BAKE_SHIFT_SEC * TICK_HZ, t + BAKE_SHIFT_SEC * TICK_HZ];
  const frac = (f.minute - l.startMinute) / l.lengthMinutes;
  for (const [a, b] of BOSS_PHASES) {
    if (frac >= a && frac <= b) return [tickAtMinute(l.startMinute + a * l.lengthMinutes), tickAtMinute(l.startMinute + b * l.lengthMinutes)];
  }
  return [t, t];
}

/**
 * Pass 1 of a flare level's bake (§2.5: "shifts each flare by ±0.5 s in data until it passes the
 * keep test"): decides its nominal flares one at a time, in order. Each is tried where it stands,
 * then moved in data by ±0.5 s steps (BAKE_SHIFTS, nearest first) inside riseBounds; a candidate is
 * taken when the validator keeps it exactly there (its keep test and every candidateFits rule: the
 * finish margin, the spacing, the eclipse and lock windows), and on the teaching level only where a
 * fixed angle parries it (stillParryable). A flare no candidate fits is dropped.
 * The world of each candidate holds the flares decided so far, so the result is a fixed point: the
 * level built with the baked flares keeps every one of them where it stands.
 */
function bakeFlares(l: LevelDef, nominal: readonly LevelFlare[]): { flares: LevelFlare[]; dropped: number } {
  const teach = l.introduces !== null;
  /** True when the level built with `list` keeps every flare exactly where the data puts it (and, teaching, a fixed angle parries each). */
  const fits = (list: readonly LevelFlare[]): boolean => {
    const w = levelWorld(Object.freeze({ ...l, flares: list }));
    return w.flares.every((f, i) => {
      // Kept exactly there (the validator's own shifts would move it into another job, whose test can differ).
      if (f.state !== FLARE_KEPT || f.riseTick !== STEP * Math.round(tickAtMinute((list[i] as LevelFlare).minute) / STEP)) return false;
      return !teach || stillParryable(w, f);
    });
  };
  const byMinute = (a: LevelFlare, b: LevelFlare): number => a.minute - b.minute;
  let decided: LevelFlare[] = [];
  const missed: LevelFlare[] = [];
  for (const nf of nominal) {
    const [lo, hi] = riseBounds(l, nf);
    const t0 = tickAtMinute(nf.minute);
    let found: LevelFlare | null = null;
    for (const off of teach ? TEACH_SHIFTS : BOSS_SHIFTS) {
      if (t0 + off < lo || t0 + off > hi) continue;
      const cand = Object.freeze({ minute: minuteOfTick(t0 + off), d: nf.d });
      if (!fits([...decided, cand])) continue;
      found = cand;
      break;
    }
    if (found) decided.push(found);
    else missed.push(nf);
  }
  // A boss finale's HP: a flare its phase could not hold is tried anywhere in the three phases
  // (nearest its nominal rise first, the lift of the phase it lands in), e.g. away from the high noon
  // sun of a Heat Dome, where no shadow moves.
  let dropped = 0;
  if (isBossFinale(l.id)) {
    for (const nf of missed) {
      const t0 = tickAtMinute(nf.minute);
      const cands: { t: number; d: number }[] = [];
      for (const [a, b, d] of BOSS_PHASES) {
        const lo = tickAtMinute(l.startMinute + a * l.lengthMinutes);
        const hi = tickAtMinute(l.startMinute + b * l.lengthMinutes);
        for (let t = lo; t <= hi; t += TICK_HZ / 2) cands.push({ t, d });
      }
      cands.sort((x, y) => Math.abs(x.t - t0) - Math.abs(y.t - t0) || x.t - y.t);
      let found: LevelFlare | null = null;
      for (const c of cands) {
        const cand = Object.freeze({ minute: minuteOfTick(c.t), d: c.d });
        if (decided.some((x) => Math.abs(tickAtMinute(x.minute) - c.t) < TICK_HZ)) continue;
        const list = [...decided, cand].sort(byMinute);
        if (!fits(list)) continue;
        found = cand;
        decided = list;
        break;
      }
      if (!found) dropped++;
    }
  } else {
    dropped = missed.length;
  }
  if (process.env.BAKE_DEBUG) console.log(`L${l.id}: ${decided.map((f) => Math.round(tickAtMinute(f.minute))).join(' ')} (dropped ${dropped})`);
  return { flares: decided, dropped };
}

/** The bake of one level (pure in the level's definition and the generator). */
export function bakeLevel(id: number): LevelBake & { rescuesFlares: number; dropped: number } {
  const l = levelDef(id) as LevelDef;
  const nom = nominalLevel(l);
  const key = levelBakeKey(l.seed, l.concepts, l.drain, l.startMinute, l.lengthMinutes, l.biome, l.forecast, nom.flares);
  // Pass 1: the nominal flares, decided one by one (bakeFlares).
  let flares: readonly LevelFlare[] = [];
  let dropped = 0;
  let rescuesFlares = 0;
  if (nom.flares.length > 0) {
    const b = bakeFlares(l, nom.flares);
    flares = Object.freeze(b.flares);
    dropped = b.dropped;
    const w1 = levelWorld(Object.freeze({ ...l, flares }));
    const w0 = levelWorld(Object.freeze({ ...l, flares: [] }));
    rescuesFlares = w1.stats.rescues - w0.stats.rescues;
  }
  // Pass 2: the offers of the world as it will be played (with the baked flares).
  const w = levelWorld(Object.freeze({ ...l, flares }));
  let stillFlares = 0;
  for (const f of w.flares) {
    const back = STEP * Math.round(tickAtMinute(minuteOfTick(f.riseTick)) / STEP);
    if (back !== f.riseTick || f.state !== FLARE_KEPT) throw new Error(`level ${id}: baked flare ${f.id} does not reproduce (rise ${f.riseTick}, state ${f.state})`);
    if (stillParryable(w, f)) stillFlares++;
  }
  const inLevel = (y: number): boolean => y >= w.startY && y <= w.finishY;
  const buds = w.buds.filter((b) => inLevel(b.y)).length;
  const glass = new Set(w.pickups.filter((p) => p.brittle && inLevel(p.y)).map((p) => p.cluster)).size;
  let balls = 0;
  // A ball counts once Nubs is past its glare reach (step.ts passObjects), so only balls passed before the line.
  const pass = TUNING.glare.cap + TUNING.glare.radius;
  for (const b of w.balls) if (b.y >= w.startY && b.y + pass <= w.finishY && glareFreeLine(w, b)) balls++;
  const flakes = w.pickups.filter((p) => p.kind === 'flake' && !p.brittle && inLevel(p.y)).length;
  const { deep, rideBest, rides, swings, shadeRun } = offersOf(w);
  const { windows, holdable: hold } = windowsOf(w, l);
  return { key, buds, balls, glass, windows, holdable: hold, flakes, deep, rideBest, rides, swings, shadeRun, flares, stillFlares, rescuesFlares, dropped };
}

/** levelBake.gen.ts's text for these entries. */
export function bakeFileText(entries: readonly (readonly [number, LevelBake])[]): string {
  const lines = entries.map(([id, b]) => {
    const fl = b.flares.map((f) => `{ minute: ${f.minute}, d: ${f.d} }`).join(', ');
    return `  ${id}: { key: '${b.key}', buds: ${b.buds}, balls: ${b.balls}, glass: ${b.glass}, windows: ${b.windows}, holdable: ${b.holdable}, flakes: ${b.flakes}, deep: ${b.deep}, rideBest: ${b.rideBest}, rides: ${b.rides}, swings: ${b.swings}, shadeRun: ${b.shadeRun}, flares: [${fl}], stillFlares: ${b.stillFlares} },`;
  });
  const run = entries.map(([id, b]) => bakeRunEntry(levelDef(id) as LevelDef, b)).join(';');
  return `// GENERATED by \`node scripts/sim.ts --bake\` (docs/V1_6_PLAN.md §2.5, §2.6). Do not edit by hand.
// tests/unit/levelBake.test.ts checks that it is current.

import type { LevelBake } from './campaign.ts';

/**
 * The game's part (config/campaign.ts bakeRun): per level, in id order and ';'-separated, its Dares
 * (a letter per kind, then the target), its kept flares (minute:d) and a bake-sized goal target.
 */
export const LEVEL_BAKE_RUN = '${run}';

/**
 * Tooling only (never read by the game, so the bundler drops it): what each Journey level offers on
 * its fixed seed, keyed by its world identity, and its flares after the keep test.
 */
export const LEVEL_BAKE: Readonly<Record<number, LevelBake>> = {
${lines.join('\n')}
};
`;
}

/** `sim --bake [--level N,…]`: bakes every level (in the worker pool's absence: in this process) and writes the file. */
export async function bakeMain(ctx: Sim16Ctx): Promise<void> {
  const t0 = performance.now();
  const entries: [number, LevelBake][] = [];
  let worst = 0;
  for (const l of CAMPAIGN_LEVELS) {
    const b = bakeLevel(l.id);
    const { rescuesFlares, dropped, ...entry } = b;
    entries.push([l.id, entry]);
    if (l.flares.length > 0 || entry.flares.length > 0 || dropped > 0) {
      console.log(`  L${l.id} ${l.name.padEnd(18)} flares kept ${entry.flares.length} (a fixed angle parries ${entry.stillFlares}), dropped ${dropped}, rescues for them ${rescuesFlares >= 0 ? '+' : ''}${rescuesFlares}`);
      if (l.id % 10 === 0 && l.id > 40) worst = Math.max(worst, rescuesFlares);
    }
  }
  const out = join(dirname(fileURLToPath(import.meta.url)), '../../src/config/levelBake.gen.ts');
  writeFileSync(out, bakeFileText(entries));
  console.log(`\nsim --bake: ${entries.length} levels in ${((performance.now() - t0) / 1000).toFixed(1)} s, wrote ${out}`);
  const ok = worst <= 3;
  console.log(`  ${ok ? 'PASS' : 'MISS'}  boss levels' flares cost ≤ 3 rescue rocks each (advisory): worst +${worst}`);
  void ctx;
}
