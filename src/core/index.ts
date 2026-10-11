// Public API of the deterministic core (see README.md in this folder). Game, render, audio, UI and
// meta code should import from here rather than from individual core modules.

// Configuration and constants
export { TUNING } from '../config/tuning.ts';
export { dayParams, PROFILES } from '../config/days.ts';
export type { BiomeId, DayParams, ProfileId, ProfileParams } from '../config/days.ts';
export { BALL_Z, CASTER_KINDS } from '../config/casters.ts';
export type { CasterKind } from '../config/casters.ts';

// Clock and formatting
export {
  DT,
  EPS_DAWN,
  TICK_HZ,
  dayLength,
  dayStartTick,
  dayStartY,
  dayTicks,
  elevation,
  elevationAt,
  exactClock,
  hourTicks,
  hudClock,
  minutesOfDay,
  nightLength,
  nightTicks,
  noonBannerTick,
  noonPassedTick,
  scoreLabel,
  scoreMinutes,
  timeAtY,
  yAtDayTick,
  yAtTime,
} from './clock.ts';
export type { YTime } from './clock.ts';
export { MINUTES_PER_DAY, formatScore, formatTimeOfDay, formatTimeOfDay10, splitMinutes } from './format.ts';

// Deterministic maths and randomness
export { angleDiff, atan2D, cosD, sinD, tanD, wrapDeg } from './dmath.ts';
export { Rng, hashString, rngFor, splitmix32, xmur3 } from './rng.ts';

// World objects, geometry and shadows
export { PICKUP_ALIVE, PICKUP_MELTED, PICKUP_TAKEN } from './objects.ts';
export type {
  Caster,
  Cloud,
  CloudKind,
  DiscPart,
  GazingBall,
  Part,
  Pickup,
  PickupKind,
  PickupState,
  PrismPart,
  SlabPart,
} from './objects.ts';
export {
  cloudAlive,
  cloudCenter,
  cloudOffset,
  cloudShadow,
  cloudVisibility,
  glareActive,
  glareCenter,
  glareOffset,
  partShadow,
  shadowLength,
} from './shadows.ts';
export { BINS, SAMPLES, SAMPLE_DX, SAMPLE_DY, binOf } from './intervals.ts';
export { trailSlope, trailX, tutorialStraightRange } from './trail.ts';
export type { Trail } from './trail.ts';

// World store and generation
export {
  ensureGenerated,
  generateSome,
  queryBalls,
  queryCasters,
  queryClouds,
  queryPickups,
  validatedY,
} from './gen/world.ts';
export type { ChunkLit, World, WorldStats } from './gen/world.ts';
export { biomeAtY, dayAtY } from './gen/placer.ts';

// Simulation
export { createRun, prepareRun, prepareSome } from './sim/create.ts';
export type { RunBuild } from './sim/create.ts';
export { step } from './sim/step.ts';
export { NO_INPUT } from './sim/types.ts';
export type { GuideState, InputFrame, NubsState, Phase, RunConfig, SimState, SunMode, SunState } from './sim/types.ts';
export type {
  DeathCause,
  DeathInfo,
  HourGlyph,
  RunMode,
  RunResult,
  RunStats,
  SimEvent,
  SimEventName,
} from './sim/events.ts';
export { sunMaxRate } from './sim/sun.ts';
export { createSnap, lerpSnap, takeSnap } from './sim/snapshot.ts';
export type { RenderSnap } from './sim/snapshot.ts';
export { historyAt, historyLength } from './sim/history.ts';
export { buildRunResult } from './sim/result.ts';
export { hashState } from './sim/hash.ts';
export { createReplay, playReplay, recordFrame } from './sim/replay.ts';
export type { Replay } from './sim/replay.ts';
export { BOT_KINDS, createBot } from './sim/bots.ts';
export type { Bot, BotKind } from './sim/bots.ts';
export { headlessConfig, runBot, runHeadless } from './sim/headless.ts';
