// Public API of the deterministic core (see README.md in this folder). Game, render, audio, UI and
// meta code should import from here rather than from individual core modules.

// Configuration and constants
export { TUNING } from '../config/tuning.ts';
export {
  COMFORT_MAX,
  COMFORT_RUNGS,
  COMFORT_STEPS,
  comfortAfterRun,
  dayParams,
  effectiveNoonCloud,
  isWarmup,
  PROFILES,
  rungConfig,
  STANDARD_WARMUP,
} from '../config/days.ts';
export type { BiomeId, ComfortPrev, ComfortRung, DayParams, DayPlan, NoonCloud, ProfileId, ProfileParams, RungConfig, SkyParams } from '../config/days.ts';
export { FORECAST_IDS, FORECAST_TUNING, FORECASTS, forecastFits, PLAN_START_DATE } from '../config/forecasts.ts';
export type { ForecastId, ForecastInfo, ForecastTuning } from '../config/forecasts.ts';
export { BALL_Z, CASTER_KINDS, SUNFLOWER } from '../config/casters.ts';
export type { CasterKind } from '../config/casters.ts';
export {
  buildCampaign,
  CAMPAIGN_LEVELS,
  CHAPTER_COUNT,
  CHAPTERS,
  chapterOf,
  CONCEPT_CONFLICTS,
  CONCEPT_IDS,
  CONCEPTS,
  conceptsCompatible,
  DARE_OF,
  featMet,
  featValue,
  foldTuning,
  goalMet,
  goalValue,
  isBossFinale,
  LEVEL_COUNT,
  levelDef,
  LEVELS_PER_CHAPTER,
  ALL_MECHANICS,
  MECHANIC_CONCEPTS,
  mechanicsOf,
  relaxedGoalFor,
  softFailMisses,
  SOFT_FAIL_MISSES,
  starsFor,
  TEACH_LEVELS,
  teachLevel,
} from '../config/campaign.ts';
export type {
  Chapter,
  Concept,
  ConceptId,
  ConceptKind,
  ConceptLevel,
  DayTuning,
  FeatKind,
  FeatSpec,
  GoalKind,
  LevelDef,
  LevelBake,
  LevelFlare,
  LevelStats,
  Mechanics,
} from '../config/campaign.ts';
// Elementals (docs/ELEMENTALS.md §4.2-§4.3): the heroes and the Trials.
export { HERO_IDS, HEROES, SMOTHER_TIP } from '../config/heroes.ts';
export type { AbilityKind, HeroDeath, HeroFace, HeroId, HeroInfo } from '../config/heroes.ts';
export {
  anyLevelDef,
  isTrialId,
  levelShort,
  levelTag,
  TRIAL_BASE,
  TRIAL_COUNT,
  TRIAL_IDS,
  trialDareValue,
  trialDef,
  trialLevel,
  TRIALS,
  trialStars,
} from '../config/trials.ts';
export type { TrialDareKind, TrialDef, TrialDuo, TrialRelay } from '../config/trials.ts';

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
  exactClock,
  hourTicks,
  hudClock,
  minutesOfDay,
  nightLength,
  nightTicks,
  noonBannerTick,
  noonPassedTick,
  scoreMinutes,
  tickAtMinute,
  timeAtY,
  yAtDayTick,
  yAtTime,
} from './clock.ts';
export type { YTime } from './clock.ts';
export { MINUTES_PER_DAY, formatScore, formatTimeOfDay, formatTimeOfDay10, splitMinutes } from './format.ts';

// Deterministic maths and randomness
export { angleDiff, atan2D, cosD, sinD, smoothstep, tanD, wrapDeg } from './dmath.ts';
export { Rng, hashString, rngFor, splitmix32, xmur3 } from './rng.ts';

// World objects, geometry and shadows
export {
  BUD_ID_BASE,
  FLAKE_ID_BASE,
  FLARE_DROPPED,
  FLARE_KEPT,
  FLARE_PENDING,
  PICKUP_ALIVE,
  PICKUP_MELTED,
  PICKUP_TAKEN,
  RUNTIME_ID_BASE,
  SEED_ID_BASE,
  SNAP_ID_BASE,
} from './objects.ts';
export type {
  Caster,
  Cloud,
  CloudKind,
  DiscPart,
  Flare,
  FlareState,
  GazingBall,
  Part,
  Pickup,
  Bud,
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
  queryBuds,
  validatedY,
} from './gen/world.ts';
export type { ChunkLit, World, WorldStats } from './gen/world.ts';
export {
  biomeAtY,
  firstTownDay,
  flareLift,
  keptFlares,
  liftElevation,
  liftOf,
  noonHeatAt,
  paramsAt,
  planDay,
  worldDayAtY,
  worldElevation,
  worldDayStartY,
  worldPlan,
  worldTimeAtY,
  worldYAtDayTick,
  worldYAtTick,
  worldYAtTime,
} from './gen/plan.ts';
export { ECLIPSE_FADE_TICKS, ECLIPSE_SEC, eclipseAt } from './gen/world.ts';
export { deltaForSlot, jobRows } from './gen/validator.ts';
export type { ValidationJob } from './gen/validator.ts';
export { campaignConfig, levelOutcome, levelProgress, minuteStart, resolveLevelConfig } from './level.ts';

// Simulation
export { createRun, prepareRun, prepareSome } from './sim/create.ts';
export type { RunBuild } from './sim/create.ts';
export { step } from './sim/step.ts';
export { NO_INPUT, V16_ALL, V16_NONE, V16_RULES, V16_SHIP } from './sim/types.ts';
export type { GuideState, InputFrame, NubsState, Phase, RunConfig, SimState, SunMode, SunState, V16Rules } from './sim/types.ts';
export type {
  DeathCause,
  DeathInfo,
  HourGlyph,
  RunLevel,
  RunMode,
  RunResult,
  RunStats,
  SimEvent,
  SimEventName,
} from './sim/events.ts';
export { sunMaxRate } from './sim/sun.ts';
export { debugRing, effectiveDrain } from './sim/nubs.ts';
export { budFacing, coolLine, debugBloom, SNAP_TICKS, snapGauge, whiteLine } from './sim/mechanics.ts';
export { meltBudgetOf } from './sim/pickups.ts';
export { debugFlare, flarePhaseAt } from './sim/flares.ts';
export { glassInWindow } from './sim/guide.ts';
export { createSnap, lerpSnap, takeSnap } from './sim/snapshot.ts';
export { abilityHero, heroHealth, heroRates, heroStart, nextTagHero, nextTagTicks, relayY, tagLocked } from './sim/heroes.ts';
export type { RenderSnap } from './sim/snapshot.ts';
export { historyAt, historyLength } from './sim/history.ts';
export { buildRunResult } from './sim/result.ts';
export { hashState } from './sim/hash.ts';
export { createReplay, playReplay, recordFrame } from './sim/replay.ts';
export type { Replay } from './sim/replay.ts';
export { BOT_KINDS, BOT_POLICIES, createBot } from './sim/bots.ts';
export type { Bot, BotKind, BotOptions, BotPolicy } from './sim/bots.ts';
export { headlessConfig, runBot, runHeadless } from './sim/headless.ts';
export { deathRecap, deathTip } from './sim/recap.ts';
export type { DeathRecap } from './sim/recap.ts';
export { createParJob } from './sim/par.ts';
export type { ParJob } from './sim/par.ts';
