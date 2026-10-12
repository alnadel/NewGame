// The world: creation and resumable, budgeted generation (V1_PLAN §7.4).
//
// Generation is a fixed sequence of jobs: place(−1), place(0), place(1), validate(0), place(2),
// validate(1), ... Chunk k is validated only after chunk k+1 is placed, so long dawn shadows from
// just ahead count. Every job draws only from streams keyed by (seed, purpose, index) and job order
// never changes, so chunk content is a pure function of the WorldConfig, k and the prior chunks:
// generating in idle frames, inside step(), in one go or in many slices yields the same world.

import { effectiveNoonCloud } from '../../config/days.ts';
import { TUNING } from '../../config/tuning.ts';
import { binOf } from '../intervals.ts';
import type { RunConfig } from '../sim/types.ts';
import { createTrail } from '../trail.ts';
import { placeChunk, placeStart } from './placer.ts';
import type { World } from './store.ts';
import { beginValidation, stepValidation } from './validator.ts';

export type { ChunkLit, World, WorldStats } from './store.ts';
export { gatherScene, pruneWorld, queryBalls, queryCasters, queryClouds, queryPickups } from './store.ts';

const CH = TUNING.world.chunkLen;
/** Work units charged for placing one chunk (a validator step costs 1). */
const PLACE_COST = 8;

/** The RunConfig fields that make a world: the same values always build the same world. */
export type WorldConfig = Pick<RunConfig, 'seed' | 'profile' | 'tutorial' | 'noonCloud' | 'plan'>;

/** Creates a world with its start hut (and tutorial layout); nothing else is generated yet. */
export function createWorld(cfg: WorldConfig): World {
  const seed = cfg.seed >>> 0;
  const w: World = {
    seed,
    profile: cfg.profile,
    tutorial: cfg.tutorial,
    noonCloud: effectiveNoonCloud(cfg),
    planOn: false,
    trail: createTrail(seed, cfg.tutorial),
    casters: [],
    byId: new Map(),
    clouds: [],
    balls: [],
    pickups: [],
    maxZ: 0,
    nextId: 1,
    startHutId: -1,
    theta0: 0,
    startSide: 1,
    placedThrough: -2,
    validatedThrough: -1,
    daysGenerated: 0,
    cursorY: -CH,
    cursorSide: 1,
    flakeY: 0,
    rescueSide: 1,
    nextStep: 0,
    carryN: 0,
    carryC: new Float64Array(360 * (TUNING.validator.prefixSteps + 1)),
    carryLit: new Uint8Array(360 * (TUNING.validator.prefixSteps + 1)),
    job: null,
    lastJob: null,
    chunkLit: [],
    stats: { chunksPlaced: 0, chunksValidated: 0, rescues: 0, rescuesPerChunk: [], parkedClouds: 0, unresolved: 0, dropped: 0, work: 0 },
  };
  placeStart(w);
  // At the start only θ0 is reachable: the run begins with the sun pointing at the start hut.
  w.carryC.fill(-1e9);
  w.carryC[binOf(w.theta0)] = TUNING.nubs.maxChill;
  return w;
}

/** y up to which the world is placed and validated. */
export function validatedY(w: World): number {
  return (w.validatedThrough + 1) * CH;
}

/** Runs (part of) the next job. Returns the work units used. */
function runJob(w: World, budget: number): number {
  if (w.job) {
    const used = stepValidation(w, w.job, budget);
    if (w.job.done) w.job = null;
    return used;
  }
  if (w.placedThrough < w.validatedThrough + 2) {
    placeChunk(w, w.placedThrough + 1);
    w.placedThrough++;
    w.stats.work += PLACE_COST;
    return PLACE_COST;
  }
  w.job = beginValidation(w, w.validatedThrough + 1);
  return 0;
}

/**
 * Generates toward `yTarget` (validated) using at most ~`budget` work units (≈ 0.02-0.05 ms each in
 * Node). Returns true once the world is validated through yTarget. Call it from idle time with a
 * small budget; the result never depends on how the work was sliced.
 */
export function generateSome(w: World, yTarget: number, budget: number): boolean {
  let used = 0;
  while (validatedY(w) < yTarget) {
    if (used >= budget) return false;
    used += runJob(w, budget - used);
  }
  return true;
}

/** Hard guarantee: generates (and validates) through yTarget right now. */
export function ensureGenerated(w: World, yTarget: number): void {
  generateSome(w, yTarget, Infinity);
}
