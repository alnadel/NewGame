// The Journey campaign (CAMPAIGN_PLAN §2-§3): 200 levels in 20 chapters. Levels 1-40 each introduce
// one concept of the catalog (config/concepts.ts) in teaching order; levels 41-200 compose two or
// three concepts per level around the chapter's theme, with drain and length rising by a chapter
// curve and star thresholds scaling with the level's length. Everything is a pure function of the
// level id (seed = hashString(`journey-${id}`); composition draws from rngFor(seed, 'campaign', id)),
// so buildCampaign() is deterministic and the table is data.

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
}

export interface LevelDef {
  /** 1..200. */
  readonly id: number;
  /** 1..20 (10 levels each). */
  readonly chapter: number;
  /** Short, playful: "First Shade", "Glass Garden". */
  readonly name: string;
  /** hashString(`journey-${id}`). */
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
  const seed = hashString(`journey-${id}`);
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
  // The Dares, kept flares and bake-sized goal targets come from the bake's result (LEVEL_BAKE_RUN).
  const run = bakeRun(id);
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

/** The fallback Dares (core verbs), drawn from (seed, 'dare', id) when no concept's Dare can be played. */
const FALLBACK_DARES: readonly FeatKind[] = Object.freeze(['blooms', 'swings', 'deep', 'snapSave'] as FeatKind[]);
/** When no core verb fits (the first levels), the first of these the level offers. */
const LAST_DARES: readonly FeatKind[] = Object.freeze(['flakes', 'clean', 'ride'] as FeatKind[]);

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
export const BAKE_VERSION = 3;

const NO_FLARES: readonly LevelFlare[] = Object.freeze([]);
const NO_FEATS: readonly FeatSpec[] = Object.freeze([]);
/** LEVEL_BAKE_RUN's Dare letters: a = blooms … m = ring. */
const FEAT_CODES: readonly FeatKind[] = ['blooms', 'swings', 'deep', 'snapSave', 'parry', 'brittle', 'flakes', 'clean', 'ride', 'gates', 'flip', 'still', 'ring'];
let runEntries: string[] | null = null;

/**
 * Level `id`'s bake result (LEVEL_BAKE_RUN, entry id − 1 of the ';'-separated list): its Dares
 * (letter + target each), its kept flares (minute:d, ','-separated) and a bake-sized goal target
 * ('/'-separated fields), or null when the bake has no entry for it.
 */
function bakeRun(id: number): { feats: readonly FeatSpec[]; flares: readonly LevelFlare[]; goal: number | null } | null {
  const entries = (runEntries ??= LEVEL_BAKE_RUN.split(';'));
  const e = entries[id - 1];
  if (e === undefined || e === '') return null;
  const [fs = '', fl = '', g = ''] = e.split('/');
  const feats: FeatSpec[] = [];
  for (const m of fs.matchAll(/([a-m])(\d+)/g)) feats.push(Object.freeze({ kind: FEAT_CODES[(m[1] as string).charCodeAt(0) - 97] as FeatKind, target: Number(m[2]) }));
  const flares: LevelFlare[] = [];
  for (const x of fl === '' ? [] : fl.split(',')) {
    const [minute, d] = x.split(':');
    flares.push(Object.freeze({ minute: Number(minute), d: Number(d) }));
  }
  return { feats: Object.freeze(feats), flares: Object.freeze(flares), goal: g === '' ? null : Number(g) };
}

/**
 * Tooling (scripts/sim16/bake.ts, the bake test): level `l`'s LEVEL_BAKE_RUN entry from what the bake
 * measured: its Dares (assignFeats over the offers), its kept flares and, for the glare lesson, the
 * clean goal (every ball with a glare-free line, minus one, at least 1).
 */
export function bakeRunEntry(l: LevelDef, bake: LevelBake): string {
  const p = dayParams(1, 3, dayPlan(l.biome, l.forecast), l.concepts);
  const flakes = expectedFlakes(l.startMinute, l.lengthMinutes, l.concepts, l.biome, l.forecast);
  const daylightTicks = Math.round((l.lengthMinutes / 720) * p.dayLen * 60);
  const feats = assignFeats(l.id, l.seed, l.concepts, l.lengthMinutes, p.dayLen, daylightTicks, flakes, bake.flares.length, bake);
  const fs = feats.map((f) => String.fromCharCode(97 + FEAT_CODES.indexOf(f.kind)) + f.target).join('');
  const fl = bake.flares.map((f) => `${f.minute}:${f.d}`).join(',');
  const g = l.introduces && TEACH_GOALS[l.introduces] === 'clean' ? String(Math.max(1, bake.balls - 1)) : '';
  return `${fs}/${fl}/${g}`;
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
      // Only where a verb pumps the ring past what plain shade reaches (its target is the first level
      // plain shade does not reach): deep shade, blooms, glass or parries. Fix round 2: on the first
      // levels (no pump yet) 'reach x4' was met by no bot, the Feat-seeking oracle included.
      return (m.deep || m.buds || m.brittle || keptFlares > 0) && (bake === null || bake.shadeRun >= RING_RUN_X3);
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
/** The ring Dare needs a fully shaded stretch of this many ticks on offer. */
const RING_RUN_X3 = 600;
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

/** A Dare's target on a level (§2.6 table), sized from what the level offers. */
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
 * A level's Dares: the first of its concepts whose Dare fits the level (the mechanic it needs is on,
 * the level offers it), else a core verb drawn from (seed, 'dare', id); finales offer a second: a boss
 * finale the parry Dare, a teaching finale another core verb.
 */
function assignFeats(id: number, seed: number, concepts: readonly ConceptId[], lengthMinutes: number, dayLen: number, daylightTicks: number, flakes: number, keptFlares: number, bake: LevelBake | null): readonly FeatSpec[] {
  const fits = (k: FeatKind): boolean => dareFits(k, id, concepts, keptFlares, bake, (lengthMinutes / 720) * dayLen);
  const spec = (k: FeatKind): FeatSpec => Object.freeze({ kind: k, target: dareTarget(k, lengthMinutes, dayLen, daylightTicks, flakes, keptFlares, bake) });
  const rng = rngFor(seed, 'dare', id);
  // A core verb the level has taught (SWINGs from their own lesson on), else a last resort the level
  // offers (fix round 2: L4 used to fall back to an unplayable 'swings'), else 'swings'.
  const taught = (k: FeatKind): boolean => k !== 'swings' || id >= teachLevel('swing');
  const fallback = (not: FeatKind | null): FeatKind => {
    const pool = FALLBACK_DARES.filter((k) => k !== not && taught(k) && fits(k));
    if (pool.length > 0) return rng.pick(pool);
    return LAST_DARES.find((k) => k !== not && fits(k)) ?? 'swings';
  };
  let first: FeatKind | null = null;
  for (const c of concepts) {
    const k = DARE_OF[c];
    if (c !== 'flare' && fits(k)) {
      first = k;
      break;
    }
  }
  if (first === null) first = concepts.includes('flare') && fits('parry') && !isBossFinale(id) ? 'parry' : fallback(null);
  const out = [spec(first)];
  if (id % LEVELS_PER_CHAPTER === 0) {
    const second = isBossFinale(id) && fits('parry') && first !== 'parry' ? 'parry' : fallback(first);
    if (second !== first) out.push(spec(second));
  }
  return Object.freeze(out);
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
