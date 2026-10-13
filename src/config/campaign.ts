// The Journey campaign (CAMPAIGN_PLAN §2-§3): 200 levels in 20 chapters. Levels 1-40 each introduce
// one concept of the catalog (config/concepts.ts) in teaching order; levels 41-200 compose two or
// three concepts per level around the chapter's theme, with drain and length rising by a chapter
// curve and star thresholds scaling with the level's length. Everything is a pure function of the
// level id (seed = hashString(`journey-${id}`); composition draws from rngFor(seed, 'campaign', id)),
// so buildCampaign() is deterministic and the table is data.

import { CONCEPT_IDS, CONCEPTS, conceptsCompatible, foldTuning, type ConceptId } from './concepts.ts';
import { dayParams, dayPlan, type BiomeId } from './days.ts';
import type { ForecastId } from './forecasts.ts';
import { hashString, rngFor } from './rng.ts';
import { TUNING } from './tuning.ts';

export type { Concept, ConceptId, ConceptKind, ConceptLevel, DayTuning } from './concepts.ts';
export { CONCEPT_CONFLICTS, CONCEPT_IDS, CONCEPTS, conceptsCompatible, foldTuning } from './concepts.ts';

export type GoalKind = 'finish' | 'flakes' | 'snow';

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
  /** 'finish' target 0; 'flakes' N; 'snow' N. */
  readonly goal: { readonly kind: GoalKind; readonly target: number };
  /**
   * Star 1 is passing; one star for flakes ≥ `flakes`, one for a cool run: at most `sunSec` seconds
   * in the sun (∫f dt, RunStats.litTotal) with the lowest Chill never below `minChill`.
   */
  readonly stars: { readonly flakes: number; readonly minChill: number; readonly sunSec: number };
  /** Chill/s at f = 1 (the campaign ignores the comfort ladder). */
  readonly drain: number;
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
 * from dawn), their finales at noon; composed chapters grow 360 → 720 in 30-minute steps, their
 * first two levels a step shorter.
 */
function curveLength(id: number): number {
  const c = chapterOf(id);
  const i = (id - 1) % LEVELS_PER_CHAPTER;
  if (c <= 4) return i === 9 ? 360 : (TEACH_LENGTH[c - 1] as number);
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
const COMPOSE_EXCLUDED: ReadonlySet<ConceptId> = new Set<ConceptId>(['drag', 'boss', 'marathon']);

/** Draws the concepts of composed level `id` (41-200): the chapter's headline first, two or three in all. */
function composeConcepts(id: number, seed: number, chapter: Chapter): ConceptId[] {
  const rng = rngFor(seed, 'campaign', id);
  const i = (id - 1) % LEVELS_PER_CHAPTER;
  const finale = i === LEVELS_PER_CHAPTER - 1;
  const n = finale ? 3 : i < 3 ? 2 : rng.next() < 0.45 ? 3 : 2;
  const fits = (c: ConceptId): boolean => (CONCEPTS[c].level?.biome ?? chapter.biome) === chapter.biome;
  const signature = chapter.concepts.filter(fits);
  const pool = CONCEPT_IDS.filter((c) => fits(c) && !COMPOSE_EXCLUDED.has(c));
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
  const introduces: ConceptId | null = id <= CONCEPT_IDS.length ? (CONCEPT_IDS[id - 1] as ConceptId) : null;
  const concepts: readonly ConceptId[] = introduces ? [introduces] : composeConcepts(id, seed, chapter);
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
  } else if (goal === 'snow') {
    target = Math.max(5, Math.round(0.7 * flakes * p.snowMult));
  }
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
  });
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

/** True when the level's goal is met by these stats (a 'finish' goal is met by reaching the line). */
export function goalMet(level: LevelDef, stats: LevelStats): boolean {
  const g = level.goal;
  if (g.kind === 'flakes') return stats.flakes >= g.target;
  if (g.kind === 'snow') return stats.snow >= g.target;
  return true;
}

/**
 * Stars for a run that reached the finish line with these stats: 0 when the goal is not met, else
 * 1, +1 if flakes ≥ stars.flakes, +1 for a cool run (lit ≤ stars.sunSec s and lowest Chill ≥ stars.minChill).
 */
export function starsFor(level: LevelDef, stats: LevelStats): 0 | 1 | 2 | 3 {
  if (!goalMet(level, stats)) return 0;
  const two = stats.flakes >= level.stars.flakes;
  const three = stats.minChill >= level.stars.minChill && (stats.litTotal ?? 0) <= level.stars.sunSec;
  return two && three ? 3 : two || three ? 2 : 1;
}
