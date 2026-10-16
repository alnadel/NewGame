// The world: creation and resumable, budgeted generation (V1_PLAN §7.4).
//
// Generation is a fixed sequence of jobs: place(−1), place(0), place(1), validate(0), place(2),
// validate(1), ... Chunk k is validated only after chunk k+1 is placed, so long dawn shadows from
// just ahead count. Every job draws only from streams keyed by (seed, purpose, index) and job order
// never changes, so chunk content is a pure function of the WorldConfig, k and the prior chunks:
// generating in idle frames, inside step(), in one go or in many slices yields the same world.

import { ALL_MECHANICS, levelDef, mechanicsOf, type LevelDef, type Mechanics } from '../../config/campaign.ts';
import { foldTuning, type ConceptId } from '../../config/concepts.ts';
import { dayParams, effectiveNoonCloud } from '../../config/days.ts';
import { TUNING } from '../../config/tuning.ts';
import { dayAtTick, tickAtMinute, TICK_HZ, yAtTick } from '../clock.ts';
import { binOf } from '../intervals.ts';
import { V16_ALL, V16_NONE, type RunConfig, type V16Rules } from '../sim/types.ts';
import { createTrail } from '../trail.ts';
import { makeFlare, placeChunk, placeStart } from './placer.ts';
import { paramsAt } from './plan.ts';
import type { World } from './store.ts';
import { beginValidation, stepValidation } from './validator.ts';

export type { ChunkLit, World, WorldStats } from './store.ts';
export { gatherScene, pruneWorld, queryBalls, queryCasters, queryClouds, queryBuds, queryPickups } from './store.ts';

const CH = TUNING.world.chunkLen;
/** Work units charged for placing one chunk (a validator step costs 1). */
const PLACE_COST = 8;

/**
 * The RunConfig fields that make a world: the same values always build the same world. A campaign
 * level (`level`) also fixes `mods` and `biome` (createRun derives them; createWorld reads the
 * level for its start, finish, gate and eclipse geometry and the validator's drain).
 */
export type WorldConfig = Pick<
  RunConfig,
  'seed' | 'profile' | 'tutorial' | 'noonCloud' | 'plan' | 'forecast' | 'mods' | 'biome' | 'level' | 'mechanics' | 'v16' | 'brittleShare'
>;

/** The v1.5 mechanics of a world: the level's (mechanicsOf), else all on; RunConfig.mechanics overrides either. */
function worldMechanics(cfg: WorldConfig, level: LevelDef | null): Mechanics {
  const base = mechanicsOf(level ? level.id : null);
  const o = cfg.mechanics;
  if (!o) return base;
  const m = { buds: o.buds ?? base.buds, snap: o.snap ?? base.snap, deep: o.deep ?? base.deep, brittle: o.brittle ?? base.brittle };
  return m.buds && m.snap && m.deep && m.brittle ? ALL_MECHANICS : Object.freeze(m);
}

/** The v1.6 rules of a world: all on (V16_ALL) unless RunConfig.v16 switches some off. */
function worldRules(cfg: WorldConfig): V16Rules {
  const o = cfg.v16;
  if (!o) return V16_ALL;
  const r: V16Rules = {
    ring: o.ring ?? true,
    bank: o.bank ?? true,
    garden: o.garden ?? true,
    brittle: o.brittle ?? true,
    flares: o.flares ?? true,
    noonHeat: o.noonHeat ?? true,
  };
  const on = Object.values(r).filter(Boolean).length;
  return on === 6 ? V16_ALL : on === 0 ? V16_NONE : Object.freeze(r);
}

const NO_MODS: readonly ConceptId[] = Object.freeze([]);

/**
 * Creates a world with its start hut (and tutorial layout); nothing else is generated yet.
 * `levelOverride` (tools only: `sim --bake`) replaces the level definition cfg.level names.
 */
export function createWorld(cfg: WorldConfig, levelOverride?: LevelDef): World {
  const seed = cfg.seed >>> 0;
  let level: LevelDef | null = null;
  if (cfg.level !== undefined) {
    level = levelOverride ?? levelDef(cfg.level);
    if (!level) throw new Error(`unknown campaign level ${cfg.level}`);
  }
  const modList: readonly ConceptId[] = cfg.mods && cfg.mods.length > 0 ? Object.freeze(cfg.mods.slice()) : NO_MODS;
  const tune = foldTuning(modList);
  const walkMul = tune?.walkMul ?? 1;
  const startTick = level ? tickAtMinute(level.startMinute) : 0;
  const endTick = level ? tickAtMinute(level.startMinute + level.lengthMinutes) : -1;
  const midTick = level ? tickAtMinute(level.startMinute + level.lengthMinutes / 2) : -1;
  const w: World = {
    seed,
    profile: cfg.profile,
    tutorial: cfg.tutorial,
    noonCloud: effectiveNoonCloud(cfg),
    planOn: cfg.forecast !== undefined || (cfg.plan ?? (cfg.profile === 3 && !cfg.tutorial)),
    forcedForecast: cfg.forecast ?? null,
    forcedBiome: cfg.biome ?? null,
    plan: [],
    mods: new Set(modList),
    modList,
    level,
    walkMul,
    heightScale: tune?.heightScale ?? 1,
    startTick,
    startY: yAtTick(startTick) * walkMul,
    finishY: level ? yAtTick(endTick) * walkMul : Infinity,
    gateY: level && modList.includes('gate') ? yAtTick(midTick) * walkMul : -Infinity,
    eclipseTick: level && modList.includes('eclipse') ? Math.max(startTick, midTick - Math.round((ECLIPSE_SEC / 2) * TICK_HZ)) : -1,
    validatorDrain: level ? level.drain : dayParams(1, cfg.profile).drain,
    trail: createTrail(seed, cfg.tutorial),
    casters: [],
    byId: new Map(),
    clouds: [],
    balls: [],
    pickups: [],
    buds: [],
    mech: worldMechanics(cfg, level),
    v16: worldRules(cfg),
    flares: [],
    brittleShare: cfg.brittleShare === undefined ? null : Math.min(1, Math.max(0, cfg.brittleShare)),
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
    budY: 0,
    budCount: 0,
    flakeCount: 0,
    lastClusterY: -Infinity,
    glassEligible: 0,
    glassMade: 0,
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
  w.budY = w.startY + TUNING.buds.startDelay * paramsAt(w, 1).v;
  // v1.6: a level's flares (the Solar Flare's level, boss finales), pending until the validator's
  // keep test (the bake put them where it passes).
  if (level && w.v16.flares) {
    const STEP = TUNING.validator.stepTicks;
    for (const lf of level.flares) {
      const rise = STEP * Math.round(tickAtMinute(lf.minute) / STEP);
      w.flares.push(makeFlare(w.flares.length + 1, dayAtTick(rise), lf.d, rise, TUNING.flare.warnTicksJourney));
    }
  }
  // At the start only θ0 is reachable: the run begins with the sun pointing at the start hut.
  w.carryC.fill(-1e9);
  w.carryC[binOf(w.theta0)] = paramsAt(w, 1).maxChill;
  return w;
}

/** The eclipse concept's window (s): f = 0 everywhere, centred on the level's midpoint. */
export const ECLIPSE_SEC = 6;
/** Ticks of the eclipse's fade in and out (SimState.eclipse ramps 0 → 1 → 0). */
export const ECLIPSE_FADE_TICKS = 30;

/** True when absolute tick `tickAbs` is inside world `w`'s eclipse window. */
export function eclipseAt(w: World, tickAbs: number): boolean {
  return w.eclipseTick >= 0 && tickAbs >= w.eclipseTick && tickAbs < w.eclipseTick + ECLIPSE_SEC * TICK_HZ;
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
