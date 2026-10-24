// Shared contract between the simulation (src/core) and its consumers (audio, UI, meta, render).
// The sim emits these; nothing else constructs SimEvents. Extend only additively.

import type { FeatKind } from '../../config/campaign.ts';
import type { ConceptId } from '../../config/concepts.ts';
import type { DayPlan, NoonCloud } from '../../config/days.ts';
import type { HeroDeath, HeroId } from '../../config/heroes.ts';
import type { ElKind } from '../../config/trials.ts';

export type HourGlyph = 'cool' | 'warm' | 'hot' | 'melt';

export type DeathCause = 'glare' | 'cloud' | 'gap' | 'plain';

export interface DeathInfo {
  day: number;
  tDay: number;
  /** Score in in-game minutes: (day-1)*720 + floor(720*tDay/Dl). */
  minutes: number;
  /** Exact clock of death, e.g. "12:07 PM". */
  time: string;
  /** World position of the puddle. */
  x: number;
  y: number;
  cause: DeathCause;
  /** Full death line, e.g. "Melted by You at 12:07 PM, between the Mossy Oak and the Little Hut." */
  line: string;
  lastId?: number;
  lastName?: string;
  nextId?: number;
  nextName?: string;
  ballId?: number;
  /** Trials: the element that failed and how. */
  who?: HeroId;
  heroCause?: HeroDeath;
}

export type SimEvent =
  | { e: 'start' }
  | { e: 'go' }
  | { e: 'detent'; dir: 1 | -1; index: number }
  | { e: 'catch'; omega: number }
  | { e: 'flake'; mult: number; degree: number; x: number; y: number; snow: number }
  | { e: 'crystal'; mult: number; x: number; y: number; snow: number }
  | { e: 'flower'; x: number; y: number; snow: number }
  | { e: 'flakeMelt'; x: number; y: number }
  | { e: 'shadeEnter'; litFor: number }
  | { e: 'shadeExit' }
  | { e: 'multUp'; level: number; reason?: 'shade' | 'trick' | 'phew' }
  | { e: 'multReset'; from: number }
  | { e: 'phew' }
  | { e: 'noonBanner' }
  | { e: 'noonPassed' }
  | { e: 'nightStart'; day: number }
  | { e: 'dawn'; day: number }
  | { e: 'cloudCapture'; id: number }
  | { e: 'glareTouch'; ballId: number }
  | { e: 'lowChill' }
  | { e: 'hourEnd'; day: number; hour: number; glyph: HourGlyph }
  | { e: 'gateArch'; noon: boolean; snow: number }
  | { e: 'ballPassed'; clean: boolean }
  | { e: 'swing'; deg: number; chain: number; snow: number; x: number; y: number }
  | { e: 'lessonDone' }
  | { e: 'death'; info: DeathInfo }
  | { e: 'levelWon'; passed: boolean; stars: 0 | 1 | 2 | 3; flakes: number; minChill: number }
  // v1.5 core mechanics (docs/V1_5_PLAN.md)
  | { e: 'budGrow'; id: number; x: number; y: number; grow: number }
  | { e: 'bloom'; id: number; x: number; y: number; snow: number }
  | { e: 'frostReady'; charges?: number }
  | { e: 'snap'; x: number; y: number; cloudId: number }
  | { e: 'snapEnd' }
  | { e: 'deepEnter' }
  // v1.6 (docs/V1_6_PLAN.md §2, §10). Flow Ring (CORE-1); multReset is no longer emitted once the ring lands.
  | { e: 'multDown'; from: number; to: number; cause: 'bleed' | 'snap' }
  | { e: 'ringTrick'; kind: 'swing' | 'bloom' | 'streak' | 'cluster' | 'land' | 'parry'; units: number }
  // Frost Bank (CORE-1): frostReady gains `charges` (1 or 2).
  | { e: 'frostGain'; source: 'bloom' | 'swing' | 'cluster' | 'land' | 'parry' | 'cash' | 'garden'; amountH: number; charges: number }
  | { e: 'frostSpill'; lostH: number }
  /**
   * A snap's cash-in (economy iteration 2, Bank on: `hot`, cast red-hot: it pours nothing and refills
   * no Chill; `noon`, cast in the Noon Heat: it pours nothing; `amber`, cast in the amber: it pours
   * and cools only part of the way).
   */
  | { e: 'snapCash'; level: number; refundH: number; hot?: true; noon?: true; amber?: true }
  // Frost Garden and Landing (CORE-1).
  | { e: 'snapExtend'; ticks: number }
  | { e: 'snapLand'; chain: number; own: boolean; x: number; y: number }
  // Glass clusters (CORE-2).
  | { e: 'clusterSaved'; cluster: number; brittle: boolean; n: number; x: number; y: number }
  // Heat Flares (CORE-2).
  | { e: 'flareWarn'; id: number; ticks: number; d: number }
  | { e: 'flareRise'; id: number }
  | { e: 'flareParry'; id: number; snap: boolean; snow: number }
  | { e: 'flareMiss'; id: number; lit: number }
  | { e: 'flareEnd'; id: number }
  // Dares (CORE-2): a Dare's live count changed; a Dare was met.
  | { e: 'feat'; kind: FeatKind; value: number; target: number }
  | { e: 'featMet'; kind: FeatKind }
  // Elementals v2 (docs/ELEMENTALS_V2.md §7.5): relay TAGs and the element verbs and objects.
  | { e: 'tagSoon'; to: HeroId; ticks: number }
  | { e: 'tag'; from: HeroId; to: HeroId; index: number }
  | { e: 'tagClean'; to: HeroId }
  /** A fire, melt or drying starts. */
  | { e: 'burn'; obj: number; kind: ElKind; x: number; y: number; cost: number; spread: boolean }
  /** Done ('ice' already turned 'puddle'). */
  | { e: 'burnOut'; obj: number; kind: ElKind; x: number; y: number }
  /** Ember walked through its own fire. */
  | { e: 'feed'; obj: number; delta: number; x: number; y: number }
  /** Rain put a fire out. */
  | { e: 'doused'; obj: number; x: number; y: number }
  /** A tap or swipe the meter cannot afford. */
  | { e: 'fizz'; x: number; y: number; reason: 'low' }
  | { e: 'bump'; obj: number; kind: ElKind; hero: HeroId; delta: number; x: number; y: number }
  /** The death follows on this tick. */
  | { e: 'fall'; obj: number; hero: HeroId; x: number; y: number }
  /** A hold starts or ends. */
  | { e: 'grow'; obj: number; on: boolean; x: number; y: number }
  /** A bridge completes / a tree stands. */
  | { e: 'grown'; obj: number; tree: boolean; x: number; y: number }
  /** Drip drank a puddle or swam a stream. */
  | { e: 'drink'; obj: number; delta: number; x: number; y: number }
  /** A hot stone: Drip −, Ember +. */
  | { e: 'sizzle'; obj: number; hero: HeroId; delta: number; x: number; y: number }
  | { e: 'gust'; dir: -1 | 1; wind: number; cost: number }
  /** el.touch changed. */
  | { e: 'touch'; bits: number };

export type SimEventName = SimEvent['e'];

export interface RunStats {
  flakes: number;
  flakesMelted: number;
  crystals: number;
  flowers: number;
  phews: number;
  snow: number;
  maxMult: number;
  /** Longest continuous time at x5 (s). */
  x5HoldBest: number;
  /** Longest continuous time fully shaded by a single cloud (s). */
  cloudRideBest: number;
  /** Total seconds with a cloud providing the shade. */
  cloudSeconds: number;
  ballsPassedClean: number;
  ballGlared: boolean;
  /** Walked under a gate arch between 11:00 AM and 1:00 PM. */
  gateNoon: boolean;
  /** Highest day reached (1-based). Reaching night of day N counts as day N. */
  dayReached: number;
  /** Nights survived (number of dawns after the first). */
  nightsReached: number;
  minutes: number;
  /** Total integral of f over daylight (s). */
  litTotal: number;
  /** SWINGs landed, the longest chain (0 when none), and the lowest Chill a PHEW fired from (100 when none). */
  swings: number;
  swingChainBest: number;
  phewMinChill: number;
  /**
   * Lowest Chill during daylight (the starting Chill when never lit; campaign star 3). On Trials:
   * the lowest steady health (0..100) any life meter reached, from 100 (docs/ELEMENTALS_V2.md §1.2).
   */
  minChill: number;
  /** v1.5: sunflowers bloomed, Cold Snaps cast, seconds in deep shade (absent = 0). */
  blooms?: number;
  snaps?: number;
  deepSeconds?: number;
  // v1.6 (docs/V1_6_PLAN.md §10): optional in the type (absent = 0), always filled by createRun.
  /** Flow Ring (CORE-1): Σ m over daylight ticks, daylight ticks at x5, level drops, trick payments. */
  multTicks?: number;
  x5Ticks?: number;
  multDowns?: number;
  ringTricks?: number;
  /** Frost Bank (CORE-1, hundredths): earned from income, lost over the cap, refunded by cash-ins. */
  frostEarnedH?: number;
  frostSpilledH?: number;
  snapCashH?: number;
  /** Garden (CORE-1): blooms under a snap, landings, own-sunflower landings. */
  gardenBlooms?: number;
  snapLands?: number;
  snapLandsOwn?: number;
  /** Glass (CORE-2): glass clusters walked through, glass clusters saved whole, clusters of any kind saved whole. */
  brittleSeen?: number;
  brittleSaved?: number;
  clustersSaved?: number;
  /** Flares (CORE-2): kept flares that reached their hold, parries. */
  flaresSeen?: number;
  parries?: number;
  /**
   * Dare counters (CORE-2, §2.6; integer ticks or counts so the HUD's live count and the verdict
   * agree): ticks in deep shade; ticks where a snap filled from income is the only source over the
   * center; clouds ridden ≥ 0.5 s; arches walked under in deep shade; the eclipse flip's shade
   * ticks; lock and gust windows held fully shaded, and how many there were.
   */
  deepTicks?: number;
  earnedSnapSavedTicks?: number;
  /** Ticks where any snap (earned or the start charge's) is the only source over the center (L10's verb goal). */
  snapSavedTicks?: number;
  cloudsRidden?: number;
  gateDeep?: number;
  /** Arches walked under fully shaded (L13's verb goal; gateDeep counts the deep ones). */
  gateShaded?: number;
  flipTicks?: number;
  lockHeld?: number;
  lockWindows?: number;
  gustHeld?: number;
  gustWindows?: number;
  // Elementals v2 (docs/ELEMENTALS_V2.md §7.5): created at 0 on Trials, absent in Nubs runs.
  /** Walls and plots cleared by fire (burn-out or feed) and ice melted; walls smashed; puddles drunk and streams swum. */
  burns?: number;
  bumps?: number;
  drinks?: number;
  /** Trees grown, and those still standing at the finish. */
  trees?: number;
  grove?: number;
  /** Nubs' ticks inside a rain footprint. */
  cloudRide?: number;
  /** Relay TAGs, and the clean ones. */
  tags?: number;
  cleanTags?: number;
  /** Gust's swipes. */
  gusts?: number;
}

export type RunMode = 'endless' | 'daily' | 'challenge' | 'campaign';

/** A campaign run's outcome (RunResult.level): the level, whether its goal was met at the finish, its stars. */
export interface RunLevel {
  id: number;
  passed: boolean;
  stars: 0 | 1 | 2 | 3;
  introduces: ConceptId | null;
}

export interface RunResult {
  mode: RunMode;
  seed: number;
  dailyDate?: string;
  profile: 0 | 1 | 2 | 3;
  /** Drain the run used (RunConfig.drain, else the profile drain) and its Day-1 noon cloud. */
  drain: number;
  noonCloud: NoonCloud;
  /** One Day Plan entry per day reached, index 0 = Day 1 (plan-off runs: alternating clear days). */
  plan: DayPlan[];
  minutes: number;
  day: number;
  /** "Day 2 · 2:40 PM" (exact minutes). */
  clock: string;
  stats: RunStats;
  death: DeathInfo;
  /** One array per day reached; 12 entries for complete days, fewer for the final day (ending in 'melt'). */
  hourGlyphs: HourGlyph[][];
  /** Pentatonic degrees of flake pickups (max 32), filled by the session for the results melody. */
  melody: number[];
  /** True when the guide was forced on via settings ("Always"). */
  assisted: boolean;
  /** Campaign runs: the level and its outcome (passed false, stars 0 when Nubs melted). */
  level?: RunLevel;
}
