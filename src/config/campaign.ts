// The Journey campaign (CAMPAIGN_PLAN §2-§3): 200 levels in 20 chapters. Levels 1-40 each introduce
// one concept of the catalog (config/concepts.ts) in teaching order; levels 41-200 compose two or
// three concepts per level around the chapter's theme, with drain and length rising by a chapter
// curve and star thresholds scaling with the level's length. Everything is a pure function of the
// level id and the bake's data (seed = hashString(`journey-${id}`), or a teaching level's world
// variant of it, levelSeed; composition draws from rngFor(seed, 'campaign', id)), so
// buildCampaign() is deterministic and the table is data.

import { CONCEPT_IDS, CONCEPTS, conceptsCompatible, foldTuning, MECHANIC_CONCEPTS, TEACH_LEVELS, type ConceptId } from './concepts.ts';
import { dayParams, dayPlan, type BiomeId } from './days.ts';
import type { ForecastId } from './forecasts.ts';
import { LEVEL_BAKE_RUN } from './levelBake.gen.ts';
import { hashString, rngFor } from './rng.ts';
import { TUNING } from './tuning.ts';

export type { Concept, ConceptId, ConceptKind, ConceptLevel, DayTuning } from './concepts.ts';
export { CONCEPT_CONFLICTS, CONCEPT_IDS, CONCEPTS, conceptsCompatible, foldTuning, MECHANIC_CONCEPTS, TEACH_LEVELS } from './concepts.ts';

/**
 * A level's goal (star 1). v1.6 adds the verb goals of the teaching levels (docs/V1_6_PLAN.md
 * §2.6). 'snow' is retired (T6: no level has it any more; L7's goal is 1 SWING); the literal stays
 * in the type only until the game layer drops its Snow-goal branches.
 */
export type GoalKind = 'finish' | 'flakes' | 'snow' | 'deep' | 'clean' | 'swings' | 'blooms' | 'snapSave' | 'gate' | 'brittle' | 'flip' | 'parry';

/** v1.6 Dares (star 2, §2.6): what a Feat counts (featValue), one kind per concept. */
export type FeatKind = 'blooms' | 'swings' | 'deep' | 'snapSave' | 'parry' | 'brittle' | 'flakes' | 'clean' | 'ride' | 'gates' | 'flip' | 'still' | 'ring';

/** One Dare: met when featValue(kind, stats) ≥ target. */
export interface FeatSpec {
  readonly kind: FeatKind;
  readonly target: number;
}

/** A Journey boss finale's baked Heat Flare (§2.5): its rise at `minute` (in-game minutes after 6:00 AM), lift d (°). */
export interface LevelFlare {
  readonly minute: number;
  readonly d: number;
}

/**
 * What `node scripts/sim.ts --bake` measured on a level's fixed seed (src/config/levelBake.gen.ts
 * `LEVEL_BAKE`, tooling only): the Dare targets are sized from it (`bakeRunEntry`), and its flares are
 * the level's (kept by the keep test). The game reads only the result, `LEVEL_BAKE_RUN`.
 */
export interface LevelBake {
  /** levelBakeKey of the level's world identity when it was baked (the bake test checks it is current). */
  readonly key: string;
  /** Sunflower buds whose reach the trail passes between the start and the finish. */
  readonly buds: number;
  /** Gazing balls with a glare-free line (a turn-limited, survivable path that never touches their glare). */
  readonly balls: number;
  /** Glass clusters on the trail. */
  readonly glass: number;
  /** Lock and gust windows in the level's daylight, and the holdable ones (some bin fully shaded through the window). */
  readonly windows: number;
  readonly holdable: number;
  /** Plain flakes on the trail. */
  readonly flakes: number;
  /** Ticks of the level's daylight with a bin in deep shade at Nubs' place on the trail (the validator's step grid). */
  readonly deep: number;
  /** The longest stretch (s) one cloud can cover all five of Nubs' samples, and the clouds that can for ≥ 1 s. */
  readonly rideBest: number;
  readonly rides: number;
  /** SWING hand-offs the trail offers (a lit gap of 42-60° between two sources' full shade), at most one per 2 s. */
  readonly swings: number;
  /** The longest stretch (ticks) a turn-limited path stays fully shaded (what the ring Dare needs). */
  readonly shadeRun: number;
  /** Kept flares a single fixed angle parries (shaded on ≥ 6 of the 7 hold steps): what the parry Dare is sized from. */
  readonly stillFlares: number;
  /** The level's flares after the keep test (the kept ones; the boss's HP is their count). */
  readonly flares: readonly LevelFlare[];
  /**
   * The world variant a teaching level plays (its seed, `levelSeed`): the first on which a
   * dial-following player meets its verb goal (`lessonReads`); 0 (the level's own seed) elsewhere.
   */
  readonly variant: number;
  /** The Dare candidates measured for the level's (first) Dare, in candidate order (`dareCandidates`). */
  readonly dares: readonly DareMeasure[];
  /** A finale's second Dare: candidates measured beyond `dares` (or under the snap its first Dare starts with). */
  readonly dares2: readonly DareMeasure[];
}

/**
 * What the bake measured of one Dare kind on a level (scripts/sim16/dares.ts): the kind's value at
 * the finish line for the players who do not seek it (the reactive bot, the oracle and humanDial on
 * DARE_PLAYERS training decision streams) and for those who seek it (the Feat-seeking oracle and
 * humanFeat on the same streams), −1 for a run that melted. The Dare's target is sized from it
 * (`sizeDare`): just above what the non-seekers reach, where the seekers reach it.
 */
export interface DareMeasure {
  readonly kind: FeatKind;
  /** [reactive, oracle, humanDial × DARE_PLAYERS] */
  readonly not: readonly number[];
  /** [Feat-seeking oracle, humanFeat × DARE_PLAYERS] */
  readonly seek: readonly number[];
}

export interface LevelDef {
  /** 1..200. */
  readonly id: number;
  /** 1..20 (10 levels each). */
  readonly chapter: number;
  /** Short, playful: "First Shade", "Glass Garden". */
  readonly name: string;
  /** hashString(`journey-${id}`), or a teaching level's world variant of it (levelSeed, the bake's lessonReads). */
  readonly seed: number;
  readonly biome: BiomeId;
  /** 'clear' unless a forecast concept is active. */
  readonly forecast: ForecastId;
  /** Every active concept, the introduced one (or the chapter's headline) first. */
  readonly concepts: readonly ConceptId[];
  /** The new concept this level teaches (levels 1-40: always set). */
  readonly introduces: ConceptId | null;
  /** Minutes since 6:00 AM of Day 1 (0 = dawn, 360 = noon, 600 = 4 PM). */
  readonly startMinute: number;
  /** In-game minutes to the finish line; only 'marathon' levels span a night. */
  readonly lengthMinutes: number;
  /** 'finish' target 0; otherwise the goal's counter must reach `target` (goalMet; 'flip': within `target` ticks). */
  readonly goal: { readonly kind: GoalKind; readonly target: number };
  /**
   * Star 1 is passing; v1.6: star 2 is a Dare (`feats`), star 3 a cool run: at most `sunSec`
   * seconds in the sun (∫f dt, RunStats.litTotal) with the lowest Chill never below `minChill`.
   * `flakes` is the v1.5 flake star's bar (80% / 65% of the flakes offered), kept for the UI.
   */
  readonly stars: { readonly flakes: number; readonly minChill: number; readonly sunSec: number };
  /** Chill/s at f = 1 (the campaign ignores the comfort ladder). */
  readonly drain: number;
  /** v1.6 Dares (star 2): one, or two on finales (either earns the star). */
  readonly feats: readonly FeatSpec[];
  /** v1.6 Heat Flares: the Solar Flare's level (38) and every boss finale of chapters 5-20 (`sim --bake`). */
  readonly flares: readonly LevelFlare[];
}

export interface Chapter {
  readonly id: number;
  readonly name: string;
  readonly biome: BiomeId;
  /** The chapter's signature concepts: every level draws its first from them; finales take three. */
  readonly concepts: readonly ConceptId[];
}

export const LEVEL_COUNT = 200;
export const CHAPTER_COUNT = 20;
export const LEVELS_PER_CHAPTER = 10;

const ch = (id: number, name: string, biome: BiomeId, concepts: readonly ConceptId[]): Chapter =>
  Object.freeze({ id, name, biome, concepts: Object.freeze(concepts.slice()) });

/** 20 themed chapters, biomes alternating from the Meadow. Chapters 1-4 teach the catalog. */
export const CHAPTERS: readonly Chapter[] = Object.freeze([
  ch(1, 'First Light', 'meadow', CONCEPT_IDS.slice(0, 10)),
  ch(2, 'Town and Weather', 'oldtown', CONCEPT_IDS.slice(10, 20)),
  ch(3, 'Frost and Flurry', 'meadow', CONCEPT_IDS.slice(20, 30)),
  ch(4, 'Strange Suns', 'oldtown', CONCEPT_IDS.slice(30, 40)),
  ch(5, 'Rolling Meadows', 'meadow', ['flakes', 'cloud', 'sparse', 'breezy']),
  ch(6, 'Cobbled Lanes', 'oldtown', ['gate', 'market', 'dense', 'glare']),
  ch(7, 'Summer Heat', 'meadow', ['heat', 'thaw', 'noon', 'drought']),
  ch(8, 'Harbour Winds', 'oldtown', ['breezy', 'gusts', 'fleet', 'overcast']),
  ch(9, 'Giant Country', 'meadow', ['giants', 'long', 'sparse', 'slippery']),
  ch(10, 'Clockwork Town', 'oldtown', ['clockwork', 'lock', 'heavy', 'ration']),
  ch(11, 'Flurry Fields', 'meadow', ['flurry', 'hardy', 'frosty', 'meltfast']),
  ch(12, 'Dusk Streets', 'oldtown', ['sunset', 'moonlit', 'lowland', 'fog']),
  ch(13, 'Glass Meadow', 'meadow', ['dazzle', 'glare', 'blind', 'noon']),
  ch(14, 'Eclipse Row', 'oldtown', ['eclipse', 'lock', 'drought', 'thaw']),
  ch(15, 'The Long Road', 'meadow', ['marathon', 'stroll', 'sprint', 'overcast']),
  ch(16, 'Market Rush', 'oldtown', ['market', 'sprint', 'swing', 'gate']),
  ch(17, 'Storm Pass', 'meadow', ['gusts', 'fleet', 'slippery', 'heavy']),
  ch(18, 'Frost Quarter', 'oldtown', ['frosty', 'ration', 'hardy', 'flurry']),
  ch(19, 'High Summer', 'meadow', ['boss', 'heat', 'noon', 'drought']),
  ch(20, 'Heat Dome', 'oldtown', ['boss', 'dense', 'eclipse', 'lock']),
]);

/** Names of the composed levels, ten per chapter 5-20 (index 0-8 regular, 9 the finale). */
const NAMES: readonly (readonly string[])[] = [
  ['Clover Walk', 'Dandelion Drift', 'Breezy Hollow', 'Wide Pasture', 'Flake Meadow', 'Cloud Shadow', 'Open Range', 'Soft Wind', 'Thistle Down', 'The Long Meadow'],
  ['Arch Street', 'Stall Row', 'Tight Alley', 'Mirror Lane', 'Baker\'s Gate', 'Crowded Square', 'Lantern Walk', 'Glass Corner', 'Market Gate', 'The Grand Arch'],
  ['Warm Morning', 'Dry Grass', 'High Sun', 'Thin Shade', 'Heat Shimmer', 'Parched Field', 'Noon Blaze', 'Baked Earth', 'Scorched Path', 'The Furnace'],
  ['Salt Breeze', 'Gull Wind', 'Rolling Fog', 'Fleet Harbour', 'Rope Walk', 'Quay Gusts', 'Grey Sky', 'Storm Jetty', 'Pier Squall', 'The Gale'],
  ['Tall Pines', 'Long Shade', 'Giant Steps', 'Stone Giants', 'Slippery Sun', 'Oak Shadow', 'Far Fields', 'Towering Grove', 'Big Country', 'The Colossus'],
  ['Tick Tock', 'Gear Street', 'Locked Sun', 'Heavy Hands', 'Half Tank', 'Clock Square', 'Detent Lane', 'Spring Wound', 'Escapement', 'The Great Clock'],
  ['Snowfall', 'Flake Storm', 'Frost Bloom', 'Quick Thaw', 'Hardy Patch', 'White Field', 'Drift Walk', 'Flurry Rise', 'Frozen Trail', 'The Blizzard'],
  ['Last Light', 'Dusk Lane', 'Low Roofs', 'Fog Street', 'Moon Walk', 'Lamplight', 'Long Evening', 'Gloaming', 'Night Market', 'The Witching Hour'],
  ['Glass Field', 'Mirror Meadow', 'Dazzle Dawn', 'Blind Noon', 'Bright Glare', 'Shining Grass', 'Sun Catchers', 'Prism Walk', 'Lens Flare', 'The Glasshouse'],
  ['Dark Noon', 'Shadow Row', 'Locked Street', 'Dry Spell', 'Thin Ice Lane', 'Black Sun', 'Umbra', 'Corona Walk', 'Totality', 'The Eclipse'],
  ['Slow Start', 'Quick March', 'Grey Miles', 'Long Haul', 'Steady Pace', 'Far Horizon', 'Endless Road', 'Dawn to Dusk', 'Night Crossing', 'The Marathon'],
  ['Opening Bell', 'Rush Hour', 'Swing Street', 'Gate Run', 'Fast Stalls', 'Busy Square', 'Quick Trade', 'Hand-off Lane', 'Bargain Dash', 'The Big Sale'],
  ['First Gust', 'Fleet Shadows', 'Wild Wind', 'Heavy Weather', 'Slick Sun', 'Storm Front', 'Crosswind', 'Squall Line', 'Thunderhead', 'The Tempest'],
  ['Frost Lane', 'Half Measure', 'Hardy Row', 'Snow Square', 'Cold Snap', 'Ice Street', 'Rimed Walls', 'Flurry Court', 'Deep Freeze', 'The Ice Palace'],
  ['Warm Dawn', 'Dry Noon', 'Heat Haze', 'Scorched Grass', 'Blazing Sun', 'White Noon', 'Furnace Field', 'Burning Walk', 'Dome Rising', 'The Heat Dome'],
  ['Hot Walls', 'Dark Square', 'Locked Noon', 'Packed Street', 'Cornered', 'Black Noon', 'Sun Trap', 'Final Lane', 'Last Shade', 'The Summit'],
];

/** Stats a level is scored on (RunStats has these fields). */
export interface LevelStats {
  readonly flakes: number;
  readonly snow: number;
  readonly minChill: number;
  /** Seconds in the sun (∫f dt); a missing value counts as 0. */
  readonly litTotal?: number;
  // v1.6 Dare and verb-goal counters (RunStats, docs/V1_6_PLAN.md §2.6); a missing value counts as 0.
  readonly swings?: number;
  readonly blooms?: number;
  readonly maxMult?: number;
  readonly ballsPassedClean?: number;
  readonly cloudRideBest?: number;
  readonly cloudsRidden?: number;
  readonly deepTicks?: number;
  readonly earnedSnapSavedTicks?: number;
  readonly parries?: number;
  readonly brittleSaved?: number;
  readonly gateDeep?: number;
  readonly flipTicks?: number;
  readonly lockHeld?: number;
  readonly lockWindows?: number;
  readonly gustHeld?: number;
  readonly gustWindows?: number;
  readonly snapSavedTicks?: number;
  readonly gateShaded?: number;
  // Elementals Trial Dares (docs/ELEMENTALS.md §4.3 trialDareValue); a missing value counts as 0.
  readonly blazeTicks?: number;
  readonly bestChain?: number;
  readonly calmTicks?: number;
  readonly cleanTags?: number;
  readonly harmonyTicks?: number;
}

/** The chapter of level `id`. */
export function chapterOf(id: number): number {
  return Math.ceil(id / LEVELS_PER_CHAPTER);
}

/**
 * The difficulty curve, in effective drain points (Chill/s at f = 1 on a level with no concept
 * cost): a sawtooth that climbs through each chapter to its finale, the spike, and starts the next
 * chapter below that spike. The teaching chapters (1-4) climb gently from 28 (finales +6); the
 * composed ones from 32-39 (chapter 5) to 41-48 (chapter 20), finales 7 above the chapter's base.
 */
function curveDrain(id: number): number {
  const c = chapterOf(id);
  const i = (id - 1) % LEVELS_PER_CHAPTER;
  if (c <= 4) return 28 + 2 * (c - 1) + (i === 9 ? 6 : Math.floor(i / 3));
  const base = 37 + Math.round(0.6 * (c - 5));
  return i === 9 ? base + 7 : base - 5 + Math.round((7 * i) / 8);
}

/**
 * Level length (minutes) on the chapter curve: teaching levels end before noon (240 → 300 minutes
 * from dawn), their finales an hour later (noon from chapter 2); composed chapters grow 360 → 720 in 30-minute steps, their
 * first two levels a step shorter.
 */
function curveLength(id: number): number {
  const c = chapterOf(id);
  const i = (id - 1) % LEVELS_PER_CHAPTER;
  if (c <= 4) return (TEACH_LENGTH[c - 1] as number) + (i === 9 ? 60 : 0);
  const len = 360 + 30 * Math.round((12 * (c - 5)) / 15);
  return i < 2 ? len - 30 : len;
}

const TEACH_LENGTH: readonly number[] = [240, 300, 300, 300];
/** The level's drain stays in [DRAIN_MIN, DRAIN_MAX]; its effective drain (× drainMul) never exceeds DRAIN_EFFECTIVE_MAX. */
const DRAIN_MIN = 22;
const DRAIN_MAX = 55;
const DRAIN_EFFECTIVE_MAX = 62;

/** Expected flakes on the trail between startMinute and the finish (clusters every ~6.5 s of the day's clock). */
function expectedFlakes(startMinute: number, lengthMinutes: number, concepts: readonly ConceptId[], biome: BiomeId, forecast: ForecastId): number {
  const P = TUNING.pickups;
  const meanGap = (P.clusterGapMin + P.clusterGapMax) / 2;
  let total = 0;
  let m0 = startMinute;
  const m1 = startMinute + lengthMinutes;
  for (let day = 1; m0 < m1 && day <= 3; day++) {
    const p = dayParams(day, 3, dayPlan(day % 2 === 1 ? biome : biome === 'meadow' ? 'oldtown' : 'meadow', forecast), concepts);
    const dl = p.dayLen;
    const dayStart = (day - 1) * 720;
    const t0 = ((m0 - dayStart) / 720) * dl;
    const t1 = ((Math.min(m1, dayStart + 720) - dayStart) / 720) * dl;
    const w0 = Math.max(t0, P.clusterTMin * dl + 1);
    const w1 = Math.min(t1, P.clusterTMax * dl);
    if (w1 > w0) total += ((w1 - w0) / (meanGap * p.clusterGap)) * p.flakesPerCluster;
    m0 = dayStart + 720;
  }
  return total;
}

/** The biome a set of concepts requires (oldtown, market → Old Town), or null. */
function requiredBiome(concepts: readonly ConceptId[]): BiomeId | null {
  for (const id of concepts) {
    const b = CONCEPTS[id].level?.biome;
    if (b) return b;
  }
  return null;
}

/** Concepts a composed level never draws from the general pool (they have their own chapters, or teach). */
const COMPOSE_EXCLUDED: ReadonlySet<ConceptId> = new Set<ConceptId>(['drag', 'boss', 'marathon', 'deep', 'bloom', 'snap']);

/**
 * The order composed levels draw their pool in: v1.2's teaching order, so the v1.5 reordering of
 * CONCEPT_IDS left every composed level (41-200) exactly as it was.
 */
const COMPOSE_ORDER: readonly ConceptId[] = Object.freeze([
  'drag', 'flakes', 'cloud', 'noon', 'oldtown', 'glare', 'swing', 'gate', 'breezy', 'long',
  'heat', 'overcast', 'dazzle', 'market', 'sprint', 'stroll', 'giants', 'lowland', 'sparse', 'dense',
  'drought', 'fleet', 'thaw', 'frosty', 'ration', 'meltfast', 'hardy', 'flurry', 'heavy', 'slippery',
  'clockwork', 'gusts', 'lock', 'fog', 'blind', 'eclipse', 'sunset', 'moonlit', 'marathon', 'boss',
] as ConceptId[]);

/** Which v1.5 core mechanics a run has (docs/V1_5_PLAN.md §2): Sunflower buds, the Cold Snap, deep shade. */
export interface Mechanics {
  readonly buds: boolean;
  readonly snap: boolean;
  readonly deep: boolean;
  /**
   * v1.6 glass (brittle) flake clusters (docs/V1_6_PLAN.md §2.3): on outside the Journey; in the
   * Journey from the 'brittle' concept's teaching level (L21).
   */
  readonly brittle: boolean;
}

export const ALL_MECHANICS: Mechanics = Object.freeze({ buds: true, snap: true, deep: true, brittle: true });

/** The level that teaches a concept (its index in the teaching order + 1), or 0 when none does. */
export function teachLevel(id: ConceptId): number {
  const i = CONCEPT_IDS.indexOf(id as (typeof CONCEPT_IDS)[number]);
  return i >= 0 && i < TEACH_LEVELS ? i + 1 : 0;
}

const mechanicsMemo: Mechanics[] = [];

/**
 * The mechanics of a campaign level: each is on from the level that teaches it (deep shade 5,
 * Sunflowers 8, Cold Snap 10) and off before it, so level 1 stays the pure lesson. Null (not a
 * campaign run): all on.
 */
export function mechanicsOf(levelId: number | null): Mechanics {
  if (levelId === null) return ALL_MECHANICS;
  let m = mechanicsMemo[levelId];
  if (!m) {
    m = Object.freeze({
      buds: levelId >= teachLevel(MECHANIC_CONCEPTS.buds),
      snap: levelId >= teachLevel(MECHANIC_CONCEPTS.snap),
      deep: levelId >= teachLevel(MECHANIC_CONCEPTS.deep),
      brittle: levelId >= teachLevel('brittle'),
    });
    mechanicsMemo[levelId] = m;
  }
  return m;
}

/** Draws the concepts of composed level `id` (41-200): the chapter's headline first, two or three in all. */
function composeConcepts(id: number, seed: number, chapter: Chapter): ConceptId[] {
  const rng = rngFor(seed, 'campaign', id);
  const i = (id - 1) % LEVELS_PER_CHAPTER;
  const finale = i === LEVELS_PER_CHAPTER - 1;
  const n = finale ? 3 : i < 3 ? 2 : rng.next() < 0.45 ? 3 : 2;
  const fits = (c: ConceptId): boolean => (CONCEPTS[c].level?.biome ?? chapter.biome) === chapter.biome;
  const signature = chapter.concepts.filter(fits);
  const pool = COMPOSE_ORDER.filter((c) => fits(c) && !COMPOSE_EXCLUDED.has(c));
  const chosen: ConceptId[] = [];
  const ok = (c: ConceptId): boolean => chosen.every((d) => conceptsCompatible(c, d));
  // The headline: a finale leads with the chapter's first concept; other levels draw one.
  chosen.push(finale ? (signature[0] as ConceptId) : rng.pick(signature));
  while (chosen.length < n) {
    const fromSignature = finale || rng.next() < 0.5;
    const a = (fromSignature ? signature : pool).filter(ok);
    const from = a.length > 0 ? a : (fromSignature ? pool : signature).filter(ok);
    if (from.length === 0) break;
    chosen.push(rng.pick(from));
  }
  return chosen;
}

/**
 * The definition of level `id` (1..200), pure in `id`. Its drain is the curve less the concepts'
 * costs (so a hard concept does not stack on the curve), over the concepts' drainMul, within the
 * caps; goals and star 2 scale with the flakes the level offers.
 */
function makeLevel(id: number): LevelDef {
  // The Dares, kept flares, bake-sized goal target and a teaching level's world variant come from
  // the bake's result (LEVEL_BAKE_RUN).
  const run = bakeRun(id);
  const seed = levelSeed(id, run?.variant ?? 0);
  const chapter = CHAPTERS[chapterOf(id) - 1] as Chapter;
  const introduces: ConceptId | null = id <= TEACH_LEVELS ? (CONCEPT_IDS[id - 1] as ConceptId) : null;
  // v1.6: every boss finale of chapters 5-20 also carries the Solar Flare, appended after the draw
  // (so the composition's draws are unchanged).
  const composed = introduces ? [introduces] : composeConcepts(id, seed, chapter);
  const concepts: readonly ConceptId[] = isBossFinale(id) ? [...composed, 'flare'] : composed;
  const biome = requiredBiome(concepts) ?? chapter.biome;
  let forecast: ForecastId = 'clear';
  let startMinute = 0;
  let lengthMinutes = curveLength(id);
  let goal: GoalKind = 'finish';
  let drain = curveDrain(id);
  let cap = DRAIN_EFFECTIVE_MAX;
  for (const c of concepts) {
    const lv = CONCEPTS[c].level;
    if (!lv) continue;
    forecast = lv.forecast ?? forecast;
    startMinute = lv.startMinute ?? startMinute;
    lengthMinutes = lv.lengthMinutes ?? lengthMinutes;
    goal = lv.goal ?? goal;
    drain -= lv.cost ?? 0;
    cap = Math.min(cap, lv.drainCap ?? cap);
  }
  const mul = foldTuning(concepts)?.drainMul ?? 1;
  drain = Math.max(DRAIN_MIN, Math.min(DRAIN_MAX, Math.round(drain / mul), Math.floor(cap / mul)));
  if (!concepts.includes('marathon')) lengthMinutes = Math.min(lengthMinutes, 720 - startMinute);
  const p = dayParams(1, 3, dayPlan(biome, forecast), concepts);
  const flakes = expectedFlakes(startMinute, lengthMinutes, concepts, biome, forecast);
  // A flake goal asks for 55% of the flakes the level offers and the flake star for 80%; otherwise
  // the star asks for 65%. A Snow goal asks for 0.7 Snow per flake offered (a kept multiplier,
  // SWINGs, PHEWs and the gate all count). The cool-run star allows 22% of the level's daylight in
  // the sun and a lowest Chill of 20% of the tank: a skilled player's shade, not a lucky one.
  let target = 0;
  let starFlakes = Math.max(2, Math.round(0.65 * flakes));
  if (goal === 'flakes') {
    target = Math.max(3, Math.round(0.55 * flakes));
    starFlakes = Math.max(target + 1, Math.round(0.8 * flakes));
  }
  // v1.6 verb goals (§2.6): a teaching level asks for the verb it teaches, kept small.
  const teach = introduces ? TEACH_GOALS[introduces] : undefined;
  if (teach) {
    goal = teach;
    target = teach === 'clean' ? (run?.goal ?? 1) : (TEACH_TARGETS[teach] ?? 1);
  }
  const flares = run ? run.flares : NO_FLARES;
  const feats = run ? run.feats : NO_FEATS;
  return Object.freeze({
    id,
    chapter: chapter.id,
    name: introduces ? CONCEPTS[introduces].title : ((NAMES[chapter.id - 5] as readonly string[])[(id - 1) % LEVELS_PER_CHAPTER] as string),
    seed,
    biome,
    forecast,
    concepts: Object.freeze(concepts.slice()),
    introduces,
    startMinute,
    lengthMinutes,
    goal: Object.freeze({ kind: goal, target }),
    stars: Object.freeze({ flakes: starFlakes, minChill: Math.round(0.2 * p.maxChill), sunSec: Math.round((2.2 * lengthMinutes * p.dayLen) / 720) / 10 }),
    drain,
    feats,
    flares,
  });
}

// ---------------------------------------------------------------------------------------------
// v1.6 Journey (docs/V1_6_PLAN.md §2.5, §2.6; CORE-2): verb goals, Dares, flare levels.

/** The verb goal of a teaching level, by the concept it teaches (others keep their concept's goal). */
const TEACH_GOALS: Readonly<Partial<Record<ConceptId, GoalKind>>> = Object.freeze({
  deep: 'deep',
  glare: 'clean',
  swing: 'swings',
  bloom: 'blooms',
  snap: 'snapSave',
  gate: 'gate',
  brittle: 'brittle',
  eclipse: 'flip',
  flare: 'parry',
});

/** Verb goal targets: deep and snapSave in ticks (1.5 s, 1 s), flip within 60 ticks of the flip; clean comes from the bake. */
const TEACH_TARGETS: Readonly<Partial<Record<GoalKind, number>>> = Object.freeze({ deep: 90, swings: 1, blooms: 1, snapSave: 60, gate: 1, brittle: 1, flip: 60, parry: 2 });

/** Every concept's Dare (§2.6 table). */
export const DARE_OF: Readonly<Record<ConceptId, FeatKind>> = Object.freeze({
  bloom: 'blooms', drought: 'blooms', sparse: 'blooms', lowland: 'blooms', heat: 'blooms',
  swing: 'swings', dazzle: 'swings', clockwork: 'swings', slippery: 'swings',
  deep: 'deep', dense: 'deep', giants: 'deep', oldtown: 'deep', noon: 'deep', sprint: 'deep',
  snap: 'snapSave', thaw: 'snapSave', ration: 'snapSave', boss: 'snapSave',
  flare: 'parry',
  brittle: 'brittle',
  flakes: 'flakes', flurry: 'flakes', meltfast: 'flakes', fog: 'flakes', blind: 'flakes',
  glare: 'clean',
  cloud: 'ride', breezy: 'ride', fleet: 'ride', overcast: 'ride',
  gate: 'gates', market: 'gates',
  eclipse: 'flip',
  lock: 'still', gusts: 'still',
  drag: 'ring', long: 'ring', stroll: 'ring', sunset: 'ring', frosty: 'ring', marathon: 'ring', moonlit: 'ring', heavy: 'ring', hardy: 'ring',
} satisfies Record<ConceptId, FeatKind>);

/** True for the boss finales of chapters 5-20 (levels 50, 60, …, 200): they carry the Solar Flare. */
export function isBossFinale(id: number): boolean {
  return id > TEACH_LEVELS && id % LEVELS_PER_CHAPTER === 0;
}

/** A boss finale's three flare phases: shares of the level [from, to] and the lift d (°). */
export const BOSS_PHASES: readonly (readonly [number, number, number])[] = [
  [0.2, 0.4, 10],
  [0.5, 0.68, 13],
  [0.76, 0.92, 16],
];

/**
 * The flares a level asks for before the bake decides them: the Solar Flare's level gets 3 at 0.30,
 * 0.55 and 0.80 of the level (d 10); a boss finale min(8, floor(level seconds / 3.2)) in three phases
 * (0.20-0.40, 0.50-0.68, 0.76-0.92 of the level, d 10, 13 and 16), spread evenly in each phase.
 */
export function nominalFlares(id: number, startMinute: number, lengthMinutes: number): readonly LevelFlare[] {
  const out: LevelFlare[] = [];
  const at = (frac: number, d: number): void => {
    out.push(Object.freeze({ minute: startMinute + frac * lengthMinutes, d }));
  };
  if (id <= TEACH_LEVELS) {
    if (CONCEPT_IDS[id - 1] === 'flare') for (const f of [0.3, 0.55, 0.8]) at(f, 10);
    return Object.freeze(out);
  }
  if (!isBossFinale(id)) return Object.freeze(out);
  const sec = (lengthMinutes / 720) * 50;
  const n = Math.min(8, Math.floor(sec / 3.2));
  for (let k = 0; k < 3; k++) {
    const [a, b, d] = BOSS_PHASES[k] as [number, number, number];
    const m = Math.floor((n + k) / 3);
    for (let i = 0; i < m; i++) at(a + ((b - a) * (i + 0.5)) / m, d);
  }
  return Object.freeze(out);
}

/** The fingerprint of a level's world identity that its bake entry must match (hex). */
export function levelBakeKey(seed: number, concepts: readonly ConceptId[], drain: number, startMinute: number, lengthMinutes: number, biome: BiomeId, forecast: ForecastId, flares: readonly LevelFlare[]): string {
  const f = flares.map((x) => `${x.minute}:${x.d}`).join(',');
  const tune = JSON.stringify(foldTuning(concepts));
  return hashString(`${seed}|${concepts.join(',')}|${tune}|${drain}|${startMinute}|${lengthMinutes}|${biome}|${forecast}|${f}|v${BAKE_VERSION}`).toString(16);
}

/** Bump when the generator changes what a level offers (every bake entry goes stale). */
export const BAKE_VERSION = 4;

/**
 * Level `id`'s seed: hashString(`journey-${id}`), or for world variant `variant` > 0 (a teaching
 * level whose own world walls its lesson off, LevelBake.variant) hashString(`journey-${id}-${variant}`).
 */
export function levelSeed(id: number, variant: number): number {
  return hashString(variant > 0 ? `journey-${id}-${variant}` : `journey-${id}`);
}

const NO_FLARES: readonly LevelFlare[] = Object.freeze([]);
const NO_FEATS: readonly FeatSpec[] = Object.freeze([]);
/** Every Dare kind; LEVEL_BAKE_RUN's Dare letters are their indices: a = blooms … m = ring. */
export const FEAT_KINDS: readonly FeatKind[] = Object.freeze(['blooms', 'swings', 'deep', 'snapSave', 'parry', 'brittle', 'flakes', 'clean', 'ride', 'gates', 'flip', 'still', 'ring'] as FeatKind[]);
let runEntries: string[] | null = null;

/**
 * Level `id`'s bake result (LEVEL_BAKE_RUN, entry id − 1 of the ';'-separated list): its Dares
 * (letter + target each), its kept flares (minute:d, ','-separated), a bake-sized goal target and a
 * teaching level's world variant ('/'-separated fields; the last two may be left out), or null when
 * the bake has no entry for it.
 */
function bakeRun(id: number): { feats: readonly FeatSpec[]; flares: readonly LevelFlare[]; goal: number | null; variant: number } | null {
  const entries = (runEntries ??= LEVEL_BAKE_RUN.split(';'));
  const e = entries[id - 1];
  if (e === undefined || e === '') return null;
  const [fs = '', fl = '', g = '', v = ''] = e.split('/');
  const feats: FeatSpec[] = [];
  for (const m of fs.matchAll(/([a-m])(\d+)/g)) feats.push(Object.freeze({ kind: FEAT_KINDS[(m[1] as string).charCodeAt(0) - 97] as FeatKind, target: Number(m[2]) }));
  const flares: LevelFlare[] = [];
  for (const x of fl === '' ? [] : fl.split(',')) {
    const [minute, d] = x.split(':');
    flares.push(Object.freeze({ minute: Number(minute), d: Number(d) }));
  }
  return { feats: Object.freeze(feats), flares: Object.freeze(flares), goal: g === '' ? null : Number(g), variant: v === '' ? 0 : Number(v) };
}

/**
 * Tooling (scripts/sim16/bake.ts, the bake test): level `l`'s LEVEL_BAKE_RUN entry from what the bake
 * measured: its Dares (assignFeats), its kept flares, for the glare lesson the clean goal (every ball
 * with a glare-free line, minus one, at least 1), and a teaching level's world variant.
 */
export function bakeRunEntry(l: LevelDef, bake: LevelBake): string {
  const feats = assignFeats(l, bake);
  const fs = feats.map((f) => String.fromCharCode(97 + FEAT_KINDS.indexOf(f.kind)) + f.target).join('');
  const fl = bake.flares.map((f) => `${f.minute}:${f.d}`).join(',');
  const g = String(bakedGoal(l, bake) ?? '');
  return `${fs}/${fl}/${g}${bake.variant > 0 ? `/${bake.variant}` : ''}`;
}

/** A teaching goal the bake sizes from the world (the glare lesson: every ball with a glare-free line, minus one, at least 1), else null. */
export function bakedGoal(l: LevelDef, bake: Pick<LevelBake, 'balls'>): number | null {
  return l.introduces && TEACH_GOALS[l.introduces] === 'clean' ? Math.max(1, bake.balls - 1) : null;
}

/** The concepts a level carries that set a mechanic or world feature a Dare needs. */
function dareFits(kind: FeatKind, id: number, concepts: readonly ConceptId[], keptFlares: number, bake: LevelBake | null, sec: number): boolean {
  const m = mechanicsOf(id);
  switch (kind) {
    case 'blooms':
      return m.buds;
    case 'deep':
      // Deep shade the level offers: at least DEEP_OFFER × the smallest deep Dare.
      return m.deep && (bake === null || bake.deep >= DEEP_OFFER * DEEP_MIN_TICKS);
    case 'flakes':
      return bake === null || bake.flakes >= FLAKES_OFFER_MIN;
    case 'snapSave':
      // A level that dares a snap starts with one ready (create.ts startsWithSnap): the Dare is when to cast it.
      return m.snap;
    case 'brittle':
      return m.brittle && (bake === null || bake.glass > 0);
    case 'parry':
      // Flares a fixed angle parries (the bake's stillFlares): the Dare asks only for what a reader of the telegraph can meet.
      return bake === null ? keptFlares > 0 : bake.stillFlares > 0;
    case 'clean':
      return bake === null || bake.balls > 0;
    case 'still':
      return bake === null || bake.holdable > 0;
    case 'swings':
      return bake === null || bake.swings >= SWING_OFFER_PER * (sec > 30 ? 3 : 2);
    case 'ring':
      // Retired (fix round 3): measured on every level that offered it (52), the ring never needed its
      // verb (good shade play reaches the same level, and the human models seldom pass x3), so its
      // concepts dare their other candidates (FeatKind keeps it for older saves and the HUD).
      return false;
    case 'ride': {
      // A ride the level offers with room to spare: one cloud for RIDE_OFFER_SEC, or RIDE_OFFER_CLOUDS clouds for ≥ 1 s.
      const t = foldTuning(concepts);
      if ((t?.cloudCount ?? 1) <= 0) return false;
      return bake === null || bake.rideBest >= RIDE_OFFER_SEC || bake.rides >= RIDE_OFFER_CLOUDS;
    }
    default:
      return true;
  }
}

/**
 * The deep Dare's least target (ticks), the deep shade a level must offer per target tick to carry
 * it, and the share of the level's daylight it asks for (sized so that sitting in the teal does not
 * meet it by itself: 12% was met by 90% of non-seeking reactive runs).
 */
const DEEP_MIN_TICKS = 90;
const DEEP_OFFER = 4;
const DEEP_SHARE = 0.16;
/** The ride Dare needs a level offering one cloud ride of this many seconds, or this many clouds for ≥ 1 s. */
const RIDE_OFFER_SEC = 3.5;
const RIDE_OFFER_CLOUDS = 4;
/** The flakes Dare needs this many plain flakes on the trail; it asks for 80% of the expected flakes, expected being 85% of those offered. */
const FLAKES_OFFER_MIN = 5;
const FLAKES_EXPECTED = 0.85;
/** The swings Dare needs this many SWING hand-offs offered per SWING asked. */
const SWING_OFFER_PER = 4;
/** The share of a level's daylight a steady player keeps Nubs in full shade (the reactive bot's ~84%). */
const RING_PLAIN_SHADE = 0.85;

/**
 * The ring Dare's level: the first one that plain steady shade (RING_PLAIN_SHADE of the level's
 * daylight at shadeUnits a tick) does not reach, so the Dare asks for the verbs that pump the ring
 * (deep shade, fresh SWINGs, blooms, glass, parries); x3 at least, x5 at most.
 */
function ringTarget(daylightTicks: number): number {
  const plain = RING_PLAIN_SHADE * daylightTicks * TUNING.ring.shadeUnits;
  let m = 1;
  let need = 0;
  while (m < 5 && need + (TUNING.ring.need[m - 1] as number) <= plain) need += TUNING.ring.need[m++ - 1] as number;
  return Math.max(3, Math.min(5, m + 1));
}

/** A Dare's target sized from the level's offers alone (a bake without measured Dares: `offerFeats`). */
function dareTarget(kind: FeatKind, lengthMinutes: number, dayLen: number, daylightTicks: number, flakes: number, keptFlares: number, bake: LevelBake | null): number {
  const sec = (lengthMinutes / 720) * dayLen;
  switch (kind) {
    case 'blooms':
      return Math.max(1, Math.min(4, Math.round(0.35 * (bake ? bake.buds : sec / 4))));
    case 'swings':
      return sec > 30 ? 3 : 2;
    case 'deep':
      return Math.max(DEEP_MIN_TICKS, Math.min(Math.round(DEEP_SHARE * daylightTicks), bake ? Math.floor(bake.deep / DEEP_OFFER) : Infinity));
    case 'snapSave':
      return 60;
    case 'parry':
      return Math.max(1, Math.ceil(0.75 * (bake ? bake.stillFlares : keptFlares)));
    case 'brittle':
      return Math.max(1, Math.ceil(0.6 * (bake ? bake.glass : 1)));
    case 'flakes':
      return Math.max(3, Math.round(0.8 * (bake ? Math.min(flakes, FLAKES_EXPECTED * bake.flakes) : flakes)));
    case 'clean':
      return Math.max(1, bake ? bake.balls : 1);
    case 'still':
      return Math.max(1, Math.ceil((bake ? bake.holdable : 2) / 2));
    case 'ring':
      return ringTarget(daylightTicks);
    default:
      return 1;
  }
}

/**
 * The Dares sized from the offers alone (a bake that measured no Dares, e.g. a level built in a
 * test): the first of its concepts whose Dare fits the level (the mechanic it needs is on, the level
 * offers it), else a core verb drawn from (seed, 'dare', id); finales offer a second.
 */
function offerFeats(l: LevelDef, bake: LevelBake | null): readonly FeatSpec[] {
  const p = dayParams(1, 3, dayPlan(l.biome, l.forecast), l.concepts);
  const flakes = expectedFlakes(l.startMinute, l.lengthMinutes, l.concepts, l.biome, l.forecast);
  const daylightTicks = Math.round((l.lengthMinutes / 720) * p.dayLen * 60);
  const keptFlares = bake ? bake.flares.length : l.flares.length;
  const fits = (k: FeatKind): boolean => dareFits(k, l.id, l.concepts, keptFlares, bake, (l.lengthMinutes / 720) * p.dayLen);
  const spec = (k: FeatKind): FeatSpec => Object.freeze({ kind: k, target: dareTarget(k, l.lengthMinutes, p.dayLen, daylightTicks, flakes, keptFlares, bake) });
  const rng = rngFor(l.seed, 'dare', l.id);
  const taught = (k: FeatKind): boolean => k !== 'swings' || l.id >= teachLevel('swing');
  const fallback = (not: FeatKind | null): FeatKind => {
    const pool = CORE_DARES.filter((k) => k !== not && taught(k) && fits(k));
    if (pool.length > 0) return rng.pick(pool);
    return SHADE_DARES.find((k) => k !== not && fits(k)) ?? 'flakes';
  };
  let first: FeatKind | null = null;
  for (const c of l.concepts) {
    const k = DARE_OF[c];
    if (c !== 'flare' && fits(k)) {
      first = k;
      break;
    }
  }
  if (first === null) first = l.concepts.includes('flare') && fits('parry') && !isBossFinale(l.id) ? 'parry' : fallback(null);
  const out = [spec(first)];
  if (l.id % LEVELS_PER_CHAPTER === 0) {
    const second = isBossFinale(l.id) && fits('parry') && first !== 'parry' ? 'parry' : fallback(first);
    if (second !== first) out.push(spec(second));
  }
  return Object.freeze(out);
}

/**
 * The core verbs a level falls back to when none of its concepts' Dares needs its verb there (in an
 * order drawn from (seed, 'dare', id)), then the shade verbs. Fix round 3: blooms, SWINGs and the
 * snap are the verbs the players who seek them reach and the others do not; the other kinds come
 * to good shade play by themselves on most levels (a measured Dare is sized above that, `sizeDare`).
 */
const CORE_DARES: readonly FeatKind[] = Object.freeze(['blooms', 'swings', 'snapSave'] as FeatKind[]);
const SHADE_DARES: readonly FeatKind[] = Object.freeze(['flakes', 'deep'] as FeatKind[]);

/** The bake's training decision streams per human model (humanDial, humanFeat): scripts/sim16/dares.ts SIZE_SALTS. */
export const DARE_PLAYERS = 10;
/** Of the DARE_PLAYERS humanDial players (who do not seek the Dare), at most this many may meet it. */
const DARE_NOT_MAX = 2;
/** Of the DARE_PLAYERS humanFeat players (who seek it), at least this many must meet it. */
const DARE_SEEK_MIN = 7;
/** …and for the minor kinds (beyond the core verbs and flakes), which dare a few levels each: this many. */
const DARE_SEEK_MIN_MINOR = 8;
/** Each kind's least target (deep and snapSave in ticks). */
const DARE_FLOOR: Readonly<Record<FeatKind, number>> = Object.freeze({
  blooms: 1, swings: 1, deep: DEEP_MIN_TICKS, snapSave: 60, parry: 1, brittle: 1, flakes: 3, clean: 1, ride: 1, gates: 1, flip: 1, still: 1, ring: 3,
});
/**
 * The kinds the oracle plays by plan on every level (its parry and glass plans, bots/world.ts): it
 * is not a player who does not seek them, so their Dares are sized above the reactive bot and
 * humanDial only (review of economy iteration 2: on every boss it parried every kept flare, so no
 * parry target could sit above it).
 */
export const ORACLE_PLANS: readonly FeatKind[] = Object.freeze(['parry', 'brittle'] as FeatKind[]);
/** Dares counted in ticks: sized in whole tenths of a second, clear of the non-seekers by 12 ticks and 10%. */
const tickDare = (k: FeatKind): boolean => k === 'deep' || k === 'snapSave';
/** Dares met or not (their value is 0 or 1). */
const binaryDare = (k: FeatKind): boolean => k === 'ride' || k === 'flip';
/** The goal kinds whose counter is a Dare kind's (the gate goal counts the arch shaded, the Dare deep; flip within 60 ticks, the Dare 12). */
const GOAL_COUNTS_AS: Readonly<Partial<Record<GoalKind, FeatKind>>> = Object.freeze({
  deep: 'deep', clean: 'clean', swings: 'swings', blooms: 'blooms', snapSave: 'snapSave', brittle: 'brittle', parry: 'parry', flakes: 'flakes',
});

/** A Dare sized from a DareMeasure: its target, how well it fits (3 best, `sizeDare`) and how many humanFeat players met it. */
export interface DareSize {
  readonly target: number;
  readonly tier: 0 | 1 | 2 | 3;
  readonly met: number;
}

/** A Dare's least target on level `l`: its kind's floor, and more than the goal when the goal counts the same thing. */
export function dareFloor(l: LevelDef, kind: FeatKind): number {
  const floor = DARE_FLOOR[kind];
  return GOAL_COUNTS_AS[l.goal.kind] === kind ? Math.max(floor, l.goal.target + (tickDare(kind) ? 6 : 1)) : floor;
}

/**
 * A Dare of `kind` sized from what the bake measured, at least `floor` (fix round 3: "Dares need
 * their verb"). Tier 3: it needs its verb there: the target is just above what the players who do
 * not seek it reach (the reactive bot and the oracle stay under it, at most DARE_NOT_MAX of the
 * humanDial players reach it; ticks clear by 12 and 10%), and the seekers reach it (the Feat-seeking
 * oracle, and at least DARE_SEEK_MIN of the humanFeat players). Tier 2: that target, which the
 * Feat-seeking oracle meets but fewer humanFeat players. Tier 1: no target needs the verb here, so it
 * is what the Feat-seeking oracle reaches (the others may meet it too). Tier 0: not even that.
 */
export function sizeDare(kind: FeatKind, m: DareMeasure, floor: number): DareSize {
  const [r = -1, o0 = -1, ...hd] = m.not;
  // The oracle plays the flares and the glass by plan (bots/world.ts): for those kinds it seeks the
  // verb whatever its Dare, so only the reactive bot and humanDial are the players who do not.
  const o = ORACLE_PLANS.includes(kind) ? -1 : o0;
  const [f = -1, ...hf] = m.seek;
  const top = hd.slice().sort((a, b) => b - a);
  const base = Math.max(r, o, top[DARE_NOT_MAX] ?? -1, 0);
  const above = binaryDare(kind) ? 1 : tickDare(kind) ? 6 * Math.ceil(Math.max(base + 12, Math.ceil(1.1 * base)) / 6) : base + 1;
  const target = Math.max(above, floor);
  const metBy = (t: number): number => hf.filter((v) => v >= t).length;
  const quiet = r < target && o < target && hd.filter((v) => v >= target).length <= DARE_NOT_MAX;
  if (quiet && f >= target) {
    const met = metBy(target);
    return { target, tier: met >= (CORE_DARES.includes(kind) || kind === 'flakes' ? DARE_SEEK_MIN : DARE_SEEK_MIN_MINOR) ? 3 : 2, met };
  }
  const own = Math.max(floor, tickDare(kind) ? 6 * Math.floor(f / 6) : f);
  return f >= own ? { target: own, tier: 1, met: metBy(own) } : { target, tier: 0, met: 0 };
}

/** True when level `l` starts with a snap ready whatever its Dares (the Cold Snap's lesson, a snapSave goal). */
export function snapByGoal(l: LevelDef): boolean {
  return l.introduces === 'snap' || l.goal.kind === 'snapSave';
}

/**
 * Level `l`'s Dare candidates, in order: its concepts' Dares, then the core verbs in an order drawn
 * from (seed, 'dare', id), then the shade verbs; each only where the level offers it (dareFits) and
 * SWINGs from their lesson on. A finale's second Dare (`first` set) is another kind, and the
 * snapSave Dare only where the level starts with a snap anyway (its first Dare was measured that way).
 */
export function dareCandidates(l: LevelDef, bake: LevelBake | null, first: FeatKind | null): FeatKind[] {
  const p = dayParams(1, 3, dayPlan(l.biome, l.forecast), l.concepts);
  const sec = (l.lengthMinutes / 720) * p.dayLen;
  const keptFlares = bake ? bake.flares.length : l.flares.length;
  const snapStart = snapByGoal(l) || first === 'snapSave';
  const out: FeatKind[] = [];
  const add = (k: FeatKind): void => {
    if (out.includes(k) || k === first) return;
    if (k === 'swings' && l.id < teachLevel('swing')) return;
    if (first !== null && k === 'snapSave' && !snapStart) return;
    if (dareFits(k, l.id, l.concepts, keptFlares, bake, sec)) out.push(k);
  };
  for (const c of l.concepts) add(DARE_OF[c]);
  const rng = rngFor(l.seed, 'dare', l.id);
  const core = CORE_DARES.slice();
  for (let i = core.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    const t = core[i] as FeatKind;
    core[i] = core[j] as FeatKind;
    core[j] = t;
  }
  for (const k of core) add(k);
  for (const k of SHADE_DARES) add(k);
  return out;
}

/**
 * Where no candidate needs its verb with enough seekers (mostly the late levels the human models
 * rarely finish, and the first levels before any verb is taught), the level dares the first of these
 * at the least tier given, in this order: a core verb the players who do not seek it stay under and
 * the Feat-seeking oracle meets (tier 2), else flakes, which every level offers (tier 1: on the first
 * levels every player collects the flakes, so that Dare is a plain one). This keeps the kinds that
 * dare only a few levels to the levels where they need their verb.
 */
const FALLBACK_DARES: readonly (readonly [FeatKind, number])[] = Object.freeze([
  ['blooms', 2],
  ['snapSave', 2],
  ['swings', 2],
  ['flakes', 1],
] as [FeatKind, number][]);

/**
 * The Dare among `cands` (in order) given what was measured (`measured(kind)`): the first that needs
 * its verb (sizeDare tier 3), else the first FALLBACK_DARES entry it reaches, else the best fit (tier,
 * then humanFeat players); none below tier `least`. `next` is the first candidate not measured yet
 * when the pick depends on it (the bake measures it and asks again).
 */
export function pickDare(l: LevelDef, cands: readonly FeatKind[], measured: (k: FeatKind) => DareMeasure | undefined, least = 0): { spec: FeatSpec | null; next: FeatKind | null } {
  let best: { kind: FeatKind; size: DareSize } | null = null;
  const sizes = new Map<FeatKind, DareSize>();
  for (const k of cands) {
    const m = measured(k);
    if (!m) return { spec: null, next: k };
    const size = sizeDare(k, m, dareFloor(l, k));
    if (size.tier === 3) return { spec: Object.freeze({ kind: k, target: size.target }), next: null };
    sizes.set(k, size);
    if (!best || size.tier > best.size.tier || (size.tier === best.size.tier && size.met > best.size.met)) best = { kind: k, size };
  }
  for (const [k, tier] of FALLBACK_DARES) {
    const size = sizes.get(k);
    if (size && size.tier >= tier && size.tier >= least) return { spec: Object.freeze({ kind: k, target: size.target }), next: null };
  }
  return { spec: best && best.size.tier >= least ? Object.freeze({ kind: best.kind, target: best.size.target }) : null, next: null };
}

/** Where a finale's second Dare's measures are looked up: its own (dares2), then the first Dare's when measured the same way. */
export function secondMeasures(l: LevelDef, bake: LevelBake, first: FeatKind): (k: FeatKind) => DareMeasure | undefined {
  const same = snapByGoal(l) || first !== 'snapSave';
  return (k) => bake.dares2.find((m) => m.kind === k) ?? (same ? bake.dares.find((m) => m.kind === k) : undefined);
}

/** A finale's second Dare must need its verb too (sizeDare tier 3): either Dare earns the star, so a weaker one would void the first. */
const SECOND_DARE_TIER = 3;

/**
 * A level's Dares from what the bake measured (fix round 3): `pickDare` over its candidates, and on
 * a finale a second Dare of another kind unless that would be free (below SECOND_DARE_TIER: either
 * Dare earns the star, so a free one would void the first); the offer-sized Dares (`offerFeats`)
 * when nothing was measured.
 */
function assignFeats(l: LevelDef, bake: LevelBake): readonly FeatSpec[] {
  if (bake.dares.length === 0) return offerFeats(l, bake);
  const first = pickDare(l, dareCandidates(l, bake, null), (k) => bake.dares.find((m) => m.kind === k)).spec;
  if (!first) return offerFeats(l, bake);
  const out: FeatSpec[] = [first];
  if (l.id % LEVELS_PER_CHAPTER === 0) {
    const look = secondMeasures(l, bake, first.kind);
    const second = bossParry(l, bake, first.kind, look) ?? pickDare(l, dareCandidates(l, bake, first.kind), look, SECOND_DARE_TIER).spec;
    if (second) out.push(second);
  }
  return Object.freeze(out);
}

/**
 * A boss finale (the Solar Flare's) offers a parry Dare beside its first one whenever parry needs
 * its verb there (sizeDare tier 2 or 3: the players who do not seek it stay under it, so it is not
 * free and cannot void the first Dare); null otherwise.
 */
export function bossParry(l: LevelDef, bake: LevelBake, first: FeatKind, look: (k: FeatKind) => DareMeasure | undefined): FeatSpec | null {
  if (!isBossFinale(l.id) || first === 'parry' || !dareCandidates(l, bake, first).includes('parry')) return null;
  const m = look('parry');
  if (!m) return null;
  const size = sizeDare('parry', m, dareFloor(l, 'parry'));
  return size.tier >= 2 ? Object.freeze({ kind: 'parry', target: size.target }) : null;
}

/** The share of humanDial players who must pass a teaching level on their first try (`lessonReads`). */
export const LESSON_SHARE = 0.8;

/**
 * Fix round 3 (teaching without walls): a teaching level's world reads when a dial-following player
 * meets its verb goal (and finishes) on the first try: humanDial on LESSON_SHARE of the `players`
 * streams played, the oracle passes and the reactive bot finishes. The bake plays world variants
 * (`levelSeed`) until one reads on its training streams, then confirms it on fresh ones.
 */
export function lessonReads(humanPasses: number, players: number, oraclePassed: boolean, reactiveWon: boolean): boolean {
  return humanPasses >= LESSON_SHARE * players && oraclePassed && reactiveWon;
}

/** Goal misses (a finish reached without the goal) after which the level's goal relaxes to 'finish' (§2.6 soft-fail). */
export const SOFT_FAIL_MISSES = 2;
/** The first chapter's levels (the first verbs) relax after a single miss. */
const SOFT_FAIL_EARLY_LEVELS = 10;

/** Goal misses after which level `level`'s goal relaxes: one on levels 1-10, else SOFT_FAIL_MISSES. */
export function softFailMisses(level: LevelDef): number {
  return level.id <= SOFT_FAIL_EARLY_LEVELS ? 1 : SOFT_FAIL_MISSES;
}

/** True when level `l` dares a snap (a snapSave Dare or goal): it starts with a snap ready, as the Cold Snap's own level does. */
export function startsWithSnap(l: LevelDef): boolean {
  return l.introduces === 'snap' || l.goal.kind === 'snapSave' || l.feats.some((f) => f.kind === 'snapSave');
}

/** True when a level's goal is relaxed after `misses` goal misses (RunConfig.relaxedGoal; a 'finish' level never relaxes). */
export function relaxedGoalFor(level: LevelDef, misses: number): boolean {
  return level.goal.kind !== 'finish' && misses >= softFailMisses(level);
}

/** Builds the 200 levels (pure; the same table every time). */
export function buildCampaign(): readonly LevelDef[] {
  const out: LevelDef[] = [];
  for (let id = 1; id <= LEVEL_COUNT; id++) out.push(makeLevel(id));
  return Object.freeze(out);
}

/** The campaign, built at module load. */
export const CAMPAIGN_LEVELS: readonly LevelDef[] = buildCampaign();

/** Level `id` (1..200), or null. */
export function levelDef(id: number): LevelDef | null {
  if (!Number.isInteger(id) || id < 1 || id > LEVEL_COUNT) return null;
  return CAMPAIGN_LEVELS[id - 1] as LevelDef;
}

/** The brittle concept's teaching level makes this share of its eligible clusters glass (§2.3). */
const BRITTLE_TEACH_SHARE = 0.6;
const glassMemo = new Map<number, number>();

/**
 * v1.6 glass (§2.3): the glass quota of a Journey level (once Mechanics.brittle is on, from L21):
 * 60% on the brittle concept's own level, else TUNING.brittle.quotaDay1; on a level with a flake goal
 * or a concept whose Dare is 'flakes' it is capped at (1 − target / expected) − 0.15, so the flakes
 * stay collectable.
 */
export function levelGlassShare(level: LevelDef): number {
  const hit = glassMemo.get(level.id);
  if (hit !== undefined) return hit;
  let q = level.introduces === 'brittle' ? BRITTLE_TEACH_SHARE : TUNING.brittle.quotaDay1;
  const expected = expectedFlakes(level.startMinute, level.lengthMinutes, level.concepts, level.biome, level.forecast);
  // A flake goal, or a concept that may carry the flakes Dare (its target is 80% of the expected
  // flakes at most): world identity from the concepts alone, so the bake that sizes the Dares from
  // this world never feeds back into it.
  let target = level.goal.kind === 'flakes' ? level.goal.target : 0;
  if (level.concepts.some((c) => DARE_OF[c] === 'flakes')) target = Math.max(target, Math.round(0.8 * expected));
  if (target > 0 && expected > 0) q = Math.min(q, Math.max(0, 1 - target / expected - 0.15));
  glassMemo.set(level.id, q);
  return q;
}

/**
 * v1.6 (§2.6): what a Dare of `kind` counts in these stats (RunStats counters; a missing value is 0):
 * blooms, SWINGs, deep-shade ticks, earned-snap-saved ticks, parries, glass clusters saved, flakes,
 * clean balls; ride 1 for a best ride ≥ 2.5 s or ≥ 3 clouds ridden ≥ 0.5 s; gates the arches walked
 * under in deep shade; flip 1 when shaded within 12 ticks of the eclipse flip; still the lock and
 * gust windows held fully shaded; ring the best multiplier level.
 */
export function featValue(kind: FeatKind, stats: LevelStats): number {
  switch (kind) {
    case 'blooms':
      return stats.blooms ?? 0;
    case 'swings':
      return stats.swings ?? 0;
    case 'deep':
      return stats.deepTicks ?? 0;
    case 'snapSave':
      // Any snap's ticks alone over Nubs' center: a snapSave level starts with its snap ready (create.ts).
      return stats.snapSavedTicks ?? 0;
    case 'parry':
      return stats.parries ?? 0;
    case 'brittle':
      return stats.brittleSaved ?? 0;
    case 'flakes':
      return stats.flakes;
    case 'clean':
      return stats.ballsPassedClean ?? 0;
    case 'ride':
      return (stats.cloudRideBest ?? 0) >= RIDE_BEST_SEC || (stats.cloudsRidden ?? 0) >= RIDE_COUNT ? 1 : 0;
    case 'gates':
      return stats.gateDeep ?? 0;
    case 'flip': {
      const t = stats.flipTicks ?? 0;
      return t > 0 && t <= FLIP_DARE_TICKS ? 1 : 0;
    }
    case 'still':
      return (stats.lockHeld ?? 0) + (stats.gustHeld ?? 0);
    case 'ring':
      return stats.maxMult ?? 1;
  }
}

/** The 'ride' Dare: a best ride of this many seconds, or this many clouds ridden ≥ 0.5 s. */
const RIDE_BEST_SEC = 2.5;
const RIDE_COUNT = 3;
/** The 'flip' Dare: shaded within this many ticks of the eclipse flip. */
const FLIP_DARE_TICKS = 12;

/** True when any of the level's Dares is met (finales offer two; either earns star 2). */
export function featMet(level: LevelDef, stats: LevelStats): boolean {
  for (const f of level.feats) if (featValue(f.kind, stats) >= f.target) return true;
  return false;
}

/** The live count of a level's goal (the HUD's pill): the goal's counter in these stats (0 for 'finish'). */
export function goalValue(kind: GoalKind, stats: LevelStats): number {
  switch (kind) {
    case 'flakes':
      return stats.flakes;
    case 'snow':
      return stats.snow;
    case 'deep':
      return stats.deepTicks ?? 0;
    case 'clean':
      return stats.ballsPassedClean ?? 0;
    case 'swings':
      return stats.swings ?? 0;
    case 'blooms':
      return stats.blooms ?? 0;
    case 'snapSave':
      return stats.snapSavedTicks ?? 0;
    case 'gate':
      return stats.gateShaded ?? 0;
    case 'brittle':
      return stats.brittleSaved ?? 0;
    case 'flip':
      return stats.flipTicks ?? 0;
    case 'parry':
      return stats.parries ?? 0;
    default:
      return 0;
  }
}

/**
 * True when the level's goal is met by these stats (a 'finish' goal is met by reaching the line;
 * 'flip' when Nubs was shaded within `target` ticks of the eclipse flip; the others when their
 * counter reaches the target). `relaxed` (RunConfig.relaxedGoal, the v1.6 soft-fail after two
 * misses) scores the goal as 'finish'.
 */
export function goalMet(level: LevelDef, stats: LevelStats, relaxed = false): boolean {
  if (relaxed) return true;
  const g = level.goal;
  if (g.kind === 'finish') return true;
  const v = goalValue(g.kind, stats);
  if (g.kind === 'flip') return v > 0 && v <= g.target;
  return v >= g.target;
}

/**
 * Stars for a run that reached the finish line with these stats: 0 when the goal is not met, else
 * 1, +1 for a Dare met (featMet; a level without Dares: flakes ≥ stars.flakes), +1 for a cool run
 * (lit ≤ stars.sunSec s and lowest Chill ≥ stars.minChill).
 */
export function starsFor(level: LevelDef, stats: LevelStats, relaxed = false): 0 | 1 | 2 | 3 {
  if (!goalMet(level, stats, relaxed)) return 0;
  const two = level.feats.length > 0 ? featMet(level, stats) : stats.flakes >= level.stars.flakes;
  const three = stats.minChill >= level.stars.minChill && (stats.litTotal ?? 0) <= level.stars.sunSec;
  return two && three ? 3 : two || three ? 2 : 1;
}
