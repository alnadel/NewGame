// Simulation state and its inputs (V1_PLAN §3.1). Everything here is advanced only by step(); the
// renderer and session read it and never write it.

import type { LevelDef, Mechanics } from '../../config/campaign.ts';
import { TUNING } from '../../config/tuning.ts';
import type { ConceptId } from '../../config/concepts.ts';
import type { BiomeId, DayParams, NoonCloud, ProfileId } from '../../config/days.ts';
import type { ForecastId } from '../../config/forecasts.ts';
import type { World } from '../gen/store.ts';
import type { DeathInfo, HourGlyph, RunMode, RunStats, SimEvent } from './events.ts';

/** One 60 Hz tick of player input, produced by src/game/input.ts (V1_PLAN §3.1). */
export interface InputFrame {
  /** Degrees requested this tick, sign/sensitivity applied, quantized to 1/1024°. */
  dTheta: number;
  /** A pointer is held during this tick (after downEdge/upEdge are applied). */
  down: boolean;
  /** A pointer went down this tick (catch). */
  downEdge: boolean;
  /** The pointer went up this tick (release). */
  upEdge: boolean;
  /** Release angular velocity °/s on the upEdge tick, quantized to 1/64 °/s; 0 otherwise. */
  release: number;
  /** Keyboard: +1 = counter-clockwise (Left/A), −1 = clockwise (Right/D); ±2 the same, fine (Shift). */
  key: -2 | -1 | 0 | 1 | 2;
  /** v1.5: a Cold Snap was asked for this tick (a swipe down, or the Down/S key). Absent = false. */
  snap?: boolean;
}

/** A frame with no input. */
export const NO_INPUT: Readonly<InputFrame> = Object.freeze({
  dTheta: 0,
  down: false,
  downEdge: false,
  upEdge: false,
  release: 0,
  key: 0,
});

/**
 * v1.6 rules (docs/V1_6_PLAN.md §2, §5 with amendment A1): each can be switched off on its own
 * (kill switches, and with/without measurements through `sim --off …`). With every flag off the
 * game plays like v1.5 (bit-identity is not promised).
 */
export interface V16Rules {
  /** §2.1 Flow Ring: the multiplier bleeds in idle sun, tricks pump it, a snap cashes it in. */
  readonly ring: boolean;
  /** §2.2 Frost Bank: two snaps, earned by risk, kept overnight. */
  readonly bank: boolean;
  /** §2.4 Frost Garden and Landing. */
  readonly garden: boolean;
  /** §2.3 Brittle (glass) flake clusters. */
  readonly brittle: boolean;
  /** §2.5 Heat Flares. */
  readonly flares: boolean;
  /** §2.5 Noon Heat (T1). */
  readonly noonHeat: boolean;
}

/** Every v1.6 rule on. */
export const V16_ALL: V16Rules = Object.freeze({ ring: true, bank: true, garden: true, brittle: true, flares: true, noonHeat: true });
/**
 * The rules v1.6 ships with (the default when RunConfig.v16 leaves a rule unset): every rule on
 * (TUNING.bank.ships). Calibration (docs/V1_6_PLAN.md §11-§12) had shipped the Frost Bank off (the
 * dial-only bot filled 0.23 meters a day from income, naive greed outlived plain play by +1336 min);
 * economy iteration 1 (core README §16.4) prices its income (frost freezes only on a cool Nubs) and
 * ships it on.
 */
export const V16_SHIP: V16Rules = Object.freeze({ ring: true, bank: TUNING.bank.ships, garden: true, brittle: true, flares: true, noonHeat: true });
/** Every v1.6 rule off: plays like v1.5. */
export const V16_NONE: V16Rules = Object.freeze({ ring: false, bank: false, garden: false, brittle: false, flares: false, noonHeat: false });
/** The names of the v1.6 rules, in V16Rules order (`sim --off`). */
export const V16_RULES: readonly (keyof V16Rules)[] = Object.freeze(['ring', 'bank', 'garden', 'brittle', 'flares', 'noonHeat'] as (keyof V16Rules)[]);

export interface RunConfig {
  /** World seed (uint32). */
  seed: number;
  mode: RunMode;
  /** Onboarding profile (V1_PLAN §6); daily and challenge runs use 3. */
  profile: ProfileId;
  /** Use the authored tutorial chunk (normally profile 0). */
  tutorial: boolean;
  /** Sun follow 300°/s and inertia cap 180°/s. */
  reducedMotion: boolean;
  /** Debug: start at this day (default 1)… */
  startDay?: number;
  /** …and this many seconds after its dawn (default 0). */
  startT?: number;
  /** Debug: starting Chill (default max). */
  startChill?: number;
  /** Daily runs: the local date, YYYY-MM-DD. */
  dailyDate?: string;
  /**
   * Drain override (Chill/s at f = 1): an endless run's comfort rung (rungConfig) or a challenge's
   * rules. Unset means the profile drain (dayParams(day, profile).drain). It changes Chill only: the
   * world and its validator always use the profile drain, so the same seed builds the same world
   * with or without it. Read it via effectiveDrain(s).
   */
  drain?: number;
  /**
   * Day-1 parked training cloud (days.ts NoonCloud); part of the world's identity. Unset means
   * effectiveNoonCloud(): 1 for profiles 0-2, 0 for profile 3 (v1.0 worlds).
   */
  noonCloud?: NoonCloud;
  /** First-run lesson: the Chill floor and lessonDone (no effect on the world). */
  lesson?: boolean;
  /**
   * Day Plan on or off; part of the world's identity. Unset means on for profile 3 without the
   * tutorial (World.planOn).
   */
  plan?: boolean;
  /**
   * Debug and tooling: force this forecast on every day it fits (others are clear) and turn the Day
   * Plan on whatever the profile; part of the world's identity. The session treats such runs as debug.
   */
  forecast?: ForecastId;
  /**
   * Campaign level id (CAMPAIGN_PLAN §2). createRun/prepareRun derive the run from levelDef(id):
   * seed, profile 3, tutorial off, plan off, forecast, biome, startDay 1, startT, drain and mods
   * (resolveLevelConfig), so the level is the world's identity.
   */
  level?: number;
  /**
   * Concept modifiers (config/concepts.ts); part of the world's identity. Campaign levels set
   * them from the level; debug runs may pass any set. dayParams applies their tunes; the sim reads
   * SimState.mods for behaviour rules.
   */
  mods?: readonly ConceptId[];
  /** Forced Day-1 biome (alternating from there, every day clear unless `forecast` fits); part of the world's identity. */
  biome?: BiomeId;
  /**
   * v1.5 debug and tooling: turn core mechanics on or off (World.mech; unset keys keep the run's
   * default: all on, or a campaign level's). Part of the world's identity (buds are only generated
   * with `buds` on).
   */
  mechanics?: Partial<Mechanics>;
  /**
   * v1.5 debug: the frost meter at the start (0..1; 1 = a Cold Snap ready). Default 0 (1 on the Cold
   * Snap's teaching level). v1.6 (CORE-1, the Frost Bank): charges 0..2 (frostH = 100 · startFrost).
   */
  startFrost?: number;
  /**
   * v1.6 tooling and kill switches: switch single v1.6 rules on or off (unset keys take the
   * shipped V16_SHIP value). Part of the world's identity (World.v16).
   */
  v16?: Partial<V16Rules>;
  /** v1.6 campaign soft-fail (§2.6): after two misses the level's goal is scored as 'finish' (set from the save). */
  relaxedGoal?: boolean;
  /** v1.6 debug: force the glass-cluster quota to this share 0..1 (screenshots); part of the world's identity. */
  brittleShare?: number;
}

/**
 * hold: before the first touch (clock, Nubs and Chill frozen); day/night: running (the first
 * `ready` ticks of 'day' are the start beat: the sun moves, everything else waits); dead: Chill hit 0
 * in daylight; won: a campaign level's finish line was crossed with Chill > 0 (step() is a no-op
 * after dead or won).
 */
export type Phase = 'hold' | 'day' | 'night' | 'dead' | 'won';

export type SunMode = 'idle' | 'dragging' | 'chasing' | 'coasting';

export interface SunState {
  /** Azimuth θ in [0, 360): 0 east, 90 north, counter-clockwise positive. Light comes from θ. */
  theta: number;
  /** Finger target minus θ, unwrapped (°). The target is wrapDeg(theta + lag). */
  lag: number;
  /** Coasting angular velocity (°/s). */
  omega: number;
  /** Release velocity stored while chasing the remaining lag (°/s). */
  omegaRel: number;
  mode: SunMode;
  /** floor(θ / 15): the current detent. */
  detent: number;
  /** Signed θ change applied this tick (°). */
  dTheta: number;
  /** Consecutive ticks a rotation key has been held with the same sign (0 on release or reversal). */
  keyTicks: number;
  /** Sign of the key counted by keyTicks (0 none). */
  keySign: number;
  /**
   * 'gusts' concept: the direction the wind is turning the sun this tick (+1 CCW, −1 CW), 0 outside a
   * gust. The HUD shows a wind glyph while it is non-zero.
   */
  gust: -1 | 0 | 1;
  /** 'lock' concept: the sun ignores every input this tick (the halo shows a padlock). */
  locked: boolean;
}

export interface NubsState {
  x: number;
  y: number;
  chill: number;
  maxChill: number;
  /** Lit weight per coverage sample (0 shaded, 1 lit, 2 glare), order SAMPLE_DX/DY: C, E, W, N, S. */
  readonly w: Float64Array;
  /** Mean lit weight Σw/5 ∈ [0, 2]. 0 = fully shaded. */
  f: number;
  /** Samples inside a glare spot (0..5). */
  glare: number;
  /** Frost multiplier ×1..×5 and its timers (ticks). */
  mult: number;
  /** v1.5 Cold Snap meter 0..1 (1 = ready: a snap input casts it). */
  frost: number;
  /** v1.5 Deep shade: the center sample is in two or more shadows this tick (and Nubs is fully shaded). */
  deep: boolean;
  /** v1.5: the last tick Nubs was in deep shade (deepEnter needs TUNING.deep.reenterTicks out of it). */
  deepTick: number;
  shadeTicks: number;
  litTicks: number;
  x5Ticks: number;
  /** PHEW latch (open = may fire) and the last tick Chill was ≥ 40. */
  phewOpen: boolean;
  highChillTick: number;
  /** Tick at which the current lit streak began (−1 while fully shaded). */
  litSince: number;
  /** Caster shading the center sample this tick (−1 none) and the most recent one (for the death line). */
  shaderId: number;
  lastShaderId: number;
  lastShaderName: string;
  lastShaderTick: number;
  /** Cloud fully covering all 5 samples this tick (−1 none), the one ridden last tick, ride length (ticks). */
  cloudId: number;
  rideId: number;
  rideTicks: number;
  /** Ball whose glare touches Nubs this tick, and last tick (−1 none). */
  glareBallId: number;
  prevGlareBallId: number;
  /** θ on the first tick of the current lit streak (Frost grace). */
  litTheta: number;
  /**
   * SWING tracking: the source (caster or cloud id) of the last full-shade tick, θ and tick then;
   * a hand-off waiting for confirmation (swPend source, −1 none; its turn and confirmed ticks so far);
   * the chain length and tick of the last SWING.
   */
  swSrc: number;
  swTheta: number;
  swTick: number;
  swPend: number;
  swPendDeg: number;
  swPendTicks: number;
  swChain: number;
  swLastTick: number;
  /** v1.6 (CORE-1): the source a pending hand-off (swPend) leaves, recorded as an endpoint when it confirms (−1 none). */
  swPendFrom: number;

  // v1.6 Flow Ring (docs/V1_6_PLAN.md §2.1; CORE-1).
  /** Ring charge in integer units (TUNING.ring.shadeUnits = one full-shade tick); `mult` is its level. */
  ringCharge: number;
  /** The level at the current lit stretch's first tick (PHEW restores up to it, never above). */
  litStartMult: number;
  /** The last tick a bud grew (the bleed spares the tick after it). */
  budGrewTick: number;
  /** Flakes and crystals taken in a row without a melt (every 3rd pays a streak trick). */
  streak: number;
  /** The last TUNING.ring.freshSlots SWING endpoints as (source id, tick) pairs (16 slots); swFreshN pairs written so far. */
  readonly swFresh: Int32Array;
  swFreshN: number;
  // v1.6 Frost Bank (§2.2; CORE-1).
  /**
   * The frost meter in integer hundredths, 0..TUNING.bank.capH (100 = one snap ready). Until the
   * Bank lands it mirrors floor(100 · frost) of the v1.5 meter; afterwards `frost` mirrors frostH / 100.
   */
  frostH: number;
  /** The last tick a SWING paid frost (at most once per TUNING.bank.swingEveryTicks). */
  swingFrostTick: number;
}

export interface GuideState {
  /** 1 where θ = b° fully shades Nubs now with no glare (strict), from the last guide update. */
  readonly now: Uint8Array;
  /** Same 0.6 s ahead (position, elevation and clouds then). */
  readonly next: Uint8Array;
  /** 1 where some sample would be in glare now. Always shown. */
  readonly glare: Uint8Array;
  /** Lit counts now, 0..10 per bin (f = lit / 5). */
  readonly lit: Uint8Array;
  /** v1.5: 1 where the sun at b° grows a bud that is close enough to matter (gold arcs on the dial). */
  readonly bud: Uint8Array;
  /** Sim tick of the last update (updates every 6 ticks on the absolute step grid). */
  tick: number;
  /** False at night (no sun): masks are all 0. */
  sunUp: boolean;
  // v1.6 dial layers (docs/V1_6_PLAN.md §4 "Dial layer budget"); all 0 until their owners fill them.
  /** Deep shade now: all 5 samples shaded and ≥ 2 sources over the center (the snap excluded). CORE-2. */
  readonly deep: Uint8Array;
  /** Shades the nearest alive glass flake in its melt window (one point mask per refresh). CORE-2. */
  readonly flake: Uint8Array;
  /** During a snap: full shade at the snap's end (snap clouds excluded, this run's sunflowers included). CORE-1. */
  readonly land: Uint8Array;
  /** During a flare warning: full shade at the first hold tick. CORE-2. */
  readonly flare: Uint8Array;
  /** Ticks to the rise during a flare warning, −1 otherwise. CORE-2. */
  flareTicks: number;
}

export interface SimState {
  readonly cfg: RunConfig;
  /** Parameters of the current day (profile, Day Plan and concepts applied). */
  params: DayParams;
  /** Active concepts (RunConfig.mods, a campaign level's); empty outside the campaign. */
  readonly mods: ReadonlySet<ConceptId>;
  /** The campaign level being played, or null. */
  readonly level: LevelDef | null;
  /**
   * 'eclipse' concept: intensity 0..1 for the renderer (ramps up over the first 0.5 s of the 6 s
   * window and down over its last 0.5 s). While eclipseOn, every sample is shaded (f = 0), nothing
   * melts, and the guide's now mask is all shade.
   */
  eclipse: number;
  eclipseOn: boolean;
  /** 'moonlit' concept: a moon sun (εnoon 30°, half drain); the renderer uses the night palette. */
  readonly moonlit: boolean;
  phase: Phase;
  /** Sim ticks since the run started (hold excluded; the start beat counts). */
  tick: number;
  /**
   * Start-beat ticks left (TUNING.start.readyTicks after the first touch, then 0). While > 0 the
   * sun follows the input and coverage is live, but the clock, Nubs' walk, Chill, the multiplier
   * and pickups wait.
   */
  ready: number;
  day: number;
  /** Ticks since the current day's dawn (daylight then night). */
  dayTick: number;
  /** Seconds since dawn: dayTick / 60. */
  tDay: number;
  /** Absolute ticks/seconds since Day 1 dawn (clouds use tAbs). */
  tickAbs: number;
  tAbs: number;
  /** Score in in-game minutes: (day − 1)·720 + floor(720·t/Dl). */
  minutes: number;
  /** Sun elevation ε (°), tan ε and cot ε; sunUp false at night (then all three are 0). */
  eps: number;
  tanEps: number;
  cot: number;
  sunUp: boolean;
  /** Sun vector u = (cos θ, sin θ), pointing toward the sun. */
  ux: number;
  uy: number;
  /** Initial azimuth (toward the start hut). */
  readonly theta0: number;
  readonly sun: SunState;
  readonly nubs: NubsState;
  /** v1.5 Cold Snap: ticks left of the active snap (0 none) and its cloud's id (−1 none). */
  snapTicks: number;
  snapCloudId: number;
  // v1.6 Frost Bank and Garden (docs/V1_6_PLAN.md §2.2, §2.4; CORE-1).
  /** Frost income banked during the snap (hundredths), paid when it ends (at most TUNING.garden.bankCapH). */
  snapBankH: number;
  /** The meter at the run's start in hundredths (the Bank's frostH, or 100 × the v1.5 meter): snaps beyond it are earned. */
  readonly startFrostH: number;
  /** Ticks this snap was extended by blooms (≤ TUNING.garden.extendCapTicks), and the blooms under it. */
  snapExt: number;
  snapBlooms: number;
  /**
   * Economy iteration 2: the Chill this snap cools Nubs to at most (Bank on: maxChill from the gauge's
   * white, less in the amber, the Chill it was cast at when red-hot; mechanics.ts snapGauge).
   */
  snapChillCap: number;
  /** Economy iteration 2 (Bank on): frost saved glass clusters banked for the next snap (hundredths, ≤ TUNING.bank.capH), paid as it is cast. */
  glassBankH: number;
  /** Landing: ticks left of the window after snapEnd (−1 none), ticks held so far, the source holding Nubs (−1 none). */
  landTicks: number;
  landHold: number;
  landSrc: number;
  /** v1.6 (CORE-1): ids of the sunflowers bloomed under the current snap (the first snapBlooms, at most 8 slots; own landings). */
  readonly snapBloomIds: Int32Array;
  // v1.6 glass clusters (§2.3; CORE-2): the cluster being walked through (−1 none), flakes taken from it, a flake of it melted.
  clusterId: number;
  clusterTaken: number;
  clusterBroken: boolean;
  // v1.6 Heat Flares (§2.5; CORE-2).
  /** Index in world.flares of the next or current flare, and its id (−1 none). */
  flareIdx: number;
  flareId: number;
  /** 0 none, 1 warning, 2 rise, 3 hold, 4 fall. */
  flarePhase: 0 | 1 | 2 | 3 | 4;
  /** Lit ticks during the current flare's hold, and ticks to its rise during the warning (−1 otherwise). */
  flareLit: number;
  flareTicks: number;
  /**
   * Chill of the tank a missed flare scorched (Endless): Chill stays at most maxChill − flareScorch
   * until nightfall, when it heals (sim/flares.ts). 0 otherwise.
   */
  flareScorch: number;
  readonly guide: GuideState;
  readonly world: World;
  readonly stats: RunStats;
  /** One glyph array per day reached (V1_PLAN §5.5). */
  readonly hourGlyphs: HourGlyph[][];
  /** Lit seconds (∫f dt) and the "Chill < 25" flag of the current in-game hour. */
  hourLit: number;
  hourHot: boolean;
  /** Melt Map ring: (x, y, chill, f) every 20 u of y; historyCount entries pushed in total. */
  readonly history: Float64Array;
  historyCount: number;
  nextHistoryY: number;
  /** Death-cause ring per tick: (θ, Σw, glare weight, glare ball id); recentCount ticks pushed. */
  readonly recent: Float64Array;
  recentCount: number;
  /** Events of the last step (cleared at the start of each step). */
  readonly events: SimEvent[];
  death: DeathInfo | null;
  /** Flakes collected today (bell pitch). */
  flakesToday: number;
  /** Clouds that already fired cloudCapture, balls that glared Nubs. */
  readonly captured: Set<number>;
  readonly glaredBalls: Set<number>;
  /**
   * First-run lesson (RunConfig.lesson): true from `go` while the Chill floor holds; it ends on
   * lessonDone, after TUNING.lesson.maxDaylightTicks daylight ticks, or at nightfall.
   */
  lessonOn: boolean;
  /** Daylight ticks played with the lesson on. */
  lessonTicks: number;
  /** θ when Nubs last became lit (−1 before the first lit tick), whether θ has since turned ≥ 15°, and the full-shade ticks since. */
  lessonFrom: number;
  lessonSwung: boolean;
  lessonShade: number;
  /**
   * Daylight ticks of Chill floor left after the lesson ends in daylight (pass or timeout): the
   * floor holds until TUNING.lesson.holdTicks of daylight, then fades to 0 over fadeTicks, so Nubs
   * is never dropped from 12 Chill to the full drain at once. Nightfall clears it.
   */
  lessonGrace: number;
}
