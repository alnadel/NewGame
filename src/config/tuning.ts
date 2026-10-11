// Every gameplay constant that is not per-day lives here (per-day values live in days.ts).
// Pure data: this module imports nothing, and src/core reads it as the single source of truth.
// Units: u (world units), s (seconds), ° (degrees), Chill points. "Ticks" are 1/60 s sim steps.

type DeepReadonly<T> = { readonly [K in keyof T]: T[K] extends object ? DeepReadonly<T[K]> : T[K] };

function deepFreeze<T extends object>(o: T): DeepReadonly<T> {
  for (const v of Object.values(o)) if (typeof v === 'object' && v !== null) deepFreeze(v as object);
  return Object.freeze(o) as DeepReadonly<T>;
}

const tuning = {
  /** Fixed timestep. Slow-mo/hit-stop change ticks per real second, never DT. */
  tick: { hz: 60, dt: 1 / 60 },

  /** Visible world width (u). The camera never pans horizontally. */
  viewWidth: 360,

  /**
   * Run start. The touch (or key) that starts a run opens a short "ready" beat: the sun answers the
   * finger at once, but the clock, Nubs and Chill wait this many ticks, so every run opens with
   * time to aim instead of a scramble (the start hut's θ0 shade only lasts ~0.2 s of walking).
   * The clock is frozen, so the world, scores and the idle bot are unchanged by it.
   */
  start: { readyTicks: 48 },

  /** Sun control (V1_PLAN §3.3). */
  sun: {
    /** Follow rate toward the finger target (°/s). */
    maxRate: 600,
    /** Follow rate while the sun is low (ε < lowSunEps), photosensitivity cap. */
    maxRateLowSun: 450,
    lowSunEps: 15,
    /** Follow rate under reduced motion. */
    maxRateReduced: 300,
    /** Release angular velocity clamp (°/s). */
    releaseCap: 360,
    releaseCapReduced: 180,
    /**
     * Only genuine flicks coast (K1). The release speed (°/s of requested angle over the last
     * ~80 ms) is scaled by smoothstep(flickMin, flickFull, |release|) before the cap: below
     * flickMin a lift stops the sun where the finger left it (a slow drag's tail never drifts on),
     * from flickFull up it coasts at full speed, and in between it eases in (400 → 200°/s).
     */
    flickMin: 200,
    flickFull: 600,
    /** Coasting friction per tick: e^(−3.5/60). */
    friction: 0.9433354499,
    /** Coasting stops below this |ω| (°/s). */
    stopOmega: 5,
    /** A touch-down while |ω| exceeds this emits `catch`. */
    catchOmega: 90,
    /** Keyboard rotation rate (°/s). */
    keyRate: 180,
    /** Detent spacing (°). Feedback only, never a snap. */
    detentDeg: 15,
    /** Chasing hands off to coasting when the remaining lag is below this (°). */
    chaseDoneDeg: 1,
  },

  /** Shadow geometry (GDD §2.4, V1_PLAN §2.7). */
  shadow: {
    /** Max ground shadow length of casters (u). */
    capLen: 520,
    /** Max shadow offset of clouds (u). */
    cloudCap: 900,
    /** Cloud altitude (u). */
    cloudZ: 300,
  },

  /** Gazing-ball glare (V1_PLAN §7.3). */
  glare: {
    radius: 22,
    mirrorZ: 40,
    /** Max distance of the glare spot from its ball (u). */
    cap: 160,
    /** Glare is active only while ε ≥ this (°). */
    minEps: 8,
  },

  /** Nubs, coverage and Chill (V1_PLAN §5.1). */
  nubs: {
    /** Coverage samples sit at the center and ±this along x and y (u). */
    sampleOffset: 5.5,
    /** Pickups are collected within this distance of Nubs' center (u). */
    collectRadius: 14,
    maxChill: 100,
    /** Daylight regeneration at f = 0 (Chill/s). */
    regen: 30,
    /** Night regeneration (Chill/s). */
    nightRegen: 30,
    /** `lowChill` threshold; also turns an hour glyph hot. */
    lowChill: 25,
  },

  /** Frost multiplier (V1_PLAN §5.2). Timers are integer ticks so they never drift. */
  mult: {
    max: 5,
    /** Continuous full-shade ticks per level (4.0 s). */
    stepTicks: 240,
    /** Continuous lit ticks that reset the multiplier (0.15 s). */
    resetLitTicks: 9,
  },

  /** PHEW (V1_PLAN §5.3). The threshold T comes from the profile (days.ts). */
  phew: {
    /** Armed only if Chill was ≥ this within the window. */
    armChill: 40,
    armWindowTicks: 180,
    /** The latch re-opens once Chill rises above this. */
    relatchChill: 50,
    snow: 3,
  },

  /** Pickups (V1_PLAN §5.4). */
  pickups: {
    flakeSpacing: 24,
    /** Cluster gap in seconds of walking, U(min, max). */
    clusterGapMin: 5,
    clusterGapMax: 8,
    /** Clusters only while t/Dl is inside this range. */
    clusterTMin: 0.08,
    clusterTMax: 0.92,
    /** A pickup melts only while it is at most this many seconds of walking ahead of Nubs. */
    meltAheadSec: 1.6,
    /**
     * Lit seconds (×2 in glare) until a flake or crystal melts (GDD §5.4: 1.2). Never above 1.3: a
     * flake only melts while it is 14 u to meltAheadSec of walking ahead (≈ 1.4 s on Day 1), so at
     * 1.4 or more it must stay lit for that whole window and flakes become effectively unmeltable.
     */
    meltBudget: 1.2,
    flakeChill: 6,
    crystalSnowMult: 5,
    crystalChill: 35,
    crystalTMin: 0.3,
    crystalTMax: 0.7,
    flowerSpacing: 60,
    flowerSnow: 2,
  },

  /** Hour glyph thresholds (V1_PLAN §5.5), lit seconds per in-game hour. */
  glyph: { coolMax: 0.2, warmMax: 1.0, hoursPerDay: 12 },

  /** Trail (V1_PLAN §7.1). Control point i sits at y = cpY0 + cpSpacing·i. */
  trail: {
    cpSpacing: 120,
    cpY0: -600,
    /** x(i+1) = clamp(x(i) + U(−step, step) + pull·(center − x(i)), xMin, xMax). */
    step: 70,
    pull: 0.15,
    center: 180,
    xMin: 80,
    xMax: 280,
    halfWidth: 15,
    /** Profile-0 tutorial range where the trail is straight at x = center. */
    tutorialY0: -120,
    tutorialY1: 480,
  },

  /** World generation (V1_PLAN §7.2, §7.4). */
  world: {
    chunkLen: 480,
    /** Ground footprints stay at least this far from the trail centerline (u). */
    clearance: 20,
    /** Centerline polyline sample spacing for the clearance check (u). */
    clearanceSample: 8,
    pushStep: 4,
    pushMax: 20,
    /** Minimum gap between the ground footprints of two casters (u). */
    overlapMargin: 6,
    /** Hard guarantee: validated world through nubs.y + this. */
    hardAhead: 1600,
    /** Idle-time generation target ahead of Nubs (u). */
    idleAhead: 2400,
    /** Objects entirely behind nubs.y − this are pruned. */
    pruneBehind: 900,
    /** Upper bound of |part point − caster center| over all kinds (u); used by range queries. */
    maxCasterRadius: 64,
    /** Rectangle kinds rotate by rotStep·randInt(0..rotSteps−1)°. */
    rotStep: 15,
    rotSteps: 12,
    /** Probability that the next caster switches trail side. */
    sideFlip: 0.6,
    /** Caster gap = spacing · U(gapMin, gapMax). */
    gapMin: 0.7,
    gapMax: 1.3,
  },

  /** Clouds (V1_PLAN §7.3, GDD §2.8). */
  cloud: {
    rxMin: 60,
    rxMax: 80,
    ryRatio: 0.66,
    overtakerChance: 0.5,
    overtakeBehind: 350,
    overtakeSpeedMin: 1.2,
    overtakeSpeedMax: 1.35,
    waitAhead: 450,
    waitSpeedMin: 0.65,
    waitSpeedMax: 0.8,
    driftMax: 10,
    x0Min: 60,
    x0Max: 300,
    life: 40,
    /** Render-only: lumps per cloud, U(min, max) inclusive. */
    lumpsMin: 5,
    lumpsMax: 7,
    /** Render-only: suggested fade-in/out at the ends of a cloud's life (s). */
    fade: 1.5,
    /** Profile-0 parked noon cloud: rides with Nubs over this clock window (minutes since 6 AM). */
    parkedFromMin: 300,
    parkedToMin: 420,
    /** Extra life before/after the window so it can fade in/out (s). */
    parkedLead: 3,
  },

  /** Gazing balls (V1_PLAN §7.3). */
  ball: { latMin: 40, latMax: 80 },

  /** Rescue Shade Rock and validator fallbacks (V1_PLAN §7.3, §7.4). */
  rescue: {
    /** Footprint across (x) and along (y) the trail. */
    w: 30,
    d: 30,
    /** Nearest edge distance from the centerline (u). */
    edge: 20,
    /** h = clamp(hTanK·tan ε + hBase, hMin, hMax). */
    hTanK: 40,
    hBase: 20,
    hMin: 60,
    hMax: 160,
    maxPerChunk: 8,
    /** Parked fallback cloud rides at v for this long, centered on the failure time (s). */
    parkedLife: 6,
    /** Parked fallback clouds per chunk: one per failure that survives the rocks. */
    maxParked: 2,
  },

  /** Validator DP (V1_PLAN §7.4). */
  validator: {
    /** One DP step every stepTicks sim ticks (0.1 s). */
    stepTicks: 6,
    /** Human model turn rate: bins reachable per step (180°/s × 0.1 s). */
    turnBins: 18,
    /**
     * Each chunk's DP re-runs this many steps of the previous chunk (2 s), so a failure just after
     * a chunk boundary can still be rescued where its deficit built up.
     */
    prefixSteps: 20,
  },

  /** Guide masks (V1_PLAN §6.3). */
  guide: { everyTicks: 6, aheadSec: 0.6 },

  /** Melt Map history ring (x, y, chill, f every `every` u of y). */
  history: { every: 20, capacity: 1024 },

  /** Death-line causes (V1_PLAN §10). */
  death: {
    glareWindowTicks: 60,
    glareShare: 0.5,
    cloudLookbackTicks: 60,
    /** "within ±(180°/s × 1 s) of θ(−60)". */
    cloudTurnRate: 180,
    cloudTurnSec: 1,
    gapLastSec: 5,
    gapAheadSec: 0.5,
    /** Ring length of per-tick (θ, lit, glare) records. */
    recentTicks: 128,
  },

  /** Headless bots (V1_PLAN §13). Turn rates in °/s. */
  bots: {
    novice: { lagTicks: 12, rate: 180, blur: 6, penalty: 0.2 },
    reactive: { lagTicks: 0, rate: 200, blur: 4, penalty: 0.5, nextWeight: 1, nowWeight: 2 },
    oracle: { rate: 240, horizonSteps: 40, planBins: 18, slackCap: 30, penalty: 0.02, margin: 1 },
  },
};

export const TUNING = deepFreeze(tuning);
export type Tuning = typeof TUNING;
