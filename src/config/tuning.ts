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
    /**
     * Keyboard rotation (°/s): a held key ramps linearly from keyRateMin to keyRateMax over
     * keyRampTicks held ticks (a 1-tick tap turns 2.5°); fine keys (Shift, |key| 2) turn at keyFine.
     */
    keyRateMin: 150,
    keyRateMax: 330,
    keyRampTicks: 15,
    keyFine: 90,
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
    /** Continuous lit ticks that reset the multiplier (0.15 s)… */
    resetLitTicks: 9,
    /**
     * …unless θ has turned ≥ graceDeg since the lit stretch began: then the reset waits for
     * graceLitTicks (0.35 s), so a lit stretch that ends in a SWING keeps the multiplier.
     */
    graceDeg: 30,
    graceLitTicks: 21,
  },

  /**
   * SWING: shade handed from one source (caster or cloud) to another by turning the sun ≥ minDeg,
   * with at most maxGapTicks lit ticks between them, confirmed once the new source has kept Nubs
   * fully shaded for confirmTicks. SWINGs within chainTicks of the last one chain (×2 … ×chainMax)
   * and pay the chain in Snow. minDeg 38 (45 in v1.1) puts a reactive player at 1-2 SWINGs a
   * minute (it was 0.7) and the human model at about 2.
   */
  swing: { minDeg: 38, maxGapTicks: 20, confirmTicks: 15, chainTicks: 180, chainMax: 5 },

  /**
   * First-run lesson: from `go` until the lesson is passed (a ≥ swingDeg turn after Nubs was lit,
   * then shadeTicks of full shade), for at most maxDaylightTicks of daylight, Chill never drops
   * below floor. When it ends in daylight the floor stays at full height until holdTicks of daylight
   * (9:00 AM on Day 1), then fades to 0 over fadeTicks (10 s): passing the lesson at 5 s no longer
   * leaves a sweating Nubs at 12 Chill under the full drain.
   */
  lesson: { floor: 12, swingDeg: 15, shadeTicks: 15, maxDaylightTicks: 1500, holdTicks: 750, fadeTicks: 600 },

  /** PHEW (V1_PLAN §5.3). The threshold T comes from the profile (days.ts). */
  phew: {
    /** Armed only if Chill was ≥ this within the window. */
    armChill: 40,
    armWindowTicks: 180,
    /** The latch re-opens once Chill rises above this. */
    relatchChill: 50,
    snow: 3,
  },

  /**
   * v1.5 Sunflower buds (docs/V1_5_PLAN.md §2A). A bud grows while the sun shines from within
   * ±faceTol° of its face (whole degrees) and it stands within [Nubs − reachBehind, Nubs + reachAhead]
   * of y: +1/growSec per second, else −decay per second; at 1 it blooms into a sunflower (+snow).
   * Placement: one bud every U(gapMin, gapMax) s of walking while t/Dl ∈ [tMin, tMax], the gap
   * divided by min(maxMore, 1 + perDay·(day − 1)), each moved into the nearby gap between casters;
   * lat u from the centerline; aimed (aimBack/aimJitter below) and never within faceTol +
   * avoidTheta0 of θ0 (an idle sun never grows one).
   */
  buds: {
    faceTol: 15,
    growSec: 0.8,
    decay: 0.8,
    snow: 5,
    reachAhead: 360,
    reachBehind: 30,
    gapMin: 3,
    gapMax: 5,
    perDay: 0.08,
    maxMore: 1.5,
    tMin: 0.06,
    tMax: 0.94,
    latMin: 25,
    latMax: 42,
    /**
     * A bud faces the sun azimuth that throws its bloom's shadow back across the trail aimBack u
     * (U(min, max)) before it, ± aimJitter°: "light it from there, its shadow falls here".
     */
    aimBackMin: 0,
    aimBackMax: 120,
    aimJitter: 20,
    avoidTheta0: 15,
    /** A bud moves up to gapSeek s of walking from its cursor spot into the widest gap between casters. */
    gapSeek: 0.6,
    /** The first bud comes this many seconds of walking after the run's start (then the window rules). */
    startDelay: 2,
    /** A growing bud emits budGrow every eventTicks ticks (feedback only). */
    eventTicks: 6,
  },
  /**
   * v1.5 Cold Snap (§2B). The frost meter (0..1) fills perShadeSec per second of full daylight
   * shade (× deep.frostMul in deep shade), perFlake per flake or crystal, perSwing per SWING and
   * perBloom per bloom; never while a snap is on. Full: a snap input casts a frosty cloud (z 0, so
   * its shadow lies right under it whatever θ is) that rides over Nubs for snapSec.
   */
  frost: {
    perShadeSec: 0.004,
    perFlake: 0.012,
    perSwing: 0.05,
    perBloom: 0.12,
    snapSec: 3,
    /**
     * Journey levels are short (17-50 s): after the Cold Snap's teaching level (which starts full)
     * each level starts with the meter at campaignStart.
     */
    campaignStart: 0.5,
    /** The snap cloud's radii (ry = rx · cloud.ryRatio). */
    snapRx: 64,
  },
  /**
   * v1.5 Deep shade (§2C): fully shaded with two or more sources (casters or clouds) over the
   * center sample. Chill regen, multiplier charge and frost charge × these. deepEnter fires on entry
   * after at least reenterTicks out of deep shade.
   */
  deep: {
    regenMul: 2,
    multMul: 2,
    frostMul: 4,
    reenterTicks: 60,
  },

  /**
   * v1.6 Flow Ring (docs/V1_6_PLAN.md §2.1; CORE-1 tunes it). Charge in integer units: a full-shade
   * daylight tick adds shadeUnits (× deepMul in deep shade); from the (freeLitTicks + 1)-th lit tick
   * of a stretch each tick costs bleedK[m − 1]·Σw; need[m − 1] levels x(m) up to x(m + 1). Tricks
   * pay `trick` (every streakEvery-th pickup without a melt pays streakTrick); a SWING is fresh
   * when its source is neither end of a SWING in the last freshTicks (freshSlots endpoint pairs
   * kept); flake and crystal Snow use min(m, snowCap).
   */
  ring: {
    shadeUnits: 5,
    deepMul: 2,
    freeLitTicks: 6,
    // Calibrated (§11 Step 2, at the top of their ranges): need +20%, x5's bleed 24. With the Frost
    // Bank shipped off a snap no longer cashes the ring in, so x5 needs the margin (16% of the reactive
    // bot's daylight, gate ≤ 20%); x5 still lasts 0.4 s of full sun and 2 s of edge-riding.
    need: [1080, 1440, 2160, 2880],
    bleedK: [2, 3, 6, 12, 24],
    trick: 600,
    streakTrick: 300,
    streakEvery: 3,
    freshTicks: 180,
    freshSlots: 8,
    snowCap: 3,
  },
  /**
   * v1.6 Frost Bank (§2.2; CORE-1). The meter in integer hundredths, 0..capH (two snaps); a snap
   * costs costH; income per act (bloom, fresh SWING at most once per swingEveryTicks, glass cluster
   * saved, own landing, flare parry); the cash-in pays cashPerLevelH per ring level above x1. Start:
   * runStartH (Endless, Daily, challenge), campaignStartH (Journey), teachStartH (the Cold Snap's
   * teaching level); lesson runs start at 0.
   */
  bank: {
    /**
     * Whether the Frost Bank ships (core V16_SHIP.bank reads it; the Journey's snapSave Dare is
     * sized from the meter that ships). Off since the v1.6 calibration (core README §16.3).
     */
    ships: false,
    capH: 200,
    costH: 100,
    bloomH: 25,
    swingH: 5,
    swingEveryTicks: 180,
    clusterH: 10,
    landH: 5,
    parryH: 10,
    cashPerLevelH: 10,
    runStartH: 0,
    campaignStartH: 50,
    teachStartH: 100,
  },
  /**
   * v1.6 Frost Garden and Landing (§2.4; CORE-1). Under a snap, buds within [y − 30, y + reach]
   * grow × growMul; each bloom adds extendTicks (at most extendCapTicks per snap); income is banked
   * (at most bankCapH per snap); the cloud re-aims every reaimTicks. A landing must start within
   * landWindowTicks of snapEnd and hold landHoldTicks.
   */
  garden: {
    growMul: 2,
    reach: 420,
    extendTicks: 30,
    extendCapTicks: 60,
    bankCapH: 30,
    reaimTicks: 30,
    landWindowTicks: 20,
    landHoldTicks: 15,
  },
  /**
   * v1.6 Brittle (glass) flakes (§2.3; CORE-2). Glass flakes melt after meltBudget lit seconds; the
   * contest test tries the shifts (s of walking) keeping minGapSec to the neighbouring clusters;
   * quotas are shares of eligible clusters (profile 3; profile 2 half); a contested cluster needs
   * C1 ≥ floor + marginChill and costMin ≤ C0 − C1 ≤ costMax (the shift nearest costAim wins);
   * tailSec of slots after the melt window must lie in the job.
   */
  brittle: {
    meltBudget: 0.8,
    shiftsSec: [0, -0.5, 0.5, -1, 1],
    quotaDay1: 0.25,
    quotaLater: 0.35,
    marginChill: 10,
    costMin: 12,
    costMax: 40,
    costAim: 25,
    tailSec: 1.5,
    minGapSec: 3,
    /**
     * Chill a glass cluster saved whole gives back at once (on top of its flakes' own): a reward that
     * matters for survival while the Frost Bank ships off (its +clusterH frost lands on a meter that
     * is often full). Below the contest's least detour cost (costMin), so glass is never free.
     */
    saveChill: 10,
  },
  /**
   * v1.6 Heat Flares (§2.5; CORE-2). Shape in ticks (warning, rise with a 3x² − 2x³ smoothstep,
   * hold, fall); rise windows as shares of the day (t/Dl), gapSec apart; ε_world clamped to
   * εnoon − epsMargin (Endless) or journeyEpsCap (Journey). Keep test: a fixed sun angle leaves Nubs
   * lit on at most parryMaxLit of the hold's ticks (counted tick by tick, the sim's parry rule, so
   * the telegraph names a parry that holds; fix round 2: the plan's turn-limited path on 85% of the
   * steps, then on all of them, kept flares that no telegraphed angle parried), and fewer than
   * keepMovedShare of the safe bins stay safe; otherwise shifted by shiftsSec, then dropped.
   * shiftsSec runs to ±5 s, past the plan's ±1 s (a deviation awaiting the integrator; core README
   * §16.3), but an Endless rise never leaves its window of `windows`, so the list amounts to
   * "anywhere in the window, nearest the drawn rise first". A Journey flare ends finishMarginSec
   * before the finish line; on a teaching level the next warning waits teachGapSec after a flare's
   * end. A parry is ≤ parryMaxLit lit hold ticks (+snow Snow); during the rise and hold buds grow ×
   * budMul and flakes melt × meltMul.
   */
  flare: {
    warnTicks: 120,
    warnTicksJourney: 72,
    riseTicks: 18,
    holdTicks: 42,
    fallTicks: 30,
    windows: [
      [0.2, 0.32],
      [0.68, 0.8],
    ],
    gapSec: 8,
    epsMargin: 2,
    journeyEpsCap: 78,
    parryMaxLit: 4,
    keepMovedShare: 0.5,
    finishMarginSec: 1,
    teachGapSec: 1.5,
    shiftsSec: [0.5, -0.5, 1, -1, 1.5, -1.5, 2, -2, 2.5, -2.5, 3, -3, 3.5, -3.5, 4, -4, 4.5, -4.5, 5, -5],
    snow: 5,
    budMul: 3,
    meltMul: 2,
    /**
     * Chill a lit tick of a flare's hold costs on top of the drain (a miss bites; the validator's DP
     * charges it on the hold's steps, so every world stays survivable with it).
     */
    burnPerLitTick: 0.4,
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

  /**
   * Hour glyph thresholds (V1_PLAN §5.5 as recalibrated in fix round 2): the share of an in-game
   * hour Nubs spent lit (∫f·dt over the hour's length). Cool ≤ 15%, hot > 45% (or Chill < 25 at any
   * moment), warm between. The old 0.2 s / 1.0 s marks (5% / 24% of a Day-1 hour) made 83% of an
   * oracle run's hours and 61-66% of a human-like player's hot: every shade hand-off crosses some
   * sun, and Chill holds steady at about 35% lit (drain 55 against regen 30). Now, at profile 3 over
   * 30 seeds (cool/warm/hot %): oracle 7/75/18, reactive 57/37/6, humanDial 19/62/20, novice 21/59/19.
   */
  glyph: { coolMax: 0.15, hotMin: 0.45, hoursPerDay: 12 },

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
    /**
     * Day-1 parked noon cloud, indexed by NoonCloud (days.ts): it rides with Nubs over this clock
     * window (minutes since 6 AM).
     */
    parkedWindows: [
      [0, 0],
      [300, 420],
      [330, 390],
    ],
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
    /**
     * A cloud is blamed only if it fully covered Nubs within ±(cloudTurnRate × cloudTurnSec) = ±60°
     * of θ(−60) (GDD §10 row 3: "within ±60° of the current θ"). At 180 nearly any cloud on screen
     * qualified, so plain gaps were misattributed to clouds the player could not have reached.
     */
    cloudTurnRate: 60,
    cloudTurnSec: 1,
    gapLastSec: 5,
    gapAheadSec: 0.5,
    /** Ring length of per-tick (θ, lit, glare) records. */
    recentTicks: 128,
  },

  /**
   * Death recap tips (sim/recap.ts): "thick teal was N° away" needs ≥ exposureSec in the sun at the
   * end and shade within maxAwayDeg (relaxed from 1.5 s and 90° in fix round 1: most melts used to
   * fall through to the generic line); "short dips add up" needs litShare of the last 10 s lit (0.35,
   * not the planned 0.5: the human model's deaths at standard rules are mostly flicker deaths at
   * 35-50% lit); the noon line covers deaths noonFrom-noonTo minutes after 6 AM.
   */
  recap: { exposureSec: 0.5, maxAwayDeg: 120, litShare: 0.35, noonFrom: 300, noonTo: 420 },

  /** Headless bots (V1_PLAN §13). Turn rates in °/s. */
  bots: {
    novice: { lagTicks: 12, rate: 180, blur: 6, penalty: 0.2 },
    /**
     * v1.5 mechanics: the reactive bot adds budWeight on gold bins that are safe now (anywhere while
     * Chill ≥ budChill), and snaps
     * when lit with Chill < snapChill and no safe bin within ±snapNearDeg (or Chill < snapLast).
     */
    reactive: { lagTicks: 0, rate: 200, blur: 4, penalty: 0.5, nextWeight: 1, nowWeight: 2, budWeight: 1.5, budChill: 55, snapChill: 40, snapNearDeg: 45, snapLast: 25 },
    /**
     * v1.5 mechanics: the oracle plans with the run's sunflowers and snap cloud (stepLitLive), adds
     * up to budBonus (Chill units, fading to 0 budReachDeg away from the nearest gold bin) while the
     * slack is ≥ budSlack and the bin is shaded next step (or Chill ≥ budSpare of the tank, never on
     * a flake-goal level), and snaps when its best slack falls below snapSlack, or when lit with
     * Chill below snapChill (campaign: whenever its next step is lit, for the cool-run star).
     */
    oracle: { rate: 240, horizonSteps: 40, planBins: 18, slackCap: 30, penalty: 0.02, margin: 1, budBonus: 6, budSlack: 12, budReachDeg: 90, budSpare: 0.6, snapSlack: 6, snapChill: 50 },
    /**
     * Seeded human model (tooling only, never an acceptance gate): reaction lag U(lagMin, lagMax)
     * per decision, aim error N(0, aimSigma)° plus a ±N(0, gainSigma) over/undershoot, min-jerk
     * drags lasting moveBase + moveMsPerDeg·|Δθ| ms, then a settle pause; lifts at ω = 0. The
     * humanDial variant reads lasting arcs (≥ lastingMinArc°) on lastingShare of its decisions.
     */
    human: {
      lagMinMs: 250,
      lagMaxMs: 350,
      aimSigmaDeg: 10,
      gainSigma: 0.2,
      settleMs: 120,
      moveBaseMs: 120,
      moveMsPerDeg: 0.9,
      lastingShare: 0.5,
      lastingMinArc: 20,
    },
  },
};

export const TUNING = deepFreeze(tuning);
export type Tuning = typeof TUNING;
