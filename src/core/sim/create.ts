// createRun(): a fresh run in the 'hold' phase (V1_PLAN §8.3).

import { TUNING } from '../../config/tuning.ts';
import { dayTicks } from '../clock.ts';
import { paramsAt, worldYAtDayTick } from '../gen/plan.ts';
import { ensureGenerated, createWorld, generateSome, type World } from '../gen/world.ts';
import { resolveLevelConfig } from '../level.ts';
import { syncTime } from './step.ts';
import { computeCoverage } from './nubs.ts';
import { updateGuide } from './guide.ts';
import type { RunStats } from './events.ts';
import type { RunConfig, SimState } from './types.ts';

function freshStats(day: number, chill: number): RunStats {
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
    minChill: chill,
    blooms: 0,
    snaps: 0,
    deepSeconds: 0,
    // v1.6 (docs/V1_6_PLAN.md §10): always filled; their owners count them.
    multTicks: 0,
    x5Ticks: 0,
    multDowns: 0,
    ringTricks: 0,
    frostEarnedH: 0,
    frostSpilledH: 0,
    snapCashH: 0,
    gardenBlooms: 0,
    snapLands: 0,
    snapLandsOwn: 0,
    brittleSeen: 0,
    brittleSaved: 0,
    clustersSaved: 0,
    flaresSeen: 0,
    parries: 0,
    deepTicks: 0,
    earnedSnapSavedTicks: 0,
    cloudsRidden: 0,
    gateDeep: 0,
    flipTicks: 0,
    lockHeld: 0,
    lockWindows: 0,
    gustHeld: 0,
    gustWindows: 0,
  };
}

/** The frost meter at the start: full on the Cold Snap's teaching level, half on later levels, else empty. */
function startFrost(w: World): number {
  if (!w.level) return 0;
  return w.level.introduces === 'snap' ? 1 : TUNING.frost.campaignStart;
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
export function prepareRun(cfg0: RunConfig): RunBuild {
  const cfg = resolveLevelConfig(cfg0);
  const { day, dayTick } = startOf(cfg);
  const world = createWorld(cfg);
  return {
    cfg: { ...cfg },
    world,
    targetY: worldYAtDayTick(world, day, dayTick) + TUNING.world.hardAhead,
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
export function createRun(cfg0: RunConfig, build?: RunBuild, ahead: number = TUNING.world.hardAhead): SimState {
  const cfg = resolveLevelConfig(cfg0);
  const world = build ? build.world : createWorld(cfg);
  const { day, dayTick } = startOf(cfg);
  const params = paramsAt(world, day);
  const maxChill = params.maxChill;
  const chill = Math.min(maxChill, Math.max(1, cfg.startChill ?? maxChill));
  const theta0 = world.theta0;
  const frost = world.mech.snap ? Math.min(1, Math.max(0, cfg.startFrost ?? startFrost(world))) : 0;
  const s: SimState = {
    cfg: { ...cfg },
    params,
    mods: world.mods,
    level: world.level,
    eclipse: 0,
    eclipseOn: false,
    moonlit: world.mods.has('moonlit'),
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
    sun: { theta: theta0, lag: 0, omega: 0, omegaRel: 0, mode: 'idle', detent: Math.floor(theta0 / TUNING.sun.detentDeg), dTheta: 0, keyTicks: 0, keySign: 0, gust: 0, locked: false },
    nubs: {
      x: 0,
      y: 0,
      chill,
      maxChill,
      w: new Float64Array(5),
      f: 0,
      glare: 0,
      mult: 1,
      frost,
      deep: false,
      deepTick: -1e9,
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
      ringCharge: 0,
      litStartMult: 1,
      budGrewTick: -1e9,
      streak: 0,
      swFresh: new Int32Array(2 * TUNING.ring.freshSlots),
      swFreshN: 0,
      frostH: Math.floor(100 * frost),
      swingFrostTick: -1e9,
    },
    snapTicks: 0,
    snapCloudId: -1,
    snapBankH: 0,
    snapExt: 0,
    snapBlooms: 0,
    landTicks: -1,
    landHold: 0,
    landSrc: -1,
    clusterId: -1,
    clusterTaken: 0,
    clusterBroken: false,
    flareIdx: 0,
    flareId: -1,
    flarePhase: 0,
    flareLit: 0,
    flareTicks: -1,
    guide: {
      now: new Uint8Array(360),
      next: new Uint8Array(360),
      glare: new Uint8Array(360),
      lit: new Uint8Array(360),
      bud: new Uint8Array(360),
      tick: 0,
      sunUp: false,
      deep: new Uint8Array(360),
      flake: new Uint8Array(360),
      land: new Uint8Array(360),
      flare: new Uint8Array(360),
      flareTicks: -1,
    },
    world,
    stats: freshStats(day, chill),
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
