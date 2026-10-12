// createRun(): a fresh run in the 'hold' phase (V1_PLAN §8.3).

import { TUNING } from '../../config/tuning.ts';
import { dayTicks, yAtDayTick } from '../clock.ts';
import { paramsAt } from '../gen/plan.ts';
import { ensureGenerated, createWorld, generateSome, type World } from '../gen/world.ts';
import { syncTime } from './step.ts';
import { computeCoverage } from './nubs.ts';
import { updateGuide } from './guide.ts';
import type { RunStats } from './events.ts';
import type { RunConfig, SimState } from './types.ts';

function freshStats(day: number): RunStats {
  return {
    flakes: 0,
    flakesMelted: 0,
    crystals: 0,
    flowers: 0,
    phews: 0,
    snow: 0,
    maxMult: 1,
    x5HoldBest: 0,
    cloudRideBest: 0,
    cloudSeconds: 0,
    ballsPassedClean: 0,
    ballGlared: false,
    gateNoon: false,
    dayReached: day,
    nightsReached: 0,
    minutes: 0,
    litTotal: 0,
    swings: 0,
    swingChainBest: 0,
    phewMinChill: 100,
  };
}

/** The start day and tick of a run (cfg.startDay/startT are debug hooks). */
function startOf(cfg: RunConfig): { day: number; dayTick: number } {
  const day = Math.max(1, Math.floor(cfg.startDay ?? 1));
  const dayTick = Math.min(dayTicks(day) - 1, Math.max(0, Math.round((cfg.startT ?? 0) * TUNING.tick.hz)));
  return { day, dayTick };
}

/**
 * A run whose world is being generated ahead of time in slices (for example while the previous run's
 * death plays), so that createRun() on it costs almost nothing. The world is the same however the
 * work is sliced (gen/world.ts).
 */
export interface RunBuild {
  readonly cfg: RunConfig;
  readonly world: World;
  /** y through which createRun() needs the world validated. */
  readonly targetY: number;
}

/** Starts building a run's world (cheap: only the start hut is placed). */
export function prepareRun(cfg: RunConfig): RunBuild {
  const { day, dayTick } = startOf(cfg);
  return {
    cfg: { ...cfg },
    world: createWorld(cfg),
    targetY: yAtDayTick(day, dayTick) + TUNING.world.hardAhead,
  };
}

/** Generates part of a prepared run's world (~`budget` work units). True once createRun is cheap. */
export function prepareSome(b: RunBuild, budget: number): boolean {
  return generateSome(b.world, b.targetY, budget);
}

/**
 * Creates a run: builds the world (validated through Nubs + `ahead` u), puts Nubs at the start (or
 * at cfg.startDay/startT for debugging) with the sun at θ0, and computes coverage and the guide so
 * the Title can render the live scene. The clock stays frozen until the first touch, and step()
 * completes the hard guarantee (Nubs + TUNING.world.hardAhead) on it, so a smaller `ahead` (≥ the
 * view and the shadow reach, e.g. 1100 for the Title) only moves generation work later: the world is
 * the same either way. With `build` (from prepareRun() with the same config) its world is used and
 * only the rest of it is generated now.
 */
export function createRun(cfg: RunConfig, build?: RunBuild, ahead: number = TUNING.world.hardAhead): SimState {
  const world = build ? build.world : createWorld(cfg);
  const { day, dayTick } = startOf(cfg);
  const maxChill = TUNING.nubs.maxChill;
  const theta0 = world.theta0;
  const s: SimState = {
    cfg: { ...cfg },
    params: paramsAt(world, day),
    phase: 'hold',
    tick: 0,
    ready: 0,
    day,
    dayTick,
    tDay: 0,
    tickAbs: 0,
    tAbs: 0,
    minutes: 0,
    eps: 0,
    tanEps: 0,
    cot: 0,
    sunUp: false,
    ux: 1,
    uy: 0,
    theta0,
    sun: { theta: theta0, lag: 0, omega: 0, omegaRel: 0, mode: 'idle', detent: Math.floor(theta0 / TUNING.sun.detentDeg), dTheta: 0, keyTicks: 0, keySign: 0 },
    nubs: {
      x: 0,
      y: 0,
      chill: Math.min(maxChill, Math.max(1, cfg.startChill ?? maxChill)),
      maxChill,
      w: new Float64Array(5),
      f: 0,
      glare: 0,
      mult: 1,
      shadeTicks: 0,
      litTicks: 0,
      x5Ticks: 0,
      phewOpen: true,
      highChillTick: (cfg.startChill ?? maxChill) >= TUNING.phew.armChill ? 0 : -1e9,
      litSince: -1,
      shaderId: -1,
      lastShaderId: -1,
      lastShaderName: '',
      lastShaderTick: -1e9,
      cloudId: -1,
      rideId: -1,
      rideTicks: 0,
      glareBallId: -1,
      prevGlareBallId: -1,
      litTheta: theta0,
      swSrc: -1,
      swTheta: theta0,
      swTick: -1e9,
      swPend: -1,
      swPendDeg: 0,
      swPendTicks: 0,
      swChain: 0,
      swLastTick: -1e9,
    },
    guide: {
      now: new Uint8Array(360),
      next: new Uint8Array(360),
      glare: new Uint8Array(360),
      lit: new Uint8Array(360),
      tick: 0,
      sunUp: false,
    },
    world,
    stats: freshStats(day),
    hourGlyphs: [[]],
    hourLit: 0,
    hourHot: false,
    history: new Float64Array(TUNING.history.capacity * 4),
    historyCount: 0,
    nextHistoryY: 0,
    recent: new Float64Array(TUNING.death.recentTicks * 4),
    recentCount: 0,
    events: [],
    death: null,
    flakesToday: 0,
    captured: new Set(),
    glaredBalls: new Set(),
    lessonOn: false,
    lessonTicks: 0,
    lessonFrom: -1,
    lessonSwung: false,
    lessonShade: 0,
    lessonGrace: 0,
  };
  syncTime(s);
  s.nextHistoryY = s.nubs.y;
  ensureGenerated(world, s.nubs.y + ahead);
  computeCoverage(s);
  updateGuide(s);
  return s;
}
