// World storage: y-sorted object lists, id lookup, range queries and pruning.
// Generation (placer/validator) inserts; the sim and renderer only read (pickups excepted).

import type { LevelDef, Mechanics } from '../../config/campaign.ts';
import type { ConceptId } from '../../config/concepts.ts';
import type { BiomeId, DayParams, DayPlan, NoonCloud, ProfileId } from '../../config/days.ts';
import type { ForecastId } from '../../config/forecasts.ts';
import { TUNING } from '../../config/tuning.ts';
import { type MaskScene, sceneAddBall, sceneAddCaster, sceneAddCloud, sceneBegin } from '../intervals.ts';
import { RUNTIME_ID_BASE, type Bud, type Caster, type Cloud, type Flare, type GazingBall, type Pickup } from '../objects.ts';
import { casterReach, cloudAlive, distToCasterBounds, glareOffset, shadowLength, cloudOffset } from '../shadows.ts';
import type { V16Rules } from '../sim/types.ts';
import type { Rng } from '../rng.ts';
import type { Trail } from '../trail.ts';
import type { ContestRun } from './contest.ts';
import type { ValidationJob } from './validator.ts';

const MAX_R = TUNING.world.maxCasterRadius;

export interface WorldStats {
  chunksPlaced: number;
  chunksValidated: number;
  /** Rescue Shade Rocks inserted. */
  rescues: number;
  /** Rescues per validated chunk, indexed by chunk (k ≥ 0). */
  rescuesPerChunk: number[];
  /** Validator fallback clouds inserted. */
  parkedClouds: number;
  /** Validator failures that survived every fallback (target 0). */
  unresolved: number;
  /** Casters dropped because no clear spot was found. */
  dropped: number;
  /** Abstract work units spent (≈ one validator step each). */
  work: number;
}

/** Validator lit counts per 0.1 s step for one chunk (0..10 per bin; f = lit/5). Read by the oracle. */
export interface ChunkLit {
  readonly k: number;
  /** Global step index of the first step; step j is at absolute tick 6·j. */
  readonly j0: number;
  readonly n: number;
  /** n × 360 lit counts. */
  readonly lit: Uint8Array;
}

export interface World {
  readonly seed: number;
  readonly profile: ProfileId;
  readonly tutorial: boolean;
  /** Effective Day-1 parked noon cloud (effectiveNoonCloud of the run's config). */
  readonly noonCloud: NoonCloud;
  /** Day Plan on: each day draws its biome and forecast (planDay); off: alternating clear days. */
  readonly planOn: boolean;
  /** RunConfig.forecast (debug and tooling): every day that fits it gets it, the others are clear. */
  readonly forcedForecast: ForecastId | null;
  /** RunConfig.biome: the Day-1 biome, alternating from there (campaign levels); null = the plan's. */
  readonly forcedBiome: BiomeId | null;
  /** worldPlan() memo of the drawn plan, index 0 = Day 1 (plan-on worlds only). */
  readonly plan: DayPlan[];
  /** Campaign concepts (RunConfig.mods) as a set and in list order (the dayParams cache key). */
  readonly mods: ReadonlySet<ConceptId>;
  readonly modList: readonly ConceptId[];
  /** The campaign level (RunConfig.level), or null. */
  readonly level: LevelDef | null;
  /** Walk multiplier of the concepts (see plan.ts worldYAtDayTick) and caster height scale. */
  readonly walkMul: number;
  readonly heightScale: number;
  /**
   * Campaign geometry: the absolute tick and y where the run starts (0 outside a level: the start
   * hut stands at startY + 10 and the validator's DP begins there), the finish line's y (Infinity
   * when none: crossing it with Chill > 0 wins the level; the validator leaves the stretch past it
   * unused), the 'gate' concept's arch y (−Infinity when none) and the 'eclipse' window's first
   * absolute tick (−1 when none).
   */
  readonly startTick: number;
  readonly startY: number;
  readonly finishY: number;
  readonly gateY: number;
  readonly eclipseTick: number;
  /** Drain the validator's DP uses (the level's, else the profile's); × DayParams.drainMul at use. */
  readonly validatorDrain: number;
  readonly trail: Trail;
  /** Casters sorted by center y (ties by id). */
  readonly casters: Caster[];
  readonly byId: Map<number, Caster>;
  /** Clouds in creation order. */
  readonly clouds: Cloud[];
  /** Gazing balls sorted by y. */
  readonly balls: GazingBall[];
  /** Pickups sorted by y (ties by id). */
  readonly pickups: Pickup[];
  /** v1.5 Sunflower buds sorted by y (ties by id). */
  readonly buds: Bud[];
  /**
   * v1.5 core mechanics this world plays with (campaign: from the level that teaches each; else
   * all on, or RunConfig.mechanics). Buds are only generated when `buds` is on.
   */
  readonly mech: Mechanics;
  /**
   * v1.6 rules this world plays with (docs/V1_6_PLAN.md §5 as amended: V16_SHIP unless
   * RunConfig.v16 switches some; part of the world's identity).
   */
  readonly v16: V16Rules;
  /**
   * v1.6 Heat Flares (§2.5), sorted by riseTick: drawn per day by generation (Endless) or from the
   * level's baked table (Journey bosses), kept or dropped by the validator. Empty until CORE-2.
   */
  readonly flares: Flare[];
  /**
   * The parry of each kept Endless flare (flare id → 360 bins, validator rules): 1 where the sun held
   * at that bin through the hold leaves Nubs lit on at most TUNING.flare.parryMaxLit hold ticks. The
   * validator's DP holds its path on one of these bins through the hold (a miss scorches the tank,
   * which the DP does not model, so the proven path parries); written by the keep test.
   */
  readonly flareParry: Map<number, Uint8Array>;
  /** v1.6 debug (RunConfig.brittleShare): the glass quota forced to this share 0..1, or null for the profile/day quota. */
  readonly brittleShare: number | null;
  /** Largest caster height so far (for reach culling). */
  maxZ: number;
  nextId: number;
  /** Start hut and the initial sun azimuth θ0 (from Nubs at y = 0 toward the hut center). */
  startHutId: number;
  theta0: number;
  /** Side of the trail the start hut is on (+1 east, −1 west). */
  startSide: -1 | 1;

  // Generation progress. Chunk k covers y ∈ [480k, 480(k+1)); chunk −1 is scenery behind the start.
  placedThrough: number;
  validatedThrough: number;
  daysGenerated: number;
  /** Placement carry: caster cursor y and side, flake cluster cursor y, alternating rescue side. */
  cursorY: number;
  cursorSide: -1 | 1;
  flakeY: number;
  rescueSide: -1 | 1;
  /** v1.5 bud placement: the next bud's y and the buds placed so far (bud ids are BUD_ID_BASE + n). */
  budY: number;
  budCount: number;
  /**
   * v1.6 flakes (§2.3, T7): flakes placed so far (flake ids are FLAKE_ID_BASE + n), the y of the
   * last cluster's last flake (−Infinity before the first), and the glass quota's running count of
   * eligible clusters and of glass ones.
   */
  flakeCount: number;
  lastClusterY: number;
  glassEligible: number;
  glassMade: number;
  /**
   * Validator carry: the next unvalidated step, how many already-validated steps the next job
   * re-runs (carryN), and the DP rows and lit counts of those steps plus the entry step before them
   * (carryN + 1 rows each, starting at step nextStep − carryN − 1).
   */
  nextStep: number;
  carryN: number;
  readonly carryC: Float64Array;
  readonly carryLit: Uint8Array;
  job: ValidationJob | null;
  /** The last finished job, whose buffers the next one reuses. */
  lastJob: ValidationJob | null;
  /** v1.6 (fix round 2): the pickups job of the chunk placed two chunks back, in progress (null: none). */
  pickJob: PickupJob | null;
  /** The glass contest run the pickups jobs reuse (its M rows), made on first use. */
  contestRun: ContestRun | null;
  readonly chunkLit: ChunkLit[];
  readonly stats: WorldStats;
}

/**
 * The flakes and buds of chunk k, placed after the casters of chunk k + 2 as a resumable job
 * (placer.ts beginPickups / stepPickups): the cluster being placed and its glass contest run.
 */
export interface PickupJob {
  readonly k: number;
  /** The chunk's end (y): clusters start below it. */
  readonly y1: number;
  /** The chunk's flake stream (null: no flakes, the tutorial's authored chunk). */
  readonly rng: Rng | null;
  /** 0 flakes, 1 buds. */
  phase: number;
  guard: number;
  /** The cluster drawn last (p null: none pending): its y, size, day, day params and the next cluster's y. */
  y: number;
  n: number;
  day: number;
  p: DayParams | null;
  nextY: number;
  /** Its glass search: the shift tried next, the best contested y and its distance to costAim. */
  shift: number;
  best: number | null;
  bestD: number;
  readonly run: ContestRun;
  /** A contest stage is due (run is not done). */
  contestOn: boolean;
  done: boolean;
}

/** Index of the first element with y ≥ target in a y-sorted array. */
export function lowerBound(arr: readonly { y: number }[], target: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((arr[mid] as { y: number }).y < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function insertSorted<T extends { y: number; id: number }>(arr: T[], item: T): void {
  let i = lowerBound(arr, item.y);
  while (i < arr.length && (arr[i] as T).y === item.y && (arr[i] as T).id < item.id) i++;
  arr.splice(i, 0, item);
}

export function takeId(w: World): number {
  return w.nextId++;
}

export function insertCaster(w: World, c: Caster): void {
  insertSorted(w.casters, c);
  w.byId.set(c.id, c);
  if (c.maxZ > w.maxZ) w.maxZ = c.maxZ;
}

export function insertPickup(w: World, p: Pickup): void {
  insertSorted(w.pickups, p);
}

export function insertBall(w: World, b: GazingBall): void {
  insertSorted(w.balls, b);
}

export function insertBud(w: World, b: Bud): void {
  insertSorted(w.buds, b);
}

/** True for the objects a run makes (blooms' sunflowers, the Cold Snap's cloud): the validator ignores them. */
export function isRuntimeId(id: number): boolean {
  return id >= RUNTIME_ID_BASE;
}

/**
 * Casters whose ground bounds overlap y ∈ [y0, y1], sorted by center y. Fills `out` and returns
 * the count (out is reused; entries past the count are stale).
 */
export function queryCasters(w: World, y0: number, y1: number, out: Caster[]): number {
  const cs = w.casters;
  let n = 0;
  for (let i = lowerBound(cs, y0 - MAX_R); i < cs.length; i++) {
    const c = cs[i] as Caster;
    if (c.y > y1 + MAX_R) break;
    if (c.maxY < y0 || c.minY > y1) continue;
    if (n < out.length) out[n] = c;
    else out.push(c);
    n++;
  }
  return n;
}

/** Pickups with y ∈ [y0, y1] in any state, sorted by y. */
export function queryPickups(w: World, y0: number, y1: number, out: Pickup[]): number {
  const ps = w.pickups;
  let n = 0;
  for (let i = lowerBound(ps, y0); i < ps.length; i++) {
    const p = ps[i] as Pickup;
    if (p.y > y1) break;
    if (n < out.length) out[n] = p;
    else out.push(p);
    n++;
  }
  return n;
}

/** v1.5 Sunflower buds with y ∈ [y0, y1] in any state, sorted by y. */
export function queryBuds(w: World, y0: number, y1: number, out: Bud[]): number {
  const bs = w.buds;
  let n = 0;
  for (let i = lowerBound(bs, y0); i < bs.length; i++) {
    const b = bs[i] as Bud;
    if (b.y > y1) break;
    if (n < out.length) out[n] = b;
    else out.push(b);
    n++;
  }
  return n;
}

/** Gazing balls with y ∈ [y0, y1]. */
export function queryBalls(w: World, y0: number, y1: number, out: GazingBall[]): number {
  const bs = w.balls;
  let n = 0;
  for (let i = lowerBound(bs, y0); i < bs.length; i++) {
    const b = bs[i] as GazingBall;
    if (b.y > y1) break;
    if (n < out.length) out[n] = b;
    else out.push(b);
    n++;
  }
  return n;
}

/** Clouds alive at absolute time tAbs (s). */
export function queryClouds(w: World, tAbs: number, out: Cloud[]): number {
  let n = 0;
  for (const cl of w.clouds) {
    if (!cloudAlive(cl, tAbs)) continue;
    if (n < out.length) out[n] = cl;
    else out.push(cl);
    n++;
  }
  return n;
}

/**
 * Gathers every occluder that could affect points within `margin` of (px, py) at absolute time
 * tAbs and elevation eps (cot = 1/tan ε) into `scene`. Clouds are stored at their tAbs position.
 * `live` false (the validator and its lit cache) leaves out what the run made (sunflowers, the snap
 * cloud), so the world stays a pure function of its config. Clouds with an id ≥ `cloudsBelow` are
 * left out too (guide.flare leaves out the Cold Snap's cloud, whose path re-aims as it goes).
 */
export function gatherScene(
  w: World,
  scene: MaskScene,
  px: number,
  py: number,
  margin: number,
  tAbs: number,
  eps: number,
  cot: number,
  live = true,
  cloudsBelow = Infinity,
): void {
  sceneBegin(scene, eps, cot);
  if (!scene.sunUp) return;
  const reach = shadowLength(w.maxZ, cot) + margin;
  const cs = w.casters;
  for (let i = lowerBound(cs, py - reach - MAX_R); i < cs.length; i++) {
    const c = cs[i] as Caster;
    if (c.y > py + reach + MAX_R) break;
    if (!live && c.id >= RUNTIME_ID_BASE) continue;
    if (distToCasterBounds(c, px, py) <= casterReach(c, cot) + margin) sceneAddCaster(scene, c);
  }
  const R0 = cloudOffset(TUNING.shadow.cloudZ, cot);
  for (const cl of w.clouds) {
    if (!cloudAlive(cl, tAbs)) continue;
    if ((!live && cl.id >= RUNTIME_ID_BASE) || cl.id >= cloudsBelow) continue;
    const R = cl.z === TUNING.shadow.cloudZ ? R0 : cloudOffset(cl.z, cot);
    const dt = tAbs - cl.t0;
    const cx = cl.x0 + cl.vx * dt;
    const cy = cl.y0 + cl.vy * dt;
    const d = Math.sqrt((cx - px) * (cx - px) + (cy - py) * (cy - py));
    // p can be shaded only if |d − R| ≤ the cloud's radius.
    if (Math.abs(d - R) <= cl.rx + margin) sceneAddCloud(scene, cx, cy, cl.rx, cl.ry, cl.id, R);
  }
  if (scene.glareOn) {
    const g = glareOffset(cot);
    const gr = TUNING.glare.radius + margin;
    const bs = w.balls;
    for (let i = lowerBound(bs, py - g - gr); i < bs.length; i++) {
      const b = bs[i] as GazingBall;
      if (b.y > py + g + gr) break;
      const d = Math.sqrt((b.x - px) * (b.x - px) + (b.y - py) * (b.y - py));
      if (Math.abs(d - g) <= gr) sceneAddBall(scene, b.x, b.y, b.id);
    }
  }
}

/**
 * Drops objects that can no longer matter: everything entirely behind y = cutoff, clouds that
 * died before tAbs, and validator lit caches of chunks behind the cutoff.
 */
export function pruneWorld(w: World, cutoff: number, tAbs: number): void {
  const cs = w.casters;
  let k = 0;
  while (k < cs.length && (cs[k] as Caster).y < cutoff - MAX_R) {
    w.byId.delete((cs[k] as Caster).id);
    k++;
  }
  if (k > 0) cs.splice(0, k);
  const ps = w.pickups;
  k = 0;
  while (k < ps.length && (ps[k] as Pickup).y < cutoff) k++;
  if (k > 0) ps.splice(0, k);
  const bs = w.balls;
  k = 0;
  while (k < bs.length && (bs[k] as GazingBall).y < cutoff - TUNING.glare.cap - TUNING.glare.radius) k++;
  if (k > 0) bs.splice(0, k);
  const bd = w.buds;
  k = 0;
  while (k < bd.length && (bd[k] as Bud).y < cutoff) k++;
  if (k > 0) bd.splice(0, k);
  for (let i = w.clouds.length - 1; i >= 0; i--) {
    const cl = w.clouds[i] as Cloud;
    if (cl.t0 + cl.life < tAbs) w.clouds.splice(i, 1);
  }
  const cl = w.chunkLit;
  k = 0;
  while (k < cl.length && ((cl[k] as ChunkLit).k + 1) * TUNING.world.chunkLen < cutoff) k++;
  if (k > 0) cl.splice(0, k);
}
