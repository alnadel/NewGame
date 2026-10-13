// The Journey's concept catalog (CAMPAIGN_PLAN §3): forty gameplay modifiers, each with its display
// data and either a `tune` (knobs dayParams() applies on top of the day table and the forecast) or
// a behaviour rule the sim consults through SimState.mods. Pure data: this module imports only
// types. The level table that composes them is src/config/campaign.ts (which re-exports all of this).

import type { BiomeId } from './days.ts';
import type { ForecastId } from './forecasts.ts';

export type ConceptId =
  | 'drag'
  | 'flakes'
  | 'cloud'
  | 'noon'
  | 'oldtown'
  | 'glare'
  | 'swing'
  | 'gate'
  | 'breezy'
  | 'long'
  | 'heat'
  | 'overcast'
  | 'dazzle'
  | 'market'
  | 'sprint'
  | 'stroll'
  | 'giants'
  | 'lowland'
  | 'sparse'
  | 'dense'
  | 'drought'
  | 'fleet'
  | 'thaw'
  | 'frosty'
  | 'ration'
  | 'meltfast'
  | 'hardy'
  | 'flurry'
  | 'heavy'
  | 'slippery'
  | 'clockwork'
  | 'gusts'
  | 'lock'
  | 'fog'
  | 'blind'
  | 'eclipse'
  | 'sunset'
  | 'moonlit'
  | 'marathon'
  | 'boss';

/**
 * Concept families. A composed level never carries two concepts of the same kind, except 'world'
 * (CAMPAIGN_PLAN §3). 'dial' (sun-control rules: heavy, slippery, clockwork, gusts, lock) is an
 * addition to the plan's list so that a control concept can share a level with a time-of-day one
 * ('sun': noon, sunset, moonlit, marathon, boss), which it could not if both were 'sun'.
 */
export type ConceptKind = 'teach' | 'world' | 'sun' | 'dial' | 'chill' | 'sky' | 'goal';

/**
 * What a concept changes on the day row (after the forecast). Multipliers multiply, offsets add,
 * overrides replace (the last concept in the level's list wins); anything left out keeps the day's
 * value. Behaviour concepts (eclipse, gusts, lock, clockwork, moonlit's palette, fog, blind) have
 * no tune entry for their rule: the sim and the renderer read SimState.mods.
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
  /** Gazing balls every N s of the day, the first at N/2 (override; 0 = none). */
  readonly ballEvery?: number;
  /** Flakes per cluster (override). */
  readonly flakesPerCluster?: number;
  /** Flake cluster spacing ×. */
  readonly clusterGap?: number;
  /** Lit seconds until a flake melts (override; Infinity = never). */
  readonly meltBudget?: number;
  /** Drain ×. */
  readonly drainMul?: number;
  /** Daylight regeneration ×. */
  readonly regenMul?: number;
  /** Max Chill (override; Chill starts there too). */
  readonly maxChill?: number;
  /** Sun follow-rate cap (°/s; override). */
  readonly sunFollow?: number;
  /** Coasting factor per tick (override; 0 = the sun never coasts). */
  readonly sunFriction?: number;
  /** Walk speed × (the clock is unchanged: the level covers more or less ground per minute). */
  readonly walkMul?: number;
  /** Noon elevation (°; override). */
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
  /** The level's goal kind. */
  readonly goal?: 'flakes' | 'snow';
  /** Fixed drain (boss) or a cap on the level's drain (lock, gusts: the validator does not model them). */
  readonly drain?: number;
  readonly drainCap?: number;
}

export interface Concept {
  readonly id: ConceptId;
  readonly name: string;
  readonly blurb: string;
  /** Glyph id for the UI (src/ui glyphs; the ids below are a contract for the UI batch). */
  readonly icon: string;
  readonly kind: ConceptKind;
  readonly tune?: DayTuning;
  readonly level?: ConceptLevel;
}

const concept = (
  id: ConceptId,
  name: string,
  kind: ConceptKind,
  blurb: string,
  icon: string,
  tune?: DayTuning,
  level?: ConceptLevel,
): Concept => {
  const c: Concept = { id, name, blurb, icon, kind, ...(tune ? { tune: Object.freeze(tune) } : {}), ...(level ? { level: Object.freeze(level) } : {}) };
  return Object.freeze(c);
};

/** Coasting factor per tick for a decay of 0.35/s: e^(−0.35/60) (precomputed; no Math.exp in config). */
const SLIPPERY_FRICTION = 0.994183647521183;

/** Every concept in teaching order (level 1 … 40). */
export const CONCEPT_IDS: readonly ConceptId[] = Object.freeze([
  'drag', 'flakes', 'cloud', 'noon', 'oldtown', 'glare', 'swing', 'gate', 'breezy', 'long',
  'heat', 'overcast', 'dazzle', 'market', 'sprint', 'stroll', 'giants', 'lowland', 'sparse', 'dense',
  'drought', 'fleet', 'thaw', 'frosty', 'ration', 'meltfast', 'hardy', 'flurry', 'heavy', 'slippery',
  'clockwork', 'gusts', 'lock', 'fog', 'blind', 'eclipse', 'sunset', 'moonlit', 'marathon', 'boss',
] as ConceptId[]);

export const CONCEPTS: Readonly<Record<ConceptId, Concept>> = Object.freeze({
  drag: concept('drag', 'First Shade', 'teach', 'Drag anywhere: you are the sun. Every shadow swings with you.', 'drag', { cloudCount: 0 }),
  flakes: concept('flakes', 'Flake Trail', 'goal', 'Collect the flakes before the sun melts them. Shade keeps them whole.', 'flake', { flakesPerCluster: 4 }, { goal: 'flakes' }),
  cloud: concept('cloud', 'Umbrella', 'sky', 'Clouds are moving shade. Ride one while it lasts.', 'cloud', { waitersOnly: true }),
  noon: concept('noon', 'High Noon', 'sun', 'A high sun throws short shadows. Noon is the boss.', 'sun', { epsNoon: 48 }, { startMinute: 270, lengthMinutes: 180 }),
  oldtown: concept('oldtown', 'Old Town', 'world', 'Walls, arches and stalls: taller casters, longer shade.', 'town', undefined, { biome: 'oldtown' }),
  glare: concept('glare', 'Glass Garden', 'world', 'Gazing balls throw light back. Red arcs on the dial are glare.', 'glare', { ballEvery: 12 }),
  swing: concept('swing', 'SWING!', 'goal', 'Hand the shade from one caster to the next with a big turn. SWINGs pay Snow.', 'swing', undefined, { goal: 'snow' }),
  gate: concept('gate', 'The Gate', 'world', 'An arch halfway along. Walk under it fully shaded for +10 Snow.', 'gate'),
  breezy: concept('breezy', 'Breezy', 'sky', 'More clouds, moving fast.', 'wind', undefined, { forecast: 'breezy' }),
  long: concept('long', 'Long Shadows', 'sky', 'A low sun all day: shadows reach far.', 'shadow', undefined, { forecast: 'long' }),
  heat: concept('heat', 'Heat Wave', 'sky', 'A higher sun. Extra flakes, Snow ×1.5.', 'heat', undefined, { forecast: 'heat' }),
  overcast: concept('overcast', 'Overcast', 'sky', 'Big slow clouds, sparse cover.', 'overcast', undefined, { forecast: 'overcast' }),
  dazzle: concept('dazzle', 'Dazzle', 'sky', 'Gazing balls in the meadow.', 'dazzle', undefined, { forecast: 'dazzle', biome: 'meadow' }),
  market: concept('market', 'Market Day', 'sky', 'Stalls and gate arches crowd the street.', 'market', undefined, { forecast: 'market', biome: 'oldtown' }),
  sprint: concept('sprint', 'Sprint', 'world', 'Nubs walks fast. Shade comes and goes quicker.', 'sprint', { walkMul: 1.35 }),
  stroll: concept('stroll', 'Stroll', 'world', 'Nubs dawdles, and the sun bites harder.', 'stroll', { walkMul: 0.75, drainMul: 1.25 }),
  giants: concept('giants', 'Giants', 'world', 'Big casters, long shadows.', 'giant', { heightScale: 1.6 }),
  lowland: concept('lowland', 'Lowland', 'world', 'Everything is squat. Shade is short.', 'low', { heightScale: 0.6 }),
  sparse: concept('sparse', 'Wide Open', 'world', 'Casters stand far apart.', 'sparse', { spacing: 1.45 }),
  dense: concept('dense', 'Crowded', 'world', 'Casters press in close to the trail.', 'dense', { spacing: 0.7, latMax: -10 }),
  drought: concept('drought', 'Drought', 'sky', 'Not a cloud in the sky.', 'drought', { cloudCount: 0 }),
  fleet: concept('fleet', 'Cloud Fleet', 'sky', 'A fleet of small clouds.', 'fleet', { cloudCount: 3, cloudRx: 0.8 }),
  thaw: concept('thaw', 'Thin Ice', 'chill', 'Chill drains fast in the sun.', 'thaw', { drainMul: 1.4 }),
  frosty: concept('frosty', 'Frosty', 'chill', 'Shade refills Chill in a flash.', 'frost', { regenMul: 2.5, maxChill: 100 }),
  ration: concept('ration', 'Rationed', 'chill', 'Only half a tank of Chill.', 'ration', { maxChill: 50 }),
  meltfast: concept('meltfast', 'Quick Melt', 'goal', 'Flakes melt in half a second of sun.', 'melt', { meltBudget: 0.5 }),
  hardy: concept('hardy', 'Hardy Flakes', 'goal', 'These flakes never melt. Collect them all.', 'hardy', { meltBudget: Infinity, flakesPerCluster: 5 }, { goal: 'flakes' }),
  flurry: concept('flurry', 'Flurry', 'goal', 'Flakes everywhere: big clusters, close together.', 'flurry', { flakesPerCluster: 7, clusterGap: 0.6 }),
  heavy: concept('heavy', 'Heavy Sun', 'dial', 'The sun is slow to follow and never coasts.', 'heavy', { sunFollow: 220, sunFriction: 0 }),
  slippery: concept('slippery', 'Slippery Sun', 'dial', 'A flick coasts a long way. Catch it.', 'slippery', { sunFriction: SLIPPERY_FRICTION }),
  clockwork: concept('clockwork', 'Clockwork', 'dial', 'The sun snaps to 30° steps when you let go.', 'clockwork'),
  gusts: concept('gusts', 'Gusts', 'dial', 'Every 8 s a gust of wind pushes the sun for 2 s.', 'gusts', undefined, { drainCap: 40 }),
  lock: concept('lock', 'Sun Lock', 'dial', 'Every 7 s the sun locks for a moment. Plan ahead.', 'lock', undefined, { drainCap: 40 }),
  fog: concept('fog', 'Fog', 'teach', 'You cannot see far ahead. The dial shows only the now.', 'fog'),
  blind: concept('blind', 'No Dial', 'teach', 'The safe arcs are hidden. Read the shadows.', 'blind'),
  eclipse: concept('eclipse', 'Eclipse', 'sky', 'Halfway along, the sun goes dark for 6 s. Rest in the dark, then it\'s back.', 'eclipse'),
  sunset: concept('sunset', 'Sunset Run', 'sun', 'From 3 PM into dusk: the shadows grow as you go.', 'sunset', undefined, { startMinute: 540, lengthMinutes: 180 }),
  moonlit: concept('moonlit', 'Moonlit', 'sun', 'A night walk under a moon sun. Low light, gentle drain.', 'moon', { epsNoon: 30, drainMul: 0.5 }),
  marathon: concept('marathon', 'Marathon', 'sun', 'A day and a half. Chill refills through the night.', 'marathon', undefined, { lengthMinutes: 1080 }),
  boss: concept('boss', 'Heat Dome', 'sun', 'The sun stands almost overhead. Shade is scarce.', 'boss', { epsNoon: 80 }, { startMinute: 180, lengthMinutes: 360, drain: 55 }),
} satisfies Record<ConceptId, Concept>);

/** Pairs that never share a level (they pull the same knob opposite ways). */
export const CONCEPT_CONFLICTS: readonly (readonly [ConceptId, ConceptId])[] = Object.freeze([
  ['sprint', 'stroll'],
  ['giants', 'lowland'],
  ['sparse', 'dense'],
  ['drought', 'cloud'],
  ['drought', 'fleet'],
  ['drag', 'blind'],
  ['oldtown', 'dazzle'],
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
  for (const [x, y] of CONCEPT_CONFLICTS) if ((x === a && y === b) || (x === b && y === a)) return false;
  return true;
}

/**
 * The day tuning of a list of concepts, folded in order: multipliers multiply, offsets add,
 * overrides take the last value. Returns null when nothing is tuned.
 */
export function foldTuning(mods: readonly ConceptId[]): DayTuning | null {
  let out: {
    spacing?: number;
    latMax?: number;
    heightScale?: number;
    cloudCount?: number;
    cloudRx?: number;
    waitersOnly?: boolean;
    ballEvery?: number;
    flakesPerCluster?: number;
    clusterGap?: number;
    meltBudget?: number;
    drainMul?: number;
    regenMul?: number;
    maxChill?: number;
    sunFollow?: number;
    sunFriction?: number;
    walkMul?: number;
    epsNoon?: number;
  } | null = null;
  for (const id of mods) {
    const t = CONCEPTS[id].tune;
    if (!t) continue;
    const o = out ?? (out = {});
    if (t.spacing !== undefined) o.spacing = (o.spacing ?? 1) * t.spacing;
    if (t.latMax !== undefined) o.latMax = (o.latMax ?? 0) + t.latMax;
    if (t.heightScale !== undefined) o.heightScale = (o.heightScale ?? 1) * t.heightScale;
    if (t.cloudCount !== undefined) o.cloudCount = (o.cloudCount ?? 1) * t.cloudCount;
    if (t.cloudRx !== undefined) o.cloudRx = (o.cloudRx ?? 1) * t.cloudRx;
    if (t.waitersOnly !== undefined) o.waitersOnly = t.waitersOnly;
    if (t.ballEvery !== undefined) o.ballEvery = t.ballEvery;
    if (t.flakesPerCluster !== undefined) o.flakesPerCluster = t.flakesPerCluster;
    if (t.clusterGap !== undefined) o.clusterGap = (o.clusterGap ?? 1) * t.clusterGap;
    if (t.meltBudget !== undefined) o.meltBudget = t.meltBudget;
    if (t.drainMul !== undefined) o.drainMul = (o.drainMul ?? 1) * t.drainMul;
    if (t.regenMul !== undefined) o.regenMul = (o.regenMul ?? 1) * t.regenMul;
    if (t.maxChill !== undefined) o.maxChill = t.maxChill;
    if (t.sunFollow !== undefined) o.sunFollow = t.sunFollow;
    if (t.sunFriction !== undefined) o.sunFriction = t.sunFriction;
    if (t.walkMul !== undefined) o.walkMul = (o.walkMul ?? 1) * t.walkMul;
    if (t.epsNoon !== undefined) o.epsNoon = t.epsNoon;
  }
  return out;
}
