// The Journey's concept catalog (CAMPAIGN_PLAN §3): forty gameplay modifiers, each with its display
// data and either a `tune` (knobs dayParams() applies on top of the day table and the forecast) or
// a behaviour rule the sim consults through SimState.mods. Pure data: this module imports only
// types. The level table that composes them is src/config/campaign.ts (which re-exports all of this).

import type { BiomeId } from './days.ts';
import type { ForecastId } from './forecasts.ts';

/**
 * Every concept: the first forty in teaching order (level n teaches CONCEPT_IDS[n − 1], n ≤ 40).
 * v1.5 teaches the three core mechanics in chapter 1 (deep shade at 5, Sunflowers at 8, Cold Snap
 * at 10, the chapter's finale) and keeps every other teaching level where it was except Old Town
 * (11), Gates (13), Long Shadows (14), Heat Wave (15) and Mirror Sun … Giants (16-20, three places
 * later); Wide Open, Crowded and Drought, plain knob concepts, are no longer taught on a level of
 * their own and appear only in composed levels (41-200). v1.6 (docs/V1_6_PLAN.md §2.3, §2.5) teaches
 * Glass Flakes at 21 (Lowland's slot) and the Solar Flare at 38 (Moon Sun's); Lowland and Moon Sun
 * stay composed concepts (COMPOSE_ORDER in campaign.ts is unchanged).
 */
export const CONCEPT_IDS = Object.freeze([
  'drag', 'flakes', 'cloud', 'noon', 'deep', 'glare', 'swing', 'bloom', 'breezy', 'snap',
  'oldtown', 'overcast', 'gate', 'long', 'heat', 'dazzle', 'market', 'sprint', 'stroll', 'giants',
  'brittle', 'fleet', 'thaw', 'frosty', 'ration', 'meltfast', 'hardy', 'flurry', 'heavy', 'slippery',
  'clockwork', 'gusts', 'lock', 'fog', 'blind', 'eclipse', 'sunset', 'flare', 'marathon', 'boss',
  'sparse', 'dense', 'drought', 'lowland', 'moonlit',
] as const);

/** Levels 1..TEACH_LEVELS each teach the next concept of CONCEPT_IDS. */
export const TEACH_LEVELS = 40;

/**
 * The v1.5 core mechanics, each taught by its own concept level: off on every level before it, on
 * from it on (and always on outside the Journey). See mechanicsOf() in campaign.ts.
 */
export const MECHANIC_CONCEPTS = Object.freeze({ deep: 'deep', buds: 'bloom', snap: 'snap' } as const);

export type ConceptId = (typeof CONCEPT_IDS)[number];

/**
 * Concept families. A composed level never carries two concepts of the same kind, except 'world'
 * (CAMPAIGN_PLAN §3). 'dial' (sun-control rules: mirror, heavy, slippery, clockwork, gusts, lock)
 * lets a control concept share a level with a time-of-day one ('sun').
 */
export type ConceptKind = 'teach' | 'world' | 'sun' | 'dial' | 'chill' | 'sky' | 'goal';

/**
 * What a concept changes on the day row (after the forecast). Multipliers multiply, latMax adds,
 * the rest override (the last concept in the level's list wins); anything left out keeps the day's
 * value. Behaviour concepts (dazzle's mirror, eclipse, gusts, lock, clockwork, moonlit's palette,
 * fog, blind) have no tune entry for their rule: the sim and the renderer read SimState.mods.
 */
export interface DayTuning {
  /** Caster spacing ×. */
  readonly spacing?: number;
  /** latMax + (u). */
  readonly latMax?: number;
  /** Caster part heights × (applied when the catalog builds parts; rescue rocks and gate arches are not scaled). */
  readonly heightScale?: number;
  /** Cloud count × (0 = no clouds at all). */
  readonly cloudCount?: number;
  /** Cloud radii ×. */
  readonly cloudRx?: number;
  /** Clouds never overtake: every cloud is a waiter. */
  readonly waitersOnly?: boolean;
  /** Gazing balls every N s of the day, the first at N/2 (0 = none). */
  readonly ballEvery?: number;
  /** Flakes per cluster. */
  readonly flakesPerCluster?: number;
  /** Flake cluster spacing ×. */
  readonly clusterGap?: number;
  /** Lit seconds until a flake melts (Infinity = never). */
  readonly meltBudget?: number;
  /** Drain ×. */
  readonly drainMul?: number;
  /** Daylight regeneration ×. */
  readonly regenMul?: number;
  /** Max Chill (Chill starts there too). */
  readonly maxChill?: number;
  /** Sun follow-rate cap (°/s). */
  readonly sunFollow?: number;
  /** Coasting factor per tick (0 = the sun never coasts). */
  readonly sunFriction?: number;
  /** Walk speed × (the clock is unchanged: the level covers more or less ground per minute). */
  readonly walkMul?: number;
  /** Noon elevation (°). */
  readonly epsNoon?: number;
}

/** How a concept shapes the level that carries it (beyond the day tuning). */
export interface ConceptLevel {
  /** The level's biome (oldtown) — else the chapter's, or the forecast's requirement. */
  readonly biome?: BiomeId;
  /** The level's forecast. */
  readonly forecast?: ForecastId;
  /** Start of the level, minutes after 6:00 AM (time-of-day concepts). */
  readonly startMinute?: number;
  /** Length in in-game minutes (time-of-day concepts). */
  readonly lengthMinutes?: number;
  /** The level's goal kind (composed levels too; the teaching levels' verb goals live in campaign.ts). */
  readonly goal?: 'flakes';
  /** A cap on the level's effective drain (lock, gusts, eclipse: rules the validator does not model). */
  readonly drainCap?: number;
  /**
   * What the concept is worth in drain points (Chill/s at f = 1): the campaign builder takes it off
   * the level's drain so a hard concept does not stack on the difficulty curve (negative: an easy
   * one adds drain). Calibrated with `sim --campaign --tries` on the human model.
   */
  readonly cost?: number;
}

export interface Concept {
  readonly id: ConceptId;
  /** The concept's own short name ("Glare"): the intro card's concept row and the combo lists. */
  readonly name: string;
  /** The title of the level that teaches it ("Glass Garden"). */
  readonly title: string;
  readonly blurb: string;
  /** Glyph id for the UI (src/ui glyphs; the ids below are a contract for the UI batch). */
  readonly icon: string;
  readonly kind: ConceptKind;
  readonly tune?: DayTuning;
  readonly level?: ConceptLevel;
}

const concept = (id: ConceptId, name: string, title: string, kind: ConceptKind, blurb: string, icon: string, tune?: DayTuning, level?: ConceptLevel): Concept =>
  Object.freeze({ id, name, title, blurb, icon, kind, ...(tune ? { tune: Object.freeze(tune) } : {}), ...(level ? { level: Object.freeze(level) } : {}) });

/** Coasting factor per tick for a decay of 0.35/s: e^(−0.35/60) (precomputed; no Math.exp in config). */
const SLIPPERY_FRICTION = 0.994183647521183;

export const CONCEPTS: Readonly<Record<ConceptId, Concept>> = Object.freeze({
  deep: concept('deep', 'Deep Shade', 'Double Shade', 'teach', 'Where two shadows overlap the shade runs deep: Chill, the multiplier and the frost meter fill twice as fast.', 'deep'),
  bloom: concept('bloom', 'Sunflowers', 'Sun Garden', 'teach', 'Buds face the sun. Shine from their side (gold on the dial) and they bloom into tall sunflowers: new shade.', 'bloom'),
  snap: concept('snap', 'Cold Snap', 'Frost Cloud', 'teach', 'Shade, flakes and SWINGs fill the frost meter. Full? Swipe down: a frosty cloud rides over Nubs.', 'snap', undefined, { cost: 3 }),
  drag: concept('drag', 'Sun Drag', 'First Shade', 'teach', 'Drag anywhere: you are the sun. Every shadow swings with you.', 'drag', { cloudCount: 0 }),
  flakes: concept('flakes', 'Snowflakes', 'Flake Trail', 'goal', 'Collect the flakes before the sun melts them. Shade keeps them whole.', 'flake', { flakesPerCluster: 4 }, { goal: 'flakes', cost: 3 }),
  cloud: concept('cloud', 'Clouds', 'Umbrella', 'sky', 'Clouds are moving shade. Ride one while it lasts.', 'cloud', { waitersOnly: true }, { cost: -2 }),
  noon: concept('noon', 'Noon', 'High Noon', 'sun', 'A high sun throws short shadows. Noon is the boss.', 'sun', { epsNoon: 48 }, { startMinute: 270, lengthMinutes: 180 }),
  oldtown: concept('oldtown', 'Old Town', 'Cobblestones', 'world', 'Walls, arches and stalls: taller casters, longer shade.', 'town', undefined, { biome: 'oldtown', cost: -5 }),
  glare: concept('glare', 'Glare', 'Glass Garden', 'world', 'Gazing balls throw light back. Red arcs on the dial are glare.', 'glare', { ballEvery: 12 }, { cost: 5 }),
  swing: concept('swing', 'SWING', 'Hand-off', 'goal', 'Hand the shade from one caster to the next with a big turn. SWINGs pay Snow.', 'swing', undefined, { cost: -4 }),
  gate: concept('gate', 'Gates', 'The Gate', 'world', 'An arch halfway along. Walk under it fully shaded for +10 Snow.', 'gate', undefined, { cost: 3 }),
  breezy: concept('breezy', 'Breeze', 'Kite Weather', 'sky', 'More clouds, moving fast.', 'wind', undefined, { forecast: 'breezy', cost: -1 }),
  long: concept('long', 'Long Shadows', 'Autumn Light', 'sky', 'A low sun all day, casters set back from the path: only long shadows reach.', 'shadow', undefined, { forecast: 'long', cost: 8 }),
  heat: concept('heat', 'Heat Wave', 'Hot Spell', 'sky', 'A higher sun. Extra flakes, Snow ×1.5.', 'heat', undefined, { forecast: 'heat', cost: 4 }),
  overcast: concept('overcast', 'Overcast', 'Grey Day', 'sky', 'Big slow clouds, sparse cover.', 'overcast', undefined, { forecast: 'overcast', cost: -6 }),
  dazzle: concept('dazzle', 'Mirror Sun', 'Looking Glass', 'dial', 'The sun turns against your drag: drag left to swing it right.', 'dazzle', undefined, { cost: 5 }),
  market: concept('market', 'Market Day', 'Stall Street', 'sky', 'Stalls and gate arches crowd the street.', 'market', undefined, { forecast: 'market', biome: 'oldtown', cost: 2 }),
  sprint: concept('sprint', 'Sprint', 'Hurry Up', 'world', 'Nubs walks fast. Shade comes and goes quicker.', 'sprint', { walkMul: 1.35 }, { cost: 13 }),
  stroll: concept('stroll', 'Stroll', 'Dawdle', 'world', 'Nubs dawdles, and the sun bites harder.', 'stroll', { walkMul: 0.75, drainMul: 1.25 }, { cost: -12 }),
  giants: concept('giants', 'Giants', 'Tall Timber', 'world', 'Big casters, long shadows.', 'giant', { heightScale: 1.6 }, { cost: -4 }),
  lowland: concept('lowland', 'Lowland', 'Short Grass', 'world', 'Everything is squat. Shade is short.', 'low', { heightScale: 0.6 }, { cost: 11 }),
  sparse: concept('sparse', 'Wide Open', 'Big Sky', 'world', 'Casters stand far apart.', 'sparse', { spacing: 1.45 }, { cost: 7 }),
  dense: concept('dense', 'Crowded', 'Thicket', 'world', 'Casters press in close to the trail.', 'dense', { spacing: 0.7, latMax: -10 }, { cost: -7 }),
  drought: concept('drought', 'Drought', 'Cloudless', 'sky', 'Not a cloud in the sky.', 'drought', { cloudCount: 0 }, { cost: 12 }),
  fleet: concept('fleet', 'Cloud Fleet', 'Cloud Hopping', 'sky', 'Open country under a fleet of clouds: hop from cloud to cloud.', 'fleet', { cloudCount: 3, spacing: 1.6 }, { cost: 5 }),
  thaw: concept('thaw', 'Sunburn', 'Thin Ice', 'chill', 'Shade heals slowly: every second in the sun counts. Flakes still cool you.', 'thaw', { regenMul: 0.45 }, { cost: 13 }),
  frosty: concept('frosty', 'Frost', 'Frosty', 'chill', 'Shade refills Chill in a flash.', 'frost', { regenMul: 2.5, maxChill: 100 }, { cost: -12 }),
  ration: concept('ration', 'Half Tank', 'Rationed', 'chill', 'Only half a tank of Chill: no long walks in the sun.', 'ration', { maxChill: 50 }, { cost: 12 }),
  meltfast: concept('meltfast', 'Quick Melt', 'Snatch', 'goal', 'Flakes melt in half a second of sun: shade them before you reach them.', 'melt', { meltBudget: 0.5 }, { cost: 4 }),
  hardy: concept('hardy', 'Hardy Flakes', 'Snow Pile', 'goal', 'These flakes never melt. Collect them all.', 'hardy', { meltBudget: Infinity, flakesPerCluster: 5 }, { goal: 'flakes', cost: -2 }),
  flurry: concept('flurry', 'Flurry', 'Snow Globe', 'goal', 'Flakes everywhere: big clusters, close together. Each one cools Nubs.', 'flurry', { flakesPerCluster: 7, clusterGap: 0.6 }, { cost: -4 }),
  heavy: concept('heavy', 'Heavy Sun', 'Slow Hands', 'dial', 'The sun is slow to follow and never coasts.', 'heavy', { sunFollow: 220, sunFriction: 0 }, { cost: 5 }),
  slippery: concept('slippery', 'Slippery Sun', 'Ice Rink', 'dial', 'A flick coasts a long way. Catch it.', 'slippery', { sunFriction: SLIPPERY_FRICTION }, { cost: 9 }),
  clockwork: concept('clockwork', 'Clockwork', 'Cuckoo', 'dial', 'The sun snaps to 30° steps when you let go.', 'clockwork', undefined, { cost: -1 }),
  gusts: concept('gusts', 'Gusts', 'Windy Day', 'dial', 'Every 8 s a gust of wind pushes the sun for 2 s.', 'gusts', undefined, { drainCap: 40, cost: 2 }),
  lock: concept('lock', 'Sun Lock', 'Stop and Go', 'dial', 'Every 7 s the sun locks for a moment. Plan ahead.', 'lock', undefined, { drainCap: 40, cost: 3 }),
  fog: concept('fog', 'Fog', 'Pea Soup', 'teach', 'You cannot see far ahead. The dial shows only the now.', 'fog', undefined, { cost: 3 }),
  blind: concept('blind', 'No Dial', 'Blindfold', 'teach', 'The safe arcs are hidden. Read the shadows.', 'blind', undefined, { cost: 3 }),
  eclipse: concept('eclipse', 'Eclipse', 'Moon Shadow', 'sky', 'Halfway along, the sun goes dark for 6 s and comes back on the far side. Be ready to swing!', 'eclipse', undefined, { drainCap: 45, cost: 4 }),
  sunset: concept('sunset', 'Sunset', 'Sunset Run', 'sun', 'From 3 PM into dusk: the shadows grow as you go.', 'sunset', undefined, { startMinute: 540, lengthMinutes: 180, cost: -16 }),
  moonlit: concept('moonlit', 'Moon Sun', 'Moonlit', 'sun', 'A night walk under a moon sun. Low light, gentle drain.', 'moon', { epsNoon: 30, drainMul: 0.7 }, { cost: 5 }),
  marathon: concept('marathon', 'Marathon', 'The Long Walk', 'sun', 'A day and a half. Chill refills through the night.', 'marathon', undefined, { lengthMinutes: 1080, cost: 9 }),
  brittle: concept('brittle', 'Glass Flakes', 'Sugar Glass', 'goal', 'Glass flakes melt fast. The white arc saves them, if you can spare the sun.', 'glass', undefined, { cost: 3 }),
  flare: concept('flare', 'Solar Flare', 'Sunspots', 'sky', 'When the sun swells, slide to the frost-rimmed shade before the flash.', 'flare', undefined, { cost: 4 }),
  boss: concept('boss', 'Heat Dome', 'Into the Dome', 'sun', 'The sun stands almost overhead. Shade is scarce.', 'boss', { epsNoon: 80 }, { startMinute: 180, lengthMinutes: 360, cost: 12 }),
} satisfies Record<ConceptId, Concept>);

/** Pairs that never share a level (they pull the same knob opposite ways). */
export const CONCEPT_CONFLICTS: readonly (readonly [ConceptId, ConceptId])[] = Object.freeze([
  ['sprint', 'stroll'],
  ['giants', 'lowland'],
  ['sparse', 'dense'],
  ['drought', 'cloud'],
  ['drought', 'fleet'],
  ['sparse', 'fleet'],
  ['drag', 'blind'],
  // Goals stay fair: no Snow or flake goal on a level whose pace or drain melts the flakes.
  ['swing', 'sprint'],
  ['swing', 'thaw'],
  ['swing', 'stroll'],
  ['swing', 'slippery'],
  ['flakes', 'sprint'],
  ['hardy', 'sprint'],
]);

/** True when concepts a and b may share a level: different kinds (or both 'world') and no conflict. */
export function conceptsCompatible(a: ConceptId, b: ConceptId): boolean {
  if (a === b) return false;
  const ka = CONCEPTS[a].kind;
  if (ka === CONCEPTS[b].kind && ka !== 'world') return false;
  return !CONCEPT_CONFLICTS.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}

/** DayTuning knobs that multiply when folded (latMax adds; the rest override). */
const MUL_KNOBS: ReadonlySet<string> = new Set(['spacing', 'heightScale', 'cloudCount', 'cloudRx', 'clusterGap', 'drainMul', 'regenMul', 'walkMul']);

/**
 * The day tuning of a list of concepts, folded in order: multipliers multiply, latMax adds,
 * overrides take the last value. Returns null when nothing is tuned.
 */
export function foldTuning(mods: readonly ConceptId[]): DayTuning | null {
  let out: Record<string, number | boolean> | null = null;
  for (const id of mods) {
    const t = CONCEPTS[id].tune;
    if (!t) continue;
    const o = (out ??= {});
    for (const [k, v] of Object.entries(t) as [string, number | boolean][]) {
      if (k === 'latMax') o[k] = ((o[k] as number | undefined) ?? 0) + (v as number);
      else if (MUL_KNOBS.has(k)) o[k] = ((o[k] as number | undefined) ?? 1) * (v as number);
      else o[k] = v;
    }
  }
  return out as DayTuning | null;
}
